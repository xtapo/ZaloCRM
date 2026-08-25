-- Automation rules hoàn thiện (2026-08-25):
-- 1. last_error/last_error_at trên automation_rules — debug rule chạy lỗi.
-- 2. Bảng automation_run_logs — lịch sử chạy rule (rule nào, KH nào, action gì, lỗi gì).
ALTER TABLE "automation_rules" ADD COLUMN "last_error" TEXT;
ALTER TABLE "automation_rules" ADD COLUMN "last_error_at" TIMESTAMP(3);

CREATE TABLE "automation_run_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "contact_id" TEXT,
    "actions_run" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_run_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_run_logs_org_id_rule_id_ran_at_idx" ON "automation_run_logs"("org_id", "rule_id", "ran_at" DESC);
CREATE INDEX "automation_run_logs_org_id_ran_at_idx" ON "automation_run_logs"("org_id", "ran_at" DESC);
