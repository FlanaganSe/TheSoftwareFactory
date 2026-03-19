import { z } from "zod";

export const TASK_STATES = [
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
] as const;

export const TaskStateSchema = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskSchema = z
  .object({
    id: z.string().uuid(),
    state: TaskStateSchema,
    objective: z.string().min(1),
    scope: z.record(z.string(), z.unknown()).nullable(),
    constraints: z.record(z.string(), z.unknown()).nullable(),
    budgetCents: z.number().int().nonnegative().nullable(),
    repoId: z.string().uuid(),
    createdBy: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z
  .object({
    objective: z.string().min(1),
    scope: z.record(z.string(), z.unknown()).nullable().optional(),
    constraints: z.record(z.string(), z.unknown()).nullable().optional(),
    budgetCents: z.number().int().nonnegative().nullable().optional(),
    repoId: z.string().uuid(),
    createdBy: z.string().min(1),
  })
  .strict();

export type CreateTask = z.infer<typeof CreateTaskSchema>;
