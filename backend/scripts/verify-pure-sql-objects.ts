/**
 * verify-pure-sql-objects.ts — CI Gate 6: Kiểm tra toàn vẹn các object thuần-SQL
 *
 * Kiểm tra 6 CHECK constraints và 5 Partial Unique Indexes không thể tự sinh qua Prisma schema.
 */

import { prisma } from '../src/shared/database/prisma-client.js';

interface ConstraintRow {
  conname: string;
  contype: string;
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

const REQUIRED_CHECK_CONSTRAINTS = [
  'facts_strength_check',
  'facts_source_not_bank_card_check',
  'fact_suggestions_status_check',
  'fact_suggestions_source_not_bank_card_check',
  'agent_tasks_status_check',
  'contacts_no_self_merge_check',
];

const REQUIRED_PARTIAL_INDEXES = [
  'uniq_one_leader_per_dept',
  'uniq_one_deputy_per_dept',
  'agent_tasks_active_dedup_key',
  'facts_created_by_task_id_uniq',
  'fact_suggestions_created_by_task_id_uniq',
];

async function main() {
  console.log('🔍 [GATE 6] Đang kiểm tra các object thuần-SQL trên database...');

  // 1. Kiểm tra 6 CHECK constraints
  const constraints = await prisma.$queryRaw<ConstraintRow[]>`
    SELECT conname::text, contype::text 
    FROM pg_constraint 
    WHERE contype::text = 'c' 
      AND conname = ANY(${REQUIRED_CHECK_CONSTRAINTS});
  `;

  const foundConstraints = new Set(constraints.map((c) => c.conname));
  const missingConstraints = REQUIRED_CHECK_CONSTRAINTS.filter((c) => !foundConstraints.has(c));

  if (missingConstraints.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Thiếu ${missingConstraints.length} CHECK constraint(s):`, missingConstraints);
    process.exit(1);
  }
  console.log(`✅ [GATE 6] 6/6 CHECK constraints đã hiện diện:`, [...foundConstraints]);

  // 2. Kiểm tra 5 Partial Unique Indexes
  const indexes = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE indexname = ANY(${REQUIRED_PARTIAL_INDEXES});
  `;

  const foundIndexes = new Map(indexes.map((i) => [i.indexname, i.indexdef]));
  const missingIndexes = REQUIRED_PARTIAL_INDEXES.filter((i) => !foundIndexes.has(i));

  if (missingIndexes.length > 0) {
    console.error(`❌ [GATE 6 THẤT BẠI] Thiếu ${missingIndexes.length} partial index(es):`, missingIndexes);
    process.exit(1);
  }

  // Kiểm tra mỗi index đều có mệnh đề WHERE
  for (const idxName of REQUIRED_PARTIAL_INDEXES) {
    const def = foundIndexes.get(idxName) || '';
    if (!def.toUpperCase().includes('WHERE')) {
      console.error(`❌ [GATE 6 THẤT BẠI] Index ${idxName} tồn tại nhưng không có mệnh đề WHERE:`, def);
      process.exit(1);
    }
  }

  console.log(`✅ [GATE 6] 5/5 Partial Unique Indexes đã hiện diện và hợp lệ:`, REQUIRED_PARTIAL_INDEXES);
  console.log('🎉 [GATE 6 HOÀN TẤT] Toàn bộ 11 object thuần-SQL đều toàn vẹn.');
}

main()
  .catch((err) => {
    console.error('❌ [GATE 6 LỖI HỆ THỐNG]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
