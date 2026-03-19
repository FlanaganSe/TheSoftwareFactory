import type { LLMCallAuditEntry } from "@software-factory/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CostTrackerDeps,
  createCostTracker,
} from "../../src/llm/cost-tracker.js";

function makeDeps(overrides: Partial<CostTrackerDeps> = {}): CostTrackerDeps {
  return {
    checkCostBudget: vi.fn().mockResolvedValue({
      allowed: true,
      currentCents: 100,
      budgetCents: 1000,
      percentUsed: 10,
    }),
    recordCost: vi.fn().mockResolvedValue({
      totalCents: 200,
      budgetCents: 1000,
      percentUsed: 20,
      overBudget: false,
    }),
    ...overrides,
  };
}

function makeAuditEntry(
  overrides: Partial<LLMCallAuditEntry> = {},
): LLMCallAuditEntry {
  return {
    model: "anthropic/claude-sonnet-4-6",
    provider: "openrouter",
    inputTokens: 1000,
    outputTokens: 500,
    costCents: 5,
    latencyMs: 200,
    taskId: "task-1",
    phase: "implement",
    finishReason: "stop",
    contentHash: "abc123",
    ...overrides,
  };
}

describe("createCostTracker", () => {
  describe("checkBudget", () => {
    it("allows when under budget", async () => {
      const deps = makeDeps();
      const tracker = createCostTracker(deps);
      const result = await tracker.checkBudget("task-1", 50);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.allowed).toBe(true);
        expect(result.value.percentUsed).toBe(10);
      }
    });

    it("denies when at budget limit", async () => {
      const deps = makeDeps({
        checkCostBudget: vi.fn().mockResolvedValue({
          allowed: false,
          currentCents: 1000,
          budgetCents: 1000,
          percentUsed: 100,
        }),
      });
      const tracker = createCostTracker(deps);
      const result = await tracker.checkBudget("task-1", 50);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.allowed).toBe(false);
      }
    });

    it("returns error on Redis failure", async () => {
      const deps = makeDeps({
        checkCostBudget: vi.fn().mockRejectedValue(new Error("Redis down")),
      });
      const tracker = createCostTracker(deps);
      const result = await tracker.checkBudget("task-1", 50);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe("storage_unavailable");
      }
    });
  });

  describe("recordLLMCost", () => {
    it("records cost and returns status", async () => {
      const deps = makeDeps();
      const tracker = createCostTracker(deps);
      const entry = makeAuditEntry({ costCents: 5 });
      const result = await tracker.recordLLMCost("task-1", entry);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.totalCents).toBe(200);
        expect(result.value.overBudget).toBe(false);
      }
      expect(deps.recordCost).toHaveBeenCalledWith("task-1", 5);
    });

    it("returns error on failure", async () => {
      const deps = makeDeps({
        recordCost: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const tracker = createCostTracker(deps);
      const result = await tracker.recordLLMCost("task-1", makeAuditEntry());
      expect(result.isErr()).toBe(true);
    });
  });

  describe("fetchGenerationStats", () => {
    it("returns null when no API key configured", async () => {
      const deps = makeDeps({ openRouterApiKey: undefined });
      const tracker = createCostTracker(deps);
      const result = await tracker.fetchGenerationStats("gen-123");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("parses OpenRouter response correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_cost: 0.005,
              tokens_prompt: 1000,
              tokens_completion: 500,
              native_tokens_reasoning: 0,
              native_tokens_cached: 100,
              latency: 200,
              generation_time: 150,
              model: "anthropic/claude-sonnet-4-6",
              provider_name: "anthropic",
              finish_reason: "stop",
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const deps = makeDeps({ openRouterApiKey: "test-key" });
      const tracker = createCostTracker(deps);
      const result = await tracker.fetchGenerationStats("gen-123");

      expect(result.isOk()).toBe(true);
      if (result.isOk() && result.value) {
        expect(result.value.totalCost).toBe(0.005);
        expect(result.value.tokensPrompt).toBe(1000);
        expect(result.value.tokensCompletion).toBe(500);
        expect(result.value.providerName).toBe("anthropic");
      }

      vi.unstubAllGlobals();
    });

    it("returns null on 404", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      );

      const deps = makeDeps({ openRouterApiKey: "test-key" });
      const tracker = createCostTracker(deps);
      const result = await tracker.fetchGenerationStats("nonexistent");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }

      vi.unstubAllGlobals();
    });
  });
});
