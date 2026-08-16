-- Phase 8a: Durable Work Queue — AgentTask & Organization Token Budget
-- AlterTable: add agent token budget to organizations
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "agent_token_budget_monthly" INTEGER,
ADD COLUMN IF NOT EXISTS "agent_token_used_this_month" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "agent_budget_reset_at" TIMESTAMP(3);

-- CreateTable: agent_tasks with lease columns
CREATE TABLE IF NOT EXISTS "agent_tasks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "leased_by" TEXT,
    "leased_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "payload" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_tasks_org_id_status_due_at_idx" ON "agent_tasks"("org_id", "status", "due_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_tasks_leased_until_idx" ON "agent_tasks"("leased_until");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tasks_org_id_kind_subject_type_subject_id_status_key" ON "agent_tasks"("org_id", "kind", "subject_type", "subject_id", "status");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_org_id_fkey') THEN
    ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Schema sync: privacy sessions, departments, and constraints
ALTER TABLE "user_privacy_sessions" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;
ALTER TABLE "departments" ALTER COLUMN "path" DROP DEFAULT;

DROP INDEX IF EXISTS "messages_zalo_cli_msg_id_idx";
DROP INDEX IF EXISTS "permission_groups_grants_idx";
DROP INDEX IF EXISTS "users_permission_group_id_idx";

DO $$ BEGIN
  ALTER TABLE "automation_broadcasts" DROP CONSTRAINT IF EXISTS "automation_broadcasts_block_id_fkey";
  ALTER TABLE "automation_broadcasts" DROP CONSTRAINT IF EXISTS "automation_broadcasts_created_by_id_fkey";
  ALTER TABLE "automation_sequences" DROP CONSTRAINT IF EXISTS "automation_sequences_created_by_id_fkey";
  ALTER TABLE "automation_triggers" DROP CONSTRAINT IF EXISTS "automation_triggers_created_by_id_fkey";
  ALTER TABLE "block_folders" DROP CONSTRAINT IF EXISTS "block_folders_created_by_id_fkey";
  ALTER TABLE "blocks" DROP CONSTRAINT IF EXISTS "blocks_created_by_id_fkey";

  ALTER TABLE "block_folders" ADD CONSTRAINT "block_folders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "automation_sequences" ADD CONSTRAINT "automation_sequences_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "automation_broadcasts" ADD CONSTRAINT "automation_broadcasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER INDEX "conversations_org_id_threadType_zalo_account_id_last_message_at" RENAME TO "conversations_org_id_threadType_zalo_account_id_last_messag_idx";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER INDEX "conversations_org_id_zalo_account_id_is_replied_last_message_at" RENAME TO "conversations_org_id_zalo_account_id_is_replied_last_messag_idx";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
