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
import { noopHandler, type TaskHandler } from './handlers/noop.js';

export interface RunOnceOptions {
  orgId: string;
  now?: Date;
  limit?: number;
  customHandlers?: Record<string, TaskHandler>;
}

export interface RunOnceResult {
  status: 'ok' | 'blocked';
  reason?: string;
  reapedCount: number;
  claimedCount: number;
  completedCount: number;
  failedCount: number;
}

const DEFAULT_HANDLERS: Record<string, TaskHandler> = {
  noop: noopHandler,
  test: noopHandler,
};

/**
 * runOnce: Một lượt quét và xử lý hàng đợi cho một tổ chức (tenant)
 */
export async function runOnce(options: RunOnceOptions): Promise<RunOnceResult> {
  const { orgId, limit = 10, customHandlers = {} } = options;

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

  // 1. Cửa ngân sách token (Fail-closed): Đọc Organization.agentTokenBudgetMonthly
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      agentTokenBudgetMonthly: true,
      agentTokenUsedThisMonth: true,
    },
  });

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
  const tasks = await claimDue({ orgId, limit });
  const handlers = { ...DEFAULT_HANDLERS, ...customHandlers };

  let completedCount = 0;
  let failedCount = 0;

  // 4. Xử lý từng task qua handler
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

    try {
      const result = await handler(task);
      if (result.success) {
        await complete({
          orgId,
          taskId: task.id,
          result: result.result,
        });
        completedCount++;
      } else {
        await fail({
          orgId,
          taskId: task.id,
          error: result.error || 'Handler returned failure without error message',
        });
        failedCount++;
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await fail({
        orgId,
        taskId: task.id,
        error: errorMsg,
      });
      failedCount++;
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
