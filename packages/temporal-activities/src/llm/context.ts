import type { ModelMessage } from "ai";
import type { RepoMapEntry } from "../indexing/types.js";
import { wrapUntrustedContent } from "./prompt-safety.js";

export interface FileContent {
  readonly path: string;
  readonly content: string;
}

export interface ToolCallSummary {
  readonly toolName: string;
  readonly args: unknown;
  readonly result: string;
  readonly stepNumber: number;
}

export interface ContextConfig {
  readonly systemPrompt: string;
  readonly repoMap: readonly RepoMapEntry[];
  readonly objective: string;
  readonly plan?: string;
  readonly relevantFiles: readonly FileContent[];
  readonly toolHistory: readonly ToolCallSummary[];
  readonly previousResults?: string;
  readonly tokenBudget: number;
}

const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function formatRepoMap(entries: readonly RepoMapEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map(
    (e) =>
      `${e.filePath} (rank: ${e.rank.toFixed(2)}) — ${e.keySymbols.join(", ")}`,
  );
  return `## Repository Map\n\n${lines.join("\n")}`;
}

function formatFiles(files: readonly FileContent[]): string {
  if (files.length === 0) return "";
  return files
    .map((f) => {
      const wrapped = wrapUntrustedContent(f.content, f.path);
      return `### ${f.path}\n\`\`\`\n${wrapped}\n\`\`\``;
    })
    .join("\n\n");
}

function formatToolHistory(history: readonly ToolCallSummary[]): string {
  if (history.length === 0) return "";
  return history
    .map((h) => {
      const truncatedResult =
        h.result.length > 2000
          ? `${h.result.substring(0, 2000)}\n... (truncated)`
          : h.result;
      return `[Step ${h.stepNumber}] ${h.toolName}(${JSON.stringify(h.args)})\n→ ${truncatedResult}`;
    })
    .join("\n\n");
}

export function assembleContext(config: ContextConfig): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let totalTokens = 0;

  // 1. System prompt + rules (TOP)
  const systemText = config.systemPrompt;
  totalTokens += estimateTokens(systemText);

  // Build user message content in strict ordering
  const sections: string[] = [];

  // 2. Repo map
  const repoMapText = formatRepoMap(config.repoMap);
  if (repoMapText) {
    sections.push(repoMapText);
    totalTokens += estimateTokens(repoMapText);
  }

  // 3. Task objective + constraints
  const objectiveText = `## Task Objective\n\n${config.objective}`;
  sections.push(objectiveText);
  totalTokens += estimateTokens(objectiveText);

  // 4. Execution plan
  if (config.plan) {
    const planText = `## Execution Plan\n\n${config.plan}`;
    if (totalTokens + estimateTokens(planText) <= config.tokenBudget) {
      sections.push(planText);
      totalTokens += estimateTokens(planText);
    }
  }

  // 5. Relevant file contents
  if (config.relevantFiles.length > 0) {
    const filesText = `## Relevant Files\n\n${formatFiles(config.relevantFiles)}`;
    const fileTokens = estimateTokens(filesText);
    if (totalTokens + fileTokens <= config.tokenBudget) {
      sections.push(filesText);
      totalTokens += fileTokens;
    }
  }

  // 6. Tool call history (recent)
  if (config.toolHistory.length > 0) {
    const historyText = `## Tool Call History\n\n${formatToolHistory(config.toolHistory)}`;
    const historyTokens = estimateTokens(historyText);
    if (totalTokens + historyTokens <= config.tokenBudget) {
      sections.push(historyText);
      totalTokens += historyTokens;
    }
  }

  // 7. Previous attempt results (BOTTOM)
  if (config.previousResults) {
    const resultsText = `## Previous Attempt Results\n\n${config.previousResults}`;
    const resultsTokens = estimateTokens(resultsText);
    if (totalTokens + resultsTokens <= config.tokenBudget) {
      sections.push(resultsText);
    }
  }

  messages.push({
    role: "system",
    content: systemText,
  });

  messages.push({
    role: "user",
    content: sections.join("\n\n---\n\n"),
  });

  return messages;
}

export function trimStepMessages(
  messages: ModelMessage[],
  maxMessages: number,
): ModelMessage[] {
  if (messages.length <= maxMessages) return messages;

  // Keep the system message (first) and last N-1 messages
  const system = messages[0];
  const recent = messages.slice(-(maxMessages - 1));
  return system ? [system, ...recent] : recent;
}

export function truncateToolResult(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;
  return `${result.substring(0, maxChars)}\n... (truncated, ${result.length} chars total)`;
}
