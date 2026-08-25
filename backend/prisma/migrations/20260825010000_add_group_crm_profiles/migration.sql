-- Group CRM management (2026-08-25) — profile CRM gắn với 1 nhóm Zalo
-- (tags, ghi chú, tên hiển thị riêng, nhân viên phụ trách).

-- CreateTable
CREATE TABLE "group_crm_profiles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "external_group_id" TEXT NOT NULL,
    "crm_name" TEXT,
    "notes" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "assigned_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_crm_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_crm_profiles_zalo_account_id_external_group_id_key" ON "group_crm_profiles"("zalo_account_id", "external_group_id");

-- CreateIndex
CREATE INDEX "group_crm_profiles_org_id_assigned_user_id_idx" ON "group_crm_profiles"("org_id", "assigned_user_id");

-- AddForeignKey
ALTER TABLE "group_crm_profiles" ADD CONSTRAINT "group_crm_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_crm_profiles" ADD CONSTRAINT "group_crm_profiles_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_crm_profiles" ADD CONSTRAINT "group_crm_profiles_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
