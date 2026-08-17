/**
 * pure-sql-inventory.ts — Single Source of Truth for Pure-SQL Objects
 *
 * Danh mục 15 object thuần-SQL (10 CHECK Constraints + 5 Partial Unique Indexes)
 * không thể quản lý tự động qua Prisma schema file và cần kiểm thử bảo vệ ở Cổng 6.
 *
 * LƯU Ý VỀ PHIÊN BẢN POSTGRESQL (Việc 6 / #71):
 * Toàn bộ biểu thức mong đợi trong file này được sinh chuẩn hóa bởi PostgreSQL 16:
 * - pg_get_constraintdef(oid)
 * - pg_indexes.indexdef
 *
 * Khi nâng cấp phiên bản PostgreSQL (ví dụ PostgreSQL 17+), cú pháp hiển thị biểu thức có thể
 * thay đổi nhẹ (dấu ngoặc, vị trí type cast). Để tái sinh danh sách này:
 *   1. Chạy trên DB sạch sau khi migrate deploy:
 *      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 *       WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname;
 *      SELECT indexname, indexdef FROM pg_indexes
 *       WHERE schemaname = 'public' AND indexdef LIKE '%WHERE%' ORDER BY indexname;
 *   2. Cập nhật các trường expectedDef tương ứng trong file này.
 */

export interface PureSqlConstraintSpec {
  name: string;
  table: string;
  expectedDef: string;
}

export interface PureSqlIndexSpec {
  name: string;
  table: string;
  expectedDef: string;
}

export const REQUIRED_CHECK_CONSTRAINTS: PureSqlConstraintSpec[] = [
  {
    name: 'agent_tasks_status_check',
    table: 'agent_tasks',
    expectedDef: "CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'dead'::text])))",
  },
  {
    name: 'chk_dept_depth_max',
    table: 'departments',
    expectedDef: 'CHECK (((depth >= 0) AND (depth <= 4)))',
  },
  {
    name: 'chk_dept_no_self_parent',
    table: 'departments',
    expectedDef: 'CHECK ((id <> parent_id))',
  },
  {
    name: 'chk_dept_role',
    table: 'department_members',
    expectedDef: "CHECK ((dept_role = ANY (ARRAY['leader'::text, 'deputy'::text, 'member'::text])))",
  },
  {
    name: 'chk_zalo_privacy_mode',
    table: 'zalo_accounts',
    expectedDef: "CHECK ((privacy_mode = ANY (ARRAY['main'::text, 'sub'::text])))",
  },
  {
    name: 'contacts_no_self_merge_check',
    table: 'contacts',
    expectedDef: 'CHECK ((merged_into IS DISTINCT FROM id))',
  },
  {
    name: 'fact_suggestions_source_not_bank_card_check',
    table: 'fact_suggestions',
    expectedDef: "CHECK ((source <> 'zalo.bank-card'::text))",
  },
  {
    name: 'fact_suggestions_status_check',
    table: 'fact_suggestions',
    expectedDef: "CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])))",
  },
  {
    name: 'facts_source_not_bank_card_check',
    table: 'facts',
    expectedDef: "CHECK ((source <> 'zalo.bank-card'::text))",
  },
  {
    name: 'facts_strength_check',
    table: 'facts',
    expectedDef: "CHECK ((strength = ANY (ARRAY['strong'::text, 'medium'::text, 'weak'::text])))",
  },
];

export const REQUIRED_PARTIAL_INDEXES: PureSqlIndexSpec[] = [
  {
    name: 'agent_tasks_active_dedup_key',
    table: 'agent_tasks',
    expectedDef: "CREATE UNIQUE INDEX agent_tasks_active_dedup_key ON public.agent_tasks USING btree (org_id, kind, subject_type, subject_id) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))",
  },
  {
    name: 'fact_suggestions_created_by_task_id_uniq',
    table: 'fact_suggestions',
    expectedDef: 'CREATE UNIQUE INDEX fact_suggestions_created_by_task_id_uniq ON public.fact_suggestions USING btree (created_by_task_id) WHERE (created_by_task_id IS NOT NULL)',
  },
  {
    name: 'facts_created_by_task_id_uniq',
    table: 'facts',
    expectedDef: 'CREATE UNIQUE INDEX facts_created_by_task_id_uniq ON public.facts USING btree (created_by_task_id) WHERE (created_by_task_id IS NOT NULL)',
  },
  {
    name: 'uniq_one_deputy_per_dept',
    table: 'department_members',
    expectedDef: "CREATE UNIQUE INDEX uniq_one_deputy_per_dept ON public.department_members USING btree (department_id) WHERE (dept_role = 'deputy'::text)",
  },
  {
    name: 'uniq_one_leader_per_dept',
    table: 'department_members',
    expectedDef: "CREATE UNIQUE INDEX uniq_one_leader_per_dept ON public.department_members USING btree (department_id) WHERE (dept_role = 'leader'::text)",
  },
];

/**
 * Danh sách loại trừ tường minh cho các partial index thuộc migration cũ hoặc hệ thống (Việc 4 / #69)
 */
export const EXCLUDED_PARTIAL_INDEXES: Set<string> = new Set([
  'user_privacy_sessions_active_idx',
  'zalo_account_status_log_one_open_per_account_idx',
]);

/**
 * Danh sách loại trừ tường minh cho các CHECK constraint do hệ thống tự sinh nếu có
 */
export const EXCLUDED_CHECK_CONSTRAINTS: Set<string> = new Set([]);
