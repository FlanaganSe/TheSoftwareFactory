ALTER TABLE "evidence_bundles" ALTER COLUMN "schema_version" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD COLUMN "base_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD COLUMN "merge_base_sha" text NOT NULL;