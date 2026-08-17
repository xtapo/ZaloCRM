#!/usr/bin/env bash
# verify-self-heal.sh — Kiểm thử kịch bản tự phục hồi (Self-Healing) cho 15 object thuần-SQL (#68)
#
# Quy trình:
# 1. Dựng database nháp zalocrm_repairtest và chạy migrate deploy.
# 2. Xóa sạch cả 15 object (10 CHECK + 5 Partial Unique Indexes).
# 3. Chạy Gate 6 -> Khẳng định ĐỎ (thiếu 15 object).
# 4. Chạy thủ công các migration tự phục hồi (20260817040000, 20260817050000).
# 5. Chạy Gate 6 -> Khẳng định XANH (khớp 100% biểu thức).
# 6. Dọn dẹp database nháp.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${BACKEND_DIR}"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-crmuser}"
DB_PASS="${DB_PASS:-devpassword}"
TEST_DB_NAME="zalocrm_repairtest"

REPAIR_DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}?schema=public"

export PGPASSWORD="${DB_PASS}"

run_sql() {
  local db="$1"
  local sql="${2:-}"
  if command -v psql &> /dev/null; then
    if [ -n "${sql}" ]; then
      psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${db}" -c "${sql}"
    else
      psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${db}"
    fi
  else
    if [ -n "${sql}" ]; then
      docker exec -i zalo-crm-db-dev psql -U "${DB_USER}" -d "${db}" -c "${sql}"
    else
      docker exec -i zalo-crm-db-dev psql -U "${DB_USER}" -d "${db}"
    fi
  fi
}

run_sql_file() {
  local db="$1"
  local file="$2"
  if command -v psql &> /dev/null; then
    psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${db}" -f "${file}"
  else
    docker exec -i zalo-crm-db-dev psql -U "${DB_USER}" -d "${db}" < "${file}"
  fi
}

echo "========================================================"
echo "==> 1. Chuẩn bị database nháp: ${TEST_DB_NAME}..."
echo "========================================================"
run_sql postgres "DROP DATABASE IF EXISTS ${TEST_DB_NAME};"
run_sql postgres "CREATE DATABASE ${TEST_DB_NAME};"

echo "========================================================"
echo "==> 2. Chạy migrate deploy trên ${TEST_DB_NAME}..."
echo "========================================================"
DATABASE_URL="${REPAIR_DB_URL}" npx prisma migrate deploy

echo "========================================================"
echo "==> 3. Giả lập mất mát: Xóa toàn bộ 15 object thuần-SQL..."
echo "========================================================"
run_sql "${TEST_DB_NAME}" << 'EOF'
ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_status_check;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS chk_dept_depth_max;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS chk_dept_no_self_parent;
ALTER TABLE department_members DROP CONSTRAINT IF EXISTS chk_dept_role;
ALTER TABLE zalo_accounts DROP CONSTRAINT IF EXISTS chk_zalo_privacy_mode;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_no_self_merge_check;
ALTER TABLE fact_suggestions DROP CONSTRAINT IF EXISTS fact_suggestions_source_not_bank_card_check;
ALTER TABLE fact_suggestions DROP CONSTRAINT IF EXISTS fact_suggestions_status_check;
ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_source_not_bank_card_check;
ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_strength_check;

DROP INDEX IF EXISTS agent_tasks_active_dedup_key;
DROP INDEX IF EXISTS fact_suggestions_created_by_task_id_uniq;
DROP INDEX IF EXISTS facts_created_by_task_id_uniq;
DROP INDEX IF EXISTS uniq_one_deputy_per_dept;
DROP INDEX IF EXISTS uniq_one_leader_per_dept;
EOF

echo "========================================================"
echo "==> 4. Kiểm tra Cổng 6 (Phải ĐỎ do thiếu 15 object)..."
echo "========================================================"
set +e
DATABASE_URL="${REPAIR_DB_URL}" npx tsx scripts/verify-pure-sql-objects.ts
GATE6_EXIT=$?
set -e

if [ ${GATE6_EXIT} -eq 0 ]; then
  echo "❌ [LỖI] Gate 6 đáng lẽ phải ĐỎ khi thiếu 15 object nhưng lại XANH!"
  exit 1
fi
echo "✅ Gate 6 đã chặn đúng khi 15 object bị xóa."

echo "========================================================"
echo "==> 5. Chạy SQL tự phục hồi (Self-Healing migrations)..."
echo "========================================================"
run_sql_file "${TEST_DB_NAME}" prisma/migrations/20260817040000_repair_pure_sql_objects/migration.sql
run_sql_file "${TEST_DB_NAME}" prisma/migrations/20260817050000_repair_rbac_privacy_checks/migration.sql

echo "========================================================"
echo "==> 6. Kiểm tra Cổng 6 sau khi phục hồi (Phải XANH)..."
echo "========================================================"
DATABASE_URL="${REPAIR_DB_URL}" npx tsx scripts/verify-pure-sql-objects.ts

echo "========================================================"
echo "==> 7. Dọn dẹp database nháp..."
echo "========================================================"
run_sql postgres "DROP DATABASE IF EXISTS ${TEST_DB_NAME};"

echo "🎉 [THÀNH CÔNG] Cơ chế tự phục hồi (Self-Healing) cho 15 object thuần-SQL hoạt động hoàn hảo!"
