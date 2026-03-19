import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { type AgentConfig, executeAgent } from "../../src/llm/agent.js";
import type {
  ExecResult,
  SandboxInstance,
  SandboxSupervisor,
} from "../../src/sandbox/index.js";

// Mock the AI SDK to avoid real LLM calls
vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn().mockReturnValue(() => false),
  tool: vi.fn((config: Record<string, unknown>) => config),
}));

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: "", stderr: "", durationMs: 10, ...overrides };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const sandbox = {
    execCommand: vi.fn().mockResolvedValue(ok(makeExecResult())),
  } as unknown as SandboxSupervisor;

  return {
    taskId: "task-1",
    objective: "Fix the bug",
    repoMap: [],
    relevantFiles: [],
    policies: [],
    sandbox,
    sandboxInstance: {
      containerId: "c1",
      phase: "execution",
      labels: {},
    } as SandboxInstance,
    provider: {
      apiKey: "test-key",
      defaultModel: "anthropic/claude-sonnet-4-6",
    },
    budgetCents: 1000,
    maxSteps: 10,
    wallClockTimeoutMs: 30_000,
    costTrackerDeps: {
      checkCostBudget: vi.fn().mockResolvedValue({
        allowed: true,
        currentCents: 0,
        budgetCents: 1000,
        percentUsed: 0,
      }),
      recordCost: vi.fn().mockResolvedValue({
        totalCents: 5,
        budgetCents: 1000,
        percentUsed: 0.5,
        overBudget: false,
      }),
    },
    checkKillSwitch: vi
      .fn()
      .mockResolvedValue({ killed: false, scope: "none" }),
    ...overrides,
  };
}

describe("executeAgent", () => {
  it("produces result with mocked LLM response", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = generateText as ReturnType<typeof vi.fn>;
    mockGenerateText.mockResolvedValue({
      text: "Done",
      totalUsage: { inputTokens: 100, outputTokens: 50 },
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    });

    const config = makeConfig();
    const result = await executeAgent(config);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.success).toBe(true);
      expect(result.value.totalInputTokens).toBe(100);
      expect(result.value.totalOutputTokens).toBe(50);
    }
  });

  it("checks kill switch before starting", async () => {
    const config = makeConfig({
      checkKillSwitch: vi
        .fn()
        .mockResolvedValue({ killed: true, scope: "global" }),
    });
    const result = await executeAgent(config);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Kill switch");
    }
  });

  it("checks cost budget before starting", async () => {
    const config = makeConfig({
      costTrackerDeps: {
        checkCostBudget: vi.fn().mockResolvedValue({
          allowed: false,
          currentCents: 1000,
          budgetCents: 1000,
          percentUsed: 100,
        }),
        recordCost: vi.fn(),
      },
    });
    const result = await executeAgent(config);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("budget");
    }
  });

  it("returns error on LLM failure", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = generateText as ReturnType<typeof vi.fn>;
    mockGenerateText.mockRejectedValue(new Error("API timeout"));

    const result = await executeAgent(makeConfig());
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("API timeout");
    }
  });

  it("audit entries include model and task info", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

    // Simulate onStepFinish being called
    mockGenerateText.mockImplementation(
      async (opts: Record<string, unknown>) => {
        const onStepFinish = opts.onStepFinish as (
          event: Record<string, unknown>,
        ) => Promise<void>;
        if (onStepFinish) {
          await onStepFinish({
            stepNumber: 0,
            text: "hello",
            usage: { inputTokens: 200, outputTokens: 100 },
            finishReason: "stop",
            toolCalls: [],
          });
        }
        return {
          text: "Done",
          totalUsage: { inputTokens: 200, outputTokens: 100 },
          steps: [],
          toolCalls: [],
          toolResults: [],
          finishReason: "stop",
        };
      },
    );

    const config = makeConfig();
    const result = await executeAgent(config);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.auditEntries).toHaveLength(1);
      expect(result.value.auditEntries[0]?.model).toBe(
        "anthropic/claude-sonnet-4-6",
      );
      expect(result.value.auditEntries[0]?.taskId).toBe("task-1");
      expect(result.value.auditEntries[0]?.inputTokens).toBe(200);
    }
  });

  it("collects filesModified from tool audit log", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = generateText as ReturnType<typeof vi.fn>;
    mockGenerateText.mockResolvedValue({
      text: "Done",
      totalUsage: { inputTokens: 100, outputTokens: 50 },
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    });

    const result = await executeAgent(makeConfig());
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(Array.isArray(result.value.filesModified)).toBe(true);
    }
  });
});
