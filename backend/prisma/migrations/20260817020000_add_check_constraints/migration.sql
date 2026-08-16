-- Phase 8b: CHECK constraints for facts, fact_suggestions, and agent_tasks

-- 1. facts.strength IN ('strong', 'medium', 'weak')
ALTER TABLE "facts" ADD CONSTRAINT "facts_strength_check"
  CHECK ("strength" IN ('strong', 'medium', 'weak'));

-- 2. facts.source <> 'zalo.bank-card' (cưỡng chế quyết định 0.3)
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_not_bank_card_check"
  CHECK ("source" <> 'zalo.bank-card');

-- 3. fact_suggestions.status IN ('pending', 'accepted', 'rejected')
ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'rejected'));

-- 4. agent_tasks.status IN ('pending', 'running', 'completed', 'dead')
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_status_check"
  CHECK ("status" IN ('pending', 'running', 'completed', 'dead'));
