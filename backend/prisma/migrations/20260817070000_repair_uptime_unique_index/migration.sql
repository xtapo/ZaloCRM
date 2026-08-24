-- Self-healing partial unique index for uptime tracking (#75)
-- Ensures only one open status log record per account (ended_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "zalo_account_status_log_one_open_per_account_idx"
  ON "zalo_account_status_log" ("account_id")
  WHERE ("ended_at" IS NULL);
