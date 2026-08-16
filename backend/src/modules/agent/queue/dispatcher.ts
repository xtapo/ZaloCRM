/**
 * dispatcher.ts — Pure single-pass execution cycle for Agent Queue
 *
 * Thực hiện 1 chu kỳ xử lý:
 * 1. Kiểm tra ngân sách token tại Organization (Fail-closed nếu null / vượt hạn mức)
 * 2. reapExpired thu hồi task running treo
 * 3. claimDue nhận task đến hạn
 * 4. Thực thi handler tương ứng và complete/fail
 *
 * Không chứa setInterval, không hook vào Fastify bootstrap.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { claimDue, complete, fail, reapExpired } from './tasks.js';
import { noopHandler, type TaskHandler, type PreparedTaskResult, type TaskHandlerContext } from './handlers/noop.js';
import { checkAndResetMonthlyBudget, consumeTokens } from './budget.js';

export interface RunOnceOptions {
  orgId: string;
  workerId?: string;
  now?: Date;
  limit?: number;
  customHandlers?: Record<string, TaskHandler<any>>;
}

export interface RunOnceResult {
  status: 'ok' | 'blocked';
  reason?: string;
  reapedCount: number;
  claimedCount: number;
  completedCount: number;
  failedCount: number;
}

const DEFAULT_HANDLERS: Record<string, TaskHandler<any>> = {
  noop: noopHandler,
  test: noopHandler,
};

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
    };
  }

  // 2. Thu hồi lease quá hạn
  const { count: reapedCount } = await reapExpired({ orgId });

  // 3. Claim tasks đến hạn
  const tasks = await claimDue({ orgId, workerId, limit });
  const handlers = { ...DEFAULT_HANDLERS, ...customHandlers };

  let completedCount = 0;
  let failedCount = 0;

  const ctx: TaskHandlerContext = {
    orgId,
    workerId,
    now,
  };

  // 4. Xử lý từng task qua handler hai pha (prepare ngoài giao dịch, apply + complete trong 1 giao dịch)
  for (const task of tasks) {
    const handler = handlers[task.kind] || handlers['noop'];
    if (!handler) {
      await fail({
        orgId,
        taskId: task.id,
        error: `No handler registered for kind '${task.kind}'`,
      });
      failedCount++;
      continue;
    }

    // ── PHA 1: prepare chạy NGOÀI giao dịch database ──
    let prepared: PreparedTaskResult;
    try {
      prepared = await handler.prepare(task, ctx);
    } catch (prepareErr: unknown) {
      const errorMsg = prepareErr instanceof Error ? prepareErr.message : String(prepareErr);
      try {
        await fail({
          orgId,
          taskId: task.id,
          error: errorMsg,
        });
      } catch {}
      failedCount++;
      continue;
    }

    // Nếu prepare trả về thất bại logic
    if (!prepared.success) {
      try {
        await fail({
          orgId,
          taskId: task.id,
          error: prepared.error || 'Handler prepare returned failure',
        });
      } catch {}
      failedCount++;

      // Vẫn consume token nếu prepare đã gọi LLM/network và tiêu thụ token
      const totalTokens = (prepared.tokensIn || 0) + (prepared.tokensOut || 0);
      if (totalTokens > 0) {
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
          result: prepared.result,
          tx,
        });
      });
      completedCount++;
    } catch (txErr: unknown) {
      const errorMsg = txErr instanceof Error ? txErr.message : String(txErr);
      // Phân biệt 2 lớp lỗi:
      // - Lỗi hạ tầng giao dịch DB (P1001, P1017, P2024, timeout, connection drop...) -> KHÔNG gọi fail(), ghi log CRITICAL để lease hết hạn cho reapExpired thu về
      // - Lỗi từ logic/validation trong apply -> fail() và tính vào attempts
      const isDbInfraError =
        (txErr && typeof txErr === 'object' && 'code' in txErr && typeof txErr.code === 'string' &&
          (txErr.code.startsWith('P1') || txErr.code === 'P2024' || txErr.code === 'P2028' || txErr.code === '57014')) ||
        errorMsg.includes('Connection') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('closed') ||
        errorMsg.includes('ECONNREFUSED');

      if (isDbInfraError) {
        console.error(`[CRITICAL] [dispatcher] Database transaction infrastructure error for task ${task.id} (org ${orgId}):`, txErr);
      } else {
        try {
          await fail({
            orgId,
            taskId: task.id,
            error: errorMsg,
          });
        } catch {}
      }
      failedCount++;
    }

    // ── BƯỚC 3: consumeTokens gọi SAU giao dịch (kể cả khi tx rollback vì token LLM/mạng trong prepare đã tiêu thật) ──
    const totalTokens = (prepared.tokensIn || 0) + (prepared.tokensOut || 0);
    if (totalTokens > 0) {
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
  };
}
