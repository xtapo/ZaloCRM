#!/usr/bin/env bash
set -euo pipefail

# Chuyen ve thu muc backend
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

cd "${BACKEND_DIR}"

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
ALLOW_INTEGRATION_DB="1" DATABASE_URL="postgresql://crmuser:devpassword@localhost:5433/zalocrm_test" npm run test:integration

echo "========================================================"
echo "==> 4. Drift Check 1 (datasource -> schema)..."
echo "========================================================"
DATABASE_URL="postgresql://crmuser:devpassword@localhost:5433/zalocrm_test" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code

echo "========================================================"
echo "==> 5. Drift Check 2 (migrations -> schema)..."
echo "========================================================"
DATABASE_URL="postgresql://crmuser:devpassword@localhost:5433/zalocrm_test" SHADOW_DATABASE_URL="postgresql://crmuser:devpassword@localhost:5433/zalocrm_shadow_test" npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code

# Ghi con dau sau khi tat ca cac cong deu xanh
GIT_DIR="${REPO_ROOT}/.git"
HEAD_COMMIT="$(git rev-parse HEAD)"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "${HEAD_COMMIT} ${TIMESTAMP}" > "${GIT_DIR}/ci-local-pass"

echo "========================================================"
echo "==> [SUCCESS] Tat ca cong kiem local deu XANH!"
echo "==> Da dong dau tai .git/ci-local-pass (${HEAD_COMMIT})"
echo "========================================================"
