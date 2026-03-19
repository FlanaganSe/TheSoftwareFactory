/**
 * Planning-specific LLM activity.
 * Uses generateText() to produce structured implementation plans.
 */

import { ApplicationFailure } from "@temporalio/activity";
import { generateText } from "ai";
import type { RepoMapEntry } from "../indexing/types.js";
import type { FileContent } from "./context.js";
import type { ProviderConfig } from "./provider.js";
import { buildRequestConfig, createProvider } from "./provider.js";

export interface PlanActivityDeps {
  readonly providerConfig: ProviderConfig;
}

const PLANNING_SYSTEM_PROMPT = `You are a software planning agent. Given a codebase analysis and an objective, produce a structured implementation plan.

Your plan must include:
1. Numbered steps with clear descriptions
2. Files to modify or create for each step
3. Expected changes (what will be added/modified/removed)
4. Any dependencies between steps (what must happen first)

Output format:
## Implementation Plan

### Step 1: [title]
- **Files:** [list of files]
- **Changes:** [description]

### Step 2: [title]
...

## Files to Modify
- [file1.ts]
- [file2.ts]

## Estimated Complexity
[low|medium|high] — [brief justification]`;

export function createPlanActivities(deps: PlanActivityDeps) {
  return {
    async generatePlan(
      objective: string,
      repoMap: RepoMapEntry[],
      relevantFiles: FileContent[],
      model: string,
    ): Promise<{ plan: string; estimatedFiles: string[] }> {
      try {
        const provider = createProvider(deps.providerConfig);
        const requestConfig = buildRequestConfig(deps.providerConfig);

        const repoMapText = repoMap
          .map(
            (e) =>
              `${e.filePath} (rank: ${e.rank.toFixed(2)}) — ${e.keySymbols.join(", ")}`,
          )
          .join("\n");

        const filesText = relevantFiles
          .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
          .join("\n\n");

        const userPrompt = `## Objective
${objective}

## Repository Map
${repoMapText}

## Relevant Files
${filesText}

Generate an implementation plan for this objective.`;

        const result = await generateText({
          model: provider(model),
          system: PLANNING_SYSTEM_PROMPT,
          prompt: userPrompt,
          ...requestConfig,
        });

        const plan = result.text;

        // Extract file paths from the plan
        const filePattern = /[-*]\s+\*?\*?Files?\*?\*?:\s*(.+)/gi;
        const estimatedFiles: string[] = [];
        const fileMatches = plan.matchAll(filePattern);
        for (const m of fileMatches) {
          const fileList = m[1];
          const files = fileList
            .split(/[,;]/)
            .map((f) => f.trim().replace(/`/g, "").replace(/\*\*/g, ""))
            .filter((f) => f.length > 0 && f.includes("."));
          estimatedFiles.push(...files);
        }

        return {
          plan,
          estimatedFiles: [...new Set(estimatedFiles)],
        };
      } catch (error) {
        throw ApplicationFailure.retryable(
          `Plan generation failed: ${String(error)}`,
          "model_rate_limited",
        );
      }
    },
  };
}
