-- Phase 8a: Durable Work Queue — AgentTask & Organization Token Budget
-- AlterTable: add agent token budget to organizations
ALTER TABLE "organizations" ADD COLUMN "agent_token_budget_monthly" INTEGER,
ADD COLUMN "agent_token_used_this_month" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "agent_budget_reset_at" TIMESTAMP(3);

-- CreateTable: agent_tasks with lease columns
CREATE TABLE "agent_tasks" (
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
CREATE INDEX "agent_tasks_org_id_status_due_at_idx" ON "agent_tasks"("org_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "agent_tasks_leased_until_idx" ON "agent_tasks"("leased_until");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tasks_org_id_kind_subject_type_subject_id_status_key" ON "agent_tasks"("org_id", "kind", "subject_type", "subject_id", "status");

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
