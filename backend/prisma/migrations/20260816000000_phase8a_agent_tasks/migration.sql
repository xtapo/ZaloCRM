-- Phase 8a: Durable Work Queue — AgentTask & Organization Token Budget
-- 1. Thêm 3 cột quản lý ngân sách token cho Organization (Fail-closed nếu NULL)
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "agent_token_budget_monthly" INTEGER,
ADD COLUMN IF NOT EXISTS "agent_token_used_this_month" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "agent_budget_reset_at" TIMESTAMP(3);

-- 2. Tạo bảng agent_tasks phục vụ hàng đợi tác vụ bền vững (Work Queue & Leasing)
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

-- 3. Các index hỗ trợ truy vấn worker lease và dedup task
CREATE INDEX IF NOT EXISTS "agent_tasks_org_id_status_due_at_idx" ON "agent_tasks"("org_id", "status", "due_at");
CREATE INDEX IF NOT EXISTS "agent_tasks_leased_until_idx" ON "agent_tasks"("leased_until");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tasks_org_id_kind_subject_type_subject_id_status_key" ON "agent_tasks"("org_id", "kind", "subject_type", "subject_id", "status");

-- 4. Foreign key ràng buộc với organization
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_org_id_fkey') THEN
    ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
