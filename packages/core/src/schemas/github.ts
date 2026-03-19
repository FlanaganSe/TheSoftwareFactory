import { z } from "zod";

export const PR_STATES = ["draft", "open", "closed", "merged"] as const;

export const PRStateSchema = z.enum(PR_STATES);
export type PRState = z.infer<typeof PRStateSchema>;

export const REVIEW_STATES = [
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
] as const;

export const ReviewStateSchema = z.enum(REVIEW_STATES);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const WEBHOOK_EVENT_TYPES = [
  "pull_request.opened",
  "pull_request.synchronize",
  "pull_request.closed",
  "pull_request.enqueued",
  "pull_request.dequeued",
  "pull_request.ready_for_review",
  "pull_request.converted_to_draft",
  "pull_request_review.submitted",
  "pull_request_review.dismissed",
  "check_run.completed",
  "check_suite.completed",
  "merge_group.checks_requested",
  "merge_group.destroyed",
  "push",
  "installation.deleted",
  "installation.suspend",
] as const;

export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookEventSchema = z
  .object({
    deliveryId: z.string().min(1),
    eventType: WebhookEventTypeSchema,
    action: z.string().nullable(),
    repositoryFullName: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    receivedAt: z.string().datetime(),
  })
  .strict();

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
