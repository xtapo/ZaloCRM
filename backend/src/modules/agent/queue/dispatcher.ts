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
  kindFilter?: string[] | string;
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
 *
 * Ghi chú đánh đổi kiến trúc #77:
 * leaseMs lấy theo handler chậm nhất kéo dài thời gian phục hồi của mọi task trong lô nếu có sự cố.
 * Có thể sử dụng tùy chọn `kindFilter` trong RunOnceOptions để phân luồng/nhóm hàng đợi theo kind.
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
    kindFilter,
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

  const tasks = await claimDue({ orgId, workerId, limit, leaseMs, kindFilter });

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

    // Bịt #53, 5a & #65: Đặt cọc maxTokens trước khi vào prepare. Vượt trần thì reschedule các task còn lại và dừng vòng lặp
    const estimatedTokens = typeof handler.maxTokens === 'number' ? handler.maxTokens : 0;
    if (runningTokensUsed + estimatedTokens > org.agentTokenBudgetMonthly || runningTokensUsed >= org.agentTokenBudgetMonthly) {
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

    // ── PHA 1: prepare chạy NGOÀI giao dịch database kèm renewLeases heartbeat cả lô (#66, #67, #73) ──
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let heartbeatLeaseLost = false;
    let abortPrepare: ((err: Error) => void) | null = null;
    const leaseLostPromise = new Promise<never>((_, reject) => {
      abortPrepare = reject;
    });

    const renewBatch = async () => {
      try {
        // 1. Task đang chạy: kiểm tra và gia hạn nghiêm ngặt (#73)
        await renewLease({
          orgId,
          taskId: task.id,
          workerId,
          leaseMs,
        });

        // 2. Các task còn lại trong lô: gia hạn khoan dung (#66)
        const waitingTaskIds = tasks.slice(i + 1).map((t) => t.id);
        if (waitingTaskIds.length > 0) {
          await renewLeases({
            orgId,
            taskIds: waitingTaskIds,
            workerId,
            leaseMs,
          });
        }
      } catch (renewErr) {
        if (renewErr instanceof LeaseLostError) {
          heartbeatLeaseLost = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (abortPrepare) abortPrepare(renewErr);
        } else {
          console.error(`[LEASE-RENEW-ERR] Unexpected error renewing leases for batch starting at task ${task.id}:`, renewErr);
        }
      }
    };

    // #79: Beat đầu tiên chạy NGAY ở task đầu tiên (i === 0). Các task thứ hai trở đi (i > 0)
    // không cần beat đồng bộ lặp lại vì setInterval của task trước đã phủ chu kỳ gia hạn.
    if (i === 0) {
      await renewBatch();
    }
    heartbeatTimer = setInterval(renewBatch, leaseRenewIntervalMs);

    let prepared: PreparedTaskResult;
    try {
      prepared = await Promise.race([
        handler.prepare(task, ctx),
        leaseLostPromise,
      ]);
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

    // #74: Helper settleTokens trừ token vào quota của org và cập nhật runningTokensUsed
    // token LLM đã tiêu thật trước khi biết giao dịch thành công hay không
    let tokensSettled = false;
    const settleTokens = async (prep?: PreparedTaskResult) => {
      if (tokensSettled || !prep) return;
      tokensSettled = true;
      const totalTokens = (prep.tokensIn || 0) + (prep.tokensOut || 0);
      if (totalTokens > 0) {
        runningTokensUsed += totalTokens;
        try {
          await consumeTokens({
            orgId,
            tokensIn: prep.tokensIn || 0,
            tokensOut: prep.tokensOut || 0,
          });
        } catch (tokenErr) {
          console.error(`[WARN] [dispatcher] Failed to consume tokens for task ${task.id}:`, tokenErr);
        }
      }
    };

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

      // Vẫn consume token nếu prepare đã gọi LLM/network và tiêu thụ token (#74)
      await settleTokens(prepared);
      continue;
    }

    // ── PHA 2: MỘT prisma.$transaction gồm apply(tx) + complete(tx) (#76) ──
    // 4a. Gia hạn lease một lần ngay TRƯỚC khi vào $transaction (ngoài transaction)
    try {
      await renewLease({
        orgId,
        taskId: task.id,
        workerId,
        leaseMs,
      });
    } catch (renewBeforeTxErr) {
      if (renewBeforeTxErr instanceof LeaseLostError) {
        console.warn(`[LEASE-LOST] Lease lost before entering transaction for task ${task.id} (worker: ${workerId})`);
        lostLeaseCount++;
        // #74: token LLM đã tiêu thật trước khi biết giao dịch thành công hay không
        await settleTokens(prepared);
        continue;
      }
      console.error(`[LEASE-RENEW-ERR] Unexpected error renewing lease before transaction for task ${task.id}:`, renewBeforeTxErr);
    }

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
      // Sau khi apply và complete thành công, consume token trong quota của org (#74)
      await settleTokens(prepared);
    } catch (txErr: unknown) {
      if (txErr instanceof LeaseLostError) {
        console.warn(`[LEASE-LOST] Lease lost during transaction for task ${task.id} (worker: ${workerId})`);
        lostLeaseCount++;
        // #74: token LLM đã tiêu thật trước khi biết giao dịch thành công hay không
        await settleTokens(prepared);
        continue;
      }

      if (isDatabaseInfrastructureError(txErr)) {
        console.error(`[CRITICAL] [dispatcher] Database transaction infrastructure error for task ${task.id} (org ${orgId}):`, txErr);
        abandonedCount++;
        // #74: token LLM đã tiêu thật trước khi biết giao dịch thành công hay không
        await settleTokens(prepared);
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

      // Vẫn consume token nếu prepare đã tiêu thụ token trước khi apply ném lỗi logic (#74)
      await settleTokens(prepared);
      continue;
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
