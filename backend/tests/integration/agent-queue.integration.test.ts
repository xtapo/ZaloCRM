/**
 * agent-queue.integration.test.ts — Real DB Integration Tests for Agent Work Queue & Dispatcher
 *
 * Kiểm tra 6 yêu cầu bắt buộc:
 * 1. Tranh chấp: 10 task đến hạn, 2 worker claimDue song song bằng Promise.all -> hợp = 10, giao = rỗng
 * 2. Phép thử ngược: Thử nghiệm không dùng SKIP LOCKED
 * 3. Reaper: Task running quá hạn lease quay về pending, attempts giữ nguyên
 * 4. Dead letter: fail liên tiếp vượt max_attempts -> status = 'dead'
 * 5. Cô lập tenant: claimDue của Org A tuyệt đối không nhận task của Org B
 * 6. Fail-closed ngân sách: Org không có hạn mức token thì runOnce dừng ngay (blocked)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AgentTask } from '@prisma/client';
import { prisma, type PrismaTx } from '../../src/shared/database/prisma-client.js';
import { claimDue, complete, fail, reschedule, reapExpired, LeaseLostError } from '../../src/modules/agent/queue/tasks.js';
import { runOnce, computeLeaseTiming } from '../../src/modules/agent/queue/dispatcher.js';
import { consumeTokens, checkAndResetMonthlyBudget, getNextMonthResetDate } from '../../src/modules/agent/queue/budget.js';
import type { PreparedTaskResult } from '../../src/modules/agent/queue/handlers/noop.js';

describe('Agent Queue & Dispatcher Integration Tests (Real DB without mock)', () => {
  const TEST_PREFIX = `queue_test_${Date.now()}`;

  const orgAId = `${TEST_PREFIX}_org_a`;
  const orgBId = `${TEST_PREFIX}_org_b`;
  const orgNoBudgetId = `${TEST_PREFIX}_org_no_budget`;
  const orgExhaustedId = `${TEST_PREFIX}_org_exhausted`;
  const orgValidId = `${TEST_PREFIX}_org_valid`;

  beforeAll(async () => {
    const futureResetDate = getNextMonthResetDate();
    // Tạo các Organization phục vụ test
    await prisma.organization.createMany({
      data: [
        { id: orgAId, name: 'Queue Test Org A', agentTokenBudgetMonthly: 50_000, agentTokenUsedThisMonth: 0, agentBudgetResetAt: futureResetDate },
        { id: orgBId, name: 'Queue Test Org B', agentTokenBudgetMonthly: 50_000, agentTokenUsedThisMonth: 0, agentBudgetResetAt: futureResetDate },
        { id: orgNoBudgetId, name: 'Queue Test Org No Budget', agentTokenBudgetMonthly: null, agentTokenUsedThisMonth: 0, agentBudgetResetAt: null },
        { id: orgExhaustedId, name: 'Queue Test Org Exhausted', agentTokenBudgetMonthly: 1000, agentTokenUsedThisMonth: 1000, agentBudgetResetAt: futureResetDate },
        { id: orgValidId, name: 'Queue Test Org Valid', agentTokenBudgetMonthly: 100_000, agentTokenUsedThisMonth: 100, agentBudgetResetAt: futureResetDate },
      ],
    });
  });

  afterAll(async () => {
    // Dọn dẹp sạch sẽ dữ liệu test
    const allOrgIds = [
      orgAId,
      orgBId,
      orgNoBudgetId,
      orgExhaustedId,
      orgValidId,
      `${TEST_PREFIX}_org_consume_test`,
      `${TEST_PREFIX}_org_expired_reset`,
      `${TEST_PREFIX}_org_recover_next_month`,
    ];
    await prisma.agentTask.deleteMany({
      where: { orgId: { in: allOrgIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: allOrgIds } },
    });
  });

  // ── 1. Tranh chấp: Concurrency với SKIP LOCKED ──────────────────────────────
  it('1. Tranh chấp: 10 task đến hạn, 2 worker claimDue song song bằng Promise.all không nhận trùng task', async () => {
    const taskIds: string[] = [];
    const now = new Date();

    // Gieo 10 task pending đến hạn
    for (let i = 0; i < 10; i++) {
      const taskId = `${TEST_PREFIX}_concurrency_task_${i}`;
      taskIds.push(taskId);
      await prisma.agentTask.create({
        data: {
          id: taskId,
          orgId: orgAId,
          kind: 'test_concurrency',
          subjectType: 'contact',
          subjectId: `contact_${i}`,
          dueAt: new Date(now.getTime() - 1000 * (10 - i)), // Đã đến hạn
          status: 'pending',
        },
      });
    }

    const worker1 = 'worker_node_1';
    const worker2 = 'worker_node_2';

    // Gọi 2 lần claimDue song song
    const [batch1, batch2] = await Promise.all([
      claimDue({ orgId: orgAId, workerId: worker1, limit: 10 }),
      claimDue({ orgId: orgAId, workerId: worker2, limit: 10 }),
    ]);

    const ids1 = new Set(batch1.map((t) => t.id));
    const ids2 = new Set(batch2.map((t) => t.id));

    // Tổng số nhận được đúng 10 task
    expect(batch1.length + batch2.length).toBe(10);

    // Giao của 2 tập hợp phải rỗng (không task nào nhận 2 lần)
    const intersection = [...ids1].filter((id) => ids2.has(id));
    expect(intersection).toHaveLength(0);

    // Hợp của 2 tập hợp phải chứa đúng 10 task ban đầu
    const union = new Set([...ids1, ...ids2]);
    expect(union.size).toBe(10);
    for (const id of taskIds) {
      expect(union.has(id)).toBe(true);
    }

    // Khẳng định leasedBy đúng bằng workerId cả trong kết quả trả về và trong DB
    for (const t of batch1) {
      expect(t.leasedBy).toBe(worker1);
      const inDb = await prisma.agentTask.findUnique({ where: { id: t.id } });
      expect(inDb?.leasedBy).toBe(worker1);
    }
    for (const t of batch2) {
      expect(t.leasedBy).toBe(worker2);
      const inDb = await prisma.agentTask.findUnique({ where: { id: t.id } });
      expect(inDb?.leasedBy).toBe(worker2);
    }
  });

  // ── 2. Phép thử ngược: Phân biệt SKIP LOCKED vs KHÔNG CÓ SKIP LOCKED ────────
  it('2a. Khong tranh chap: hai che do cho ket qua giong nhau', async () => {
    // Dọn dẹp task cũ trước khi kiểm thử
    await prisma.agentTask.deleteMany({ where: { orgId: orgAId } });

    // Khi hai worker chạy auto-commit liên tiếp mà không giữ transaction mở, Worker 1 hoàn tất commit
    // cực nhanh (~1-2ms), Worker 2 đến sau thấy 2 task pending còn lại và claim nốt -> cả hai chế độ đều ra [3, 2].
    for (let i = 0; i < 5; i++) {
      await prisma.agentTask.create({
        data: {
          id: `${TEST_PREFIX}_noconflict_task_${i}`,
          orgId: orgAId,
          kind: 'test_noconflict',
          subjectType: 'contact',
          subjectId: `contact_noconflict_${i}`,
          dueAt: new Date(Date.now() - 1000 * (5 - i)),
          status: 'pending',
        },
      });
    }

    const [batch1, batch2] = await Promise.all([
      claimDue({ orgId: orgAId, workerId: 'worker_nc_1', limit: 3 }),
      claimDue({ orgId: orgAId, workerId: 'worker_nc_2', limit: 3 }),
    ]);

    const counts = [batch1.length, batch2.length].sort((a, b) => b - a);
    expect(counts).toEqual([3, 2]);
  });

  it('2b. SKIP LOCKED loai bo nghen dau hang (do bang thoi gian cho)', async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const leaseUntil = new Date(Date.now() + 60_000);

    // ── BIẾN THỂ 1: Với SKIP LOCKED (claimDue) ──
    await prisma.agentTask.deleteMany({ where: { orgId: orgAId } });
    for (let i = 0; i < 5; i++) {
      await prisma.agentTask.create({
        data: {
          id: `${TEST_PREFIX}_skip_hold_task_${i}`,
          orgId: orgAId,
          kind: 'test_skip_hold',
          subjectType: 'contact',
          subjectId: `contact_skip_hold_${i}`,
          dueAt: new Date(Date.now() - 60_000 - i * 1000),
          status: 'pending',
        },
      });
    }

    const now1 = new Date();
    // Worker 1: Giữ khoá 3 task đầu trong transaction 1400ms
    const w1SkipPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
      const rows = await tx.$queryRaw<AgentTask[]>`
        UPDATE "agent_tasks"
        SET 
          "status" = 'running',
          "leased_by" = 'w1_skip',
          "leased_until" = ${leaseUntil},
          "attempts" = "attempts" + 1,
          "updated_at" = ${now1}
        WHERE "id" IN (
          SELECT "id"
          FROM "agent_tasks"
          WHERE "org_id" = ${orgAId}
            AND "status" = 'pending'
            AND "due_at" <= ${now1}
          ORDER BY "priority" DESC, "due_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 3
        )
        RETURNING *;
      `;
      await sleep(1400);
      return rows;
    }, { timeout: 20000, maxWait: 5000 });

    // Worker 2: Chạy sau 300ms, gọi claimDue (SKIP LOCKED) trên connection khác
    await sleep(300);
    const startSkip = Date.now();
    const w2SkipRows = await claimDue({ orgId: orgAId, workerId: 'w2_skip', limit: 3 });
    const elapsedSkip = Date.now() - startSkip;

    const w1SkipRows = await w1SkipPromise;
    // Bất biến đúng đắn: 2 worker không bao giờ nhận trùng task (w1 nhận 3, w2 nhận 2)
    const skipIds1 = new Set(w1SkipRows.map((r) => r.id));
    const skipIds2 = new Set(w2SkipRows.map((r) => r.id));
    expect([...skipIds1].filter((id) => skipIds2.has(id))).toEqual([]);

    // ── BIẾN THỂ 2: Với KHÔNG SKIP LOCKED (FOR UPDATE đơn thuần) ──
    await prisma.agentTask.deleteMany({ where: { orgId: orgAId } });
    for (let i = 0; i < 5; i++) {
      await prisma.agentTask.create({
        data: {
          id: `${TEST_PREFIX}_noskip_hold_task_${i}`,
          orgId: orgAId,
          kind: 'test_noskip_hold',
          subjectType: 'contact',
          subjectId: `contact_noskip_hold_${i}`,
          dueAt: new Date(Date.now() - 60_000 - i * 1000),
          status: 'pending',
        },
      });
    }

    const now2 = new Date();
    // Worker 1: Giữ khoá 3 task đầu trong transaction 1400ms
    const w1NoSkipPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
      const rows = await tx.$queryRaw<AgentTask[]>`
        UPDATE "agent_tasks"
        SET 
          "status" = 'running',
          "leased_by" = 'w1_noskip',
          "leased_until" = ${leaseUntil},
          "attempts" = "attempts" + 1,
          "updated_at" = ${now2}
        WHERE "id" IN (
          SELECT "id"
          FROM "agent_tasks"
          WHERE "org_id" = ${orgAId}
            AND "status" = 'pending'
            AND "due_at" <= ${now2}
          ORDER BY "priority" DESC, "due_at" ASC
          FOR UPDATE
          LIMIT 3
        )
        RETURNING *;
      `;
      await sleep(1400);
      return rows;
    }, { timeout: 20000, maxWait: 5000 });

    // Worker 2: Chạy sau 300ms, gọi claim KHÔNG CÓ SKIP LOCKED
    await sleep(300);
    const startNoSkip = Date.now();
    const w2NoSkipRows = await prisma.$queryRaw<AgentTask[]>`
      UPDATE "agent_tasks"
      SET 
        "status" = 'running',
        "leased_by" = 'w2_noskip',
        "leased_until" = ${leaseUntil},
        "attempts" = "attempts" + 1,
        "updated_at" = ${now2}
      WHERE "id" IN (
        SELECT "id"
        FROM "agent_tasks"
        WHERE "org_id" = ${orgAId}
          AND "status" = 'pending'
          AND "due_at" <= ${now2}
        ORDER BY "priority" DESC, "due_at" ASC
        FOR UPDATE
        LIMIT 3
      )
      RETURNING *;
    `;
    const elapsedNoSkip = Date.now() - startNoSkip;

    const w1NoSkipRows = await w1NoSkipPromise;
    // Bất biến đúng đắn: 2 worker không bao giờ nhận trùng task (w1 nhận 3, w2 nhận 2 sau unblock)
    const noSkipIds1 = new Set(w1NoSkipRows.map((r) => r.id));
    const noSkipIds2 = new Set(w2NoSkipRows.map((r) => r.id));
    expect([...noSkipIds1].filter((id) => noSkipIds2.has(id))).toEqual([]);

    // ── Trục phân biệt duy nhất: Thời gian chờ (Head-of-line blocking) ──
    expect(elapsedNoSkip).toBeGreaterThan(1000);
    expect(elapsedSkip * 4).toBeLessThan(elapsedNoSkip);
    expect(elapsedNoSkip).toBeLessThan(8000); // lock_timeout chưa hề nổ
  });

  // ── 3. Reaper: Task running quá hạn lease quay về pending ────────────────────
  it('3. Reaper: task running có lease quá hạn quay về pending và attempts giữ nguyên', async () => {
    const taskId = `${TEST_PREFIX}_reaper_task`;
    const pastLease = new Date(Date.now() - 30_000); // Hết hạn 30s trước

    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgAId,
        kind: 'test_reaper',
        subjectType: 'contact',
        subjectId: 'contact_reaper',
        dueAt: new Date(Date.now() - 60_000),
        leasedUntil: pastLease,
        leasedBy: 'worker_crashed',
        status: 'running',
        attempts: 1,
      },
    });

    // Chạy reapExpired
    const { count } = await reapExpired({ orgId: orgAId, leaseGraceMs: 0 });
    expect(count).toBeGreaterThanOrEqual(1);

    // Kiểm tra task trong DB
    const reaped = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(reaped).not.toBeNull();
    expect(reaped?.status).toBe('pending');
    expect(reaped?.leasedUntil).toBeNull();
    expect(reaped?.leasedBy).toBeNull();
    expect(reaped?.attempts).toBe(1); // Attempts giữ nguyên không tăng!
    expect(reaped?.lastError).toBe('[REAPED] lease expired');
  });

  // ── 4. Dead Letter: Fail liên tiếp vượt max_attempts ─────────────────────────
  it('4. Dead Letter: fail liên tiếp vượt max_attempts chuyển sang status = dead', async () => {
    const taskId = `${TEST_PREFIX}_dead_letter_task`;

    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgAId,
        kind: 'test_dead_letter',
        subjectType: 'contact',
        subjectId: 'contact_dead',
        dueAt: new Date(),
        status: 'running',
        leasedBy: 'worker_dead_letter',
        leasedUntil: new Date(Date.now() + 60_000),
        attempts: 1,
        maxAttempts: 3,
      },
    });

    // Lần fail thứ nhất: attempts tăng lên 2 < maxAttempts (3) -> pending với backoff
    const fail1 = await fail({ orgId: orgAId, taskId, workerId: 'worker_dead_letter', error: 'Transient network failure' });
    expect(fail1.count).toBe(1);

    const inDb1 = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(inDb1?.status).toBe('pending');
    expect(inDb1?.attempts).toBe(2);
    expect(inDb1?.lastError).toBe('Transient network failure');

    // Giả lập worker claim lại (running với attempts = 2)
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: 'running', leasedBy: 'worker_dead_letter', leasedUntil: new Date(Date.now() + 60_000) },
    });

    // Lần fail thứ hai: attempts tăng lên 3 >= maxAttempts (3) -> dead
    const fail2 = await fail({ orgId: orgAId, taskId, workerId: 'worker_dead_letter', error: 'Permanent fatal failure' });
    expect(fail2.count).toBe(1);

    const inDb2 = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(inDb2?.status).toBe('dead');
    expect(inDb2?.attempts).toBe(3);
    expect(inDb2?.lastError).toBe('Permanent fatal failure');
    expect(inDb2?.leasedUntil).toBeNull();
  });

  // ── 5. Cô lập Tenant: Org A không bao giờ nhận task của Org B ────────────────
  it('5. Cô lập Tenant: claimDue và các mutation của Org A tuyệt đối không chạm task của Org B', async () => {
    const taskAId = `${TEST_PREFIX}_tenant_task_a`;
    const taskBId = `${TEST_PREFIX}_tenant_task_b`;
    const now = new Date();

    await prisma.agentTask.createMany({
      data: [
        {
          id: taskAId,
          orgId: orgAId,
          kind: 'test_tenant',
          subjectType: 'contact',
          subjectId: 'contact_a',
          dueAt: now,
          status: 'pending',
        },
        {
          id: taskBId,
          orgId: orgBId,
          kind: 'test_tenant',
          subjectType: 'contact',
          subjectId: 'contact_b',
          dueAt: now,
          status: 'pending',
        },
      ],
    });

    // Org A claim
    const batchA = await claimDue({ orgId: orgAId, workerId: 'worker_tenant_a', limit: 10 });
    const batchAIds = batchA.map((t) => t.id);
    expect(batchAIds).toContain(taskAId);
    expect(batchAIds).not.toContain(taskBId);
    expect(batchA[0].leasedBy).toBe('worker_tenant_a');

    // Org B claim
    const batchB = await claimDue({ orgId: orgBId, workerId: 'worker_tenant_b', limit: 10 });
    const batchBIds = batchB.map((t) => t.id);
    expect(batchBIds).toContain(taskBId);
    expect(batchBIds).not.toContain(taskAId);
    expect(batchB[0].leasedBy).toBe('worker_tenant_b');

    // Cross-tenant mutation: Org A cố complete task của Org B -> Ném LeaseLostError
    await expect(complete({ orgId: orgAId, taskId: taskBId, workerId: 'worker_tenant_a' })).rejects.toThrow(LeaseLostError);

    // Cross-tenant mutation: Org A cố fail task của Org B -> Ném LeaseLostError
    await expect(fail({ orgId: orgAId, taskId: taskBId, workerId: 'worker_tenant_a', error: 'hack' })).rejects.toThrow(LeaseLostError);

    // Cross-tenant mutation: Org A cố reschedule task của Org B -> Ném LeaseLostError
    await expect(
      reschedule({
        orgId: orgAId,
        taskId: taskBId,
        workerId: 'worker_tenant_a',
        runAt: new Date(),
        reason: 'malicious reschedule',
      })
    ).rejects.toThrow(LeaseLostError);

    // Task B vẫn giữ nguyên status 'running' của Org B
    const taskBInDb = await prisma.agentTask.findUnique({ where: { id: taskBId } });
    expect(taskBInDb?.status).toBe('running');
  });

  // ── 6. Fail-closed Ngân sách Token trong runOnce ────────────────────────────
  it('6. Fail-closed Ngân sách: Org không có hạn mức hoặc hết hạn mức thì runOnce dừng ngay', async () => {
    // 6a. Org không cấu hình hạn mức (agentTokenBudgetMonthly = null) -> Blocked
    const taskNoBudgetId = `${TEST_PREFIX}_task_no_budget`;
    await prisma.agentTask.create({
      data: {
        id: taskNoBudgetId,
        orgId: orgNoBudgetId,
        kind: 'noop',
        subjectType: 'contact',
        subjectId: 'contact_nobudget',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const resultNoBudget = await runOnce({ orgId: orgNoBudgetId });
    expect(resultNoBudget.status).toBe('blocked');
    expect(resultNoBudget.reason).toBe('TOKEN_BUDGET_NOT_CONFIGURED');
    expect(resultNoBudget.claimedCount).toBe(0);

    const taskStillPending1 = await prisma.agentTask.findUnique({ where: { id: taskNoBudgetId } });
    expect(taskStillPending1?.status).toBe('pending');

    // 6b. Org đã dùng hết hạn mức (used >= budget) -> Blocked
    const taskExhaustedId = `${TEST_PREFIX}_task_exhausted`;
    await prisma.agentTask.create({
      data: {
        id: taskExhaustedId,
        orgId: orgExhaustedId,
        kind: 'noop',
        subjectType: 'contact',
        subjectId: 'contact_exhausted',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const resultExhausted = await runOnce({ orgId: orgExhaustedId });
    expect(resultExhausted.status).toBe('blocked');
    expect(resultExhausted.reason).toBe('TOKEN_BUDGET_EXHAUSTED');
    expect(resultExhausted.claimedCount).toBe(0);

    const taskStillPending2 = await prisma.agentTask.findUnique({ where: { id: taskExhaustedId } });
    expect(taskStillPending2?.status).toBe('pending');

    // 6c. Org có hạn mức hợp lệ -> Chạy thành công qua noop handler và complete task
    const taskValidId = `${TEST_PREFIX}_task_valid`;
    const initialPayload = { inputParam: 'hello_world', sampleId: 123 };
    await prisma.agentTask.create({
      data: {
        id: taskValidId,
        orgId: orgValidId,
        kind: 'noop',
        subjectType: 'contact',
        subjectId: 'contact_valid',
        dueAt: new Date(),
        status: 'pending',
        payload: initialPayload,
      },
    });

    const resultValid = await runOnce({ orgId: orgValidId });
    expect(resultValid.status).toBe('ok');
    expect(resultValid.claimedCount).toBe(1);
    expect(resultValid.completedCount).toBe(1);

    const taskCompleted = await prisma.agentTask.findUnique({ where: { id: taskValidId } });
    expect(taskCompleted?.status).toBe('completed');
    expect(taskCompleted?.payload).toEqual(initialPayload);
    expect(taskCompleted?.result).toMatchObject({ handledBy: 'noop', taskId: taskValidId });
  });

  // ── 7. Ngân sách Token Sống: consumeTokens, Reset Quá Hạn & Sang Tháng Mới ─
  it('7a. consumeTokens: cộng chính xác tokens_in + tokens_out vào agent_token_used_this_month trong transaction', async () => {
    const orgTestBudgetId = `${TEST_PREFIX}_org_consume_test`;
    await prisma.organization.create({
      data: {
        id: orgTestBudgetId,
        name: 'Org Consume Test',
        agentTokenBudgetMonthly: 50_000,
        agentTokenUsedThisMonth: 1_200,
      },
    });

    const updated = await consumeTokens({
      orgId: orgTestBudgetId,
      tokensIn: 350,
      tokensOut: 150,
    });

    expect(updated.agentTokenUsedThisMonth).toBe(1_700);

    const inDb = await prisma.organization.findUnique({ where: { id: orgTestBudgetId } });
    expect(inDb?.agentTokenUsedThisMonth).toBe(1_700);
  });

  it('7b. Reset khi quá hạn mốc: checkAndResetMonthlyBudget đặt used_this_month = 0 và reset_at = đầu tháng kế tiếp', async () => {
    const orgExpiredBudgetId = `${TEST_PREFIX}_org_expired_reset`;
    const pastResetDate = new Date(Date.now() - 7 * 24 * 3600 * 1000); // 7 ngày trước

    await prisma.organization.create({
      data: {
        id: orgExpiredBudgetId,
        name: 'Org Expired Budget Test',
        agentTokenBudgetMonthly: 10_000,
        agentTokenUsedThisMonth: 9_500,
        agentBudgetResetAt: pastResetDate,
      },
    });

    const resetOrg = await checkAndResetMonthlyBudget(orgExpiredBudgetId);
    expect(resetOrg).not.toBeNull();
    expect(resetOrg?.agentTokenUsedThisMonth).toBe(0);
    expect(resetOrg?.agentBudgetResetAt).not.toBeNull();

    const expectedNextMonth = getNextMonthResetDate();
    expect(resetOrg?.agentBudgetResetAt?.toISOString()).toBe(expectedNextMonth.toISOString());

    const inDb = await prisma.organization.findUnique({ where: { id: orgExpiredBudgetId } });
    expect(inDb?.agentTokenUsedThisMonth).toBe(0);
    expect(inDb?.agentBudgetResetAt?.toISOString()).toBe(expectedNextMonth.toISOString());
  });

  it('7c. Phục hồi sang tháng mới: Org đã hết hạn mức nhưng sang tháng mới thì runOnce tự reset và chạy được trở lại', async () => {
    const orgRecoverId = `${TEST_PREFIX}_org_recover_next_month`;
    const pastResetDate = new Date(Date.now() - 24 * 3600 * 1000); // Hôm qua (đã qua mốc reset)

    await prisma.organization.create({
      data: {
        id: orgRecoverId,
        name: 'Org Recover Test',
        agentTokenBudgetMonthly: 5_000,
        agentTokenUsedThisMonth: 5_000, // Đã hết 100% hạn mức của tháng trước
        agentBudgetResetAt: pastResetDate,
      },
    });

    const taskId = `${TEST_PREFIX}_task_recover`;
    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgRecoverId,
        kind: 'custom_consume_task',
        subjectType: 'contact',
        subjectId: 'contact_recover',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const customHandlers = {
      custom_consume_task: {
        prepare: async (task: AgentTask) => ({
          success: true,
          result: { handled: true, taskId: task.id },
          tokensIn: 300,
          tokensOut: 200,
        }),
      },
    };

    // Gọi runOnce: Hệ thống phát hiện đã sang chu kỳ mới -> reset used về 0, chạy task và consume 500 tokens
    const result = await runOnce({ orgId: orgRecoverId, customHandlers });
    expect(result.status).toBe('ok');
    expect(result.claimedCount).toBe(1);
    expect(result.completedCount).toBe(1);

    const taskInDb = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(taskInDb?.status).toBe('completed');

    const orgInDb = await prisma.organization.findUnique({ where: { id: orgRecoverId } });
    // Sau reset về 0 + handler tiêu 500 tokens -> used phải là 500
    expect(orgInDb?.agentTokenUsedThisMonth).toBe(500);
  });

  it('7d. Khởi tạo mốc reset: Org có reset_at null và used = 777 -> checkAndResetMonthlyBudget giữ nguyên used = 777 và đặt reset_at', async () => {
    const orgNullResetId = `${TEST_PREFIX}_org_null_reset`;
    await prisma.organization.create({
      data: {
        id: orgNullResetId,
        name: 'Org Null Reset Test',
        agentTokenBudgetMonthly: 10_000,
        agentTokenUsedThisMonth: 777,
        agentBudgetResetAt: null,
      },
    });

    const res = await checkAndResetMonthlyBudget(orgNullResetId);
    expect(res).not.toBeNull();
    expect(res?.agentTokenUsedThisMonth).toBe(777);
    expect(res?.agentBudgetResetAt).not.toBeNull();

    const expectedNextMonth = getNextMonthResetDate();
    expect(res?.agentBudgetResetAt?.toISOString()).toBe(expectedNextMonth.toISOString());

    const inDb = await prisma.organization.findUnique({ where: { id: orgNullResetId } });
    expect(inDb?.agentTokenUsedThisMonth).toBe(777);
    expect(inDb?.agentBudgetResetAt?.toISOString()).toBe(expectedNextMonth.toISOString());
  });

  it('7e. Cửa ngân sách đóng thật sự: org có budget 1000, used 999, handler tiêu 500 -> lượt runOnce kế tiếp trả blocked TOKEN_BUDGET_EXHAUSTED', async () => {
    const orgExhaustId = `${TEST_PREFIX}_org_exhaust_budget`;
    const nextResetDate = getNextMonthResetDate(); // Chưa qua mốc reset

    await prisma.organization.create({
      data: {
        id: orgExhaustId,
        name: 'Org Exhaust Budget Test',
        agentTokenBudgetMonthly: 1_000,
        agentTokenUsedThisMonth: 999,
        agentBudgetResetAt: nextResetDate,
      },
    });

    const task1Id = `${TEST_PREFIX}_task_exhaust_1`;
    const task2Id = `${TEST_PREFIX}_task_exhaust_2`;

    await prisma.agentTask.createMany({
      data: [
        {
          id: task1Id,
          orgId: orgExhaustId,
          kind: 'custom_consume_task',
          subjectType: 'contact',
          subjectId: 'contact_exhaust_1',
          dueAt: new Date(),
          status: 'pending',
        },
        {
          id: task2Id,
          orgId: orgExhaustId,
          kind: 'custom_consume_task',
          subjectType: 'contact',
          subjectId: 'contact_exhaust_2',
          dueAt: new Date(),
          status: 'pending',
        },
      ],
    });

    const customHandlers = {
      custom_consume_task: {
        prepare: async (task: AgentTask) => ({
          success: true,
          result: { handled: true, taskId: task.id },
          tokensIn: 300,
          tokensOut: 200, // tổng tiêu 500
        }),
      },
    };

    // Lượt 1: used = 999 < 1000 -> ĐƯỢC CHẠY (limit: 1 để chỉ xử lý task 1)
    const run1 = await runOnce({
      orgId: orgExhaustId,
      limit: 1,
      customHandlers,
    });
    expect(run1.status).toBe('ok');
    expect(run1.claimedCount).toBe(1);
    expect(run1.completedCount).toBe(1);

    // Kiểm tra used sau lượt 1: 999 + 500 = 1499
    const orgAfterRun1 = await prisma.organization.findUnique({ where: { id: orgExhaustId } });
    expect(orgAfterRun1?.agentTokenUsedThisMonth).toBe(1_499);

    // Lượt 2 (KẾ TIẾP): used = 1499 >= 1000 -> BỊ CHẶN HOÀN TOÀN
    const run2 = await runOnce({
      orgId: orgExhaustId,
      limit: 1,
      customHandlers,
    });
    expect(run2.status).toBe('blocked');
    expect(run2.reason).toBe('TOKEN_BUDGET_EXHAUSTED');
    expect(run2.claimedCount).toBe(0);
    expect(run2.completedCount).toBe(0);

    // Task 2 vẫn giữ nguyên trạng thái pending, không hề bị claim
    const task2InDb = await prisma.agentTask.findUnique({ where: { id: task2Id } });
    expect(task2InDb?.status).toBe('pending');
  });

  // ── 8. Giao dịch nguyên tử hai pha: prepare ngoài tx, apply trong tx ────────
  it('8. Atomic Two-Phase Apply: apply ném lỗi sau khi ghi DB -> bản ghi bị rollback và task về pending', async () => {
    const orgAtomicId = `${TEST_PREFIX}_org_atomic_test`;
    await prisma.organization.create({
      data: {
        id: orgAtomicId,
        name: 'Org Atomic Test',
        agentTokenBudgetMonthly: 10_000,
        agentTokenUsedThisMonth: 0,
      },
    });

    const taskId = `${TEST_PREFIX}_task_atomic`;
    const contactRollbackId = `${TEST_PREFIX}_contact_should_rollback`;

    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgAtomicId,
        kind: 'custom_failing_apply',
        subjectType: 'contact',
        subjectId: 'contact_dummy',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const customHandlers = {
      custom_failing_apply: {
        prepare: async (task: AgentTask) => ({
          success: true,
          writes: { contactId: contactRollbackId },
          result: { shouldNotPersist: true },
          tokensIn: 100,
          tokensOut: 50,
        }),
        apply: async (tx: PrismaTx, prepared: PreparedTaskResult<{ contactId: string }>) => {
          // 1. Ghi bản ghi Contact vào DB qua tx
          await tx.contact.create({
            data: {
              id: prepared.writes!.contactId,
              orgId: orgAtomicId,
              fullName: 'Contact Should Be Rolled Back',
            },
          });
          // 2. Cố tình ném lỗi sau khi ghi để kích hoạt rollback
          throw new Error('Intentional error in apply phase to trigger rollback');
        },
      },
    };

    const result = await runOnce({ orgId: orgAtomicId, customHandlers });
    expect(result.status).toBe('ok');
    expect(result.claimedCount).toBe(1);
    expect(result.completedCount).toBe(0);
    expect(result.failedCount).toBe(1);

    // Khẳng định bản ghi Contact KHÔNG HỀ tồn tại trong DB (đã được rollback)
    const contactInDb = await prisma.contact.findUnique({ where: { id: contactRollbackId } });
    expect(contactInDb).toBeNull();

    // Khẳng định task quay về status = pending với attempts = 1 (do attempts < maxAttempts)
    const taskInDb = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(taskInDb?.status).toBe('pending');
    expect(taskInDb?.attempts).toBe(1);
    expect(taskInDb?.lastError).toContain('Intentional error in apply phase');

    // Token vẫn bị tiêu thụ vì pha prepare đã thực hiện xong ngoài tx
    const orgInDb = await prisma.organization.findUnique({ where: { id: orgAtomicId } });
    expect(orgInDb?.agentTokenUsedThisMonth).toBe(150);
  });

  // ── 9. Bịt #51: LeaseLostError & Rollback khi mất quyền lease ────────────────
  it('9. LeaseLostError: Worker A hoàn thành sau khi lease hết hạn và task bị Worker B claim -> rollback và task vẫn thuộc Worker B', async () => {
    const orgLeaseTestId = `${TEST_PREFIX}_org_lease_lost`;
    await prisma.organization.create({
      data: { id: orgLeaseTestId, name: 'Org Lease Lost Test', agentTokenBudgetMonthly: 10_000 },
    });

    const taskId = `${TEST_PREFIX}_task_lease_lost`;
    const contactRollbackId = `${TEST_PREFIX}_contact_worker_a_rollback`;

    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgLeaseTestId,
        kind: 'custom_slow_worker',
        subjectType: 'contact',
        subjectId: 'contact_dummy',
        dueAt: new Date(Date.now() - 10_000),
        status: 'pending',
      },
    });

    // 1. Worker A claim task với leaseMs rất ngắn (50ms)
    const claimedByA = await claimDue({ orgId: orgLeaseTestId, workerId: 'worker_A', limit: 1, leaseMs: 50 });
    expect(claimedByA).toHaveLength(1);
    expect(claimedByA[0].id).toBe(taskId);

    // 2. Chờ 100ms cho lease của Worker A hết hạn
    await new Promise((r) => setTimeout(r, 100));

    // 3. reapExpired thu hồi task về pending
    const reaped = await reapExpired({ orgId: orgLeaseTestId, leaseGraceMs: 0 });
    expect(reaped.count).toBe(1);

    // 4. Worker B claim task
    const claimedByB = await claimDue({ orgId: orgLeaseTestId, workerId: 'worker_B', limit: 1, leaseMs: 60_000 });
    expect(claimedByB).toHaveLength(1);
    expect(claimedByB[0].leasedBy).toBe('worker_B');

    // 5. Worker A cố tình gọi complete trong 1 transaction (kèm ghi DB Contact)
    let leaseLostThrown = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.contact.create({
          data: {
            id: contactRollbackId,
            orgId: orgLeaseTestId,
            fullName: 'Contact by Worker A',
          },
        });
        await complete({
          orgId: orgLeaseTestId,
          taskId,
          workerId: 'worker_A',
          result: { doneBy: 'worker_A' },
          tx,
        });
      });
    } catch (err) {
      if (err instanceof LeaseLostError) {
        leaseLostThrown = true;
      }
    }
    expect(leaseLostThrown).toBe(true);

    // Khẳng định: Contact do Worker A ghi bị rollback hoàn toàn khỏi DB
    const contactInDb = await prisma.contact.findUnique({ where: { id: contactRollbackId } });
    expect(contactInDb).toBeNull();

    // Khẳng định: Task vẫn thuộc về Worker B, đang running
    const taskInDb = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(taskInDb?.status).toBe('running');
    expect(taskInDb?.leasedBy).toBe('worker_B');
  });

  // ── 10. Bịt #51 (1e): Partial unique index trên created_by_task_id ───────────
  it('10. Partial unique index created_by_task_id: chống ghi trùng fact/suggestion từ cùng một task', async () => {
    const orgDedupId = `${TEST_PREFIX}_org_dedup_facts`;
    const contactDedupId = `${TEST_PREFIX}_contact_dedup`;
    await prisma.organization.create({
      data: { id: orgDedupId, name: 'Org Dedup Facts Test', agentTokenBudgetMonthly: 10_000 },
    });
    await prisma.contact.create({
      data: { id: contactDedupId, orgId: orgDedupId, fullName: 'Dedup Contact' },
    });

    const sourceTaskId = `${TEST_PREFIX}_source_task_001`;

    // 10a. Facts partial unique
    await prisma.fact.create({
      data: {
        id: `${TEST_PREFIX}_fact_1`,
        orgId: orgDedupId,
        contactId: contactDedupId,
        field: 'interest',
        value: 'AI Automation',
        source: 'zalo.chat',
        strength: 'strong',
        createdByTaskId: sourceTaskId,
      },
    });

    // Fact thứ 2 cùng createdByTaskId -> Từ chối (unique index violation)
    await expect(
      prisma.fact.create({
        data: {
          id: `${TEST_PREFIX}_fact_2`,
          orgId: orgDedupId,
          contactId: contactDedupId,
          field: 'budget',
          value: '50tr',
          source: 'zalo.chat',
          strength: 'medium',
          createdByTaskId: sourceTaskId,
        },
      })
    ).rejects.toThrow();

    // Fact với createdByTaskId = null -> Cho phép nhiều bản ghi null
    const nullFact1 = await prisma.fact.create({
      data: {
        id: `${TEST_PREFIX}_fact_null_1`,
        orgId: orgDedupId,
        contactId: contactDedupId,
        field: 'notes',
        value: 'Note 1',
        source: 'zalo.chat',
        strength: 'weak',
        createdByTaskId: null,
      },
    });
    const nullFact2 = await prisma.fact.create({
      data: {
        id: `${TEST_PREFIX}_fact_null_2`,
        orgId: orgDedupId,
        contactId: contactDedupId,
        field: 'notes',
        value: 'Note 2',
        source: 'zalo.chat',
        strength: 'weak',
        createdByTaskId: null,
      },
    });
    expect(nullFact1.id).toBeDefined();
    expect(nullFact2.id).toBeDefined();

    // 10b. FactSuggestion partial unique
    await prisma.factSuggestion.create({
      data: {
        id: `${TEST_PREFIX}_sug_1`,
        orgId: orgDedupId,
        contactId: contactDedupId,
        field: 'title',
        proposedValue: 'Manager',
        source: 'zalo.chat',
        strength: 'strong',
        reason: 'Khách xưng Trưởng phòng',
        excerpt: 'Tôi là trưởng phòng',
        status: 'pending',
        createdByTaskId: sourceTaskId,
      },
    });

    // FactSuggestion thứ 2 cùng createdByTaskId -> Từ chối
    await expect(
      prisma.factSuggestion.create({
        data: {
          id: `${TEST_PREFIX}_sug_2`,
          orgId: orgDedupId,
          contactId: contactDedupId,
          field: 'title',
          proposedValue: 'Director',
          source: 'zalo.chat',
          strength: 'strong',
          reason: 'Duplicate',
          excerpt: 'Duplicate',
          status: 'pending',
          createdByTaskId: sourceTaskId,
        },
      })
    ).rejects.toThrow();
  });

  // ── 11. Bịt #52: Phân loại lỗi bằng mã đóng (không dùng chuỗi) ───────────────
  it('11. Phân loại lỗi bằng mã đóng: (i) handler ném Error("Request timeout after 30s") -> fail() và attempts tăng; (ii) lỗi P1017 -> không gọi fail(), tăng abandonedCount', async () => {
    const orgErrId = `${TEST_PREFIX}_org_err_classify`;
    await prisma.organization.create({
      data: { id: orgErrId, name: 'Org Error Classify Test', agentTokenBudgetMonthly: 10_000 },
    });

    const taskTimeoutId = `${TEST_PREFIX}_task_timeout`;
    const taskInfraId = `${TEST_PREFIX}_task_infra_p1017`;

    // (i) Handler ném Error('Request timeout after 30s') -> Lỗi nghiệp vụ, KHÔNG PHẢI lỗi hạ tầng DB
    await prisma.agentTask.create({
      data: {
        id: taskTimeoutId,
        orgId: orgErrId,
        kind: 'custom_timeout_task',
        subjectType: 'contact',
        subjectId: 'contact_timeout',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const customTimeoutHandlers = {
      custom_timeout_task: {
        prepare: async () => {
          throw new Error('Request timeout after 30s');
        },
      },
    };

    const resTimeout = await runOnce({ orgId: orgErrId, customHandlers: customTimeoutHandlers });
    expect(resTimeout.failedCount).toBe(1);
    expect(resTimeout.abandonedCount).toBe(0);

    const taskTimeoutInDb = await prisma.agentTask.findUnique({ where: { id: taskTimeoutId } });
    expect(taskTimeoutInDb?.status).toBe('pending');
    expect(taskTimeoutInDb?.attempts).toBe(1);
    expect(taskTimeoutInDb?.lastError).toBe('Request timeout after 30s');

    // (ii) Mô phỏng lỗi có code = 'P1017' (Server has closed the connection) trong transaction apply
    await prisma.agentTask.create({
      data: {
        id: taskInfraId,
        orgId: orgErrId,
        kind: 'custom_infra_task',
        subjectType: 'contact',
        subjectId: 'contact_infra',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const infraError = new Error('Server has closed the connection');
    Object.assign(infraError, { code: 'P1017' });

    const customInfraHandlers = {
      custom_infra_task: {
        prepare: async (task: AgentTask) => ({
          success: true,
          result: { ok: true },
        }),
        apply: async () => {
          throw infraError;
        },
      },
    };

    const resInfra = await runOnce({ orgId: orgErrId, customHandlers: customInfraHandlers });
    expect(resInfra.failedCount).toBe(0);
    expect(resInfra.abandonedCount).toBe(1);

    // Task vẫn ở trạng thái running (không gọi fail(), attempts không tăng do fail())
    const taskInfraInDb = await prisma.agentTask.findUnique({ where: { id: taskInfraId } });
    expect(taskInfraInDb?.status).toBe('running');
    expect(taskInfraInDb?.attempts).toBe(0); // attempts không bị tăng khi hạ tầng lỗi
  });

  // ── 12. Bịt #53 & #62: Ngân sách fail-closed thật và không ghi đè reason ─────
  it('12. Real-time budget limit in runOnce: trần 1000, used 900, handler tiêu 500, gieo 3 task limit 3 -> chỉ 1 task chạy, 2 task reschedule pending, used = 1400', async () => {
    const orgBudgetCheckId = `${TEST_PREFIX}_org_realtime_budget`;
    await prisma.organization.create({
      data: {
        id: orgBudgetCheckId,
        name: 'Org Realtime Budget Test',
        agentTokenBudgetMonthly: 1_000,
        agentTokenUsedThisMonth: 900,
        agentBudgetResetAt: getNextMonthResetDate(),
      },
    });

    const task1Id = `${TEST_PREFIX}_rt_task_1`;
    const task2Id = `${TEST_PREFIX}_rt_task_2`;
    const task3Id = `${TEST_PREFIX}_rt_task_3`;

    const now = Date.now();
    await prisma.agentTask.createMany({
      data: [
        { id: task1Id, orgId: orgBudgetCheckId, kind: 'consume_500', subjectType: 'contact', subjectId: 'c1', dueAt: new Date(now - 30_000), priority: 10, status: 'pending', reason: 'original_reason_1' },
        { id: task2Id, orgId: orgBudgetCheckId, kind: 'consume_500', subjectType: 'contact', subjectId: 'c2', dueAt: new Date(now - 20_000), priority: 5, status: 'pending', reason: 'original_reason_2' },
        { id: task3Id, orgId: orgBudgetCheckId, kind: 'consume_500', subjectType: 'contact', subjectId: 'c3', dueAt: new Date(now - 10_000), priority: 0, status: 'pending', reason: 'original_reason_3' },
      ],
    });

    const customHandlers = {
      consume_500: {
        prepare: async (task: AgentTask) => ({
          success: true,
          result: { taskId: task.id },
          tokensIn: 300,
          tokensOut: 200,
        }),
      },
    };

    const res = await runOnce({ orgId: orgBudgetCheckId, limit: 3, customHandlers });
    expect(res.status).toBe('ok');
    expect(res.claimedCount).toBe(3);
    expect(res.completedCount).toBe(1);
    expect(res.failedCount).toBe(0);

    // Task 1 hoàn thành
    const task1 = await prisma.agentTask.findUnique({ where: { id: task1Id } });
    expect(task1?.status).toBe('completed');

    // Task 2 và Task 3 bị reschedule về pending với deferReason = 'TOKEN_BUDGET_EXHAUSTED', reason gốc giữ nguyên (#72)
    const task2 = await prisma.agentTask.findUnique({ where: { id: task2Id } });
    expect(task2?.status).toBe('pending');
    expect(task2?.reason).toBe('original_reason_2');
    expect(task2?.deferReason).toBe('TOKEN_BUDGET_EXHAUSTED');

    const task3 = await prisma.agentTask.findUnique({ where: { id: task3Id } });
    expect(task3?.status).toBe('pending');
    expect(task3?.reason).toBe('original_reason_3');
    expect(task3?.deferReason).toBe('TOKEN_BUDGET_EXHAUSTED');

    // used = 900 + 500 = 1400 (và không hơn!)
    const orgInDb = await prisma.organization.findUnique({ where: { id: orgBudgetCheckId } });
    expect(orgInDb?.agentTokenUsedThisMonth).toBe(1_400);
  });

  // ── 13. Quyết định 0.10 & #61: Hai bộ đếm claim_count và attempts độc lập múi giờ ──
  it('13. Hai bộ đếm Quyết định 0.10: task bị reap 4 lần liên tiếp -> vẫn pending, attempts = 0, claim_count = 4 (Kiểm thử cả khi SET TIME ZONE)', async () => {
    // #61: Gỡ phụ thuộc múi giờ
    await prisma.$executeRawUnsafe("SET TIME ZONE 'Asia/Ho_Chi_Minh';");

    const orgCountersId = `${TEST_PREFIX}_org_two_counters`;
    await prisma.organization.create({
      data: { id: orgCountersId, name: 'Org Two Counters Test', agentTokenBudgetMonthly: 10_000 },
    });

    const taskId = `${TEST_PREFIX}_task_reap_4_times`;
    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgCountersId,
        kind: 'noop',
        subjectType: 'contact',
        subjectId: 'contact_dummy',
        dueAt: new Date(Date.now() - 60_000),
        status: 'pending',
      },
    });

    // Lặp 4 chu kỳ: claim -> hết hạn lease -> reap
    for (let c = 1; c <= 4; c++) {
      const claimed = await claimDue({ orgId: orgCountersId, workerId: `worker_crash_${c}`, limit: 1, leaseMs: 1 });
      expect(claimed).toHaveLength(1);
      expect(claimed[0].claimCount).toBe(c);
      expect(claimed[0].attempts).toBe(0); // attempts KHÔNG TĂNG khi claim

      // Chờ 10ms cho lease hết hạn
      await new Promise((r) => setTimeout(r, 10));

      const reaped = await reapExpired({ orgId: orgCountersId, leaseGraceMs: 0 });
      expect(reaped.count).toBe(1);

      const inDb = await prisma.agentTask.findUnique({ where: { id: taskId } });
      expect(inDb?.status).toBe('pending');
      expect(inDb?.attempts).toBe(0); // attempts giữ nguyên 0
      expect(inDb?.claimCount).toBe(c); // claim_count = c
      expect(inDb?.lastError).toBe('[REAPED] lease expired');
    }

    const finalInDb = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(finalInDb?.status).toBe('pending');
    expect(finalInDb?.attempts).toBe(0);
    expect(finalInDb?.claimCount).toBe(4);
  });

  // ── 14. Bịt #59: Tách riêng câu khai tử khỏi cấp lease ───────────────────────
  it('14. Tách khai tử khỏi claim: task pending có claim_count = 10 -> claimDue trả về 0 hàng, task chuyển dead, handler không được gọi', async () => {
    const orgDeadClaimId = `${TEST_PREFIX}_org_dead_claim`;
    await prisma.organization.create({
      data: { id: orgDeadClaimId, name: 'Org Dead Claim Test', agentTokenBudgetMonthly: 10_000 },
    });

    const taskId = `${TEST_PREFIX}_task_max_claims_dead`;
    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgDeadClaimId,
        kind: 'custom_check_not_called',
        subjectType: 'contact',
        subjectId: 'contact_dummy',
        dueAt: new Date(Date.now() - 10_000),
        status: 'pending',
        claimCount: 10,
        attempts: 0,
      },
    });

    let handlerCallCount = 0;
    const customHandlers = {
      custom_check_not_called: {
        prepare: async (task: AgentTask) => {
          handlerCallCount++;
          return { success: true, result: { ok: true } };
        },
      },
    };

    const res = await runOnce({ orgId: orgDeadClaimId, customHandlers });
    expect(res.claimedCount).toBe(0);
    expect(res.completedCount).toBe(0);
    expect(handlerCallCount).toBe(0); // Handler tuyệt đối không được gọi

    const taskInDb = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(taskInDb?.status).toBe('dead');
    expect(taskInDb?.lastError).toBe('[INFRA] Max claim count exceeded');
    expect(taskInDb?.leasedBy).toBeNull();
    expect(taskInDb?.leasedUntil).toBeNull();
  });

  // ── 15. Bịt #60: renewLease Heartbeat cho tác vụ chạy lâu ───────────────────
  it('15. renewLease Heartbeat: handler maxDurationMs = 200 ngủ 1200ms trong prepare -> vẫn complete thành công nhờ renewLease', async () => {
    const orgHeartbeatId = `${TEST_PREFIX}_org_heartbeat_test`;
    await prisma.organization.create({
      data: { id: orgHeartbeatId, name: 'Org Heartbeat Test', agentTokenBudgetMonthly: 10_000 },
    });

    const taskId = `${TEST_PREFIX}_task_heartbeat_long_run`;
    await prisma.agentTask.create({
      data: {
        id: taskId,
        orgId: orgHeartbeatId,
        kind: 'custom_long_running',
        subjectType: 'contact',
        subjectId: 'contact_dummy',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const customHandlers = {
      custom_long_running: {
        maxDurationMs: 200,
        prepare: async (task: AgentTask) => {
          // Ngủ 1200ms (lớn hơn 6 lần so với maxDurationMs)
          await new Promise((resolve) => setTimeout(resolve, 1200));
          return {
            success: true,
            result: { finishedAfterSleep: true },
            tokensIn: 50,
            tokensOut: 50,
          };
        },
      },
    };

    const res = await runOnce({ orgId: orgHeartbeatId, customHandlers });
    expect(res.status).toBe('ok');
    expect(res.claimedCount).toBe(1);
    expect(res.completedCount).toBe(1);
    expect(res.failedCount).toBe(0);
    expect(res.lostLeaseCount).toBe(0);

    const taskInDb = await prisma.agentTask.findUnique({ where: { id: taskId } });
    expect(taskInDb?.status).toBe('completed');
    expect(taskInDb?.result).toEqual({ finishedAfterSleep: true });
  });

  // ── 16. #66: Lease phải phủ cả lô, không chỉ task đang chạy ─────────────────
  it('16. Batch lease renewal #66: claim limit 3, leaseMs 300, handler ngủ 250ms -> toàn bộ 3 task phải hoàn thành nhờ gia hạn cả lô', async () => {
    const orgBatchLeaseId = `${TEST_PREFIX}_org_batch_lease_66`;
    await prisma.organization.create({
      data: { id: orgBatchLeaseId, name: 'Org Batch Lease Test 66', agentTokenBudgetMonthly: 10_000 },
    });

    const task1Id = `${TEST_PREFIX}_batch_task_1`;
    const task2Id = `${TEST_PREFIX}_batch_task_2`;
    const task3Id = `${TEST_PREFIX}_batch_task_3`;

    const now = Date.now();
    await prisma.agentTask.createMany({
      data: [
        { id: task1Id, orgId: orgBatchLeaseId, kind: 'batch_sleep_task', subjectType: 'contact', subjectId: 'c1', dueAt: new Date(now - 30_000), priority: 10, status: 'pending' },
        { id: task2Id, orgId: orgBatchLeaseId, kind: 'batch_sleep_task', subjectType: 'contact', subjectId: 'c2', dueAt: new Date(now - 20_000), priority: 5, status: 'pending' },
        { id: task3Id, orgId: orgBatchLeaseId, kind: 'batch_sleep_task', subjectType: 'contact', subjectId: 'c3', dueAt: new Date(now - 10_000), priority: 0, status: 'pending' },
      ],
    });

    const customHandlers = {
      batch_sleep_task: {
        maxDurationMs: 200,
        prepare: async (task: AgentTask) => {
          // Ngủ 250ms mỗi task
          await new Promise((resolve) => setTimeout(resolve, 250));
          return {
            success: true,
            result: { doneTaskId: task.id },
            tokensIn: 10,
            tokensOut: 10,
          };
        },
      },
    };

    const res = await runOnce({ orgId: orgBatchLeaseId, limit: 3, leaseMs: 300, customHandlers });
    
    // Kỳ vọng cho bài toán sau khi sửa đúng: Toàn bộ 3 task hoàn thành, 0 task mất lease
    // Khi chạy trên mã hiện tại (chưa sửa), test này PHẢI ĐỎ vì task 2/3 bị mất lease trong lúc task 1 chạy.
    expect(res.claimedCount).toBe(3);
    expect(res.completedCount).toBe(3);
    expect(res.lostLeaseCount).toBe(0);
    expect(res.failedCount).toBe(0);

    const t1 = await prisma.agentTask.findUnique({ where: { id: task1Id } });
    const t2 = await prisma.agentTask.findUnique({ where: { id: task2Id } });
    const t3 = await prisma.agentTask.findUnique({ where: { id: task3Id } });

    expect(t1?.status).toBe('completed');
    expect(t2?.status).toBe('completed');
    expect(t3?.status).toBe('completed');
  });

  // ── 17. #67: Nhịp gia hạn suy từ lease đang giữ ─────────────────────────────
  it('17. Lease timing #67: handler maxDurationMs = 150_000 -> leaseMs = 300_000, leaseRenewIntervalMs = 100_000 < leaseMs', () => {
    const longRunningHandlers = {
      heavy_ai_task: {
        maxDurationMs: 150_000,
        prepare: async () => ({ success: true }),
      },
    };

    const timing = computeLeaseTiming(longRunningHandlers);
    expect(timing.leaseMs).toBe(300_000); // max(60_000, 150_000 * 2) = 300_000
    expect(timing.leaseRenewIntervalMs).toBe(100_000); // floor(300_000 / 3) = 100_000

    // Bất biến cốt lõi: Chu kỳ renew luôn nhỏ hơn đáng kể so với thời hạn lease ban đầu
    expect(timing.leaseRenewIntervalMs).toBeLessThan(timing.leaseMs);
    expect(timing.leaseMs / timing.leaseRenewIntervalMs).toBeGreaterThanOrEqual(2.5);

    // Kiểm tra cấu hình mặc định (không khai maxDurationMs)
    const defaultTiming = computeLeaseTiming({});
    expect(defaultTiming.leaseMs).toBe(60_000);
    expect(defaultTiming.leaseRenewIntervalMs).toBe(20_000);
    expect(defaultTiming.leaseRenewIntervalMs).toBeLessThan(defaultTiming.leaseMs);

    // Kiểm tra cấu hình thời lượng siêu ngắn (100ms)
    const shortTiming = computeLeaseTiming({ quick: { maxDurationMs: 100, prepare: async () => ({ success: true }) } }, 300);
    expect(shortTiming.leaseMs).toBe(300);
    expect(shortTiming.leaseRenewIntervalMs).toBe(100); // 300 / 3 = 100 >= 50
    expect(shortTiming.leaseRenewIntervalMs).toBeLessThan(shortTiming.leaseMs);
  });
});
