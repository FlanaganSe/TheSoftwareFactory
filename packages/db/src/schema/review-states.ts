import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { evidenceBundles } from "./evidence-bundles.js";
import { tasks } from "./tasks.js";

export const reviewStates = pgTable("review_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .unique()
    .references(() => tasks.id),
  // Internal boundary
  evidenceBundleId: uuid("evidence_bundle_id").references(
    () => evidenceBundles.id,
  ),
  internalApprovedBy: text("internal_approved_by"),
  internalApprovedAt: timestamp("internal_approved_at", {
    withTimezone: true,
  }),
  // External boundary
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  prNodeId: text("pr_node_id"),
  headSha: text("head_sha"),
  requiredChecks: jsonb("required_checks"),
  codeownersStatus: jsonb("codeowners_status"),
  unresolvedThreads: integer("unresolved_threads").default(0),
  staleReviews: boolean("stale_reviews").default(false),
  mergeQueueStatus: text("merge_queue_status"),
  // Reconciliation
  lastGithubSync: timestamp("last_github_sync", { withTimezone: true }),
  githubReconciliationData: jsonb("github_reconciliation_data"),
});
