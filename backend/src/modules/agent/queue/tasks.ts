/**
 * tasks.ts — Durable Work Queue operations for Agent Tasks
 *
 * Cung cấp 5 thao tác cốt lõi cho hàng đợi tác vụ:
 * 1. claimDue: Atomic pick & lock task đến hạn qua PostgreSQL FOR UPDATE SKIP LOCKED
 * 2. complete: Đánh dấu task hoàn thành
 * 3. fail: Xử lý lỗi (chuyển pending với backoff mũ, hoặc dead nếu vượt maxAttempts)
 * 4. reschedule: Lên lịch lại tác vụ với reason bắt buộc
 * 5. reapExpired: Thu hồi các task running bị treo / quá hạn lease về pending
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import type { Prisma, AgentTask } from '@prisma/client';

export interface ClaimDueOptions {
  orgId: string;
  limit?: number;
  leaseMs?: number;
  skipLocked?: boolean;
}

export interface CompleteOptions {
  orgId: string;
  taskId: string;
  result?: Prisma.InputJsonValue;
}

export interface FailOptions {
  orgId: string;
  taskId: string;
  error: string;
}

export interface RescheduleOptions {
  orgId: string;
  taskId: string;
  runAt: Date;
  reason: string;
}

export interface ReapExpiredOptions {
  orgId?: string;
  leaseGraceMs?: number;
}

/**
 * 1. claimDue: Atomic claim các task đến hạn trong tenant qua SELECT ... FOR UPDATE SKIP LOCKED
 */
export async function claimDue(options: ClaimDueOptions): Promise<AgentTask[]> {
  const { orgId, limit = 10, leaseMs = 60_000, skipLocked = true } = options;
  if (!orgId) return [];

  const leaseUntil = new Date(Date.now() + leaseMs);
  const now = new Date();

  if (skipLocked) {
    return prisma.$queryRaw<AgentTask[]>`
      UPDATE "agent_tasks"
      SET 
        "status" = 'running',
        "leased_until" = ${leaseUntil},
        "attempts" = "attempts" + 1,
        "updated_at" = ${now}
      WHERE "id" IN (
        SELECT "id"
        FROM "agent_tasks"
        WHERE "org_id" = ${orgId}
          AND "status" = 'pending'
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
        "max_attempts" AS "maxAttempts",
        "status",
        "reason",
        "payload",
        "result",
        "last_error" AS "lastError",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt";
    `;
  }

  return prisma.$queryRaw<AgentTask[]>`
    UPDATE "agent_tasks"
    SET 
      "status" = 'running',
      "leased_until" = ${leaseUntil},
      "attempts" = "attempts" + 1,
      "updated_at" = ${now}
    WHERE "id" IN (
      SELECT "id"
      FROM "agent_tasks"
      WHERE "org_id" = ${orgId}
        AND "status" = 'pending'
        AND "due_at" <= ${now}
      ORDER BY "priority" DESC, "due_at" ASC
      FOR UPDATE
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
      "max_attempts" AS "maxAttempts",
      "status",
      "reason",
      "payload",
      "result",
      "last_error" AS "lastError",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt";
  `;
}

/**
 * 2. complete: Đánh dấu task hoàn thành (ghi vào result, KHÔNG chạm payload)
 */
export async function complete(options: CompleteOptions): Promise<AgentTask | null> {
  const { orgId, taskId, result } = options;
  if (!orgId || !taskId) return null;

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, orgId },
  });
  if (!task) return null;

  return prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: 'completed',
      leasedUntil: null,
      leasedBy: null,
      ...(result !== undefined ? { result } : {}),
    },
  });
}

/**
 * 3. fail: Xử lý lỗi tác vụ (backoff mũ hoặc đánh dấu dead)
 */
export async function fail(options: FailOptions): Promise<AgentTask | null> {
  const { orgId, taskId, error } = options;
  if (!orgId || !taskId) return null;

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, orgId },
  });
  if (!task) return null;

  const isDead = task.attempts >= task.maxAttempts;
  if (isDead) {
    return prisma.agentTask.update({
      where: { id: taskId },
      data: {
        status: 'dead',
        lastError: error,
        leasedUntil: null,
        leasedBy: null,
      },
    });
  }

  // Backoff lũy thừa: 2s, 4s, 8s...
  const backoffMs = Math.min(1000 * Math.pow(2, task.attempts), 3_600_000);
  const nextDueAt = new Date(Date.now() + backoffMs);

  return prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: 'pending',
      dueAt: nextDueAt,
      lastError: error,
      leasedUntil: null,
      leasedBy: null,
    },
  });
}

/**
 * 4. reschedule: Lên lịch lại tác vụ với reason bắt buộc
 */
export async function reschedule(options: RescheduleOptions): Promise<AgentTask | null> {
  const { orgId, taskId, runAt, reason } = options;
  if (!orgId || !taskId) return null;
  if (!reason || !reason.trim()) {
    throw new Error('reason is required and cannot be empty for reschedule');
  }

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, orgId },
  });
  if (!task) return null;

  return prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: 'pending',
      dueAt: runAt,
      reason: reason.trim(),
      leasedUntil: null,
      leasedBy: null,
    },
  });
}

/**
 * 5. reapExpired: Thu hồi các task running có lease đã quá hạn về pending (không tăng attempts)
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
    },
  });

  return { count: result.count };
}
