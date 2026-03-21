import type { LLMCallAuditEntry, PolicyConfig } from "@software-factory/core";
import { ApplicationFailure, heartbeat } from "@temporalio/activity";
import type { RepoMapEntry } from "../indexing/types.js";
import type { AgentConfig, AgentLogger } from "./agent.js";
import { executeAgent } from "./agent.js";
import type { FileContent } from "./context.js";

export interface LLMActivityDeps {
  readonly createAgentConfig: (
    stepConfig: AgentStepConfig,
  ) => Promise<AgentConfig>;
  readonly logger?: AgentLogger;
}

export interface AgentStepConfig {
  readonly taskId: string;
  readonly objective: string;
  readonly plan?: string;
  readonly model: string;
  readonly budgetCents: number;
  readonly maxSteps: number;
  readonly wallClockTimeoutMs: number;
  readonly containerId: string;
  readonly repoMap: readonly RepoMapEntry[];
  readonly relevantFiles: readonly FileContent[];
  readonly policies: readonly PolicyConfig[];
}

export interface AgentStepResult {
  readonly success: boolean;
  readonly filesModified: readonly string[];
  readonly toolCallCount: number;
  readonly totalCostCents: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly guardrailTripped?: string;
  readonly auditEntries?: readonly LLMCallAuditEntry[];
}

export function createLLMActivities(deps: LLMActivityDeps) {
  const log = deps.logger;

  return {
    async executeAgentStep(
      stepConfig: AgentStepConfig,
    ): Promise<AgentStepResult> {
      log?.info(
        {
          taskId: stepConfig.taskId,
          model: stepConfig.model,
          containerId: stepConfig.containerId?.slice(0, 12),
          maxSteps: stepConfig.maxSteps,
        },
        "executeAgentStep starting",
      );

      if (!stepConfig.containerId) {
        throw ApplicationFailure.nonRetryable(
          "Cannot execute agent: no sandbox container (containerId is empty)",
          "MISSING_SANDBOX",
        );
      }

      const agentConfig = await deps.createAgentConfig(stepConfig);

      heartbeat("agent starting");
      const heartbeatInterval = setInterval(() => {
        heartbeat("agent executing");
      }, 30_000);

      try {
        const result = await executeAgent(agentConfig);

        if (result.isErr()) {
          throw ApplicationFailure.nonRetryable(
            result.error.message,
            result.error.code,
          );
        }

        const value = result.value;

        return {
          success: value.success,
          filesModified: value.filesModified,
          toolCallCount: value.toolCallCount,
          totalCostCents: value.totalCostCents,
          totalInputTokens: value.totalInputTokens,
          totalOutputTokens: value.totalOutputTokens,
          guardrailTripped: value.guardrailTripped,
          auditEntries: value.auditEntries,
        };
      } finally {
        clearInterval(heartbeatInterval);
      }
    },
  };
}
