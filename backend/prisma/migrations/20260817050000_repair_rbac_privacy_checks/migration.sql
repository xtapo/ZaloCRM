-- Phase 8b/8c: Repair RBAC and Privacy CHECK constraints
-- Self-healing for:
-- 1. chk_zalo_privacy_mode on zalo_accounts
-- 2. chk_dept_role on department_members
-- 3. chk_dept_depth_max on departments
-- 4. chk_dept_no_self_parent on departments

-- 1. zalo_accounts: privacy_mode IN ('main', 'sub')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_zalo_privacy_mode') THEN
    ALTER TABLE "zalo_accounts" ADD CONSTRAINT "chk_zalo_privacy_mode"
      CHECK ("privacy_mode" IN ('main', 'sub'));
  END IF;
END $$;

-- 2. department_members: dept_role IN ('leader', 'deputy', 'member')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dept_role') THEN
    ALTER TABLE "department_members" ADD CONSTRAINT "chk_dept_role"
      CHECK ("dept_role" IN ('leader', 'deputy', 'member'));
  END IF;
END $$;

-- 3. departments: depth >= 0 AND depth <= 4
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dept_depth_max') THEN
    ALTER TABLE "departments" ADD CONSTRAINT "chk_dept_depth_max"
      CHECK (("depth" >= 0) AND ("depth" <= 4));
  END IF;
END $$;

-- 4. departments: id <> parent_id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dept_no_self_parent') THEN
    ALTER TABLE "departments" ADD CONSTRAINT "chk_dept_no_self_parent"
      CHECK ("id" <> "parent_id");
  END IF;
END $$;
