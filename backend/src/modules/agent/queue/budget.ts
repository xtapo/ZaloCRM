/**
 * budget.ts — Agent Token Budget management and automatic monthly reset
 */

import { prisma } from '../../../shared/database/prisma-client.js';

export interface ConsumeTokensParams {
  orgId: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Tính ngày đầu tháng kế tiếp (00:00:00.000 UTC) làm mốc reset chu kỳ token
 */
export function getNextMonthResetDate(from: Date = new Date()): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
}

/**
 * consumeTokens: Cộng số token tiêu thụ (in + out) vào agent_token_used_this_month trong 1 transaction
 */
export async function consumeTokens(params: ConsumeTokensParams): Promise<{
  agentTokenUsedThisMonth: number;
  agentTokenBudgetMonthly: number | null;
}> {
  const { orgId, tokensIn, tokensOut } = params;
  const delta = Math.max(0, (tokensIn || 0) + (tokensOut || 0));

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: orgId },
      data: {
        agentTokenUsedThisMonth: {
          increment: delta,
        },
      },
      select: {
        agentTokenUsedThisMonth: true,
        agentTokenBudgetMonthly: true,
      },
    });
    return org;
  });
}

/**
 * checkAndResetMonthlyBudget: Kiểm tra và reset ngân sách token nếu chưa có mốc reset hoặc mốc đã qua
 */
export async function checkAndResetMonthlyBudget(
  orgId: string,
  now: Date = new Date()
): Promise<{
  id: string;
  agentTokenBudgetMonthly: number | null;
  agentTokenUsedThisMonth: number;
  agentBudgetResetAt: Date | null;
} | null> {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        agentTokenBudgetMonthly: true,
        agentTokenUsedThisMonth: true,
        agentBudgetResetAt: true,
      },
    });
    if (!org) return null;

    // Khi agentBudgetResetAt là null: CHỈ đặt mốc reset, TUYỆT ĐỐI không chạm agentTokenUsedThisMonth
    if (org.agentBudgetResetAt === null) {
      const nextReset = getNextMonthResetDate(now);
      return tx.organization.update({
        where: { id: orgId },
        data: {
          agentBudgetResetAt: nextReset,
        },
        select: {
          id: true,
          agentTokenBudgetMonthly: true,
          agentTokenUsedThisMonth: true,
          agentBudgetResetAt: true,
        },
      });
    }

    // Chỉ zero-hoá khi vượt qua một mốc đã đặt (agentBudgetResetAt <= now)
    if (org.agentBudgetResetAt <= now) {
      const nextReset = getNextMonthResetDate(now);
      return tx.organization.update({
        where: { id: orgId },
        data: {
          agentTokenUsedThisMonth: 0,
          agentBudgetResetAt: nextReset,
        },
        select: {
          id: true,
          agentTokenBudgetMonthly: true,
          agentTokenUsedThisMonth: true,
          agentBudgetResetAt: true,
        },
      });
    }

    return org;
  });
}
