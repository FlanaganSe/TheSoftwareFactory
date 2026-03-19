import type {
  DangerousTrigger,
  DangerousWorkflow,
} from "@software-factory/core";
import { parse as parseYaml } from "yaml";

export interface WorkflowScanResult {
  readonly dangerousWorkflows: readonly DangerousWorkflow[];
  readonly scanErrors: readonly string[];
}

/**
 * Scan GitHub Actions workflow files for dangerous trigger patterns.
 *
 * Detects:
 * - `pull_request_target` — runs in base branch context with write
 *   permissions and secrets access (HIGH RISK)
 * - `workflow_run` — can chain from untrusted PR workflows
 *
 * Does NOT parse complex workflow logic — only detects trigger patterns.
 */
export function scanWorkflowContent(
  path: string,
  content: string,
): WorkflowScanResult {
  const dangerousWorkflows: DangerousWorkflow[] = [];
  const scanErrors: string[] = [];

  try {
    const parsed = parseYaml(content);

    if (!parsed || typeof parsed !== "object") {
      return { dangerousWorkflows: [], scanErrors: [] };
    }

    const triggers = extractTriggers(parsed);
    const dangerous: DangerousTrigger[] = [];

    if (triggers.has("pull_request_target")) {
      dangerous.push("pull_request_target");
    }
    if (triggers.has("workflow_run")) {
      dangerous.push("workflow_run");
    }

    if (dangerous.length > 0) {
      dangerousWorkflows.push({ path, triggers: dangerous });
    }
  } catch {
    scanErrors.push(`Failed to parse workflow ${path}: invalid YAML`);
  }

  return { dangerousWorkflows, scanErrors };
}

/**
 * Scan multiple workflow files and aggregate results.
 */
export function scanWorkflows(
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
): WorkflowScanResult {
  const allDangerous: DangerousWorkflow[] = [];
  const allErrors: string[] = [];

  for (const file of files) {
    const result = scanWorkflowContent(file.path, file.content);
    allDangerous.push(...result.dangerousWorkflows);
    allErrors.push(...result.scanErrors);
  }

  return { dangerousWorkflows: allDangerous, scanErrors: allErrors };
}

/**
 * Extract trigger event names from a parsed workflow YAML `on:` field.
 */
function extractTriggers(workflow: Record<string, unknown>): Set<string> {
  const triggers = new Set<string>();
  const on = workflow.on ?? workflow.true;
  // Note: YAML parser may interpret `on:` as boolean `true` key

  if (on === undefined || on === null) {
    return triggers;
  }

  if (typeof on === "string") {
    triggers.add(on);
    return triggers;
  }

  if (Array.isArray(on)) {
    for (const item of on) {
      if (typeof item === "string") {
        triggers.add(item);
      }
    }
    return triggers;
  }

  if (typeof on === "object") {
    for (const key of Object.keys(on as Record<string, unknown>)) {
      triggers.add(key);
    }
  }

  return triggers;
}
