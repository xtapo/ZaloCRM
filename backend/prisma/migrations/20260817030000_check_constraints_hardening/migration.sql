-- Phase 8b hardening: Idempotent CHECK constraints + fact_suggestions bank-card prevention + contacts no-self-merge

-- 1. facts.strength IN ('strong', 'medium', 'weak')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facts_strength_check') THEN
    ALTER TABLE "facts" ADD CONSTRAINT "facts_strength_check"
      CHECK ("strength" IN ('strong', 'medium', 'weak'));
  END IF;
END $$;

-- 2. facts.source <> 'zalo.bank-card' (cưỡng chế quyết định 0.3)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facts_source_not_bank_card_check') THEN
    ALTER TABLE "facts" ADD CONSTRAINT "facts_source_not_bank_card_check"
      CHECK ("source" <> 'zalo.bank-card');
  END IF;
END $$;

-- 3. fact_suggestions.status IN ('pending', 'accepted', 'rejected')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fact_suggestions_status_check') THEN
    ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_status_check"
      CHECK ("status" IN ('pending', 'accepted', 'rejected'));
  END IF;
END $$;

-- 4. agent_tasks.status IN ('pending', 'running', 'completed', 'dead')
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_status_check') THEN
    ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_status_check"
      CHECK ("status" IN ('pending', 'running', 'completed', 'dead'));
  END IF;
END $$;

-- 5. fact_suggestions.source <> 'zalo.bank-card' (cưỡng chế quyết định 0.3 cho suggestions)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fact_suggestions_source_not_bank_card_check') THEN
    ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_source_not_bank_card_check"
      CHECK ("source" <> 'zalo.bank-card');
  END IF;
END $$;

-- 6. contacts.merged_into IS DISTINCT FROM id (chống tự merge chính mình)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_no_self_merge_check') THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_no_self_merge_check"
      CHECK ("merged_into" IS DISTINCT FROM "id");
  END IF;
END $$;
