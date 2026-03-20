import type { TaskState } from "@software-factory/core";

/** Task state → display color class (Tailwind) */
export const STATE_COLORS: Record<TaskState, string> = {
  created: "bg-gray-500/20 text-gray-400",
  needs_clarification: "bg-amber-500/20 text-amber-400",
  assigned: "bg-blue-500/20 text-blue-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  paused: "bg-yellow-500/20 text-yellow-400",
  evidence_ready: "bg-purple-500/20 text-purple-400",
  changes_requested: "bg-orange-500/20 text-orange-400",
  approved: "bg-green-500/20 text-green-400",
  pr_created: "bg-teal-500/20 text-teal-400",
  external_checks_pending: "bg-teal-500/20 text-teal-400",
  addressing_review_feedback: "bg-orange-500/20 text-orange-400",
  external_blocked: "bg-red-500/20 text-red-400",
  merge_ready: "bg-green-500/20 text-green-400",
  merged: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

/** Task state → human-readable label */
export const STATE_LABELS: Record<TaskState, string> = {
  created: "Created",
  needs_clarification: "Needs Clarification",
  assigned: "Assigned",
  in_progress: "In Progress",
  paused: "Paused",
  evidence_ready: "Awaiting Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
  pr_created: "PR Created",
  external_checks_pending: "Checks Pending",
  addressing_review_feedback: "Addressing Feedback",
  external_blocked: "Blocked",
  merge_ready: "Merge Ready",
  merged: "Merged",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Risk level → color class */
export const RISK_COLORS: Record<string, string> = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-red-400",
};

/** Vulnerability severity → color class */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-500 font-bold",
  high: "text-red-400",
  medium: "text-yellow-400",
  low: "text-gray-400",
};

/** Circuit breaker state → color */
export const CIRCUIT_COLORS: Record<string, string> = {
  closed: "text-green-400",
  open: "text-red-400",
  half_open: "text-yellow-400",
};
