import { z } from "zod";

export const WORKFLOW_PHASES = [
  "intake",
  "understand",
  "plan",
  "setup",
  "implement",
  "validate",
  "evidence",
  "review",
  "pr_creation",
  "pr_tracking",
  "learn",
] as const;

export const WorkflowPhaseSchema = z.enum(WORKFLOW_PHASES);
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const LLMCallAuditEntrySchema = z
  .object({
    model: z.string().min(1),
    provider: z.string().min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    cachedTokens: z.number().int().nonnegative().optional(),
    costCents: z.number().nonnegative(),
    latencyMs: z.number().nonnegative(),
    taskId: z.string().uuid(),
    phase: WorkflowPhaseSchema,
    finishReason: z.string().min(1),
    contentHash: z.string().min(1),
  })
  .strict();

export type LLMCallAuditEntry = z.infer<typeof LLMCallAuditEntrySchema>;

export const AGENT_TOOL_NAMES = [
  "file_read",
  "file_write",
  "file_edit",
  "search_codebase",
  "run_command",
  "list_files",
  "search_text",
] as const;

export const AgentToolNameSchema = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = z.infer<typeof AgentToolNameSchema>;

export const AgentToolSchema = z
  .object({
    name: AgentToolNameSchema,
    purpose: z.string().min(1),
    securityConstraint: z.string().min(1),
  })
  .strict();

export type AgentTool = z.infer<typeof AgentToolSchema>;

export const EDIT_FORMATS = ["search_replace", "whole_file"] as const;

export const EditFormatSchema = z.enum(EDIT_FORMATS);
export type EditFormat = z.infer<typeof EditFormatSchema>;
