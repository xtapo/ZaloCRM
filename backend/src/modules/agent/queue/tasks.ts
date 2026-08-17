/**
 * tasks.ts — Durable Work Queue operations for Agent Tasks
 *
 * Cung cấp 6 thao tác cốt lõi cho hàng đợi tác vụ:
 * 1. claimDue: Atomic pick & lock task đến hạn qua PostgreSQL FOR UPDATE SKIP LOCKED
 * 2. complete: Đánh dấu task hoàn thành (kiểm chứng lease)
 * 3. fail: Xử lý lỗi (chuyển pending với backoff mũ, hoặc dead nếu vượt maxAttempts)
 * 4. renewLease: Gia hạn lease trong lúc prepare chạy lâu (Heartbeat)
 * 5. reschedule: Lên lịch lại tác vụ có kiểm chứng lease
 * 6. reapExpired: Thu hồi các task running bị treo / quá hạn lease về pending
 */

import { prisma, type PrismaTx } from '../../../shared/database/prisma-client.js';
import type { Prisma, AgentTask } from '@prisma/client';

export class LeaseLostError extends Error {
  constructor(taskId: string, workerId?: string) {
    super(`Lease lost for task ${taskId}${workerId ? ` (worker: ${workerId})` : ''}`);
    this.name = 'LeaseLostError';
  }
}

export interface ClaimDueOptions {
  orgId: string;
  workerId: string;
  limit?: number;
  leaseMs?: number;
}

export interface CompleteOptions {
  orgId: string;
  taskId: string;
  workerId: string;
  result?: Prisma.InputJsonValue;
  tx?: PrismaTx;
}

export interface FailOptions {
  orgId: string;
  taskId: string;
  workerId: string;
  error: string;
  tx?: PrismaTx;
}

export interface RenewLeaseOptions {
  orgId: string;
  taskId: string;
  workerId: string;
  leaseMs?: number;
  tx?: PrismaTx;
}

export interface RescheduleOptions {
  orgId: string;
  taskId: string;
  workerId: string;
  runAt: Date;
  reason: string;
  tx?: PrismaTx;
}

export interface ReapExpiredOptions {
  orgId?: string;
  leaseGraceMs?: number;
}

export const MAX_CLAIMS = 10;

/**
 * 1. claimDue: Atomic claim các task đến hạn trong tenant qua SELECT ... FOR UPDATE SKIP LOCKED
 * - Bước 1: Khai tử các task pending đã chạm trần MAX_CLAIMS (10)
 * - Bước 2: Claim các task pending có claim_count < 10 (RETURNING không bao giờ chứa hàng dead)
 */
export async function claimDue(options: ClaimDueOptions): Promise<AgentTask[]> {
  const { orgId, workerId, limit = 10, leaseMs = 60_000 } = options;
  if (!orgId || !workerId) return [];

  const leaseUntil = new Date(Date.now() + leaseMs);
  const now = new Date();

  // 1a. Tách riêng câu khai tử trước khi pick task (Việc 2a)
  await prisma.$executeRaw`
    UPDATE "agent_tasks"
    SET 
      "status" = 'dead',
      "leased_by" = NULL,
      "leased_until" = NULL,
      "last_error" = '[INFRA] Max claim count exceeded',
      "updated_at" = ${now}
    WHERE "org_id" = ${orgId}
      AND "status" = 'pending'
      AND "claim_count" >= ${MAX_CLAIMS};
  `;

  // 1b. Claim các task pending đến hạn (claim_count < MAX_CLAIMS)
  const tasks = await prisma.$queryRaw<AgentTask[]>`
    UPDATE "agent_tasks"
    SET 
      "status" = 'running',
      "leased_by" = ${workerId},
      "leased_until" = ${leaseUntil},
      "claim_count" = "claim_count" + 1,
      "updated_at" = ${now}
    WHERE "id" IN (
      SELECT "id"
      FROM "agent_tasks"
      WHERE "org_id" = ${orgId}
        AND "status" = 'pending'
        AND "claim_count" < ${MAX_CLAIMS}
        AND "due_at" <= ${now}
      ORDER BY "priority" DESC, "due_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING 
      "id",
      "org_id" AS "orgId",
      "kind",
      "subject_type" AS "subjectType",
      "subject_id" AS "subjectId",
      "due_at" AS "dueAt",
      "priority",
      "leased_by" AS "leasedBy",
      "leased_until" AS "leasedUntil",
      "attempts",
      "claim_count" AS "claimCount",
      "max_attempts" AS "maxAttempts",
      "status",
      "reason",
      "payload",
      "result",
      "last_error" AS "lastError",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt";
  `;

  // Sắp xếp lại mảng kết quả theo thứ tự ưu tiên cao -> thấp, hạn đến sớm -> muộn
  return tasks.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aTime = a.dueAt instanceof Date ? a.dueAt.getTime() : new Date(a.dueAt).getTime();
    const bTime = b.dueAt instanceof Date ? b.dueAt.getTime() : new Date(b.dueAt).getTime();
    return aTime - bTime;
  });
}

/**
 * 2. complete: Đánh dấu task hoàn thành (chỉ thành công nếu lease còn sống và thuộc workerId)
 */
export async function complete(options: CompleteOptions): Promise<AgentTask> {
  const { orgId, taskId, workerId, result, tx } = options;
  if (!orgId || !taskId || !workerId) {
    throw new Error('orgId, taskId and workerId are required for complete');
  }

  const db = tx || prisma;
  const now = new Date();

  const res = await db.agentTask.updateMany({
    where: {
      id: taskId,
      orgId,
      status: 'running',
      leasedBy: workerId,
      leasedUntil: { gt: now },
    },
    data: {
      status: 'completed',
      leasedUntil: null,
      leasedBy: null,
      ...(result !== undefined ? { result } : {}),
      updatedAt: now,
    },
  });

  if (res.count === 0) {
    throw new LeaseLostError(taskId, workerId);
  }

  const updated = await db.agentTask.findUnique({ where: { id: taskId } });
  return updated!;
}

/**
 * 3. fail: Xử lý lỗi tác vụ (tăng attempts, backoff mũ hoặc đánh dấu dead; kiểm chứng lease)
 */
export async function fail(options: FailOptions): Promise<AgentTask> {
  const { orgId, taskId, workerId, error, tx } = options;
  if (!orgId || !taskId || !workerId) {
    throw new Error('orgId, taskId and workerId are required for fail');
  }

  const db = tx || prisma;
  const now = new Date();

  // Kiểm tra task đang running và lease còn hiệu lực thuộc workerId
  const task = await db.agentTask.findFirst({
    where: {
      id: taskId,
      orgId,
      status: 'running',
      leasedBy: workerId,
      leasedUntil: { gt: now },
    },
  });

  if (!task) {
    throw new LeaseLostError(taskId, workerId);
  }

  const newAttempts = task.attempts + 1;
  const isDead = newAttempts >= task.maxAttempts;

  if (isDead) {
    const res = await db.agentTask.updateMany({
      where: {
        id: taskId,
        orgId,
        status: 'running',
        leasedBy: workerId,
        leasedUntil: { gt: now },
      },
      data: {
        status: 'dead',
        attempts: newAttempts,
        lastError: error,
        leasedUntil: null,
        leasedBy: null,
        updatedAt: now,
      },
    });
    if (res.count === 0) throw new LeaseLostError(taskId, workerId);
  } else {
    // Backoff lũy thừa: 2s, 4s, 8s...
    const backoffMs = Math.min(1000 * Math.pow(2, newAttempts), 3_600_000);
    const nextDueAt = new Date(Date.now() + backoffMs);

    const res = await db.agentTask.updateMany({
      where: {
        id: taskId,
        orgId,
        status: 'running',
        leasedBy: workerId,
        leasedUntil: { gt: now },
      },
      data: {
        status: 'pending',
        attempts: newAttempts,
        dueAt: nextDueAt,
        lastError: error,
        leasedUntil: null,
        leasedBy: null,
        updatedAt: now,
      },
    });
    if (res.count === 0) throw new LeaseLostError(taskId, workerId);
  }

  const updated = await db.agentTask.findUnique({ where: { id: taskId } });
  return updated!;
}

/**
 * 4. renewLease: Gia hạn lease cho tác vụ đang chạy trong lúc xử lý lâu (Heartbeat)
 */
export async function renewLease(options: RenewLeaseOptions): Promise<AgentTask> {
  const { orgId, taskId, workerId, leaseMs = 60_000, tx } = options;
  if (!orgId || !taskId || !workerId) {
    throw new Error('orgId, taskId and workerId are required for renewLease');
  }

  const db = tx || prisma;
  const now = new Date();
  const newLeaseUntil = new Date(Date.now() + leaseMs);

  const res = await db.agentTask.updateMany({
    where: {
      id: taskId,
      orgId,
      status: 'running',
      leasedBy: workerId,
      leasedUntil: { gt: now },
    },
    data: {
      leasedUntil: newLeaseUntil,
      updatedAt: now,
    },
  });

  if (res.count === 0) {
    throw new LeaseLostError(taskId, workerId);
  }

  const updated = await db.agentTask.findUnique({ where: { id: taskId } });
  return updated!;
}

/**
 * 5. reschedule: Lên lịch lại tác vụ có kiểm chứng lease (Ghi lý do defer vào last_error không đè reason gốc)
 */
export async function reschedule(options: RescheduleOptions): Promise<AgentTask> {
  const { orgId, taskId, workerId, runAt, reason, tx } = options;
  if (!orgId || !taskId || !workerId) {
    throw new Error('orgId, taskId and workerId are required for reschedule');
  }
  if (!reason || !reason.trim()) {
    throw new Error('reason is required and cannot be empty for reschedule');
  }

  const db = tx || prisma;
  const now = new Date();

  const res = await db.agentTask.updateMany({
    where: {
      id: taskId,
      orgId,
      status: 'running',
      leasedBy: workerId,
      leasedUntil: { gt: now },
    },
    data: {
      status: 'pending',
      dueAt: runAt,
      lastError: `[DEFER] ${reason.trim()}`,
      leasedUntil: null,
      leasedBy: null,
      updatedAt: now,
    },
  });

  if (res.count === 0) {
    throw new LeaseLostError(taskId, workerId);
  }

  const updated = await db.agentTask.findUnique({ where: { id: taskId } });
  return updated!;
}

/**
 * 6. reapExpired: Thu hồi các task running có lease đã quá hạn về pending (không tăng counters, ghi last_error [REAPED])
 * Lưu ý về nhãn lỗi (Việc 2f): Task chết vì chậm hơn lease KHÔNG mang nhãn [INFRA],
 * vì với cơ chế renewLease chủ động trong dispatcher, tác vụ hợp lệ sẽ không bị mất lease giữa chừng;
 * chỉ tác vụ bị sập/chết đột ngột hoặc mất kết nối mới bị thu hồi về pending.
 */
export async function reapExpired(options: ReapExpiredOptions = {}): Promise<{ count: number }> {
  const { orgId, leaseGraceMs = 0 } = options;
  const cutoff = new Date(Date.now() - leaseGraceMs);

  const result = await prisma.agentTask.updateMany({
    where: {
      ...(orgId ? { orgId } : {}),
      status: 'running',
      leasedUntil: { lte: cutoff },
    },
    data: {
      status: 'pending',
      leasedUntil: null,
      leasedBy: null,
      lastError: '[REAPED] lease expired',
    },
  });

  return { count: result.count };
}
