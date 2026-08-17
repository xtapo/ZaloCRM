-- Phase 8b/8c: Repair and complete pure-SQL objects inventory
-- Contains:
-- 1. created_by_task_id columns & partial unique indexes for facts & fact_suggestions
-- 2. claim_count column & backfill for agent_tasks
-- 3. Self-healing partial unique indexes for RBAC & agent_tasks
-- 4. Self-healing CHECK constraints for facts, fact_suggestions, agent_tasks, contacts

-- ── 1. Cột created_by_task_id và Partial Unique Indexes ─────────────────────
ALTER TABLE "facts" ADD COLUMN IF NOT EXISTS "created_by_task_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "facts_created_by_task_id_uniq"
  ON "facts" ("created_by_task_id")
  WHERE ("created_by_task_id" IS NOT NULL);

ALTER TABLE "fact_suggestions" ADD COLUMN IF NOT EXISTS "created_by_task_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "fact_suggestions_created_by_task_id_uniq"
  ON "fact_suggestions" ("created_by_task_id")
  WHERE ("created_by_task_id" IS NOT NULL);

-- ── 2. Cột claim_count và Backfill (Quyết định 0.10) ─────────────────────────
ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "claim_count" INTEGER NOT NULL DEFAULT 0;
UPDATE "agent_tasks" SET "claim_count" = "attempts" WHERE "claim_count" = 0 AND "attempts" > 0;

-- ── 3. Tự chữa các Partial Unique Indexes thuần-SQL ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_one_leader_per_dept"
  ON "department_members" ("department_id")
  WHERE ("dept_role" = 'leader');

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_one_deputy_per_dept"
  ON "department_members" ("department_id")
  WHERE ("dept_role" = 'deputy');

CREATE UNIQUE INDEX IF NOT EXISTS "agent_tasks_active_dedup_key"
  ON "agent_tasks" ("org_id", "kind", "subject_type", "subject_id")
  WHERE ("status" IN ('pending', 'running'));

-- ── 4. Tự chữa 6 CHECK Constraints thuần-SQL ────────────────────────────────
-- 4.1 facts.strength IN ('strong', 'medium', 'weak')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facts_strength_check') THEN
    ALTER TABLE "facts" ADD CONSTRAINT "facts_strength_check"
      CHECK ("strength" IN ('strong', 'medium', 'weak'));
  END IF;
END $$;

-- 4.2 facts.source <> 'zalo.bank-card'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facts_source_not_bank_card_check') THEN
    ALTER TABLE "facts" ADD CONSTRAINT "facts_source_not_bank_card_check"
      CHECK ("source" <> 'zalo.bank-card');
  END IF;
END $$;

-- 4.3 fact_suggestions.status IN ('pending', 'accepted', 'rejected')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fact_suggestions_status_check') THEN
    ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_status_check"
      CHECK ("status" IN ('pending', 'accepted', 'rejected'));
  END IF;
END $$;

-- 4.4 fact_suggestions.source <> 'zalo.bank-card'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fact_suggestions_source_not_bank_card_check') THEN
    ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_source_not_bank_card_check"
      CHECK ("source" <> 'zalo.bank-card');
  END IF;
END $$;

-- 4.5 agent_tasks.status IN ('pending', 'running', 'completed', 'dead')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_status_check') THEN
    ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_status_check"
      CHECK ("status" IN ('pending', 'running', 'completed', 'dead'));
  END IF;
END $$;

-- 4.6 contacts.merged_into IS DISTINCT FROM id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_no_self_merge_check') THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_no_self_merge_check"
      CHECK ("merged_into" IS DISTINCT FROM "id");
  END IF;
END $$;
