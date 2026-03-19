import { ApplicationFailure } from "@temporalio/activity";
import { type AgentConfig, executeAgent } from "./agent.js";

export interface LLMActivityDeps {
  readonly createAgentConfig: (
    stepConfig: AgentStepConfig,
  ) => Promise<AgentConfig>;
}

export interface AgentStepConfig {
  readonly taskId: string;
  readonly objective: string;
  readonly plan?: string;
  readonly model: string;
  readonly budgetCents: number;
  readonly maxSteps: number;
  readonly wallClockTimeoutMs: number;
}

export interface AgentStepResult {
  readonly success: boolean;
  readonly filesModified: readonly string[];
  readonly toolCallCount: number;
  readonly totalCostCents: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly guardrailTripped?: string;
}

export function createLLMActivities(deps: LLMActivityDeps) {
  return {
    async executeAgentStep(
      stepConfig: AgentStepConfig,
    ): Promise<AgentStepResult> {
      const agentConfig = await deps.createAgentConfig(stepConfig);
      const result = await executeAgent(agentConfig);

      if (result.isErr()) {
        throw ApplicationFailure.nonRetryable(
          result.error.message,
          result.error.code,
        );
      }

      const value = result.value;

      if (value.guardrailTripped) {
        throw ApplicationFailure.nonRetryable(
          `Guardrail tripped: ${value.guardrailTripped}`,
          "GUARDRAIL_TRIPPED",
        );
      }

      return {
        success: value.success,
        filesModified: value.filesModified,
        toolCallCount: value.toolCallCount,
        totalCostCents: value.totalCostCents,
        totalInputTokens: value.totalInputTokens,
        totalOutputTokens: value.totalOutputTokens,
        guardrailTripped: value.guardrailTripped,
      };
    },
  };
}
