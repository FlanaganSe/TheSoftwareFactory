/**
 * Parent orchestrator workflow.
 * Manages the entire task lifecycle by spawning child phase workflows
 * and handling signals/queries at the top level.
 */

import type {
  CapabilitySnapshot,
  TaskState,
  TrustedBaseContext,
} from "@software-factory/core";
import {
  CancellationScope,
  allHandlersFinished,
  condition,
  continueAsNew,
  executeChild,
  patched,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import { Mutex } from "async-mutex";

import type { ImplementResult } from "./phases/implement.js";
import type { SetupResult } from "./phases/setup.js";
import type { UnderstandResult } from "./phases/understand.js";
import type { ValidateResult } from "./phases/validate.js";
import {
  approveSignal,
  changesRequestedSignal,
  clarifyResponseSignal,
  costOverrideSignal,
  getPhaseQuery,
  getProgressQuery,
  getStateQuery,
  killSignal,
  rejectSignal,
  resumeSignal,
} from "./signals.js";
import type { WorkflowProgress } from "./signals.js";

// ─── Workflow Input / Config ───

export interface WorkflowConfig {
  readonly reviewTimeoutMs: number;
  readonly costBudgetCents: number;
  readonly maxImplementationAttempts: number;
}

export interface TaskWorkflowInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly objective: string;
  readonly autonomyLevel: "L0" | "L1" | "L2";
  readonly config: WorkflowConfig;
  readonly resumeFromPhase?: string;
  readonly attemptNumber?: number;
  readonly phaseIteration?: number;
  // Persisted state for Continue-As-New
  readonly trustedContext?: TrustedBaseContext;
  readonly capabilitySnapshot?: CapabilitySnapshot;
  readonly setupResult?: SetupResult;
  readonly implementResult?: ImplementResult;
  readonly validateResult?: ValidateResult;
}

// ─── Phase ordering ───

const PHASE_ORDER = [
  "intake",
  "understand",
  "plan",
  "setup",
  "implement",
  "validate",
  "evidence",
  "review",
  "pr_creation",
  "pr_tracking",
  "learn",
] as const;

type PhaseName = (typeof PHASE_ORDER)[number];

// ─── Orchestrator ───

export async function taskOrchestrator(
  input: TaskWorkflowInput,
): Promise<void> {
  const mutex = new Mutex();

  // ─── Mutable workflow state ───
  let killed = false;
  let killInfo: { actor: string; reason: string } | undefined;
  let currentPhase: PhaseName = "intake";
  let currentState: TaskState = "created";
  const attemptNumber = input.attemptNumber ?? 1;
  let phaseIteration = input.phaseIteration ?? 0;
  let costBudgetCents = input.config.costBudgetCents;
  let costCents = 0;
  const startedAt = new Date().toISOString();
  let lastActivityAt = startedAt;

  // Inter-phase data (persisted for Continue-As-New)
  let trustedContext: TrustedBaseContext | undefined = input.trustedContext;
  let capabilitySnapshot: CapabilitySnapshot | undefined =
    input.capabilitySnapshot;
  let understandResult: UnderstandResult | undefined;
  let planText: string | undefined;
  let setupResult: SetupResult | undefined = input.setupResult;
  let implementResult: ImplementResult | undefined = input.implementResult;
  let validateResult: ValidateResult | undefined = input.validateResult;
  let evidenceLocator:
    | {
        readonly taskId: string;
        readonly bundleId: string;
        readonly artifactPrefix: string;
      }
    | undefined;

  // ─── Signal Handlers ───

  setHandler(killSignal, async ({ actor, reason }) => {
    const release = await mutex.acquire();
    try {
      killed = true;
      killInfo = { actor, reason: reason ?? "" };
    } finally {
      release();
    }
  });

  // These handlers exist at the parent level to prevent "unhandled signal" warnings.
  // Actual signal processing for approve/reject/changes_requested/clarify happens
  // in child workflows (review, clarify, implement) which register their own handlers.
  // The parent tracks lastActivityAt for progress reporting.

  setHandler(approveSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(rejectSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(changesRequestedSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(resumeSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(clarifyResponseSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  // costOverrideSignal is handled at the parent level since it modifies
  // the workflow-wide budget, not a phase-specific concern.
  setHandler(costOverrideSignal, async ({ newBudgetCents }) => {
    const release = await mutex.acquire();
    try {
      costBudgetCents = newBudgetCents;
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  // ─── Query Handlers ───

  setHandler(getStateQuery, (): TaskState => currentState);

  setHandler(
    getProgressQuery,
    (): WorkflowProgress => ({
      taskId: input.taskId,
      currentPhase,
      state: currentState,
      attemptNumber,
      phaseIteration,
      startedAt,
      lastActivityAt,
      costCents,
      costBudgetCents,
    }),
  );

  setHandler(getPhaseQuery, (): string => currentPhase);

  // ─── Determine starting phase ───
  let startIdx = 0;
  if (input.resumeFromPhase) {
    const idx = PHASE_ORDER.indexOf(input.resumeFromPhase as PhaseName);
    if (idx >= 0) {
      startIdx = idx;
    }
  }

  // ─── Phase execution loop ───

  for (let i = startIdx; i < PHASE_ORDER.length; i++) {
    // Check kill flag between phases
    if (killed) {
      break;
    }

    // Check Continue-As-New triggers
    const info = workflowInfo();
    if (info.continueAsNewSuggested || info.historyLength > 10_000) {
      await condition(allHandlersFinished);
      await continueAsNew<typeof taskOrchestrator>({
        ...input,
        resumeFromPhase: PHASE_ORDER[i],
        attemptNumber,
        phaseIteration,
        trustedContext,
        capabilitySnapshot,
        setupResult,
        implementResult,
        validateResult,
      });
    }

    const phase = PHASE_ORDER[i];
    currentPhase = phase;
    lastActivityAt = new Date().toISOString();

    // Phases that repeat on changes_requested need iteration in the ID
    // to avoid Temporal's workflow ID uniqueness constraint
    const needsIteration =
      phase === "implement" ||
      phase === "validate" ||
      phase === "evidence" ||
      phase === "review";
    const childId = needsIteration
      ? `task-${input.taskId}-${phase}-${phaseIteration}`
      : `task-${input.taskId}-${phase}`;

    if (phase === "intake") {
      const intakeResult = await executeChild("intakePhase", {
        workflowId: childId,
        args: [
          {
            taskId: input.taskId,
            repoId: input.repoId,
            objective: input.objective,
            autonomyLevel: input.autonomyLevel,
            createdBy: "system",
          },
        ],
      });

      currentState = intakeResult.state;

      // Handle clarification if needed
      if (intakeResult.needsClarification) {
        if (killed) break;

        const clarifyResult = await executeChild("clarifyPhase", {
          workflowId: `task-${input.taskId}-clarify`,
          args: [
            {
              taskId: intakeResult.taskId,
              objective: input.objective,
            },
          ],
        });
        currentState = clarifyResult.state;
      }
    } else if (phase === "understand") {
      currentState = "in_progress";

      if (patched("m12-real-understand")) {
        // Capture TrustedBaseContext if not already done
        // (This is done as a GitHub activity in the understand phase context)
        const repoPath = `/tmp/factory/${input.taskId}/repo`;

        const result = await executeChild("understandPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              objective: input.objective,
              repoOwner: input.repoOwner ?? "",
              repoName: input.repoName ?? "",
              repoPath,
              baseSha: trustedContext?.baseSha ?? "HEAD",
            },
          ],
        });

        understandResult = result;
        capabilitySnapshot = result.capabilitySnapshot;
        // Capture trustedContext from understand phase if not already set
        if (!trustedContext) {
          trustedContext = result.trustedContext;
        }
      } else {
        await executeChild("understandPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              objective: input.objective,
              baseSha: "stub-base-sha",
            },
          ],
        });
      }
    } else if (phase === "plan") {
      if (patched("m12-real-plan")) {
        const defaultModel = "anthropic/claude-sonnet-4-20250514";
        const result = await executeChild("planPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              objective: input.objective,
              repoMap: understandResult?.repoMap ?? [],
              relevantFiles: [],
              model: defaultModel,
            },
          ],
        });

        planText = result.plan;
      } else {
        await executeChild("planPhase", {
          workflowId: childId,
          args: [{ taskId: input.taskId, objective: input.objective }],
        });
      }
    } else if (phase === "setup") {
      if (patched("m12-real-setup")) {
        const repoPath = `/tmp/factory/${input.taskId}/repo`;
        const repoSlug = `${input.repoOwner ?? ""}/${input.repoName ?? ""}`;

        const defaultContext: TrustedBaseContext = trustedContext ?? {
          baseSha: "HEAD",
          setupContract: null,
          policySnapshot: [],
          behavioralControlFiles: {},
          validationCommandSources: [],
          capturedAt: new Date().toISOString(),
        };

        setupResult = await executeChild("setupPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              repoPath,
              repoSlug,
              trustedContext: defaultContext,
            },
          ],
        });
      } else {
        await executeChild("setupPhase", {
          workflowId: childId,
          args: [{ taskId: input.taskId }],
        });
      }
    } else if (phase === "implement") {
      if (patched("m12-real-implement")) {
        const branchName = `factory/${input.taskId}`;
        const defaultModel = "anthropic/claude-sonnet-4-20250514";
        const baseSha = trustedContext?.baseSha ?? "HEAD";

        const result = await executeChild("implementPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              objective: input.objective,
              plan: planText ?? input.objective,
              iteration: phaseIteration,
              sandbox: setupResult?.sandboxInstance ?? {
                containerId: "",
                phase: "execution",
                labels: {},
              },
              repoOwner: input.repoOwner ?? "",
              repoName: input.repoName ?? "",
              branchName,
              baseSha,
              model: defaultModel,
              budgetCents: costBudgetCents,
              autonomyLevel: input.autonomyLevel,
            },
          ],
        });

        implementResult = result;
        costCents += result.agentResult.totalCostCents;
      } else {
        await executeChild("implementPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              objective: input.objective,
              plan: "stub",
              iteration: phaseIteration,
            },
          ],
        });
      }
    } else if (phase === "validate") {
      if (patched("m13-real-validate")) {
        const defaultContext: TrustedBaseContext = trustedContext ?? {
          baseSha: "HEAD",
          setupContract: null,
          policySnapshot: [],
          behavioralControlFiles: {},
          validationCommandSources: [],
          capturedAt: new Date().toISOString(),
        };

        validateResult = await executeChild("validatePhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              containerId: setupResult?.sandboxInstance?.containerId ?? "",
              trustedContext: defaultContext,
              changedFiles: implementResult?.agentResult?.filesModified ?? [],
              indexVersionId: understandResult?.indexVersionId ?? "",
              policies: defaultContext.policySnapshot,
            },
          ],
        });
      } else {
        await executeChild("validatePhase", {
          workflowId: childId,
          args: [{ taskId: input.taskId }],
        });
      }
    } else if (phase === "evidence") {
      if (patched("m14-real-evidence")) {
        const defaultContext: TrustedBaseContext = trustedContext ?? {
          baseSha: "HEAD",
          setupContract: null,
          policySnapshot: [],
          behavioralControlFiles: {},
          validationCommandSources: [],
          capturedAt: new Date().toISOString(),
        };

        const evidenceResult = await executeChild("evidencePhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              objective: input.objective,
              attemptNumber,
              baseSha: defaultContext.baseSha,
              headSha: implementResult?.headSha ?? defaultContext.baseSha,
              mergeBaseSha: defaultContext.baseSha,
              containerId: setupResult?.sandboxInstance?.containerId ?? "",
              validationResult: validateResult?.validationResult ?? {
                testResults: {
                  passed: 0,
                  failed: 0,
                  skipped: 0,
                },
                lintResults: { errorCount: 0, warningCount: 0 },
                securityScanResults: {
                  vulnerabilities: [],
                  totalFindings: 0,
                  criticalCount: 0,
                  highCount: 0,
                },
                blastRadius: { files: 0, packages: 0 },
                protectedSurfaceEdits: [],
                migrationImpact: {
                  hasMigrations: false,
                  migrationFiles: [],
                  schemaChanges: [],
                },
                revertabilityClass: "clean_revert",
                commandsRun: [],
              },
              agentResult: {
                filesModified:
                  implementResult?.agentResult?.filesModified ?? [],
                totalCostCents:
                  implementResult?.agentResult?.totalCostCents ?? 0,
              },
              capabilitySnapshot: {
                requiredStatusChecks:
                  capabilitySnapshot?.requiredStatusChecks ?? [],
              },
              changedFiles: implementResult?.agentResult?.filesModified ?? [],
              policies: defaultContext.policySnapshot,
              codeownersEntries: capabilitySnapshot?.codeowners?.entries ?? [],
              indexVersionId: understandResult?.indexVersionId ?? "",
            },
          ],
        });

        evidenceLocator = evidenceResult.locator;
        currentState = "evidence_ready";
      } else {
        await executeChild("evidencePhase", {
          workflowId: childId,
          args: [{ taskId: input.taskId }],
        });
      }
    } else if (phase === "review") {
      const reviewResult = await executeChild("reviewPhase", {
        workflowId: childId,
        args: [
          {
            taskId: input.taskId,
            reviewTimeoutMs: input.config.reviewTimeoutMs,
          },
        ],
      });

      if (reviewResult.outcome === "approved") {
        currentState = "approved";
        // Continue to pr_creation
      } else if (reviewResult.outcome === "changes_requested") {
        // Loop back to implement
        phaseIteration++;
        if (phaseIteration < input.config.maxImplementationAttempts) {
          // Jump back to implement phase
          i = PHASE_ORDER.indexOf("implement") - 1; // -1 because loop increments
          currentState = "changes_requested";
          continue;
        }
        // Max attempts exceeded — fail
        currentState = "failed";
        break;
      } else if (reviewResult.outcome === "rejected") {
        currentState = "failed";
        break;
      } else if (reviewResult.outcome === "timed_out") {
        currentState = "failed";
        break;
      }
    } else if (phase === "pr_creation") {
      if (patched("m16-real-pr-creation")) {
        const defaultContext: TrustedBaseContext = trustedContext ?? {
          baseSha: "HEAD",
          setupContract: null,
          policySnapshot: [],
          behavioralControlFiles: {},
          validationCommandSources: [],
          capturedAt: new Date().toISOString(),
        };

        const vr = validateResult?.validationResult;
        const validationData = {
          testResults: vr?.testResults ?? { passed: 0, failed: 0, skipped: 0 },
          lintResults: vr?.lintResults ?? { errorCount: 0, warningCount: 0 },
          securityScanResults: {
            vulnerabilities: [] as {
              severity: string;
              description: string;
              file?: string;
              line?: number;
              id: string;
            }[],
            criticalCount: vr?.criticalVulnerabilities ?? 0,
            highCount: 0,
          },
          blastRadius: vr?.blastRadius ?? { files: 0, packages: 0 },
          revertabilityClass: vr?.revertabilityClass ?? "clean_revert",
        };

        const prResult = await executeChild("prCreationPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              owner: input.repoOwner,
              repo: input.repoName,
              candidateBranch: `factory/${input.taskId}`,
              baseBranch:
                defaultContext.baseSha === "HEAD"
                  ? "main"
                  : (capabilitySnapshot?.defaultBranch ?? "main"),
              objective: input.objective,
              headSha: implementResult?.headSha ?? defaultContext.baseSha,
              attemptNumber,
              evidenceLocator: evidenceLocator ?? {
                taskId: input.taskId,
                attemptNumber,
                bundleId: "",
                artifactPrefix: "",
                evidenceJsonKey: "",
                manifestKey: "",
                diffPatchKey: "",
                createdAt: new Date().toISOString(),
              },
              riskSummary: {
                hardBlockers: [],
                softConcerns: [],
                humanJudgmentRequired: [],
                informational: [],
              },
              validationPassed:
                validateResult?.validationResult?.passed ?? false,
              validationResult: validationData,
              capabilitySnapshot: capabilitySnapshot ?? {
                repoId: input.repoId,
                capturedAt: new Date().toISOString(),
                sourceRevision: "HEAD",
                defaultBranch: "main",
                visibility: "private" as const,
                isArchived: false,
                isFork: false,
                hasWiki: false,
                hasProjects: false,
                branchProtection: null,
                rulesets: [],
                hasInheritedRulesets: false,
                codeowners: null,
                mergeQueue: null,
                allowedMergeStrategies: ["squash" as const],
                requiredStatusChecks: [],
                requiredWorkflows: [],
                requiresSignedCommits: false,
                requiresLinearHistory: false,
                requiresConversationResolution: false,
                dismissesStaleReviews: false,
                requiredReviewCount: 0,
                requiresCodeOwnerReview: false,
                lastPusherCannotApprove: false,
                hasPullRequestTargetWorkflows: false,
                pullRequestTargetWorkflowPaths: [],
                pushRestrictions: null,
                bypassActors: [],
                environments: [],
                repoClass: "C" as const,
                supportedByFactory: true,
                unsupportedReasons: [],
                warnings: [],
              },
              evidenceBundleId: evidenceLocator?.bundleId,
              protectedSurfaceEdits: vr?.protectedSurfaceEdits,
              changedFiles: implementResult?.agentResult?.filesModified?.map(
                (f: string) => ({ path: f }),
              ),
              ownersImpacted: capabilitySnapshot?.codeowners?.entries?.map(
                (e) => e.owners.join(", "),
              ),
            },
          ],
        });
        currentState = "pr_created";
        void prResult;
      } else {
        await executeChild("prCreationPhase", {
          workflowId: childId,
          args: [{ taskId: input.taskId }],
        });
        currentState = "pr_created";
      }
    } else if (phase === "pr_tracking") {
      await executeChild("prTrackingPhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId, prNumber: 0 }],
      });
      currentState = "merged";
    } else if (phase === "learn") {
      await executeChild("learnPhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId }],
      });
    }
  }

  // ─── Cleanup on kill ───

  if (killed && killInfo) {
    await CancellationScope.nonCancellable(async () => {
      currentState = "cancelled";

      // Release branch lease if setup was completed
      if (setupResult?.branchLease) {
        try {
          // We can't call activities here during cancellation cleanup
          // The branch lease TTL will auto-expire
          void setupResult;
        } catch {
          // Best-effort cleanup
        }
      }

      void killInfo;
    });
  }

  // Drain all handlers before completing
  await condition(allHandlersFinished);
}
