/**
 * Setup phase — environment provisioning.
 * Loads setup contract from TrustedBaseContext, provisions a Docker sandbox,
 * and acquires a branch lease for the candidate branch.
 */

import type { SetupContract, TrustedBaseContext } from "@software-factory/core";
import {
  ApplicationFailure,
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type {
  SafetyActivities,
  SandboxActivities,
  SandboxInstanceRef,
  TaskActivities,
} from "../activity-types.js";

const safetyActivities = proxyActivities<SafetyActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const sandboxActivities = proxyActivities<SandboxActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 2 },
});

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

// Signal for human approval of suggested setup contract
const approveSetupSignal =
  defineSignal<[{ contract: SetupContract; actor: string }]>("approve_setup");

export interface SetupInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly repoPath: string;
  readonly repoSlug: string;
  readonly trustedContext: TrustedBaseContext;
}

export interface SetupResult {
  readonly taskId: string;
  readonly sandboxInstance: SandboxInstanceRef;
  readonly branchLease: { branch: string; acquired: boolean };
  readonly setupContractUsed: SetupContract;
}

export async function setupPhase(input: SetupInput): Promise<SetupResult> {
  // Step 1: Check kill switch
  const killCheck = await safetyActivities.checkKillSwitch(input.taskId);
  if (killCheck.killed) {
    throw ApplicationFailure.nonRetryable(
      `Kill switch active: ${killCheck.scope}`,
    );
  }

  // Step 2: Load setup contract from TrustedBaseContext
  let setupContract = input.trustedContext.setupContract;

  // Step 3: If no setup contract, generate a suggestion and wait for human approval
  if (setupContract === null) {
    // Generate a basic suggestion
    const suggestedContract: SetupContract = {
      version: "1",
      image: "node:22-slim",
      setup: ["npm install || yarn install || pnpm install || true"],
      maintenance: [],
      secrets: { setup_only: [], runtime: [], per_tool: [] },
      health_check: ["node --version"],
    };

    // Transition to paused while waiting for human input
    await taskActivities.transitionTaskState(input.taskId, "paused", "system", {
      phase: "setup",
      action: "awaiting_setup_approval",
      suggestedContract,
    });

    // Wait for human approval signal
    let approvedContract: SetupContract | null = null;
    setHandler(approveSetupSignal, ({ contract }) => {
      approvedContract = contract;
    });

    await condition(() => approvedContract !== null);
    setupContract = approvedContract as unknown as SetupContract;

    // Resume from paused
    await taskActivities.transitionTaskState(
      input.taskId,
      "in_progress",
      "system",
      { phase: "setup", action: "setup_approved" },
    );
  }

  // Step 4: Provision sandbox
  const sandboxInstance = await sandboxActivities.provisionSandbox({
    repoPath: input.repoPath,
    setupContract,
    taskId: input.taskId,
    repoSlug: input.repoSlug,
    secrets: { setupOnly: {}, runtime: {}, perTool: {} },
  });

  // Step 5: Acquire branch lease
  const branchName = `factory/${input.taskId}`;
  const lease = await safetyActivities.acquireBranchLease(
    branchName,
    input.taskId,
    3600,
  );

  if (!lease.acquired) {
    // Cleanup sandbox since we can't proceed
    await sandboxActivities.destroySandbox(sandboxInstance.containerId);
    throw ApplicationFailure.nonRetryable(
      `Branch lease for ${branchName} held by ${lease.existingOwner ?? "unknown"}`,
    );
  }

  return {
    taskId: input.taskId,
    sandboxInstance,
    branchLease: { branch: branchName, acquired: true },
    setupContractUsed: setupContract,
  };
}
