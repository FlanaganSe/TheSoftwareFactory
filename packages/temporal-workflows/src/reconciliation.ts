/**
 * Reconciliation workflow — runs as a Temporal scheduled workflow.
 *
 * Periodically syncs all active GitHub resources to catch drift.
 * Registered as a Temporal Schedule on worker startup (idempotent).
 */

import { proxyActivities } from "@temporalio/workflow";
import type { BroadReconcilerActivities } from "./activity-types.js";

const reconciler = proxyActivities<BroadReconcilerActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
  },
});

export async function reconciliationWorkflow(): Promise<void> {
  await reconciler.reconcileAllResources();
}
