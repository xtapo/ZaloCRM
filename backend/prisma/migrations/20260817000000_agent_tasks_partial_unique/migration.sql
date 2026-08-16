-- Drop full unique index
DROP INDEX IF EXISTS "agent_tasks_org_id_kind_subject_type_subject_id_status_key";

-- Create partial unique index only for active tasks (pending or running)
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tasks_active_dedup_key"
  ON "agent_tasks" ("org_id", "kind", "subject_type", "subject_id")
  WHERE "status" IN ('pending', 'running');
