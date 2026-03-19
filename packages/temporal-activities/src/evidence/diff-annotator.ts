import type {
  DiffAnnotation,
  PolicyConfig,
  RiskLevel,
} from "@software-factory/core";
import type { SandboxInstance, SandboxSupervisor } from "../sandbox/index.js";

export interface DiffAnnotatorConfig {
  readonly containerId: string;
  readonly sandbox: SandboxSupervisor;
  readonly baseSha: string;
}

export interface AnnotatedDiffResult {
  readonly annotations: readonly DiffAnnotation[];
  readonly rawPatch: string;
}

interface ParsedHunk {
  readonly file: string;
  readonly hunkIndex: number;
  readonly additions: number;
  readonly deletions: number;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Generate annotated diffs by running git diff in the sandbox.
 * All annotations are deterministic — no LLM involved.
 */
export async function generateAnnotatedDiff(
  config: DiffAnnotatorConfig,
  policies: readonly PolicyConfig[],
  affectedConsumersMap: ReadonlyMap<string, readonly string[]>,
): Promise<AnnotatedDiffResult> {
  const instance: SandboxInstance = {
    containerId: config.containerId,
    phase: "execution",
    labels: {},
  };

  // Run git diff in the sandbox
  const diffResult = await config.sandbox.execCommand(instance, [
    "git",
    "diff",
    `${config.baseSha}..HEAD`,
  ]);

  if (diffResult.isErr()) {
    return { annotations: [], rawPatch: "" };
  }

  const rawPatch = diffResult.value.stdout;
  if (!rawPatch.trim()) {
    return { annotations: [], rawPatch: "" };
  }

  const hunks = parseDiffHunks(rawPatch);
  const annotations: DiffAnnotation[] = hunks.map((hunk) => {
    const riskLevel = classifyRisk(hunk.file, policies);
    const protectedLabel = getProtectedLabel(hunk.file, policies);
    const baseAnnotation = `Modified lines ${hunk.startLine}-${hunk.endLine}: ${hunk.additions} additions, ${hunk.deletions} deletions`;
    const annotation = protectedLabel
      ? `${baseAnnotation} [PROTECTED: ${protectedLabel}]`
      : baseAnnotation;

    return {
      file: hunk.file,
      hunkIndex: hunk.hunkIndex,
      annotation,
      riskLevel,
      affectedConsumers: [...(affectedConsumersMap.get(hunk.file) ?? [])],
    };
  });

  return { annotations, rawPatch };
}

/**
 * Parse unified diff output into structured hunks.
 */
function parseDiffHunks(diffOutput: string): readonly ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  const lines = diffOutput.split("\n");
  let currentFile = "";
  let hunkIndex = -1;

  for (const line of lines) {
    // Detect file header: diff --git a/path b/path
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      if (match) {
        currentFile = match[1];
        hunkIndex = -1;
      }
      continue;
    }

    // Detect hunk header: @@ -start,count +start,count @@
    if (line.startsWith("@@") && currentFile) {
      hunkIndex++;
      const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!hunkMatch) continue;

      const startLine = Number.parseInt(hunkMatch[2], 10);
      const lineCount = hunkMatch[3] ? Number.parseInt(hunkMatch[3], 10) : 1;
      const endLine = startLine + Math.max(lineCount - 1, 0);

      // Count additions and deletions in this hunk
      let additions = 0;
      let deletions = 0;

      // Scan forward until next hunk or file header
      const hunkStartIdx = lines.indexOf(line);
      for (let j = hunkStartIdx + 1; j < lines.length; j++) {
        const hLine = lines[j];
        if (
          hLine.startsWith("diff --git") ||
          hLine.startsWith("@@") ||
          hLine === undefined
        ) {
          break;
        }
        if (hLine.startsWith("+") && !hLine.startsWith("+++")) {
          additions++;
        } else if (hLine.startsWith("-") && !hLine.startsWith("---")) {
          deletions++;
        }
      }

      hunks.push({
        file: currentFile,
        hunkIndex,
        additions,
        deletions,
        startLine,
        endLine,
      });
    }
  }

  return hunks;
}

/**
 * Deterministic risk classification based on file path and policies.
 * No LLM involvement — purely rule-based.
 */
export function classifyRisk(
  filePath: string,
  policies: readonly PolicyConfig[],
): RiskLevel {
  // Protected surface → high
  if (isProtectedPath(filePath, policies)) return "high";
  // Migration/schema files → high
  if (/migration|\.sql|schema/i.test(filePath)) return "high";
  // Security-critical paths → high
  if (/auth|security|crypto|secret|password|token/i.test(filePath))
    return "high";
  // Tests, docs, comments → low (checked before medium to avoid false matches on "api" etc.)
  if (/\.test\.|\.spec\.|__tests__|\.md$|\.txt$/i.test(filePath)) return "low";
  // Public API, config, dependency → medium
  if (/package\.json|go\.mod|Cargo\.toml|requirements\.txt/i.test(filePath))
    return "medium";
  if (/api|route|endpoint|handler/i.test(filePath)) return "medium";
  // Default → medium
  return "medium";
}

function isProtectedPath(
  filePath: string,
  policies: readonly PolicyConfig[],
): boolean {
  for (const policy of policies) {
    if (
      policy.policyType === "edit_protected" ||
      policy.policyType === "edit_deny"
    ) {
      for (const pattern of policy.pathPatterns) {
        // Simple glob check — patterns like "*.lock", "src/auth/**"
        if (simpleGlobMatch(filePath, pattern)) {
          return true;
        }
      }
    }
  }
  return false;
}

function getProtectedLabel(
  filePath: string,
  policies: readonly PolicyConfig[],
): string | undefined {
  for (const policy of policies) {
    if (
      policy.policyType === "edit_protected" ||
      policy.policyType === "edit_deny"
    ) {
      for (const pattern of policy.pathPatterns) {
        if (simpleGlobMatch(filePath, pattern)) {
          return policy.protectionClass ?? "flagged";
        }
      }
    }
  }
  return undefined;
}

/**
 * Simple glob matching for path patterns.
 * Supports * (any segment chars) and ** (any path) wildcards.
 */
function simpleGlobMatch(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}
