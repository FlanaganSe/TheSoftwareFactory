import type { FactoryError } from "@software-factory/core";
import type { LLMCallAuditEntry } from "@software-factory/core";
import { type Result, err, ok } from "neverthrow";

export interface CostCheckResult {
  readonly allowed: boolean;
  readonly currentCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
}

export interface CostStatus {
  readonly totalCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
  readonly overBudget: boolean;
}

export interface GenerationStats {
  readonly totalCost: number;
  readonly tokensPrompt: number;
  readonly tokensCompletion: number;
  readonly nativeTokensReasoning: number;
  readonly nativeTokensCached: number;
  readonly latencyMs: number;
  readonly generationTimeMs: number;
  readonly model: string;
  readonly providerName: string;
  readonly finishReason: string;
}

export interface CostTrackerDeps {
  readonly checkCostBudget: (
    taskId: string,
    estimatedCost: number,
  ) => Promise<CostCheckResult>;
  readonly recordCost: (
    taskId: string,
    costCents: number,
  ) => Promise<CostStatus>;
  readonly openRouterApiKey?: string;
}

export function createCostTracker(deps: CostTrackerDeps) {
  async function checkBudget(
    taskId: string,
    estimatedCostCents: number,
  ): Promise<Result<CostCheckResult, FactoryError>> {
    try {
      const result = await deps.checkCostBudget(taskId, estimatedCostCents);
      return ok(result);
    } catch (error) {
      return err({
        code: "storage_unavailable",
        message: `Cost budget check failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  async function recordLLMCost(
    taskId: string,
    entry: LLMCallAuditEntry,
  ): Promise<Result<CostStatus, FactoryError>> {
    try {
      const status = await deps.recordCost(taskId, entry.costCents);
      return ok(status);
    } catch (error) {
      return err({
        code: "storage_unavailable",
        message: `Cost recording failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  async function fetchGenerationStats(
    generationId: string,
  ): Promise<Result<GenerationStats | null, FactoryError>> {
    if (!deps.openRouterApiKey) {
      return ok(null);
    }

    try {
      const response = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
        {
          headers: {
            Authorization: `Bearer ${deps.openRouterApiKey}`,
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) return ok(null);
        return err({
          code: "model_rate_limited",
          message: `OpenRouter generation stats request failed: ${response.status}`,
          retryable: response.status === 429,
        });
      }

      const data = (await response.json()) as {
        data?: {
          total_cost?: number;
          tokens_prompt?: number;
          tokens_completion?: number;
          native_tokens_reasoning?: number;
          native_tokens_cached?: number;
          latency?: number;
          generation_time?: number;
          model?: string;
          provider_name?: string;
          finish_reason?: string;
        };
      };

      if (!data.data) return ok(null);

      return ok({
        totalCost: data.data.total_cost ?? 0,
        tokensPrompt: data.data.tokens_prompt ?? 0,
        tokensCompletion: data.data.tokens_completion ?? 0,
        nativeTokensReasoning: data.data.native_tokens_reasoning ?? 0,
        nativeTokensCached: data.data.native_tokens_cached ?? 0,
        latencyMs: data.data.latency ?? 0,
        generationTimeMs: data.data.generation_time ?? 0,
        model: data.data.model ?? "",
        providerName: data.data.provider_name ?? "",
        finishReason: data.data.finish_reason ?? "",
      });
    } catch (error) {
      return err({
        code: "storage_unavailable",
        message: `Failed to fetch generation stats: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  return {
    checkBudget,
    recordLLMCost,
    fetchGenerationStats,
  };
}
