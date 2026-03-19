import { z } from "zod";

export const AUDIT_ACTION_TYPES = [
  "task_state_change",
  "task_created",
  "evidence_generated",
  "review_decision",
  "pr_created",
  "pr_merged",
  "pr_closed",
  "policy_check",
  "llm_call",
  "sandbox_exec",
  "file_read",
  "file_write",
  "command_run",
  "credential_rotation",
  "secret_access",
  "kill_switch_activated",
  "budget_warning",
  "config_changed",
] as const;

export const AuditActionTypeSchema = z.enum(AUDIT_ACTION_TYPES);
export type AuditActionType = z.infer<typeof AuditActionTypeSchema>;

export const AUDIT_TARGET_TYPES = [
  "task",
  "repository",
  "policy",
  "evidence",
  "pr",
  "sandbox",
  "secret",
  "config",
  "system",
] as const;

export const AuditTargetTypeSchema = z.enum(AUDIT_TARGET_TYPES);
export type AuditTargetType = z.infer<typeof AuditTargetTypeSchema>;

export const AuditEntrySchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    actor: z.string().min(1),
    actionType: AuditActionTypeSchema,
    targetType: AuditTargetTypeSchema,
    targetId: z.string().min(1),
    result: z.string().min(1),
    costCents: z.number().nonnegative().nullable().optional(),
    taskId: z.string().uuid().nullable().optional(),
    content: z.unknown().optional(),
    contentHash: z.string().min(1),
  })
  .strict();

export type AuditEntry = z.infer<typeof AuditEntrySchema>;
