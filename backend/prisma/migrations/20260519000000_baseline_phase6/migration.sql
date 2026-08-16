-- CreateTable
CREATE TABLE "statuses" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_search_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT,
    "phone_hash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "found_uid" TEXT,
    "error_code" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_search_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "parent_note_id" TEXT,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "suggested_appointment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tags" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#90A4AE',
    "emoji" TEXT,
    "description" TEXT,
    "category" TEXT,
    "group_id" TEXT,
    "managed_by" TEXT,
    "source_zalo_label_id" INTEGER,
    "archived_at" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tag_groups" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managed_by" TEXT,
    "zalo_account_id" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_tag_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT 'null',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zalo_labels" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "zalo_label_id" INTEGER NOT NULL,
    "text_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "emoji" TEXT,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "conversations" JSONB NOT NULL DEFAULT '[]',
    "create_time" BIGINT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zalo_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_reactions" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_candidates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_ids" TEXT[],
    "match_type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    "max_daily" INTEGER NOT NULL DEFAULT 500,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "reactor_id" TEXT NOT NULL,
    "reactor_source" TEXT NOT NULL DEFAULT 'crm',
    "reactor_name" TEXT,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pinned_conversations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "pinned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_polls" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "group_external_id" TEXT NOT NULL,
    "zalo_poll_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "is_multi_choice" BOOLEAN NOT NULL DEFAULT false,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendship_attempts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "zalo_uid_found" TEXT,
    "request_msg" TEXT,
    "error_code" TEXT,
    "error_detail" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "looked_up_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "friendship_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friends" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "zalo_uid_in_nick" TEXT NOT NULL,
    "friendship_status" TEXT NOT NULL DEFAULT 'none',
    "has_conversation" BOOLEAN NOT NULL DEFAULT false,
    "relationship_kind" TEXT NOT NULL DEFAULT 'none',
    "alias_in_nick" TEXT,
    "zalo_display_name" TEXT,
    "zalo_avatar_url" TEXT,
    "zalo_global_id" TEXT,
    "zalo_username" TEXT,
    "zalo_labels" JSONB NOT NULL DEFAULT '[]',
    "zalo_labels_synced_at" TIMESTAMP(3),
    "crm_tags_per_nick" JSONB NOT NULL DEFAULT '[]',
    "became_friend_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "first_message_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "last_interaction_at" TIMESTAMP(3),
    "total_inbound" INTEGER NOT NULL DEFAULT 0,
    "total_outbound" INTEGER NOT NULL DEFAULT 0,
    "status_id" TEXT,
    "lead_score" INTEGER NOT NULL DEFAULT 0,
    "score_breakdown" JSONB NOT NULL DEFAULT '{}',
    "score_updated_at" TIMESTAMP(3),
    "stuck_since" TIMESTAMP(3),
    "auto_tags" JSONB NOT NULL DEFAULT '[]',
    "stage_entered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "weight_engagement" INTEGER NOT NULL DEFAULT 35,
    "weight_intent" INTEGER NOT NULL DEFAULT 30,
    "weight_fit" INTEGER NOT NULL DEFAULT 15,
    "weight_velocity" INTEGER NOT NULL DEFAULT 20,
    "decay_day_3_7" INTEGER NOT NULL DEFAULT -1,
    "decay_day_7_14" INTEGER NOT NULL DEFAULT -3,
    "decay_day_14_30" INTEGER NOT NULL DEFAULT -5,
    "decay_day_30_60" INTEGER NOT NULL DEFAULT -8,
    "auto_promote" BOOLEAN NOT NULL DEFAULT true,
    "stuck_detection_enabled" BOOLEAN NOT NULL DEFAULT true,
    "explainability_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_signal_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "signal_key" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "cap_per_day" INTEGER,
    "cap_total" INTEGER,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "label" TEXT NOT NULL,
    "applicable_stages" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "score_signal_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_transition_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "from_stage" TEXT NOT NULL,
    "to_stage" TEXT NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "requires_manual_confirm" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stage_transition_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stuck_thresholds" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "threshold_days" INTEGER NOT NULL,
    "extra_decay_per_day" INTEGER NOT NULL DEFAULT 0,
    "nba_template_key" TEXT,
    "alert_label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stuck_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nba_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content_template" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nba_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_folders" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#6366F1',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_folder_members" (
    "id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_folder_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_filter_presets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT DEFAULT '⭐',
    "filter_json" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filter_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_engagement_daily" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "inbound_msg_count" INTEGER NOT NULL DEFAULT 0,
    "outbound_msg_count" INTEGER NOT NULL DEFAULT 0,
    "reaction_count" INTEGER NOT NULL DEFAULT 0,
    "media_share_count" INTEGER NOT NULL DEFAULT 0,
    "voice_msg_count" INTEGER NOT NULL DEFAULT 0,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "missed_call_count" INTEGER NOT NULL DEFAULT 0,
    "quote_reply_count" INTEGER NOT NULL DEFAULT 0,
    "customer_initiated" BOOLEAN NOT NULL DEFAULT false,
    "daily_intensity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_engagement_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_lists" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon_emoji" TEXT,
    "source_type" TEXT NOT NULL,
    "raw_text" TEXT,
    "total_entries" INTEGER NOT NULL DEFAULT 0,
    "valid_entries" INTEGER NOT NULL DEFAULT 0,
    "invalid_entries" INTEGER NOT NULL DEFAULT 0,
    "dup_in_list_entries" INTEGER NOT NULL DEFAULT 0,
    "dup_cross_list_entries" INTEGER NOT NULL DEFAULT 0,
    "dup_with_contact_entries" INTEGER NOT NULL DEFAULT 0,
    "has_zalo_entries" INTEGER NOT NULL DEFAULT 0,
    "no_zalo_entries" INTEGER NOT NULL DEFAULT 0,
    "pending_lookup_entries" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_list_entries" (
    "id" TEXT NOT NULL,
    "customer_list_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "phone_raw" TEXT NOT NULL,
    "name_raw" TEXT,
    "phone_e164" TEXT,
    "phone_local" TEXT,
    "phone_valid" BOOLEAN NOT NULL DEFAULT false,
    "invalid_reason" TEXT,
    "contact_id" TEXT,
    "zalo_uid" TEXT,
    "zalo_global_id" TEXT,
    "zalo_name" TEXT,
    "resolved_by_nick_id" TEXT,
    "multi_nick_count" INTEGER NOT NULL DEFAULT 0,
    "has_zalo" BOOLEAN,
    "dup_in_list_with_entry_id" TEXT,
    "dup_with_list_id" TEXT,
    "dup_with_list_entry_id" TEXT,
    "dup_with_contact_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "enriched_at" TIMESTAMP(3),
    "fb_leadgen_id" TEXT,
    "fb_ad_id" TEXT,
    "fb_ad_name" TEXT,
    "fb_adset_id" TEXT,
    "fb_adset_name" TEXT,
    "fb_campaign_id" TEXT,
    "fb_campaign_name" TEXT,
    "fb_form_id" TEXT,
    "fb_form_name" TEXT,
    "fb_inbox_url" TEXT,
    "fb_platform" TEXT,
    "fb_is_organic" BOOLEAN,
    "fb_custom_answers" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_page_connections" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "page_name" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "subscribed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'connected',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facebook_page_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_form_mappings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "page_connection_id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "form_name" TEXT NOT NULL,
    "customer_list_id" TEXT NOT NULL,
    "field_map" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_form_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_lead_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "leadgen_id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "contact_id" TEXT,
    "list_entry_id" TEXT,
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_list_sale_assignments" (
    "id" TEXT NOT NULL,
    "customer_list_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_list_sale_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_assignment_states" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_list_id" TEXT NOT NULL,
    "last_assigned_user_id" TEXT,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_assignment_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "statuses_org_id_order_idx" ON "statuses"("org_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "statuses_org_id_name_key" ON "statuses"("org_id", "name");

-- CreateIndex
CREATE INDEX "phone_search_events_account_id_occurred_at_idx" ON "phone_search_events"("account_id", "occurred_at");

-- CreateIndex
CREATE INDEX "phone_search_events_org_id_occurred_at_idx" ON "phone_search_events"("org_id", "occurred_at");

-- CreateIndex
CREATE INDEX "phone_search_events_phone_hash_idx" ON "phone_search_events"("phone_hash");

-- CreateIndex
CREATE INDEX "notes_org_id_contact_id_created_at_idx" ON "notes"("org_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "notes_parent_note_id_idx" ON "notes"("parent_note_id");

-- CreateIndex
CREATE INDEX "crm_tags_org_id_category_idx" ON "crm_tags"("org_id", "category");

-- CreateIndex
CREATE INDEX "crm_tags_org_id_group_id_idx" ON "crm_tags"("org_id", "group_id");

-- CreateIndex
CREATE INDEX "crm_tags_managed_by_archived_at_idx" ON "crm_tags"("managed_by", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tags_org_id_name_key" ON "crm_tags"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tags_source_zalo_label_id_key" ON "crm_tags"("source_zalo_label_id");

-- CreateIndex
CREATE INDEX "crm_tag_groups_org_id_archived_at_idx" ON "crm_tag_groups"("org_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tag_groups_org_id_name_key" ON "crm_tag_groups"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tag_groups_zalo_account_id_managed_by_key" ON "crm_tag_groups"("zalo_account_id", "managed_by");

-- CreateIndex
CREATE INDEX "user_preferences_user_id_idx" ON "user_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key_key" ON "user_preferences"("user_id", "key");

-- CreateIndex
CREATE INDEX "zalo_labels_org_id_zalo_account_id_idx" ON "zalo_labels"("org_id", "zalo_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "zalo_labels_zalo_account_id_zalo_label_id_key" ON "zalo_labels"("zalo_account_id", "zalo_label_id");

-- CreateIndex
CREATE INDEX "note_reactions_note_id_idx" ON "note_reactions"("note_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_reactions_note_id_user_id_emoji_key" ON "note_reactions"("note_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "parent_candidates_org_id_dismissed_created_at_idx" ON "parent_candidates"("org_id", "dismissed", "created_at");

-- CreateIndex
CREATE INDEX "automation_rules_org_id_trigger_enabled_priority_idx" ON "automation_rules"("org_id", "trigger", "enabled", "priority");

-- CreateIndex
CREATE INDEX "message_templates_org_id_owner_user_id_idx" ON "message_templates"("org_id", "owner_user_id");

-- CreateIndex
CREATE INDEX "message_templates_org_id_category_idx" ON "message_templates"("org_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ai_configs_org_id_key" ON "ai_configs"("org_id");

-- CreateIndex
CREATE INDEX "ai_suggestions_org_id_created_at_idx" ON "ai_suggestions"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_conversation_id_created_at_idx" ON "ai_suggestions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_org_id_type_created_at_idx" ON "ai_suggestions"("org_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_reactor_id_emoji_key" ON "message_reactions"("message_id", "reactor_id", "emoji");

-- CreateIndex
CREATE UNIQUE INDEX "pinned_conversations_zalo_account_id_conversation_id_key" ON "pinned_conversations"("zalo_account_id", "conversation_id");

-- CreateIndex
CREATE INDEX "group_polls_org_id_group_external_id_idx" ON "group_polls"("org_id", "group_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_polls_zalo_account_id_zalo_poll_id_key" ON "group_polls"("zalo_account_id", "zalo_poll_id");

-- CreateIndex
CREATE INDEX "friendship_attempts_org_id_state_idx" ON "friendship_attempts"("org_id", "state");

-- CreateIndex
CREATE INDEX "friendship_attempts_contact_id_state_idx" ON "friendship_attempts"("contact_id", "state");

-- CreateIndex
CREATE INDEX "friendship_attempts_zalo_account_id_state_queued_at_idx" ON "friendship_attempts"("zalo_account_id", "state", "queued_at");

-- CreateIndex
CREATE UNIQUE INDEX "friendship_attempts_zalo_account_id_contact_id_key" ON "friendship_attempts"("zalo_account_id", "contact_id");

-- CreateIndex
CREATE INDEX "friends_zalo_account_id_contact_id_idx" ON "friends"("zalo_account_id", "contact_id");

-- CreateIndex
CREATE INDEX "friends_org_id_contact_id_idx" ON "friends"("org_id", "contact_id");

-- CreateIndex
CREATE INDEX "friends_zalo_account_id_relationship_kind_idx" ON "friends"("zalo_account_id", "relationship_kind");

-- CreateIndex
CREATE INDEX "friends_zalo_account_id_friendship_status_idx" ON "friends"("zalo_account_id", "friendship_status");

-- CreateIndex
CREATE INDEX "friends_org_id_relationship_kind_idx" ON "friends"("org_id", "relationship_kind");

-- CreateIndex
CREATE INDEX "friends_org_id_status_id_idx" ON "friends"("org_id", "status_id");

-- CreateIndex
CREATE INDEX "friends_org_id_score_updated_at_idx" ON "friends"("org_id", "score_updated_at" DESC);

-- CreateIndex
CREATE INDEX "friends_org_id_stuck_since_idx" ON "friends"("org_id", "stuck_since");

-- CreateIndex
CREATE INDEX "friends_org_id_lead_score_idx" ON "friends"("org_id", "lead_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "friends_zalo_account_id_zalo_uid_in_nick_key" ON "friends"("zalo_account_id", "zalo_uid_in_nick");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_configs_org_id_key" ON "scoring_configs"("org_id");

-- CreateIndex
CREATE INDEX "score_signal_rules_org_id_rule_type_enabled_idx" ON "score_signal_rules"("org_id", "rule_type", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "score_signal_rules_org_id_signal_key_key" ON "score_signal_rules"("org_id", "signal_key");

-- CreateIndex
CREATE INDEX "stage_transition_rules_org_id_from_stage_enabled_idx" ON "stage_transition_rules"("org_id", "from_stage", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "stage_transition_rules_org_id_from_stage_to_stage_key" ON "stage_transition_rules"("org_id", "from_stage", "to_stage");

-- CreateIndex
CREATE INDEX "stuck_thresholds_org_id_stage_enabled_idx" ON "stuck_thresholds"("org_id", "stage", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "stuck_thresholds_org_id_stage_key" ON "stuck_thresholds"("org_id", "stage");

-- CreateIndex
CREATE INDEX "nba_templates_org_id_category_enabled_idx" ON "nba_templates"("org_id", "category", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "nba_templates_org_id_key_key" ON "nba_templates"("org_id", "key");

-- CreateIndex
CREATE INDEX "account_folders_org_id_user_id_sort_order_idx" ON "account_folders"("org_id", "user_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "account_folders_user_id_name_key" ON "account_folders"("user_id", "name");

-- CreateIndex
CREATE INDEX "account_folder_members_zalo_account_id_idx" ON "account_folder_members"("zalo_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_folder_members_folder_id_zalo_account_id_key" ON "account_folder_members"("folder_id", "zalo_account_id");

-- CreateIndex
CREATE INDEX "saved_filter_presets_org_id_user_id_sort_order_idx" ON "saved_filter_presets"("org_id", "user_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "saved_filter_presets_user_id_name_key" ON "saved_filter_presets"("user_id", "name");

-- CreateIndex
CREATE INDEX "contact_engagement_daily_org_id_contact_id_date_idx" ON "contact_engagement_daily"("org_id", "contact_id", "date" DESC);

-- CreateIndex
CREATE INDEX "contact_engagement_daily_org_id_date_idx" ON "contact_engagement_daily"("org_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "contact_engagement_daily_org_id_contact_id_date_key" ON "contact_engagement_daily"("org_id", "contact_id", "date");

-- CreateIndex
CREATE INDEX "customer_lists_org_id_status_created_at_idx" ON "customer_lists"("org_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customer_lists_org_id_archived_at_idx" ON "customer_lists"("org_id", "archived_at");

-- CreateIndex
CREATE INDEX "customer_list_entries_customer_list_id_status_idx" ON "customer_list_entries"("customer_list_id", "status");

-- CreateIndex
CREATE INDEX "customer_list_entries_customer_list_id_fb_campaign_id_idx" ON "customer_list_entries"("customer_list_id", "fb_campaign_id");

-- CreateIndex
CREATE INDEX "customer_list_entries_customer_list_id_fb_form_id_idx" ON "customer_list_entries"("customer_list_id", "fb_form_id");

-- CreateIndex
CREATE INDEX "customer_list_entries_phone_e164_idx" ON "customer_list_entries"("phone_e164");

-- CreateIndex
CREATE INDEX "customer_list_entries_phone_local_idx" ON "customer_list_entries"("phone_local");

-- CreateIndex
CREATE UNIQUE INDEX "customer_list_entries_customer_list_id_row_index_key" ON "customer_list_entries"("customer_list_id", "row_index");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_page_connections_org_id_page_id_key" ON "facebook_page_connections"("org_id", "page_id");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_form_mappings_org_id_form_id_key" ON "facebook_form_mappings"("org_id", "form_id");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_lead_events_leadgen_id_key" ON "facebook_lead_events"("leadgen_id");

-- CreateIndex
CREATE INDEX "facebook_lead_events_org_id_form_id_idx" ON "facebook_lead_events"("org_id", "form_id");

-- CreateIndex
CREATE INDEX "facebook_lead_events_created_at_idx" ON "facebook_lead_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_list_sale_assignments_customer_list_id_user_id_key" ON "customer_list_sale_assignments"("customer_list_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_assignment_states_customer_list_id_key" ON "sale_assignment_states"("customer_list_id");

-- AddForeignKey
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_search_events" ADD CONSTRAINT "phone_search_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_search_events" ADD CONSTRAINT "phone_search_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_search_events" ADD CONSTRAINT "phone_search_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_note_id_fkey" FOREIGN KEY ("parent_note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_suggested_appointment_id_fkey" FOREIGN KEY ("suggested_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "crm_tag_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tag_groups" ADD CONSTRAINT "crm_tag_groups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tag_groups" ADD CONSTRAINT "crm_tag_groups_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zalo_labels" ADD CONSTRAINT "zalo_labels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zalo_labels" ADD CONSTRAINT "zalo_labels_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_candidates" ADD CONSTRAINT "parent_candidates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_conversations" ADD CONSTRAINT "pinned_conversations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_conversations" ADD CONSTRAINT "pinned_conversations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_polls" ADD CONSTRAINT "group_polls_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendship_attempts" ADD CONSTRAINT "friendship_attempts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendship_attempts" ADD CONSTRAINT "friendship_attempts_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendship_attempts" ADD CONSTRAINT "friendship_attempts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_configs" ADD CONSTRAINT "scoring_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_signal_rules" ADD CONSTRAINT "score_signal_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_transition_rules" ADD CONSTRAINT "stage_transition_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stuck_thresholds" ADD CONSTRAINT "stuck_thresholds_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nba_templates" ADD CONSTRAINT "nba_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_folders" ADD CONSTRAINT "account_folders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_folders" ADD CONSTRAINT "account_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_folder_members" ADD CONSTRAINT "account_folder_members_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "account_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_folder_members" ADD CONSTRAINT "account_folder_members_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filter_presets" ADD CONSTRAINT "saved_filter_presets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filter_presets" ADD CONSTRAINT "saved_filter_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_engagement_daily" ADD CONSTRAINT "contact_engagement_daily_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_list_entries" ADD CONSTRAINT "customer_list_entries_customer_list_id_fkey" FOREIGN KEY ("customer_list_id") REFERENCES "customer_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_page_connections" ADD CONSTRAINT "facebook_page_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_form_mappings" ADD CONSTRAINT "facebook_form_mappings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_form_mappings" ADD CONSTRAINT "facebook_form_mappings_page_connection_id_fkey" FOREIGN KEY ("page_connection_id") REFERENCES "facebook_page_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_form_mappings" ADD CONSTRAINT "facebook_form_mappings_customer_list_id_fkey" FOREIGN KEY ("customer_list_id") REFERENCES "customer_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_list_sale_assignments" ADD CONSTRAINT "customer_list_sale_assignments_customer_list_id_fkey" FOREIGN KEY ("customer_list_id") REFERENCES "customer_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_list_sale_assignments" ADD CONSTRAINT "customer_list_sale_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_assignment_states" ADD CONSTRAINT "sale_assignment_states_customer_list_id_fkey" FOREIGN KEY ("customer_list_id") REFERENCES "customer_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contacts Phase 6 columns
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "zalo_global_id" TEXT,
  ADD COLUMN IF NOT EXISTS "zalo_username" TEXT,
  ADD COLUMN IF NOT EXISTS "phone_normalized" TEXT,
  ADD COLUMN IF NOT EXISTS "crm_name" TEXT,
  ADD COLUMN IF NOT EXISTS "status_id" TEXT,
  ADD COLUMN IF NOT EXISTS "parent_contact_id" TEXT,
  ADD COLUMN IF NOT EXISTS "has_zalo" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "zalo_lookup_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "zalo_lookup_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "import_batch_id" TEXT,
  ADD COLUMN IF NOT EXISTS "consent_status" TEXT NOT NULL DEFAULT 'implicit',
  ADD COLUMN IF NOT EXISTS "consent_revoked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "consent_source" TEXT,
  ADD COLUMN IF NOT EXISTS "phone_2" TEXT,
  ADD COLUMN IF NOT EXISTS "phone_3" TEXT,
  ADD COLUMN IF NOT EXISTS "phones_extra" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "province" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "ward" TEXT,
  ADD COLUMN IF NOT EXISTS "address_line" TEXT,
  ADD COLUMN IF NOT EXISTS "gender" TEXT,
  ADD COLUMN IF NOT EXISTS "birth_year" INTEGER,
  ADD COLUMN IF NOT EXISTS "birth_date" DATE,
  ADD COLUMN IF NOT EXISTS "occupation" TEXT,
  ADD COLUMN IF NOT EXISTS "income_range" TEXT,
  ADD COLUMN IF NOT EXISTS "social_facebook" TEXT,
  ADD COLUMN IF NOT EXISTS "social_tiktok" TEXT,
  ADD COLUMN IF NOT EXISTS "preferred_lang" TEXT DEFAULT 'vi',
  ADD COLUMN IF NOT EXISTS "last_inbound_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_inbound_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_inbound_preview" TEXT,
  ADD COLUMN IF NOT EXISTS "last_inbound_type" TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_outbound_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_preview" TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_type" TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_outbound_by_zalo_account_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_interaction_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_interaction_type" TEXT,
  ADD COLUMN IF NOT EXISTS "last_interaction_payload" JSONB,
  ADD COLUMN IF NOT EXISTS "total_inbound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_outbound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_appointments" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "accepted_nicks_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pending_nicks_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "chatting_nicks_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "aggregate_score_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "owner_friend_id" TEXT,
  ADD COLUMN IF NOT EXISTS "aggregate_breakdown" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "auto_tags" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "stuck_since_aggregate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "engagement_pattern" TEXT,
  ADD COLUMN IF NOT EXISTS "engagement_trend" INTEGER,
  ADD COLUMN IF NOT EXISTS "engagement_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "engagement_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "priority_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "priority_updated_at" TIMESTAMP(3);

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "system_notify_zalo_account_id" TEXT;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "tab" TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS "group_name" TEXT,
  ADD COLUMN IF NOT EXISTS "group_avatar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "group_members_count" INTEGER;

ALTER TABLE "activity_logs"
  ADD COLUMN IF NOT EXISTS "actor_type" TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "bot_name" TEXT,
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "system_source" TEXT;

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "emoji" TEXT,
  ADD COLUMN IF NOT EXISTS "external_ref" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "status_changed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status_changed_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "zalo_message_id" TEXT;

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "album_key" TEXT,
  ADD COLUMN IF NOT EXISTS "album_index" INTEGER,
  ADD COLUMN IF NOT EXISTS "album_total" INTEGER,
  ADD COLUMN IF NOT EXISTS "quote" JSONB,
  ADD COLUMN IF NOT EXISTS "sent_via" TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "zalo_msg_id_num" BIGINT;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "internal_contact_zalo_account_id" TEXT,
  ADD COLUMN IF NOT EXISTS "max_privacy_nicks" INTEGER NOT NULL DEFAULT 2;

-- Contacts indexes
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_org_id_zalo_global_id_key" ON "contacts"("org_id", "zalo_global_id");
CREATE INDEX IF NOT EXISTS "contacts_org_id_phone_normalized_idx" ON "contacts"("org_id", "phone_normalized");
CREATE INDEX IF NOT EXISTS "contacts_org_id_last_activity_idx" ON "contacts"("org_id", "last_activity");
CREATE INDEX IF NOT EXISTS "contacts_org_id_priority_score_idx" ON "contacts"("org_id", "priority_score" DESC);
CREATE INDEX IF NOT EXISTS "contacts_org_id_zalo_username_idx" ON "contacts"("org_id", "zalo_username");
CREATE INDEX IF NOT EXISTS "contacts_org_id_has_zalo_idx" ON "contacts"("org_id", "has_zalo");
CREATE INDEX IF NOT EXISTS "contacts_org_id_consent_status_idx" ON "contacts"("org_id", "consent_status");
CREATE INDEX IF NOT EXISTS "contacts_org_id_import_batch_id_idx" ON "contacts"("org_id", "import_batch_id");
CREATE INDEX IF NOT EXISTS "contacts_org_id_province_district_idx" ON "contacts"("org_id", "province", "district");
CREATE INDEX IF NOT EXISTS "contacts_org_id_last_inbound_at_idx" ON "contacts"("org_id", "last_inbound_at");
CREATE INDEX IF NOT EXISTS "contacts_org_id_last_outbound_at_idx" ON "contacts"("org_id", "last_outbound_at");
CREATE INDEX IF NOT EXISTS "contacts_org_id_status_last_inbound_at_idx" ON "contacts"("org_id", "status", "last_inbound_at");
CREATE INDEX IF NOT EXISTS "contacts_phone_2_idx" ON "contacts"("phone_2");
CREATE INDEX IF NOT EXISTS "contacts_phone_3_idx" ON "contacts"("phone_3");
CREATE INDEX IF NOT EXISTS "contacts_org_id_accepted_nicks_count_idx" ON "contacts"("org_id", "accepted_nicks_count");
CREATE INDEX IF NOT EXISTS "contacts_org_id_parent_contact_id_idx" ON "contacts"("org_id", "parent_contact_id");
CREATE INDEX IF NOT EXISTS "contacts_org_id_status_id_idx" ON "contacts"("org_id", "status_id");
CREATE INDEX IF NOT EXISTS "contacts_org_id_lead_score_idx" ON "contacts"("org_id", "lead_score" DESC);
CREATE INDEX IF NOT EXISTS "contacts_org_id_stuck_since_aggregate_idx" ON "contacts"("org_id", "stuck_since_aggregate");
CREATE INDEX IF NOT EXISTS "contacts_org_id_aggregate_score_updated_at_idx" ON "contacts"("org_id", "aggregate_score_updated_at" DESC);

-- Conversation indexes
CREATE INDEX IF NOT EXISTS "conversations_org_id_zalo_account_id_is_replied_last_message_at_idx" ON "conversations"("org_id", "zalo_account_id", "is_replied", "last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_org_id_zalo_account_id_last_message_at_idx" ON "conversations"("org_id", "zalo_account_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_org_id_tab_last_message_at_idx" ON "conversations"("org_id", "tab", "last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_org_id_threadType_zalo_account_id_last_message_at_idx" ON "conversations"("org_id", "threadType", "zalo_account_id", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS "conversations_org_id_tab_zalo_account_id_last_message_at_idx" ON "conversations"("org_id", "tab", "zalo_account_id", "last_message_at" DESC);

-- Message indexes
CREATE UNIQUE INDEX IF NOT EXISTS "messages_conversation_id_zalo_msg_id_key" ON "messages"("conversation_id", "zalo_msg_id");
CREATE INDEX IF NOT EXISTS "messages_conversation_id_album_key_idx" ON "messages"("conversation_id", "album_key");
CREATE INDEX IF NOT EXISTS "messages_conversation_id_zalo_msg_id_num_idx" ON "messages"("conversation_id", "zalo_msg_id_num" DESC);
CREATE INDEX IF NOT EXISTS "messages_conversation_id_sent_at_sender_type_sent_via_idx" ON "messages"("conversation_id", "sent_at", "sender_type", "sent_via");

-- Activity log indexes
CREATE INDEX IF NOT EXISTS "activity_logs_org_id_actor_type_created_at_idx" ON "activity_logs"("org_id", "actor_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "activity_logs_org_id_category_created_at_idx" ON "activity_logs"("org_id", "category", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "activity_logs_entity_type_entity_id_created_at_idx" ON "activity_logs"("entity_type", "entity_id", "created_at" DESC);

-- Appointment indexes
CREATE INDEX IF NOT EXISTS "appointments_org_id_appointment_date_idx" ON "appointments"("org_id", "appointment_date");
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_org_id_external_ref_key" ON "appointments"("org_id", "external_ref");
CREATE INDEX IF NOT EXISTS "appointments_source_idx" ON "appointments"("source");

-- Foreign keys
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_parent_contact_id_fkey" FOREIGN KEY ("parent_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_system_notify_zalo_account_id_fkey" FOREIGN KEY ("system_notify_zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_changed_by_user_id_fkey" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_internal_contact_zalo_account_id_fkey" FOREIGN KEY ("internal_contact_zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
