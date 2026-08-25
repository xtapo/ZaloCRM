-- Notification preferences (2026-08-25) — bật/tắt từng nguồn thông báo per-user.
ALTER TABLE "users" ADD COLUMN "notification_prefs" JSONB;
