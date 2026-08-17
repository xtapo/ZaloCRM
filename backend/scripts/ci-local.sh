#!/usr/bin/env bash
set -euo pipefail

# Chuyen ve thu muc backend
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

cd "${BACKEND_DIR}"

# Cau hinh database tu bien moi truong (co gia tri mac dinh)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-crmuser}"
DB_PASSWORD="${DB_PASSWORD:-devpassword}"
DEFAULT_DB="${DEFAULT_DB:-zalocrm}"
TEST_DB_NAME="${TEST_DB_NAME:-zalocrm_test}"
SHADOW_DB_NAME="${SHADOW_DB_NAME:-zalocrm_shadow_test}"
CONTAINER_NAME="${CONTAINER_NAME:-zalo-crm-db-dev}"

TEST_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}"
SHADOW_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${SHADOW_DB_NAME}"

echo "========================================================"
echo "==> 0. Chuan bi Database (Container, Schema, Prisma)..."
echo "========================================================"

# 1. Kiem tra container zalo-crm-db-dev dang chay
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "==> Container ${CONTAINER_NAME} chua chay. Dang khoi dong..."
  docker start "${CONTAINER_NAME}" 2>/dev/null || docker compose -f "${REPO_ROOT}/docker-compose.dev.yml" up -d
fi

echo "==> Cho PostgreSQL san sang (pg_isready)..."
docker exec "${CONTAINER_NAME}" sh -c "until pg_isready -U ${DB_USER}; do sleep 1; done"

# 2. Tao database zalocrm_test va zalocrm_shadow_test neu chua co
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DEFAULT_DB}" -tc "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB_NAME}'" | grep -q 1 || \
  docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DEFAULT_DB}" -c "CREATE DATABASE ${TEST_DB_NAME};"

docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DEFAULT_DB}" -tc "SELECT 1 FROM pg_database WHERE datname = '${SHADOW_DB_NAME}'" | grep -q 1 || \
  docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DEFAULT_DB}" -c "CREATE DATABASE ${SHADOW_DB_NAME};"

# 3. Reset database zalocrm_test ve schema migration moi nhat
echo "==> Reset migration tren ${TEST_DB_NAME}..."
DATABASE_URL="${TEST_DATABASE_URL}" npx prisma migrate reset --force

# 4. Sinh Prisma Client
echo "==> Sinh Prisma Client (prisma generate)..."
DATABASE_URL="${TEST_DATABASE_URL}" npx prisma generate

echo "========================================================"
echo "==> 1. Typecheck (tsc -p tsconfig.test.json --noEmit)..."
echo "========================================================"
npm run typecheck

echo "========================================================"
echo "==> 2. Unit Tests (npm test)..."
echo "========================================================"
npm test

echo "========================================================"
echo "==> 3. Integration Tests (npm run test:integration)..."
echo "========================================================"
ALLOW_INTEGRATION_DB="1" DATABASE_URL="${TEST_DATABASE_URL}" npm run test:integration

echo "========================================================"
echo "==> 4. Drift Check 1 (datasource -> schema)..."
echo "========================================================"
DATABASE_URL="${TEST_DATABASE_URL}" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code

echo "========================================================"
echo "==> 5. Drift Check 2 (migrations -> schema)..."
echo "========================================================"
DATABASE_URL="${TEST_DATABASE_URL}" SHADOW_DATABASE_URL="${SHADOW_DATABASE_URL}" npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code

echo "========================================================"
echo "==> 6. Pure-SQL Objects Integrity Check (CHECKs & Indexes)..."
echo "========================================================"
DATABASE_URL="${TEST_DATABASE_URL}" npx tsx scripts/verify-pure-sql-objects.ts

# Ghi con dau sau khi tat ca cac cong deu xanh
GIT_DIR="${REPO_ROOT}/.git"
HEAD_COMMIT="$(git rev-parse HEAD)"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "${HEAD_COMMIT} ${TIMESTAMP}" > "${GIT_DIR}/ci-local-pass"

echo "========================================================"
echo "==> [SUCCESS] Tat ca cong kiem local deu XANH!"
echo "==> Da dong dau tai .git/ci-local-pass (${HEAD_COMMIT})"
echo "========================================================"
