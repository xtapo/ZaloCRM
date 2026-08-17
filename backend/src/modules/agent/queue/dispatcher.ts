import { prisma } from '../../../shared/database/prisma-client.js';
import { claimDue, complete, fail, renewLease, renewLeases, reschedule, reapExpired, LeaseLostError } from './tasks.js';
import { noopHandler, type TaskHandler, type PreparedTaskResult, type TaskHandlerContext } from './handlers/noop.js';
import { checkAndResetMonthlyBudget, consumeTokens } from './budget.js';

export interface RunOnceOptions {
  orgId: string;
  workerId?: string;
  now?: Date;
  limit?: number;
  leaseMs?: number;
  customHandlers?: Record<string, TaskHandler<any>>;
}

export interface RunOnceResult {
  status: 'ok' | 'blocked';
  reason?: string;
  reapedCount: number;
  claimedCount: number;
  completedCount: number;
  failedCount: number;
  abandonedCount: number;
  lostLeaseCount: number;
}

export interface LeaseTiming {
  leaseMs: number;
  leaseRenewIntervalMs: number;
}

const DEFAULT_HANDLERS: Record<string, TaskHandler<any>> = {
  noop: noopHandler,
  test: noopHandler,
};

/**
 * #67: Tính toán leaseMs và chu kỳ renewLease (leaseRenewIntervalMs) dựa trên các handler đã đăng ký.
 * - leaseMs = Math.max(60_000, maxHandlerDurationMs * 2)
 * - leaseRenewIntervalMs = Math.max(Math.floor(leaseMs / 3), 50)
 */
export function computeLeaseTiming(
  handlers: Record<string, TaskHandler<any>>,
  overrideLeaseMs?: number
): LeaseTiming {
  const registeredHandlers = Object.values(handlers);
  const maxHandlerDurationMs = Math.max(
    0,
    ...registeredHandlers.map((h) => (h && typeof h.maxDurationMs === 'number' ? h.maxDurationMs : 30_000))
  );
  const calculatedLeaseMs = Math.max(60_000, maxHandlerDurationMs * 2);
  const leaseMs = overrideLeaseMs ?? calculatedLeaseMs;
  const leaseRenewIntervalMs = Math.max(Math.floor(leaseMs / 3), 50);
  return { leaseMs, leaseRenewIntervalMs };
}

// ── Bịt #52: Phân loại lỗi bằng mã đóng, không dùng chuỗi ──────────────────────
const INFRA_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
const INFRA_SQLSTATE_CODES = new Set(['57014', '57P01', '08006', '08003', '08001']);

export function isDatabaseInfrastructureError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  if ('code' in err && typeof (err as { code: unknown }).code === 'string') {
    const code = (err as { code: string }).code;
    if (INFRA_PRISMA_CODES.has(code) || INFRA_SQLSTATE_CODES.has(code)) {
      return true;
    }
  }

  if ('pgCode' in err && typeof (err as { pgCode: unknown }).pgCode === 'string') {
    const pgCode = (err as { pgCode: string }).pgCode;
    if (INFRA_SQLSTATE_CODES.has(pgCode)) {
      return true;
    }
  }

  return false;
}

/**
 * runOnce: Một lượt quét và xử lý hàng đợi cho một tổ chức (tenant)
 */
export async function runOnce(options: RunOnceOptions): Promise<RunOnceResult> {
  const {
    orgId,
    workerId = process.env.WORKER_ID || `dispatcher-${process.pid}`,
    now = new Date(),
    limit = 10,
    customHandlers = {},
  } = options;

  if (!orgId) {
    return {
      status: 'blocked',
      reason: 'MISSING_ORG_ID',
      reapedCount: 0,
      claimedCount: 0,
      completedCount: 0,
      failedCount: 0,
      abandonedCount: 0,
      lostLeaseCount: 0,
    };
  }

  // 1. Cửa ngân sách token (Fail-closed & Auto-reset): Kiểm tra mốc reset và tự động đặt lại hạn mức nếu sang tháng mới
  const org = await checkAndResetMonthlyBudget(orgId, now);

  if (!org) {
    return {
      status: 'blocked',
      reason: 'ORG_NOT_FOUND',
      reapedCount: 0,
      claimedCount: 0,
      completedCount: 0,
      failedCount: 0,
      abandonedCount: 0,
      lostLeaseCount: 0,
    };
  }

  // Quyết định 0.2: Để trống hạn mức (null / undefined) nghĩa là fail-closed: dừng ngay
  if (org.agentTokenBudgetMonthly === null || org.agentTokenBudgetMonthly === undefined) {
    return {
      status: 'blocked',
      reason: 'TOKEN_BUDGET_NOT_CONFIGURED',
      reapedCount: 0,
      claimedCount: 0,
      completedCount: 0,
      failedCount: 0,
      abandonedCount: 0,
      lostLeaseCount: 0,
    };
  }

  if (org.agentTokenUsedThisMonth >= org.agentTokenBudgetMonthly) {
    return {
      status: 'blocked',
      reason: 'TOKEN_BUDGET_EXHAUSTED',
      reapedCount: 0,
      claimedCount: 0,
      completedCount: 0,
      failedCount: 0,
      abandonedCount: 0,
      lostLeaseCount: 0,
    };
  }

  // 2. Thu hồi lease quá hạn
  const { count: reapedCount } = await reapExpired({ orgId });

  // 3. Tính toán nhịp lease (#67) & Claim tasks đến hạn
  const handlers = { ...DEFAULT_HANDLERS, ...customHandlers };
  const { leaseMs, leaseRenewIntervalMs } = computeLeaseTiming(handlers, options.leaseMs);

  const tasks = await claimDue({ orgId, workerId, limit, leaseMs });

  let completedCount = 0;
  let failedCount = 0;
  let abandonedCount = 0;
  let lostLeaseCount = 0;

  let runningTokensUsed = org.agentTokenUsedThisMonth;

  const ctx: TaskHandlerContext = {
    orgId,
    workerId,
    now,
  };

  // 4. Xử lý từng task qua handler hai pha (prepare ngoài giao dịch, apply + complete trong 1 giao dịch)
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    // Bịt #53 & 5a: Kiểm tra ngân sách trước mỗi lượt prepare. Vượt trần thì reschedule các task còn lại và dừng vòng lặp
    if (runningTokensUsed >= org.agentTokenBudgetMonthly) {
      for (let j = i; j < tasks.length; j++) {
        try {
          await reschedule({
            orgId,
            taskId: tasks[j].id,
            workerId,
            runAt: new Date(Date.now() + 60_000),
            reason: 'TOKEN_BUDGET_EXHAUSTED',
          });
        } catch (reschedErr) {
          if (reschedErr instanceof LeaseLostError) {
            console.warn(`[LEASE-LOST] Lease lost while rescheduling task ${tasks[j].id} (worker: ${workerId})`);
            lostLeaseCount++;
          } else {
            console.error(`[WARN] [dispatcher] Failed to reschedule task ${tasks[j].id} due to budget exhaustion:`, reschedErr);
          }
        }
      }
      break;
    }

    const handler = handlers[task.kind] || handlers['noop'];
    if (!handler) {
      try {
        await fail({
          orgId,
          taskId: task.id,
          workerId,
          error: `No handler registered for kind '${task.kind}'`,
        });
        failedCount++;
      } catch (fErr) {
        if (fErr instanceof LeaseLostError) {
          console.warn(`[LEASE-LOST] Lease lost for task ${task.id} (worker: ${workerId})`);
          lostLeaseCount++;
        }
      }
      continue;
    }

    // ── PHA 1: prepare chạy NGOÀI giao dịch database kèm renewLeases heartbeat cả lô (#66, #67) ──
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let heartbeatLeaseLost = false;

    const renewBatch = async () => {
      try {
        const remainingTaskIds = tasks.slice(i).map((t) => t.id);
        await renewLeases({
          orgId,
          taskIds: remainingTaskIds,
          workerId,
          leaseMs,
        });
      } catch (renewErr) {
        if (renewErr instanceof LeaseLostError) {
          heartbeatLeaseLost = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        } else {
          console.error(`[LEASE-RENEW-ERR] Unexpected error renewing leases for batch starting at task ${task.id}:`, renewErr);
        }
      }
    };

    // 2b. Beat đầu tiên chạy NGAY khi vào prepare, không chờ hết chu kỳ đầu
    await renewBatch();
    heartbeatTimer = setInterval(renewBatch, leaseRenewIntervalMs);

    let prepared: PreparedTaskResult;
    try {
      prepared = await handler.prepare(task, ctx);
      if (heartbeatLeaseLost) {
        throw new LeaseLostError(task.id, workerId);
      }
    } catch (prepareErr: unknown) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      if (prepareErr instanceof LeaseLostError) {
        console.warn(`[LEASE-LOST] Lease lost for task ${task.id} (worker: ${workerId})`);
        lostLeaseCount++;
        continue;
      }

      const errorMsg = prepareErr instanceof Error ? prepareErr.message : String(prepareErr);
      try {
        await fail({
          orgId,
          taskId: task.id,
          workerId,
          error: errorMsg,
        });
        failedCount++;
      } catch (fErr) {
        if (fErr instanceof LeaseLostError) {
          console.warn(`[LEASE-LOST] Lease lost for task ${task.id} (worker: ${workerId})`);
          lostLeaseCount++;
        }
      }
      continue;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }

    // Nếu prepare trả về thất bại logic
    if (!prepared.success) {
      try {
        await fail({
          orgId,
          taskId: task.id,
          workerId,
          error: prepared.error || 'Handler prepare returned failure',
        });
        failedCount++;
      } catch (fErr) {
        if (fErr instanceof LeaseLostError) {
          console.warn(`[LEASE-LOST] Lease lost for task ${task.id} (worker: ${workerId})`);
          lostLeaseCount++;
        }
      }

      // Vẫn consume token nếu prepare đã gọi LLM/network và tiêu thụ token
      const totalTokens = (prepared.tokensIn || 0) + (prepared.tokensOut || 0);
      if (totalTokens > 0) {
        runningTokensUsed += totalTokens;
        try {
          await consumeTokens({
            orgId,
            tokensIn: prepared.tokensIn || 0,
            tokensOut: prepared.tokensOut || 0,
          });
        } catch (tokenErr) {
          console.error(`[WARN] [dispatcher] Failed to consume tokens on prepare failure for task ${task.id}:`, tokenErr);
        }
      }
      continue;
    }

    // ── PHA 2: MỘT prisma.$transaction gồm apply(tx) + complete(tx) ──
    try {
      await prisma.$transaction(async (tx) => {
        if (handler.apply) {
          await handler.apply(tx, prepared, task);
        }
        await complete({
          orgId,
          taskId: task.id,
          workerId,
          result: prepared.result,
          tx,
        });
      });
      completedCount++;
    } catch (txErr: unknown) {
      if (txErr instanceof LeaseLostError) {
        console.warn(`[LEASE-LOST] Lease lost during transaction for task ${task.id} (worker: ${workerId})`);
        lostLeaseCount++;
        continue;
      }

      if (isDatabaseInfrastructureError(txErr)) {
        console.error(`[CRITICAL] [dispatcher] Database transaction infrastructure error for task ${task.id} (org ${orgId}):`, txErr);
        abandonedCount++;
        continue;
      }

      const applyErrorMsg = txErr instanceof Error ? txErr.message : String(txErr);
      try {
        await fail({
          orgId,
          taskId: task.id,
          workerId,
          error: applyErrorMsg,
        });
        failedCount++;
      } catch (fErr) {
        if (fErr instanceof LeaseLostError) {
          console.warn(`[LEASE-LOST] Lease lost while failing task ${task.id} (worker: ${workerId})`);
          lostLeaseCount++;
        }
      }

      // Vẫn consume token nếu prepare đã tiêu thụ token trước khi apply ném lỗi logic
      const totalTokens = (prepared.tokensIn || 0) + (prepared.tokensOut || 0);
      if (totalTokens > 0) {
        runningTokensUsed += totalTokens;
        try {
          await consumeTokens({
            orgId,
            tokensIn: prepared.tokensIn || 0,
            tokensOut: prepared.tokensOut || 0,
          });
        } catch (tokenErr) {
          console.error(`[WARN] [dispatcher] Failed to consume tokens on apply failure for task ${task.id}:`, tokenErr);
        }
      }
      continue;
    }

    // Sau khi apply và complete thành công, consume token trong quota của org
    const totalTokens = (prepared.tokensIn || 0) + (prepared.tokensOut || 0);
    if (totalTokens > 0) {
      runningTokensUsed += totalTokens;
      try {
        await consumeTokens({
          orgId,
          tokensIn: prepared.tokensIn || 0,
          tokensOut: prepared.tokensOut || 0,
        });
      } catch (tokenErr) {
        console.error(`[WARN] [dispatcher] Failed to consume tokens for task ${task.id}:`, tokenErr);
      }
    }
  }

  return {
    status: 'ok',
    reapedCount,
    claimedCount: tasks.length,
    completedCount,
    failedCount,
    abandonedCount,
    lostLeaseCount,
  };
}
