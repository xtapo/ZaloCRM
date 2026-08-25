-- Audit log đầy đủ (2026-08-25) — lưu IP hash + user-agent + index listing toàn tổ chức.

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN "ip_hash" TEXT;
ALTER TABLE "activity_logs" ADD COLUMN "user_agent" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_logs_org_id_created_at_idx" ON "activity_logs"("org_id", "created_at" DESC);
