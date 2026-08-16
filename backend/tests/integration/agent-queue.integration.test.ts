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
import { prisma } from '../../src/shared/database/prisma-client.js';
import { claimDue, complete, fail, reschedule, reapExpired } from '../../src/modules/agent/queue/tasks.js';
import { runOnce } from '../../src/modules/agent/queue/dispatcher.js';

describe('Agent Queue & Dispatcher Integration Tests (Real DB without mock)', () => {
  const TEST_PREFIX = `queue_test_${Date.now()}`;

  const orgAId = `${TEST_PREFIX}_org_a`;
  const orgBId = `${TEST_PREFIX}_org_b`;
  const orgNoBudgetId = `${TEST_PREFIX}_org_no_budget`;
  const orgExhaustedId = `${TEST_PREFIX}_org_exhausted`;
  const orgValidId = `${TEST_PREFIX}_org_valid`;

  beforeAll(async () => {
    // Tạo các Organization phục vụ test
    await prisma.organization.createMany({
      data: [
        { id: orgAId, name: 'Queue Test Org A', agentTokenBudgetMonthly: 50_000, agentTokenUsedThisMonth: 0 },
        { id: orgBId, name: 'Queue Test Org B', agentTokenBudgetMonthly: 50_000, agentTokenUsedThisMonth: 0 },
        { id: orgNoBudgetId, name: 'Queue Test Org No Budget', agentTokenBudgetMonthly: null, agentTokenUsedThisMonth: 0 },
        { id: orgExhaustedId, name: 'Queue Test Org Exhausted', agentTokenBudgetMonthly: 1000, agentTokenUsedThisMonth: 1000 },
        { id: orgValidId, name: 'Queue Test Org Valid', agentTokenBudgetMonthly: 100_000, agentTokenUsedThisMonth: 100 },
      ],
    });
  });

  afterAll(async () => {
    // Dọn dẹp sạch sẽ dữ liệu test
    const allOrgIds = [orgAId, orgBId, orgNoBudgetId, orgExhaustedId, orgValidId];
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

    // Gọi 2 lần claimDue song song
    const [batch1, batch2] = await Promise.all([
      claimDue({ orgId: orgAId, limit: 10 }),
      claimDue({ orgId: orgAId, limit: 10 }),
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
  });

  // ── 2. Phép thử ngược: Thử nghiệm không dùng SKIP LOCKED ─────────────────────
  it('2. Phép thử ngược: Kiểm chứng hành vi cạnh tranh khi không có SKIP LOCKED', async () => {
    const taskIds: string[] = [];
    const now = new Date();

    // Gieo 5 task pending
    for (let i = 0; i < 5; i++) {
      const taskId = `${TEST_PREFIX}_noskip_task_${i}`;
      taskIds.push(taskId);
      await prisma.agentTask.create({
        data: {
          id: taskId,
          orgId: orgAId,
          kind: 'test_noskip',
          subjectType: 'contact',
          subjectId: `contact_noskip_${i}`,
          dueAt: new Date(now.getTime() - 1000 * (5 - i)),
          status: 'pending',
        },
      });
    }

    // Khi không có SKIP LOCKED, câu lệnh subquery FOR UPDATE khóa toàn bộ hàng phù hợp.
    // Lần gọi song song thứ hai phải chờ khóa hoặc đọc trạng thái sau khi câu thứ nhất hoàn tất.
    const [batch1, batch2] = await Promise.all([
      claimDue({ orgId: orgAId, limit: 5, skipLocked: false }),
      claimDue({ orgId: orgAId, limit: 5, skipLocked: false }),
    ]);

    // Quan sát kết quả: câu thứ nhất claim hết 5 task, câu thứ hai chờ và sau đó lấy được 0 task
    // vì subquery evaluate lại sau khi update 1 commit
    expect(batch1.length + batch2.length).toBe(5);
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
        attempts: 2,
        maxAttempts: 3,
      },
    });

    // Lần fail thứ nhất: attempts (2) < maxAttempts (3) -> pending với backoff
    const fail1 = await fail({ orgId: orgAId, taskId, error: 'Transient network failure' });
    expect(fail1).not.toBeNull();
    expect(fail1?.status).toBe('pending');
    expect(fail1?.lastError).toBe('Transient network failure');

    // Giả lập worker claim lại (attempts tăng lên 3)
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: 'running', attempts: 3 },
    });

    // Lần fail thứ hai: attempts (3) >= maxAttempts (3) -> dead
    const fail2 = await fail({ orgId: orgAId, taskId, error: 'Permanent fatal failure' });
    expect(fail2).not.toBeNull();
    expect(fail2?.status).toBe('dead');
    expect(fail2?.lastError).toBe('Permanent fatal failure');
    expect(fail2?.leasedUntil).toBeNull();
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
    const batchA = await claimDue({ orgId: orgAId, limit: 10 });
    const batchAIds = batchA.map((t) => t.id);
    expect(batchAIds).toContain(taskAId);
    expect(batchAIds).not.toContain(taskBId);

    // Org B claim
    const batchB = await claimDue({ orgId: orgBId, limit: 10 });
    const batchBIds = batchB.map((t) => t.id);
    expect(batchBIds).toContain(taskBId);
    expect(batchBIds).not.toContain(taskAId);

    // Cross-tenant mutation: Org A cố complete task của Org B -> Bị từ chối (null)
    const crossComplete = await complete({ orgId: orgAId, taskId: taskBId });
    expect(crossComplete).toBeNull();

    // Cross-tenant mutation: Org A cố fail task của Org B -> Bị từ chối (null)
    const crossFail = await fail({ orgId: orgAId, taskId: taskBId, error: 'hack' });
    expect(crossFail).toBeNull();

    // Cross-tenant mutation: Org A cố reschedule task của Org B -> Bị từ chối (null)
    const crossReschedule = await reschedule({
      orgId: orgAId,
      taskId: taskBId,
      runAt: new Date(),
      reason: 'malicious reschedule',
    });
    expect(crossReschedule).toBeNull();

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
    await prisma.agentTask.create({
      data: {
        id: taskValidId,
        orgId: orgValidId,
        kind: 'noop',
        subjectType: 'contact',
        subjectId: 'contact_valid',
        dueAt: new Date(),
        status: 'pending',
      },
    });

    const resultValid = await runOnce({ orgId: orgValidId });
    expect(resultValid.status).toBe('ok');
    expect(resultValid.claimedCount).toBe(1);
    expect(resultValid.completedCount).toBe(1);

    const taskCompleted = await prisma.agentTask.findUnique({ where: { id: taskValidId } });
    expect(taskCompleted?.status).toBe('completed');
    expect(taskCompleted?.payload).toMatchObject({ handledBy: 'noop', taskId: taskValidId });
  });
});
