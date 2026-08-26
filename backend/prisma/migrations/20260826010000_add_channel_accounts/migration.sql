-- Multi-channel messaging (2026-08-26):
-- 1. Bảng channel_accounts — tài khoản kênh ngoài Zalo (Messenger page / Telegram bot /
--    WhatsApp number). Token AES-256-GCM, access model MVP org-wide.
-- 2. Bảng channel_contacts — mapping external id (PSID / chat_id / wa_id) → Contact.
-- 3. conversations: provider ('zalo' default) + channel_account_id + unique/index riêng
--    cho conv channel.
-- 4. messages: external_msg_id (FB mid, Telegram message_id) — unique per conversation
--    để webhook idempotent. Tin Zalo giữ NULL → Postgres cho phép nhiều NULL.
--
-- LƯU Ý sentinel: conversations.zalo_account_id là NOT NULL FK. Conv channel không có
-- nick Zalo thật → mỗi org có 1 ZaloAccount sentinel zalo_uid='SENTINEL:<orgId>'
-- (displayName '— Channel placeholder —', status 'disconnected'). Conv channel trỏ
-- sentinel này. Code mới LUÔN đọc conv.provider/channelAccount, không bao giờ đụng
-- zaloAccount của conv channel.

CREATE TABLE "channel_accounts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "access_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'connected',
    "last_error" TEXT,
    "privacy_mode" TEXT NOT NULL DEFAULT 'sub',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_accounts_org_id_provider_external_id_key" ON "channel_accounts"("org_id", "provider", "external_id");
CREATE INDEX "channel_accounts_org_id_provider_status_idx" ON "channel_accounts"("org_id", "provider", "status");

ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "channel_contacts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_contacts_org_id_provider_external_id_key" ON "channel_contacts"("org_id", "provider", "external_id");
CREATE INDEX "channel_contacts_contact_id_idx" ON "channel_contacts"("contact_id");

ALTER TABLE "channel_contacts" ADD CONSTRAINT "channel_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- conversations: cột provider + channel_account_id
ALTER TABLE "conversations" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'zalo';
ALTER TABLE "conversations" ADD COLUMN "channel_account_id" TEXT;

CREATE UNIQUE INDEX "conversations_channel_account_id_external_thread_id_key" ON "conversations"("channel_account_id", "external_thread_id");
CREATE INDEX "conversations_org_id_provider_channel_account_id_last_message_at_idx" ON "conversations"("org_id", "provider", "channel_account_id", "last_message_at" DESC);

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- messages: external_msg_id + dedup unique
ALTER TABLE "messages" ADD COLUMN "external_msg_id" TEXT;
CREATE UNIQUE INDEX "messages_conversation_id_external_msg_id_key" ON "messages"("conversation_id", "external_msg_id");

-- Sentinel ZaloAccount per-org cho conv channel (zalo_account_id NOT NULL vẫn thỏa).
-- zalo_uid unique → prefix SENTINEL:<orgId> đảm bảo 1 row/org.
-- owner_user_id = user role='owner' đầu tiên của org (fallback: user bất kỳ nếu org
-- chưa có ai role owner — tránh INSERT fail).
INSERT INTO "zalo_accounts" ("id", "org_id", "owner_user_id", "zalo_uid", "display_name", "status", "privacy_mode", "created_at")
SELECT
    gen_random_uuid(),
    o."id",
    COALESCE(
        (SELECT u."id" FROM "users" u WHERE u."org_id" = o."id" AND u."role" = 'owner' ORDER BY u."created_at" LIMIT 1),
        (SELECT u."id" FROM "users" u WHERE u."org_id" = o."id" ORDER BY u."created_at" LIMIT 1)
    ),
    'SENTINEL:' || o."id",
    '— Channel placeholder —',
    'disconnected',
    'sub',
    CURRENT_TIMESTAMP
FROM "organizations" o
WHERE NOT EXISTS (
    SELECT 1 FROM "zalo_accounts" za WHERE za."zalo_uid" = 'SENTINEL:' || o."id"
) AND EXISTS (SELECT 1 FROM "users" u WHERE u."org_id" = o."id");
