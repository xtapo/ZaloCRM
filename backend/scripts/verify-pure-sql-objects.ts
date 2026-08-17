/**
 * verify-pure-sql-objects.ts — CI Gate 6: Kiểm tra toàn vẹn các object thuần-SQL
 *
 * Kiểm tra 10 CHECK constraints và 5 Partial Unique Indexes (Tổng cộng 15 objects).
 * So khớp chính xác cả tên và biểu thức định nghĩa từ pure-sql-inventory.ts.
 */

import { prisma } from '../src/shared/database/prisma-client.js';
import { REQUIRED_CHECK_CONSTRAINTS, REQUIRED_PARTIAL_INDEXES } from '../src/shared/database/pure-sql-inventory.js';

interface ConstraintDefRow {
  conname: string;
  def: string;
}

interface IndexDefRow {
  indexname: string;
  def: string;
}

async function main() {
  console.log('🔍 [GATE 6] Đang kiểm tra 15 object thuần-SQL trên database...');

  // 1. Kiểm tra 10 CHECK constraints
  const constraints = await prisma.$queryRaw<ConstraintDefRow[]>`
    SELECT conname::text, pg_get_constraintdef(oid)::text AS def
    FROM pg_constraint 
    WHERE contype::text = 'c' 
      AND connamespace = 'public'::regnamespace;
  `;

  const foundConstraints = new Map(constraints.map((c) => [c.conname, c.def]));
  const missingConstraints: string[] = [];
  const mismatchedConstraints: { name: string; expected: string; actual: string }[] = [];

  for (const spec of REQUIRED_CHECK_CONSTRAINTS) {
    if (!foundConstraints.has(spec.name)) {
      missingConstraints.push(spec.name);
    } else {
      const actualDef = foundConstraints.get(spec.name)!;
      if (actualDef !== spec.expectedDef) {
        mismatchedConstraints.push({
          name: spec.name,
          expected: spec.expectedDef,
          actual: actualDef,
        });
      }
    }
  }

  if (missingConstraints.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Thiếu ${missingConstraints.length} CHECK constraint(s):`, missingConstraints);
    process.exit(1);
  }

  if (mismatchedConstraints.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Phát hiện ${mismatchedConstraints.length} CHECK constraint bị sai biểu thức:`, mismatchedConstraints);
    process.exit(1);
  }

  console.log(`✅ [GATE 6] 10/10 CHECK constraints đã hiện diện và khớp 100% biểu thức:`, REQUIRED_CHECK_CONSTRAINTS.map((c) => c.name));

  // 2. Kiểm tra 5 Partial Unique Indexes
  const indexes = await prisma.$queryRaw<IndexDefRow[]>`
    SELECT indexname::text, indexdef::text AS def
    FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND indexdef LIKE '%WHERE%';
  `;

  const foundIndexes = new Map(indexes.map((i) => [i.indexname, i.def]));
  const missingIndexes: string[] = [];
  const mismatchedIndexes: { name: string; expected: string; actual: string }[] = [];

  for (const spec of REQUIRED_PARTIAL_INDEXES) {
    if (!foundIndexes.has(spec.name)) {
      missingIndexes.push(spec.name);
    } else {
      const actualDef = foundIndexes.get(spec.name)!;
      if (actualDef !== spec.expectedDef) {
        mismatchedIndexes.push({
          name: spec.name,
          expected: spec.expectedDef,
          actual: actualDef,
        });
      }
    }
  }

  if (missingIndexes.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Thiếu ${missingIndexes.length} partial unique index(es):`, missingIndexes);
    process.exit(1);
  }

  if (mismatchedIndexes.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Phát hiện ${mismatchedIndexes.length} partial unique index bị sai biểu thức:`, mismatchedIndexes);
    process.exit(1);
  }

  console.log(`✅ [GATE 6] 5/5 Partial Unique Indexes đã hiện diện và khớp 100% biểu thức:`, REQUIRED_PARTIAL_INDEXES.map((i) => i.name));
  console.log('🎉 [GATE 6 HOÀN TẤT] Toàn bộ 15/15 object thuần-SQL đều toàn vẹn và khớp biểu thức.');
}

main()
  .catch((err) => {
    console.error('❌ [GATE 6 LỖI HỆ THỐNG]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
