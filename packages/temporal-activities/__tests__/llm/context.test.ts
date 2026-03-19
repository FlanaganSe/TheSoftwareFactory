import { describe, expect, it } from "vitest";
import {
  assembleContext,
  trimStepMessages,
  truncateToolResult,
} from "../../src/llm/context.js";

describe("assembleContext", () => {
  it("assembles context in correct ordering: system first, results last", () => {
    const messages = assembleContext({
      systemPrompt: "You are an agent.",
      repoMap: [
        {
          filePath: "src/index.ts",
          rank: 1.5,
          keySymbols: ["main"],
          lineCount: 100,
        },
      ],
      objective: "Fix the bug",
      plan: "Step 1: Read file",
      relevantFiles: [{ path: "src/bug.ts", content: "const x = 1;" }],
      toolHistory: [],
      previousResults: "Previous attempt failed",
      tokenBudget: 100_000,
    });

    expect(messages.length).toBe(2);
    // First message is system
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe("You are an agent.");

    // Second message is user with ordered sections
    const userContent = messages[1]?.content as string;
    const repoMapIdx = userContent.indexOf("Repository Map");
    const objectiveIdx = userContent.indexOf("Task Objective");
    const planIdx = userContent.indexOf("Execution Plan");
    const filesIdx = userContent.indexOf("Relevant Files");
    const resultsIdx = userContent.indexOf("Previous Attempt");

    // Strict ordering
    expect(repoMapIdx).toBeLessThan(objectiveIdx);
    expect(objectiveIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(filesIdx);
    expect(filesIdx).toBeLessThan(resultsIdx);
  });

  it("includes repo map in position 2 (after system, in user message)", () => {
    const messages = assembleContext({
      systemPrompt: "System",
      repoMap: [
        { filePath: "a.ts", rank: 1.0, keySymbols: ["foo"], lineCount: 10 },
      ],
      objective: "Do thing",
      relevantFiles: [],
      toolHistory: [],
      tokenBudget: 100_000,
    });

    const userContent = messages[1]?.content as string;
    expect(userContent).toContain("Repository Map");
    expect(userContent).toContain("a.ts");
    expect(userContent).toContain("foo");
  });

  it("respects token budget by omitting sections that exceed it", () => {
    const longContent = "x".repeat(50_000);
    const messages = assembleContext({
      systemPrompt: "System",
      repoMap: [],
      objective: "Do thing",
      relevantFiles: [{ path: "big.ts", content: longContent }],
      toolHistory: [],
      tokenBudget: 1000,
    });

    const userContent = messages[1]?.content as string;
    // The big file should be omitted because it exceeds the token budget
    expect(userContent).not.toContain(longContent);
  });

  it("truncates verbose stdout in tool history to 2000 chars", () => {
    const longOutput = "a".repeat(5000);
    const messages = assembleContext({
      systemPrompt: "System",
      repoMap: [],
      objective: "Do thing",
      relevantFiles: [],
      toolHistory: [
        {
          toolName: "run_command",
          args: { command: "test" },
          result: longOutput,
          stepNumber: 0,
        },
      ],
      tokenBudget: 100_000,
    });

    const userContent = messages[1]?.content as string;
    expect(userContent).toContain("truncated");
    expect(userContent).not.toContain(longOutput);
  });

  it("empty optional fields produce valid context", () => {
    const messages = assembleContext({
      systemPrompt: "System",
      repoMap: [],
      objective: "Objective",
      relevantFiles: [],
      toolHistory: [],
      tokenBudget: 100_000,
    });

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    const userContent = messages[1]?.content as string;
    expect(userContent).toContain("Objective");
    expect(userContent).not.toContain("Execution Plan");
    expect(userContent).not.toContain("Previous Attempt");
  });

  it("includes objective in assembled context", () => {
    const messages = assembleContext({
      systemPrompt: "System",
      repoMap: [],
      objective: "Fix authentication bug in login flow",
      relevantFiles: [],
      toolHistory: [],
      tokenBudget: 100_000,
    });

    const userContent = messages[1]?.content as string;
    expect(userContent).toContain("Fix authentication bug in login flow");
  });
});

describe("trimStepMessages", () => {
  it("returns messages unchanged when under limit", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "user1" },
    ];
    const result = trimStepMessages(messages, 5);
    expect(result).toEqual(messages);
  });

  it("keeps system message and trims oldest", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "msg1" },
      { role: "assistant" as const, content: "msg2" },
      { role: "user" as const, content: "msg3" },
      { role: "assistant" as const, content: "msg4" },
    ];
    const result = trimStepMessages(messages, 3);
    expect(result.length).toBe(3);
    expect(result[0]?.content).toBe("sys");
    expect(result[1]?.content).toBe("msg3");
    expect(result[2]?.content).toBe("msg4");
  });
});

describe("truncateToolResult", () => {
  it("returns short results unchanged", () => {
    expect(truncateToolResult("short", 100)).toBe("short");
  });

  it("truncates long results with indicator", () => {
    const long = "a".repeat(200);
    const result = truncateToolResult(long, 100);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain("truncated");
    expect(result).toContain("200 chars total");
  });
});
