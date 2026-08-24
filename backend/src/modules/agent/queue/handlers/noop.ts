import type { AgentTask, Prisma } from '@prisma/client';
import type { PrismaTx } from '../../../../shared/database/prisma-client.js';

export interface TaskHandlerContext {
  orgId: string;
  workerId: string;
  now: Date;
}

export interface PreparedTaskResult<TWrites = unknown> {
  success: boolean;
  writes?: TWrites;
  result?: Prisma.InputJsonValue;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface TaskHandler<TWrites = unknown> {
  /**
   * Thời lượng ước tính tối đa của tác vụ (ms).
   * Dùng để định thời hạn lease ban đầu và chu kỳ gọi renewLease tự động.
   * Mặc định là 30_000ms (30s) nếu không khai báo.
   */
  maxDurationMs?: number;

  /**
   * Số lượng token ước tính tối đa (#65).
   * Dùng để đặt cọc kiểm tra trần ngân sách trước khi vào prepare.
   * Nếu runningTokensUsed + maxTokens > trần tháng -> hoãn task và dừng batch.
   */
  maxTokens?: number;

  /**
   * Pha 1: prepare chạy NGOÀI giao dịch database.
   * Gọi LLM, Zalo API, tính toán...
   * TUYỆT ĐỐI KHÔNG GHI DATABASE TRONG PHA NÀY.
   */
  prepare: (task: AgentTask, ctx: TaskHandlerContext) => Promise<PreparedTaskResult<TWrites>>;

  /**
   * Pha 2: apply chạy TRONG giao dịch database (tx).
   * Chỉ thực hiện các câu lệnh ghi DB với dữ liệu đã prepare.
   * TUYỆT ĐỐI KHÔNG GỌI MẠNG / LLM TRONG PHA NÀY.
   */
  apply?: (tx: PrismaTx, prepared: PreparedTaskResult<TWrites>, task: AgentTask) => Promise<void>;
}

export const noopHandler: TaskHandler<{ handledBy: string }> = {
  prepare: async (task: AgentTask, ctx: TaskHandlerContext): Promise<PreparedTaskResult<{ handledBy: string }>> => {
    return {
      success: true,
      writes: {
        handledBy: 'noop',
      },
      result: {
        handledBy: 'noop',
        taskId: task.id,
        kind: task.kind,
        timestamp: ctx.now.toISOString(),
      },
      tokensIn: 0,
      tokensOut: 0,
    };
  },
  apply: async (_tx: PrismaTx, _prepared: PreparedTaskResult<{ handledBy: string }>, _task: AgentTask): Promise<void> => {
    // noop không ghi thêm bản ghi vào DB
  },
};
