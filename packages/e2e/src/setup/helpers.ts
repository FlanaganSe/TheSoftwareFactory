/**
 * Shared test utilities for E2E scenarios.
 */

import type {
  TaskWorkflowInput,
  WorkflowConfig,
} from "@software-factory/temporal-workflows";
import type { Client, WorkflowHandle } from "@temporalio/client";
import { MOCK_TRUSTED_CONTEXT } from "./mock-activities.js";

/** Generate a unique task ID for test isolation. */
export function testTaskId(scenario: string): string {
  return `e2e-${scenario}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Default workflow config for E2E tests — short timeouts. */
export const E2E_WORKFLOW_CONFIG: WorkflowConfig = {
  reviewTimeoutMs: 14_400_000, // 4 hours (time-skipped in tests)
  costBudgetCents: 1000,
  maxImplementationAttempts: 3,
};

/** Build a TaskWorkflowInput with sensible E2E defaults. */
export function makeE2EInput(
  taskId: string,
  overrides: Partial<TaskWorkflowInput> = {},
): TaskWorkflowInput {
  return {
    taskId,
    repoId: "repo-e2e",
    repoOwner: "test-org",
    repoName: "test-repo",
    objective: "E2E test objective",
    autonomyLevel: "L2",
    config: E2E_WORKFLOW_CONFIG,
    trustedContext: MOCK_TRUSTED_CONTEXT,
    ...overrides,
  };
}

/**
 * Poll for a child workflow to reach RUNNING state, then signal it.
 *
 * Uses string signal name to avoid Temporal generic constraints.
 */
export async function signalChildWhenRunning(
  client: Client,
  childId: string,
  signal: { name: string },
  payload: Record<string, unknown>,
  timeoutMs = 16_000,
): Promise<void> {
  const handle = client.workflow.getHandle(childId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const desc = await handle.describe();
      if (desc.status.name === "RUNNING") {
        await handle.signal(signal.name, payload);
        return;
      }
    } catch {
      // Child not started yet
    }
  }
  throw new Error(
    `Child workflow ${childId} never reached RUNNING state within ${timeoutMs}ms`,
  );
}

/**
 * Poll a parent workflow's query until it returns an expected value.
 */
export async function waitForQuery<T>(
  handle: WorkflowHandle,
  query: { name: string },
  predicate: (value: T) => boolean,
  timeoutMs = 16_000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const value = (await handle.query(query.name)) as T;
      if (predicate(value)) return value;
    } catch {
      // Query might not be available yet
    }
  }
  throw new Error(
    `Query ${query.name} never satisfied predicate within ${timeoutMs}ms`,
  );
}
