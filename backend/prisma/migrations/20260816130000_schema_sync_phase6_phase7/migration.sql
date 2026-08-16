-- Migration 20260816130000_schema_sync_phase6_phase7
-- Đồng bộ chi tiết schema và constraints giữa Phase 6, Phase 7 và schema.prisma

-- 1. Bổ sung cột ip_address cho user_privacy_sessions (tham chiếu: backend/src/modules/privacy/pin-service.ts:224 phục vụ hiển thị phiên thiết bị của user)
ALTER TABLE "user_privacy_sessions" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;

-- 2. Bỏ default rỗng của departments.path (được quản lý tự động và nhất quán bởi trigger recompute_department_path trong 20260521020000_rbac_phase_phan_quyen)
ALTER TABLE "departments" ALTER COLUMN "path" DROP DEFAULT;

-- 3. Đồng bộ Foreign Key ràng buộc created_by_id sang ON DELETE RESTRICT cho automation & blocks
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'block_folders_created_by_id_fkey') THEN
    ALTER TABLE "block_folders" DROP CONSTRAINT "block_folders_created_by_id_fkey";
  END IF;
  ALTER TABLE "block_folders" ADD CONSTRAINT "block_folders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocks_created_by_id_fkey') THEN
    ALTER TABLE "blocks" DROP CONSTRAINT "blocks_created_by_id_fkey";
  END IF;
  ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_sequences_created_by_id_fkey') THEN
    ALTER TABLE "automation_sequences" DROP CONSTRAINT "automation_sequences_created_by_id_fkey";
  END IF;
  ALTER TABLE "automation_sequences" ADD CONSTRAINT "automation_sequences_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_triggers_created_by_id_fkey') THEN
    ALTER TABLE "automation_triggers" DROP CONSTRAINT "automation_triggers_created_by_id_fkey";
  END IF;
  ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_broadcasts_created_by_id_fkey') THEN
    ALTER TABLE "automation_broadcasts" DROP CONSTRAINT "automation_broadcasts_created_by_id_fkey";
  END IF;
  ALTER TABLE "automation_broadcasts" ADD CONSTRAINT "automation_broadcasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_broadcasts_block_id_fkey') THEN
    ALTER TABLE "automation_broadcasts" DROP CONSTRAINT "automation_broadcasts_block_id_fkey";
  END IF;
  ALTER TABLE "automation_broadcasts" ADD CONSTRAINT "automation_broadcasts_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

-- 4. Chuẩn hóa tên index cho conversations theo quy ước đặt tên của Prisma
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'conversations_org_id_threadType_zalo_account_id_last_message_at') THEN
    ALTER INDEX "conversations_org_id_threadType_zalo_account_id_last_message_at" RENAME TO "conversations_org_id_threadType_zalo_account_id_last_messag_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'conversations_org_id_zalo_account_id_is_replied_last_message_at') THEN
    ALTER INDEX "conversations_org_id_zalo_account_id_is_replied_last_message_at" RENAME TO "conversations_org_id_zalo_account_id_is_replied_last_messag_idx";
  END IF;
END $$;
