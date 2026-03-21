import { z } from "zod";
import { WorkflowPhaseSchema } from "./llm.js";
import { TaskStateSchema } from "./task.js";

export const TASK_EVENT_TYPES = [
  "phase_started",
  "phase_completed",
  "task_state_changed",
  "agent_step",
  "task_error",
] as const;

export const TaskEventTypeSchema = z.enum(TASK_EVENT_TYPES);
export type TaskEventType = z.infer<typeof TaskEventTypeSchema>;

export const PhaseEventSchema = z
  .object({
    type: TaskEventTypeSchema,
    taskId: z.string().uuid(),
    phase: WorkflowPhaseSchema,
    state: TaskStateSchema.optional(),
    attemptNumber: z.number().int().nonnegative().optional(),
    phaseIteration: z.number().int().nonnegative().optional(),
    costCents: z.number().nonnegative().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type PhaseEvent = z.infer<typeof PhaseEventSchema>;

export const AgentStepEventSchema = z
  .object({
    type: z.literal("agent_step"),
    taskId: z.string().uuid(),
    stepNumber: z.number().int().nonnegative(),
    toolCalls: z.array(
      z
        .object({
          toolName: z.string(),
          summary: z.string().optional(),
        })
        .strict(),
    ),
    costCents: z.number().nonnegative(),
    totalCostCents: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    filesModified: z.array(z.string()),
    finishReason: z.string(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type AgentStepEvent = z.infer<typeof AgentStepEventSchema>;
