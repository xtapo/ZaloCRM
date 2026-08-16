-- CreateTable
CREATE TABLE "facts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "written_to_record" BOOLEAN NOT NULL DEFAULT false,
    "superseded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_evidence" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "fact_id" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "message_id" TEXT,
    "conversation_id" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_suggestions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "proposed_value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "model" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "tool_name" TEXT,
    "input_redacted" JSONB,
    "output_redacted" JSONB,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facts_org_id_contact_id_field_idx" ON "facts"("org_id", "contact_id", "field");

-- CreateIndex
CREATE INDEX "facts_superseded_by_id_idx" ON "facts"("superseded_by_id");

-- CreateIndex
CREATE INDEX "fact_evidence_org_id_fact_id_idx" ON "fact_evidence"("org_id", "fact_id");

-- CreateIndex
CREATE INDEX "fact_suggestions_org_id_contact_id_status_idx" ON "fact_suggestions"("org_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "agent_sessions_org_id_status_started_at_idx" ON "agent_sessions"("org_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "agent_steps_org_id_session_id_step_index_idx" ON "agent_steps"("org_id", "session_id", "step_index");

-- CreateIndex
CREATE UNIQUE INDEX "agent_steps_session_id_step_index_key" ON "agent_steps"("session_id", "step_index");

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_evidence" ADD CONSTRAINT "fact_evidence_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_evidence" ADD CONSTRAINT "fact_evidence_fact_id_fkey" FOREIGN KEY ("fact_id") REFERENCES "facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_evidence" ADD CONSTRAINT "fact_evidence_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_suggestions" ADD CONSTRAINT "fact_suggestions_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
