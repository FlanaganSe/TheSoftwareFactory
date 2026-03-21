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
  ContinueAsNew,
  allHandlersFinished,
  condition,
  continueAsNew,
  executeChild,
  patched,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import { Mutex } from "async-mutex";

import type {
  EvidenceLocatorData,
  EventActivities,
  MergeActivities,
  SafetyActivities,
  SandboxActivities,
  TaskActivities,
} from "./activity-types.js";
import type { ImplementResult } from "./phases/implement.js";
import type { LearnFullResult } from "./phases/learn.js";
import type { PrCreationFullResult } from "./phases/pr-creation.js";
import type { PrTrackingResult } from "./phases/pr-tracking.js";
import type { SetupResult } from "./phases/setup.js";
import type { UnderstandResult } from "./phases/understand.js";
import type { ValidateResult } from "./phases/validate.js";
import {
  approveSignal,
  changesRequestedSignal,
  checkCompleteSignal,
  clarifyResponseSignal,
  costOverrideSignal,
  getPhaseQuery,
  getProgressQuery,
  getStateQuery,
  killSignal,
  mergeQueueUpdateSignal,
  prClosedSignal,
  prReviewSignal,
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
  readonly understandResult?: UnderstandResult;
  readonly planText?: string;
  readonly evidenceLocator?: EvidenceLocatorData;
  readonly prResult?: PrCreationFullResult;
  readonly addressingFeedback?: boolean;
  readonly mergedSha?: string;
  readonly costCents?: number;
  readonly startedAt?: string;
  readonly costBudgetCentsOverride?: number;
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

// ─── Merge method selection ───

function selectMergeMethod(
  cap: CapabilitySnapshot | undefined,
): "merge" | "squash" | "rebase" {
  const allowed = cap?.allowedMergeStrategies ?? ["squash"];
  if (allowed.includes("squash")) return "squash";
  if (allowed.includes("merge")) return "merge";
  if (allowed.includes("rebase")) return "rebase";
  return "squash"; // fallback
}

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
  let costBudgetCents =
    input.costBudgetCentsOverride ?? input.config.costBudgetCents;
  let costCents = input.costCents ?? 0;
  const startedAt = input.startedAt ?? new Date().toISOString();
  let lastActivityAt = startedAt;
  let mergedSha: string | undefined = input.mergedSha;

  // Inter-phase data (persisted for Continue-As-New)
  let trustedContext: TrustedBaseContext | undefined = input.trustedContext;
  let capabilitySnapshot: CapabilitySnapshot | undefined =
    input.capabilitySnapshot;
  let understandResult: UnderstandResult | undefined = input.understandResult;
  let planText: string | undefined = input.planText;
  let setupResult: SetupResult | undefined = input.setupResult;
  let implementResult: ImplementResult | undefined = input.implementResult;
  let validateResult: ValidateResult | undefined = input.validateResult;
  let evidenceLocator: EvidenceLocatorData | undefined = input.evidenceLocator;
  let prResult: PrCreationFullResult | undefined = input.prResult;
  let addressingFeedback = input.addressingFeedback ?? false;

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

  // GitHub lifecycle signals — forwarded to child pr_tracking workflow.
  // Parent handlers prevent "unhandled signal" warnings and track activity.
  setHandler(prReviewSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(checkCompleteSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(prClosedSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(mergeQueueUpdateSignal, async () => {
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

  // ─── Event publishing (fire-and-forget, never blocks pipeline) ───

  const eventActivities = proxyActivities<EventActivities>({
    startToCloseTimeout: "5s",
    retry: { maximumAttempts: 1 },
  });

  async function emitPhaseEvent(
    type:
      | "phase_started"
      | "phase_completed"
      | "task_state_changed"
      | "task_error",
    phase: PhaseName,
  ): Promise<void> {
    if (!patched("observability-phase-events")) return;
    try {
      await eventActivities.publishPhaseEvent({
        type,
        taskId: input.taskId,
        phase,
        state: currentState,
        attemptNumber,
        phaseIteration,
        costCents,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Fire-and-forget: never fail the pipeline for event publishing
    }
  }

  // ─── Determine starting phase ───
  let startIdx = 0;
  if (input.resumeFromPhase) {
    const idx = PHASE_ORDER.indexOf(input.resumeFromPhase as PhaseName);
    if (idx >= 0) {
      startIdx = idx;
    }
  }

  // ─── Phase execution loop ───

  let failureReason: string | undefined;

  try {
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
          understandResult,
          planText,
          evidenceLocator,
          prResult,
          addressingFeedback,
          mergedSha,
          costCents,
          startedAt,
          costBudgetCentsOverride: costBudgetCents,
        });
      }

      const phase = PHASE_ORDER[i];
      currentPhase = phase;
      lastActivityAt = new Date().toISOString();

      await emitPhaseEvent("phase_started", phase);

      // Phases that repeat on changes_requested need iteration in the ID
      // to avoid Temporal's workflow ID uniqueness constraint
      const needsIteration =
        phase === "implement" ||
        phase === "validate" ||
        phase === "evidence" ||
        phase === "review" ||
        phase === "pr_tracking";
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
      } else if (phase === "plan") {
        const defaultModel = "openai/gpt-5.4-nano";
        const planResult = await executeChild("planPhase", {
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

        planText = planResult.plan;
      } else if (phase === "setup") {
        const setupRepoPath = `/tmp/factory/${input.taskId}/repo`;
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
              repoPath: setupRepoPath,
              repoSlug,
              trustedContext: defaultContext,
              autonomyLevel: input.autonomyLevel,
            },
          ],
        });
      } else if (phase === "implement") {
        const branchName = `factory/${input.taskId}`;
        const implModel = "openai/gpt-5.4-nano";
        const baseSha = trustedContext?.baseSha ?? "HEAD";

        const implResult = await executeChild("implementPhase", {
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
              model: implModel,
              budgetCents: costBudgetCents,
              autonomyLevel: input.autonomyLevel,
              repoMap: understandResult?.repoMap ?? [],
              policies: trustedContext?.policySnapshot ?? [],
            },
          ],
        });

        implementResult = implResult;
        costCents += implResult.agentResult.totalCostCents;
      } else if (phase === "validate") {
        const validateContext: TrustedBaseContext = trustedContext ?? {
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
              trustedContext: validateContext,
              changedFiles: implementResult?.agentResult?.filesModified ?? [],
              indexVersionId: understandResult?.indexVersionId ?? "",
              policies: validateContext.policySnapshot,
            },
          ],
        });
      } else if (phase === "evidence") {
        const evidenceContext: TrustedBaseContext = trustedContext ?? {
          baseSha: "HEAD",
          setupContract: null,
          policySnapshot: [],
          behavioralControlFiles: {},
          validationCommandSources: [],
          capturedAt: new Date().toISOString(),
        };

        // Map validate-phase output to evidence-phase input shape.
        // The validate phase returns a flat structure; the evidence generator
        // expects a nested one with full security/migration objects.
        const vr = validateResult?.validationResult;
        const evidenceValidation = {
          testResults: vr?.testResults ?? { passed: 0, failed: 0, skipped: 0 },
          lintResults: vr?.lintResults ?? { errorCount: 0, warningCount: 0 },
          securityScanResults: {
            // Individual vulnerability details are not yet surfaced by the validate phase.
            // The validate phase only provides aggregate counts (securityFindings, criticalVulnerabilities).
            vulnerabilities: [] as readonly {
              id: string;
              severity: "critical" | "high" | "medium" | "low";
              description: string;
            }[],
            totalFindings: vr?.securityFindings ?? 0,
            criticalCount: vr?.criticalVulnerabilities ?? 0,
            highCount: 0,
          },
          blastRadius: vr?.blastRadius ?? { files: 0, packages: 0 },
          protectedSurfaceEdits: vr?.protectedSurfaceEdits ?? [],
          migrationImpact: {
            hasMigrations: vr?.hasMigrations ?? false,
            // Individual migration files and schema changes are not yet surfaced by the validate phase.
            // The validate phase only provides the hasMigrations boolean flag.
            migrationFiles: [] as readonly string[],
            schemaChanges: [] as readonly string[],
          },
          revertabilityClass: (vr?.revertabilityClass ?? "clean_revert") as
            | "clean_revert"
            | "revert_with_migration"
            | "non_revertable",
          // Individual command records are tracked at the activity level, not surfaced through the validate phase result.
          commandsRun: [] as readonly {
            command: string;
            exitCode: number;
            durationMs: number;
          }[],
          validatorControlFileEdits: vr?.validatorControlFileEdits,
        };

        const evidenceResult = await executeChild("evidencePhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              objective: input.objective,
              attemptNumber,
              baseSha: evidenceContext.baseSha,
              headSha: implementResult?.headSha ?? evidenceContext.baseSha,
              mergeBaseSha: evidenceContext.baseSha,
              containerId: setupResult?.sandboxInstance?.containerId ?? "",
              validationResult: evidenceValidation,
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
              policies: evidenceContext.policySnapshot,
              codeownersEntries: capabilitySnapshot?.codeowners?.entries ?? [],
              indexVersionId: understandResult?.indexVersionId ?? "",
            },
          ],
        });

        evidenceLocator = evidenceResult.locator;
        currentState = "evidence_ready";
      } else if (phase === "review") {
        if (addressingFeedback) {
          // Skip internal review when re-entering after external review feedback.
          // The PR already exists and the external reviewer is tracking it.
          currentState = "approved";
        } else if (patched("l2-auto-approve") && input.autonomyLevel === "L2") {
          // L2 (full autonomy): auto-approve without human review
          currentState = "approved";
        } else {
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
        }
      } else if (phase === "pr_creation") {
        if (addressingFeedback) {
          // Skip PR creation on feedback loop — PR already exists.
          // The implement phase pushed new commits to the existing branch.
          currentState = "pr_created";
        } else {
          const prContext: TrustedBaseContext = trustedContext ?? {
            baseSha: "HEAD",
            setupContract: null,
            policySnapshot: [],
            behavioralControlFiles: {},
            validationCommandSources: [],
            capturedAt: new Date().toISOString(),
          };

          const vr = validateResult?.validationResult;
          const validationData = {
            testResults: vr?.testResults ?? {
              passed: 0,
              failed: 0,
              skipped: 0,
            },
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

          prResult = (await executeChild("prCreationPhase", {
            workflowId: childId,
            args: [
              {
                taskId: input.taskId,
                repoId: input.repoId,
                owner: input.repoOwner,
                repo: input.repoName,
                candidateBranch: `factory/${input.taskId}`,
                baseBranch:
                  prContext.baseSha === "HEAD"
                    ? "main"
                    : (capabilitySnapshot?.defaultBranch ?? "main"),
                objective: input.objective,
                headSha: implementResult?.headSha ?? prContext.baseSha,
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
          })) as PrCreationFullResult;
          currentState = "pr_created";
        }
      } else if (phase === "pr_tracking") {
        const trackingResult = (await executeChild("prTrackingPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              owner: input.repoOwner,
              repo: input.repoName,
              prNumber: prResult?.prNumber ?? 0,
              prNodeId: prResult?.prNodeId ?? "",
              headSha: implementResult?.headSha ?? "",
              baseBranch: capabilitySnapshot?.defaultBranch ?? "main",
              requiredChecks:
                capabilitySnapshot?.requiredStatusChecks?.map(
                  (c) => c.context,
                ) ?? [],
              requiredReviewCount: capabilitySnapshot?.requiredReviewCount ?? 0,
              requiresCodeOwnerReview:
                capabilitySnapshot?.requiresCodeOwnerReview ?? false,
            },
          ],
        })) as PrTrackingResult;

        if (trackingResult.outcome === "merge_ready") {
          currentState = "merge_ready";

          // ─── MERGE EXECUTION ───
          const mergeActivities = proxyActivities<MergeActivities>({
            startToCloseTimeout: "60s",
            retry: { maximumAttempts: 2 },
          });

          const taskActivities = proxyActivities<
            Pick<TaskActivities, "transitionTaskState">
          >({
            startToCloseTimeout: "30s",
            retry: { maximumAttempts: 3 },
          });

          // Pre-merge safety check
          const precheck = await mergeActivities.checkMergeReadiness({
            owner: input.repoOwner,
            repo: input.repoName,
            prNumber: prResult?.prNumber ?? 0,
            expectedHeadSha: implementResult?.headSha ?? "",
            requiredChecks:
              capabilitySnapshot?.requiredStatusChecks?.map((c) => c.context) ??
              [],
            requiredReviewCount: capabilitySnapshot?.requiredReviewCount ?? 0,
          });

          if (!precheck.ready) {
            await taskActivities.transitionTaskState(
              input.taskId,
              "failed",
              "system",
              { phase: "merge", blockers: precheck.blockers },
            );
            currentState = "failed";
            break;
          }

          // Execute merge
          const prNumber = prResult?.prNumber ?? 0;
          const mergeResult = await mergeActivities.mergePullRequest({
            owner: input.repoOwner,
            repo: input.repoName,
            prNumber,
            prNodeId: prResult?.prNodeId ?? "",
            expectedHeadSha: implementResult?.headSha ?? "",
            mergeMethod: selectMergeMethod(capabilitySnapshot),
            commitTitle: `factory: ${input.objective.slice(0, 60)} (#${prNumber})`,
            useMergeQueue: capabilitySnapshot?.mergeQueue?.enabled ?? false,
            taskId: input.taskId,
          });

          if (mergeResult.merged) {
            mergedSha = mergeResult.sha;
            currentState = "merged";
          } else if (mergeResult.mergeQueuePosition != null) {
            // Enqueued to merge queue — treat as optimistic success
            currentState = "merged";
          } else {
            await taskActivities.transitionTaskState(
              input.taskId,
              "failed",
              "system",
              { phase: "merge", reason: mergeResult.message },
            );
            currentState = "failed";
            break;
          }

          // Post-merge cleanup (non-cancellable)
          await CancellationScope.nonCancellable(async () => {
            try {
              await mergeActivities.deleteBranch(
                input.repoOwner,
                input.repoName,
                `factory/${input.taskId}`,
              );
            } catch {
              // best-effort
            }
          });
          // Continue to learn phase
        } else if (trackingResult.outcome === "changes_requested") {
          // External review feedback → loop back to implement
          addressingFeedback = true;
          phaseIteration++;
          if (phaseIteration < input.config.maxImplementationAttempts) {
            i = PHASE_ORDER.indexOf("implement") - 1;
            currentState = "changes_requested";
            continue;
          }
          currentState = "failed";
          break;
        } else if (trackingResult.outcome === "pr_closed_merged") {
          currentState = "merged";
          // Continue to learn
        } else if (trackingResult.outcome === "pr_closed_unmerged") {
          currentState = "failed";
          break;
        } else if (trackingResult.outcome === "timed_out") {
          currentState = "failed";
          break;
        }
      } else if (phase === "learn") {
        const learnResult = (await executeChild("learnPhase", {
          workflowId: childId,
          args: [
            {
              taskId: input.taskId,
              repoId: input.repoId,
              owner: input.repoOwner,
              repo: input.repoName,
              merged: currentState === "merged",
              mergedSha,
              attemptNumber,
              phaseIteration,
              totalCostCents: costCents,
              evidenceLocator,
              startedAt,
              completedAt: new Date().toISOString(),
              filesChanged:
                implementResult?.agentResult?.filesModified?.length ?? 0,
            },
          ],
        })) as LearnFullResult;
        void learnResult;
      }

      await emitPhaseEvent("phase_completed", phase);
    }
  } catch (error: unknown) {
    if (error instanceof ContinueAsNew) {
      throw error;
    }
    currentState = "failed";
    failureReason = error instanceof Error ? error.message : String(error);
  }

  // ─── Consolidated cleanup ───
  // Runs in ALL terminal paths: merged, failed, cancelled

  if (killed && killInfo) {
    currentState = "cancelled";
    void killInfo;
  }

  await CancellationScope.nonCancellable(async () => {
    const safetyActs = proxyActivities<
      Pick<SafetyActivities, "releaseBranchLease">
    >({
      startToCloseTimeout: "15s",
      retry: { maximumAttempts: 2 },
    });

    const sandboxActs = proxyActivities<
      Pick<SandboxActivities, "destroySandbox">
    >({
      startToCloseTimeout: "30s",
      retry: { maximumAttempts: 2 },
    });

    const taskActs = proxyActivities<
      Pick<TaskActivities, "transitionTaskState">
    >({
      startToCloseTimeout: "30s",
      retry: { maximumAttempts: 2 },
    });

    // Release branch lease
    const branchName = `factory/${input.taskId}`;
    try {
      await safetyActs.releaseBranchLease(branchName, input.taskId);
    } catch {
      // best-effort — TTL auto-expires
    }

    // Destroy sandbox if still alive
    if (setupResult?.sandboxInstance?.containerId) {
      try {
        await sandboxActs.destroySandbox(
          setupResult.sandboxInstance.containerId,
        );
      } catch {
        // best-effort
      }
    }

    // Ensure terminal state is persisted
    if (
      currentState === "merged" ||
      currentState === "failed" ||
      currentState === "cancelled"
    ) {
      try {
        await taskActs.transitionTaskState(
          input.taskId,
          currentState,
          "system",
          {
            phase: "cleanup",
            finalState: currentState,
            ...(failureReason ? { error: failureReason } : {}),
          },
        );
      } catch {
        // may already be in terminal state
      }
    }
  });

  // Drain all handlers before completing
  await condition(allHandlersFinished);
}
