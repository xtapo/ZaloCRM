-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "defer_reason" TEXT;
