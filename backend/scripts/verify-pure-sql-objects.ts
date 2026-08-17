/**
 * verify-pure-sql-objects.ts — CI Gate 6: Kiểm tra toàn vẹn các object thuần-SQL
 *
 * Kiểm tra 10 CHECK constraints và 5 Partial Unique Indexes (Tổng cộng 15 objects).
 * - So khớp chính xác cả tên và biểu thức định nghĩa từ pure-sql-inventory.ts (chuẩn hóa khoảng trắng).
 * - Đẳng thức tập hợp hai chiều (Việc 4 / #69): Không thiếu object nào và không có object rác nào ngoài danh mục.
 */

import { prisma } from '../src/shared/database/prisma-client.js';
import {
  REQUIRED_CHECK_CONSTRAINTS,
  REQUIRED_PARTIAL_INDEXES,
  EXCLUDED_PARTIAL_INDEXES,
  EXCLUDED_CHECK_CONSTRAINTS,
} from '../src/shared/database/pure-sql-inventory.js';

interface ConstraintDefRow {
  conname: string;
  def: string;
}

interface IndexDefRow {
  indexname: string;
  def: string;
}

async function main() {
  console.log('🔍 [GATE 6] Đang kiểm tra 15 object thuần-SQL trên database (Đẳng thức hai chiều)...');

  let hasError = false;

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Kiểm tra CHECK constraints (Hai chiều)
  // ────────────────────────────────────────────────────────────────────────────
  const constraints = await prisma.$queryRaw<ConstraintDefRow[]>`
    SELECT conname::text, pg_get_constraintdef(oid)::text AS def
    FROM pg_constraint 
    WHERE contype::text = 'c' 
      AND connamespace = 'public'::regnamespace;
  `;

  const foundConstraints = new Map(constraints.map((c) => [c.conname.trim(), c.def.trim()]));
  const expectedConstraintNames = new Set(REQUIRED_CHECK_CONSTRAINTS.map((c) => c.name.trim()));

  const missingConstraints: string[] = [];
  const mismatchedConstraints: { name: string; expected: string; actual: string }[] = [];
  const unexpectedConstraints: { name: string; def: string }[] = [];

  // 1a. Chiều xuôi: Mọi object trong danh mục phải tồn tại và khớp biểu thức
  for (const spec of REQUIRED_CHECK_CONSTRAINTS) {
    const specName = spec.name.trim();
    if (!foundConstraints.has(specName)) {
      missingConstraints.push(specName);
    } else {
      const actualDef = foundConstraints.get(specName)!;
      const expectedDef = spec.expectedDef.trim();
      if (actualDef !== expectedDef) {
        mismatchedConstraints.push({
          name: specName,
          expected: expectedDef,
          actual: actualDef,
        });
      }
    }
  }

  // 1b. Chiều ngược: Mọi CHECK trong DB public phải nằm trong danh mục (hoặc excluded)
  for (const [conname, def] of foundConstraints.entries()) {
    if (!expectedConstraintNames.has(conname) && !EXCLUDED_CHECK_CONSTRAINTS.has(conname)) {
      unexpectedConstraints.push({ name: conname, def });
    }
  }

  if (missingConstraints.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Thiếu ${missingConstraints.length} CHECK constraint(s) trong DB:`, missingConstraints);
    hasError = true;
  }

  if (mismatchedConstraints.length > 0) {
    console.error(
      `❌ [GATE 6 THẤT BẠI] Phát hiện ${mismatchedConstraints.length} CHECK constraint bị sai biểu thức:\n` +
        mismatchedConstraints
          .map((m) => `  - [${m.name}]\n    Expected: ${m.expected}\n    Actual:   ${m.actual}`)
          .join('\n')
    );
    hasError = true;
  }

  if (unexpectedConstraints.length > 0) {
    console.error(
      `❌ [GATE 6 THẤT BẠI] Phát hiện ${unexpectedConstraints.length} CHECK constraint lạ (rác/drift) không có trong pure-sql-inventory.ts:\n` +
        unexpectedConstraints.map((u) => `  - [${u.name}] ${u.def}`).join('\n')
    );
    hasError = true;
  }

  if (!hasError) {
    console.log(`✅ [GATE 6] 10/10 CHECK constraints đã hiện diện, khớp 100% biểu thức và không có constraint rác.`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Kiểm tra Partial Unique Indexes (Hai chiều)
  // ────────────────────────────────────────────────────────────────────────────
  const indexes = await prisma.$queryRaw<IndexDefRow[]>`
    SELECT indexname::text, indexdef::text AS def
    FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND indexdef LIKE '%WHERE%';
  `;

  const foundIndexes = new Map(indexes.map((i) => [i.indexname.trim(), i.def.trim()]));
  const expectedIndexNames = new Set(REQUIRED_PARTIAL_INDEXES.map((i) => i.name.trim()));

  const missingIndexes: string[] = [];
  const mismatchedIndexes: { name: string; expected: string; actual: string }[] = [];
  const unexpectedIndexes: { name: string; def: string }[] = [];

  // 2a. Chiều xuôi: Mọi partial index yêu cầu phải tồn tại và khớp biểu thức
  for (const spec of REQUIRED_PARTIAL_INDEXES) {
    const specName = spec.name.trim();
    if (!foundIndexes.has(specName)) {
      missingIndexes.push(specName);
    } else {
      const actualDef = foundIndexes.get(specName)!;
      const expectedDef = spec.expectedDef.trim();
      if (actualDef !== expectedDef) {
        mismatchedIndexes.push({
          name: specName,
          expected: expectedDef,
          actual: actualDef,
        });
      }
    }
  }

  // 2b. Chiều ngược: Mọi partial index trong DB public phải nằm trong danh mục (hoặc excluded)
  for (const [indexname, def] of foundIndexes.entries()) {
    if (!expectedIndexNames.has(indexname) && !EXCLUDED_PARTIAL_INDEXES.has(indexname)) {
      unexpectedIndexes.push({ name: indexname, def });
    }
  }

  if (missingIndexes.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Thiếu ${missingIndexes.length} partial index(es) trong DB:`, missingIndexes);
    hasError = true;
  }

  if (mismatchedIndexes.length > 0) {
    console.error(
      `❌ [GATE 6 THẤT BẠI] Phát hiện ${mismatchedIndexes.length} partial index bị sai biểu thức:\n` +
        mismatchedIndexes
          .map((m) => `  - [${m.name}]\n    Expected: ${m.expected}\n    Actual:   ${m.actual}`)
          .join('\n')
    );
    hasError = true;
  }

  if (unexpectedIndexes.length > 0) {
    console.error(
      `❌ [GATE 6 THẤT BẠI] Phát hiện ${unexpectedIndexes.length} partial index lạ (rác/drift) không có trong pure-sql-inventory.ts:\n` +
        unexpectedIndexes.map((u) => `  - [${u.name}] ${u.def}`).join('\n')
    );
    hasError = true;
  }

  if (hasError) {
    process.exit(1);
  }

  console.log(`✅ [GATE 6] 5/5 Partial Unique Indexes đã hiện diện, khớp 100% biểu thức và không có index rác.`);
  console.log('🎉 [GATE 6 HOÀN TẤT] Toàn bộ 15/15 object thuần-SQL đều toàn vẹn theo đẳng thức hai chiều.');
}

main()
  .catch((err) => {
    console.error('❌ [GATE 6 LỖI HỆ THỐNG]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
