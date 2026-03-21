CREATE TABLE "capability_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_revision" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_states" ADD COLUMN IF NOT EXISTS "pr_node_id" text;--> statement-breakpoint
ALTER TABLE "review_states" ADD COLUMN IF NOT EXISTS "head_sha" text;--> statement-breakpoint
ALTER TABLE "capability_snapshots" ADD CONSTRAINT "capability_snapshots_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_snapshots_repo_latest_idx" ON "capability_snapshots" USING btree ("repo_id","captured_at");