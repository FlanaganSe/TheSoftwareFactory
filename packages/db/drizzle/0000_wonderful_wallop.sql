CREATE TYPE "public"."policy_type" AS ENUM('read_exclusion', 'edit_deny', 'edit_protected', 'edit_allowed');--> statement-breakpoint
CREATE TYPE "public"."protection_class" AS ENUM('hard_protected', 'flagged', 'light_protected');--> statement-breakpoint
CREATE TYPE "public"."revertability_class" AS ENUM('clean_revert', 'revert_with_migration', 'non_revertable');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('pending_evidence', 'evidence_ready', 'approved', 'changes_requested', 'pr_created', 'external_checks_pending', 'external_blocked', 'merge_ready', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."secret_class" AS ENUM('setup_only', 'runtime', 'per_tool');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('created', 'needs_clarification', 'assigned', 'in_progress', 'paused', 'evidence_ready', 'changes_requested', 'approved', 'pr_created', 'external_checks_pending', 'addressing_review_feedback', 'external_blocked', 'merge_ready', 'merged', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_owner" text NOT NULL,
	"github_repo" text NOT NULL,
	"default_branch" text DEFAULT 'main',
	"repo_class" text DEFAULT 'A',
	"autonomy_level" text DEFAULT 'L1',
	"setup_contract_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" "task_state" DEFAULT 'created' NOT NULL,
	"objective" text NOT NULL,
	"scope" jsonb,
	"constraints" jsonb,
	"budget_cents" numeric(10, 0),
	"repo_id" uuid NOT NULL,
	"autonomy_level" text DEFAULT 'L1' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_valid_transitions" (
	"from_state" "task_state" NOT NULL,
	"to_state" "task_state" NOT NULL,
	CONSTRAINT "task_valid_transitions_from_state_to_state_pk" PRIMARY KEY("from_state","to_state")
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"result" text NOT NULL,
	"cost_cents" numeric(10, 0),
	"task_id" uuid,
	"content" jsonb,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"schema_version" text NOT NULL,
	"objective" text NOT NULL,
	"revertability_class" "revertability_class" NOT NULL,
	"blast_radius_files" integer NOT NULL,
	"blast_radius_packages" integer NOT NULL,
	"has_protected_surface_edits" boolean DEFAULT false,
	"has_migration_impact" boolean DEFAULT false,
	"artifact_url" text,
	"annotated_diff" jsonb,
	"owners_impacted" jsonb,
	"test_results" jsonb,
	"security_scan_results" jsonb,
	"lint_results" jsonb,
	"protected_surface_edits" jsonb,
	"migration_impact" jsonb,
	"unresolved_assumptions" jsonb,
	"commands_run" jsonb,
	"pending_external_checks" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"evidence_bundle_id" uuid,
	"internal_approved_by" text,
	"internal_approved_at" timestamp with time zone,
	"pr_number" integer,
	"pr_url" text,
	"required_checks" jsonb,
	"codeowners_status" jsonb,
	"unresolved_threads" integer DEFAULT 0,
	"stale_reviews" boolean DEFAULT false,
	"merge_queue_status" text,
	"last_github_sync" timestamp with time zone,
	"github_reconciliation_data" jsonb,
	CONSTRAINT "review_states_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "policy_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"policy_type" "policy_type" NOT NULL,
	"protection_class" "protection_class",
	"path_patterns" jsonb NOT NULL,
	"autonomy_level" text,
	"requires_approval" boolean DEFAULT false,
	"approver_role" text,
	"is_active" boolean DEFAULT true,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"secret_class" "secret_class" NOT NULL,
	"tool_scope" text,
	"encrypted_value" "bytea" NOT NULL,
	"encrypted_dek" "bytea" NOT NULL,
	"kek_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credential_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"token_type" text NOT NULL,
	"scope" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index_version_id" uuid NOT NULL,
	"source_file" text NOT NULL,
	"target_file" text NOT NULL,
	"import_type" text
);
--> statement-breakpoint
CREATE TABLE "code_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index_version_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"file_hash" text NOT NULL,
	"language" text,
	"line_count" integer,
	"is_entry_point" boolean,
	"module_group" text,
	"governance_excluded" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "code_index_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index_version_id" uuid NOT NULL,
	"file_path" text,
	"symbol_name" text,
	"symbol_kind" text,
	"line_start" integer,
	"line_end" integer,
	"parent_symbol" text,
	"signature" text,
	"is_exported" boolean
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"model_id" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_cents" numeric(10, 4) NOT NULL,
	"latency_ms" integer,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid,
	"image_ref" text,
	"setup_contract_hash" text,
	"cache_valid" boolean DEFAULT false,
	"last_health_check" timestamp with time zone,
	"health_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "side_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"effect_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"target_ref" text,
	"request_payload_hash" text,
	"response_payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "side_effects_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"role" "role" NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_evidence_bundle_id_evidence_bundles_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_configs" ADD CONSTRAINT "policy_configs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_bindings" ADD CONSTRAINT "secret_bindings_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_leases" ADD CONSTRAINT "credential_leases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_dependencies" ADD CONSTRAINT "code_dependencies_index_version_id_code_index_versions_id_fk" FOREIGN KEY ("index_version_id") REFERENCES "public"."code_index_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_files" ADD CONSTRAINT "code_files_index_version_id_code_index_versions_id_fk" FOREIGN KEY ("index_version_id") REFERENCES "public"."code_index_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_index_versions" ADD CONSTRAINT "code_index_versions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_index_version_id_code_index_versions_id_fk" FOREIGN KEY ("index_version_id") REFERENCES "public"."code_index_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_states" ADD CONSTRAINT "environment_states_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_effects" ADD CONSTRAINT "side_effects_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repos_owner_repo_idx" ON "repos" USING btree ("github_owner","github_repo");--> statement-breakpoint
CREATE INDEX "tasks_active_idx" ON "tasks" USING btree ("state") WHERE "tasks"."state" NOT IN ('merged', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "tasks_repo_id_idx" ON "tasks" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "tasks_created_at_idx" ON "tasks" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_entries_task_id_idx" ON "audit_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "audit_entries_actor_idx" ON "audit_entries" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "audit_entries_action_type_idx" ON "audit_entries" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "policy_configs_repo_id_idx" ON "policy_configs" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "policy_configs_path_patterns_idx" ON "policy_configs" USING gin ("path_patterns");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_bindings_repo_name_idx" ON "secret_bindings" USING btree ("repo_id","name");--> statement-breakpoint
CREATE INDEX "credential_leases_task_id_idx" ON "credential_leases" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "credential_leases_expires_at_idx" ON "credential_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "code_dependencies_source_idx" ON "code_dependencies" USING btree ("source_file");--> statement-breakpoint
CREATE INDEX "code_dependencies_target_idx" ON "code_dependencies" USING btree ("target_file");--> statement-breakpoint
CREATE UNIQUE INDEX "code_index_versions_repo_sha_idx" ON "code_index_versions" USING btree ("repo_id","commit_sha");--> statement-breakpoint
CREATE INDEX "code_symbols_symbol_name_idx" ON "code_symbols" USING btree ("symbol_name");--> statement-breakpoint
CREATE INDEX "code_symbols_file_path_idx" ON "code_symbols" USING btree ("file_path");--> statement-breakpoint
CREATE INDEX "cost_records_task_id_idx" ON "cost_records" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "cost_records_timestamp_idx" ON "cost_records" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "cost_records_model_id_idx" ON "cost_records" USING btree ("model_id");