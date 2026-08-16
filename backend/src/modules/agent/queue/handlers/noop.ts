/**
 * noop.ts — Test / No-op handler for Agent Queue
 */

import type { AgentTask, Prisma } from '@prisma/client';

export interface TaskHandlerResult {
  success: boolean;
  result?: Prisma.InputJsonValue;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export type TaskHandler = (task: AgentTask) => Promise<TaskHandlerResult>;

export const noopHandler: TaskHandler = async (task: AgentTask): Promise<TaskHandlerResult> => {
  return {
    success: true,
    result: {
      handledBy: 'noop',
      taskId: task.id,
      kind: task.kind,
      timestamp: new Date().toISOString(),
    },
    tokensIn: 0,
    tokensOut: 0,
  };
};
