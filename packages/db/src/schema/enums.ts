import { pgEnum } from "drizzle-orm/pg-core";

export const taskStateEnum = pgEnum("task_state", [
  "created",
  "needs_clarification",
  "assigned",
  "in_progress",
  "paused",
  "evidence_ready",
  "changes_requested",
  "approved",
  "pr_created",
  "external_checks_pending",
  "addressing_review_feedback",
  "external_blocked",
  "merge_ready",
  "merged",
  "failed",
  "cancelled",
]);

export const revertabilityClassEnum = pgEnum("revertability_class", [
  "clean_revert",
  "revert_with_migration",
  "non_revertable",
]);

export const policyTypeEnum = pgEnum("policy_type", [
  "read_exclusion",
  "edit_deny",
  "edit_protected",
  "edit_allowed",
]);

export const protectionClassEnum = pgEnum("protection_class", [
  "hard_protected",
  "flagged",
  "light_protected",
]);

export const secretClassEnum = pgEnum("secret_class", [
  "setup_only",
  "runtime",
  "per_tool",
]);

export const reviewStateEnum = pgEnum("review_state", [
  "pending_evidence",
  "evidence_ready",
  "approved",
  "changes_requested",
  "pr_created",
  "external_checks_pending",
  "external_blocked",
  "merge_ready",
  "merged",
  "closed",
]);

export const roleEnum = pgEnum("role", ["admin", "operator", "viewer"]);
