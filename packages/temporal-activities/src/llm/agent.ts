import { createHash } from "node:crypto";
import type {
  FactoryError,
  LLMCallAuditEntry,
  PolicyConfig,
} from "@software-factory/core";
import { generateText, stepCountIs } from "ai";
import { type Result, err, ok } from "neverthrow";
import type { RepoMapEntry } from "../indexing/types.js";
import type { SandboxInstance, SandboxSupervisor } from "../sandbox/index.js";
import {
  type FileContent,
  type ToolCallSummary,
  assembleContext,
} from "./context.js";
import { type CostTrackerDeps, createCostTracker } from "./cost-tracker.js";
import { createGuardrails } from "./guardrails.js";
import type { ProviderConfig } from "./provider.js";
import { buildRequestConfig, createProvider } from "./provider.js";
import {
  type AuditLogEntry,
  type FlaggedEdit,
  createAgentTools,
} from "./tools.js";

export interface AgentConfig {
  readonly taskId: string;
  readonly objective: string;
  readonly plan?: string;
  readonly repoMap: readonly RepoMapEntry[];
  readonly relevantFiles: readonly FileContent[];
  readonly policies: readonly PolicyConfig[];
  readonly sandbox: SandboxSupervisor;
  readonly sandboxInstance: SandboxInstance;
  readonly provider: ProviderConfig;
  readonly budgetCents: number;
  readonly maxSteps: number;
  readonly wallClockTimeoutMs: number;
  readonly tokenBudget?: number;
  readonly systemPrompt?: string;
  readonly costTrackerDeps: CostTrackerDeps;
  readonly checkKillSwitch: (
    taskId: string,
  ) => Promise<{ killed: boolean; scope: string }>;
  readonly searchSymbols?: (
    query: string,
    kind?: string,
  ) => Promise<
    readonly {
      readonly name: string;
      readonly kind: string;
      readonly filePath: string;
      readonly line: number;
      readonly signature?: string;
    }[]
  >;
}

export interface AgentResult {
  readonly success: boolean;
  readonly filesModified: readonly string[];
  readonly toolCallCount: number;
  readonly totalCostCents: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly guardrailTripped?: string;
  readonly auditEntries: readonly LLMCallAuditEntry[];
}

const DEFAULT_SYSTEM_PROMPT = `You are a software engineering agent. You can read, write, and edit files, search code, and run commands.

Rules:
- Make minimal, targeted changes
- Follow existing code style and patterns
- Run tests after making changes to verify correctness
- If an edit fails, read the file first to see current content
- Do not modify files outside the task scope`;

export async function executeAgent(
  config: AgentConfig,
): Promise<Result<AgentResult, FactoryError>> {
  const provider = createProvider(config.provider);
  const requestConfig = buildRequestConfig(config.provider);
  const costTracker = createCostTracker(config.costTrackerDeps);
  const guardrails = createGuardrails({
    maxSteps: config.maxSteps,
    wallClockTimeoutMs: config.wallClockTimeoutMs,
    budgetCents: config.budgetCents,
  });

  const flaggedEdits: FlaggedEdit[] = [];
  const auditLog: AuditLogEntry[] = [];
  const auditEntries: LLMCallAuditEntry[] = [];
  const toolHistory: ToolCallSummary[] = [];

  const guardrailState: {
    stepCount: number;
    stateFingerprints: string[];
    toolCallHashes: string[];
    startTimeMs: number;
    totalCostCents: number;
  } = {
    stepCount: 0,
    stateFingerprints: [],
    toolCallHashes: [],
    startTimeMs: Date.now(),
    totalCostCents: 0,
  };

  const tools = createAgentTools({
    sandbox: config.sandbox,
    instance: config.sandboxInstance,
    policies: config.policies,
    flaggedEdits,
    auditLog,
    searchSymbols: config.searchSymbols,
  });

  // Check kill switch before starting
  const killCheck = await config.checkKillSwitch(config.taskId);
  if (killCheck.killed) {
    return err({
      code: "unknown_internal",
      message: `Kill switch active (scope: ${killCheck.scope})`,
      retryable: false,
    });
  }

  // Check budget before starting
  const budgetCheck = await costTracker.checkBudget(config.taskId, 0);
  if (budgetCheck.isErr()) return err(budgetCheck.error);
  if (!budgetCheck.value.allowed) {
    return err({
      code: "unknown_internal",
      message: "Cost budget already exceeded",
      retryable: false,
    });
  }

  const messages = assembleContext({
    systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    repoMap: config.repoMap,
    objective: config.objective,
    plan: config.plan,
    relevantFiles: config.relevantFiles,
    toolHistory: [],
    tokenBudget: config.tokenBudget ?? 100_000,
  });

  let guardrailTripped: string | undefined;
  const abortController = new AbortController();

  try {
    const result = await generateText({
      model: provider(config.provider.defaultModel),
      messages,
      tools,
      stopWhen: stepCountIs(config.maxSteps),
      abortSignal: abortController.signal,
      ...requestConfig,
      onStepFinish: async (event) => {
        guardrailState.stepCount = event.stepNumber + 1;

        // Record usage
        const inputTokens = event.usage.inputTokens ?? 0;
        const outputTokens = event.usage.outputTokens ?? 0;
        const costCents = estimateCostCents(
          inputTokens,
          outputTokens,
          config.provider.defaultModel,
        );

        guardrailState.totalCostCents += costCents;

        const contentHash = createHash("sha256")
          .update(event.text ?? "")
          .digest("hex");

        const auditEntry: LLMCallAuditEntry = {
          model: config.provider.defaultModel,
          provider: "openrouter",
          inputTokens,
          outputTokens,
          costCents,
          latencyMs: 0,
          taskId: config.taskId,
          phase: "implement",
          finishReason: event.finishReason,
          contentHash,
        };
        auditEntries.push(auditEntry);

        // Record cost
        await costTracker.recordLLMCost(config.taskId, auditEntry);

        // Track tool calls for guardrails
        for (const tc of event.toolCalls) {
          const hash = guardrails.computeToolCallHash(
            tc.toolName,
            tc.input,
            undefined,
          );
          guardrailState.toolCallHashes.push(hash);

          toolHistory.push({
            toolName: tc.toolName,
            args: tc.input as Record<string, unknown>,
            result: "",
            stepNumber: event.stepNumber,
          });
        }

        // Compute state fingerprint from actual modified files
        const modifiedFiles = new Map<string, string>();
        for (const entry of auditLog) {
          if (
            (entry.toolName === "file_write" ||
              entry.toolName === "file_edit") &&
            entry.result.startsWith("OK:")
          ) {
            const p = entry.args.path;
            if (typeof p === "string") modifiedFiles.set(p, entry.result);
          }
        }
        const fp = guardrails.computeFingerprint(
          modifiedFiles,
          0,
          0,
          0,
          auditLog.length,
        );
        guardrailState.stateFingerprints.push(fp);

        // Check guardrails
        const trip = guardrails.checkAfterStep(guardrailState);
        if (trip) {
          guardrailTripped = trip.guardrail;
          abortController.abort();
        }

        // Check kill switch between steps
        const kill = await config.checkKillSwitch(config.taskId);
        if (kill.killed) {
          guardrailTripped = "kill_switch";
          abortController.abort();
        }
      },
    });

    // Collect files modified from audit log
    const filesModified = new Set<string>();
    for (const entry of auditLog) {
      if (
        (entry.toolName === "file_write" || entry.toolName === "file_edit") &&
        entry.result.startsWith("OK:")
      ) {
        const path = entry.args.path;
        if (typeof path === "string") filesModified.add(path);
      }
      if (
        entry.toolName === "run_command" &&
        entry.result.includes("changed_files:")
      ) {
        const match = /changed_files:\s*(.+)/.exec(entry.result);
        if (match?.[1]) {
          for (const f of match[1].split(",").map((s) => s.trim())) {
            if (f) filesModified.add(f);
          }
        }
      }
    }

    return ok({
      success: !guardrailTripped,
      filesModified: [...filesModified],
      toolCallCount: auditLog.length,
      totalCostCents: guardrailState.totalCostCents,
      totalInputTokens: result.totalUsage.inputTokens ?? 0,
      totalOutputTokens: result.totalUsage.outputTokens ?? 0,
      guardrailTripped,
      auditEntries,
    });
  } catch (error) {
    // If aborted due to guardrail/kill switch, return a normal result
    if (guardrailTripped && abortController.signal.aborted) {
      const filesModified = new Set<string>();
      for (const entry of auditLog) {
        if (
          (entry.toolName === "file_write" || entry.toolName === "file_edit") &&
          entry.result.startsWith("OK:")
        ) {
          const path = entry.args.path;
          if (typeof path === "string") filesModified.add(path);
        }
      }
      return ok({
        success: false,
        filesModified: [...filesModified],
        toolCallCount: auditLog.length,
        totalCostCents: guardrailState.totalCostCents,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        guardrailTripped,
        auditEntries,
      });
    }

    return err({
      code: "unknown_internal",
      message: `Agent execution failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: false,
    });
  }
}

function estimateCostCents(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  // Rough estimates per 1M tokens (in cents)
  const rates: Record<string, { input: number; output: number }> = {
    "anthropic/claude-sonnet-4-6": { input: 300, output: 1500 },
    "anthropic/claude-opus-4-6": { input: 1500, output: 7500 },
    "openai/gpt-5.2-mini": { input: 15, output: 60 },
  };

  const rate = rates[model] ?? { input: 300, output: 1500 };
  return (
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output
  );
}
