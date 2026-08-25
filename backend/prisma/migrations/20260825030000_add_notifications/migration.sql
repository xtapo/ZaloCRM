-- Persistent notifications (2026-08-25) — bảng lưu thông báo + trạng thái đã đọc.
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Một nguồn thông báo chỉ tồn tại 1 row cho mỗi người nhận → upsert theo cặp này.
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- Query chính: danh sách active (resolved_at IS NULL) của 1 user, badge unread.
CREATE INDEX "notifications_org_id_user_id_resolved_at_read_at_idx" ON "notifications"("org_id", "user_id", "resolved_at", "read_at");
-- Sort mới nhất trước trong danh sách.
CREATE INDEX "notifications_org_id_user_id_created_at_idx" ON "notifications"("org_id", "user_id", "created_at" DESC);
