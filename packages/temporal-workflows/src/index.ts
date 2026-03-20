// Workflow exports — these are the entry points for the V8 isolate bundler.
// The Temporal worker discovers workflows from this module.

export { taskOrchestrator } from "./orchestrator.js";
export type { TaskWorkflowInput, WorkflowConfig } from "./orchestrator.js";

export { intakePhase } from "./phases/intake.js";
export type { IntakeInput, IntakeResult } from "./phases/intake.js";

export { clarifyPhase } from "./phases/clarify.js";
export type { ClarifyInput, ClarifyResult } from "./phases/clarify.js";

export { understandPhase } from "./phases/understand.js";
export type { UnderstandInput, UnderstandResult } from "./phases/understand.js";

export { planPhase } from "./phases/plan.js";
export type { PlanInput, PlanResult } from "./phases/plan.js";

export { setupPhase } from "./phases/setup.js";
export type { SetupInput, SetupResult } from "./phases/setup.js";

export { implementPhase } from "./phases/implement.js";
export type { ImplementInput, ImplementResult } from "./phases/implement.js";

export { validatePhase } from "./phases/validate.js";
export type { ValidateInput, ValidateResult } from "./phases/validate.js";

export { evidencePhase } from "./phases/evidence.js";
export type { EvidenceInput, EvidenceResult } from "./phases/evidence.js";

export { reviewPhase } from "./phases/review.js";
export type {
  ReviewInput,
  ReviewResult,
  ReviewOutcome,
} from "./phases/review.js";

export { prCreationPhase } from "./phases/pr-creation.js";
export type {
  PrCreationInput,
  PrCreationResult,
} from "./phases/pr-creation.js";

export { prTrackingPhase } from "./phases/pr-tracking.js";
export type {
  PrTrackingInput,
  PrTrackingResult,
  PrTrackingOutcome,
  PRStateSnapshot,
} from "./phases/pr-tracking.js";

export { learnPhase } from "./phases/learn.js";
export type {
  LearnInput,
  LearnResult,
  LearnFullInput,
  LearnFullResult,
} from "./phases/learn.js";

export { reconciliationWorkflow } from "./reconciliation.js";

// Signal/Query definitions — for external consumers
export {
  killSignal,
  approveSignal,
  rejectSignal,
  changesRequestedSignal,
  resumeSignal,
  clarifyResponseSignal,
  costOverrideSignal,
  prReviewSignal,
  checkCompleteSignal,
  mergeQueueUpdateSignal,
  prClosedSignal,
  getStateQuery,
  getProgressQuery,
  getPhaseQuery,
} from "./signals.js";
export type { WorkflowProgress } from "./signals.js";

// Activity type interfaces — for proxyActivities<T>() in workflow code
export type {
  TaskActivities,
  AuditActivities,
  SafetyActivities,
  TaskRecord,
  CreateTaskInput,
  AuditEntryInput,
  KillCheckResult,
  CostCheckResult,
  LeaseResult,
  CostStatus,
  SandboxActivities,
  SandboxProvisionConfig,
  SandboxInstanceRef,
  SandboxExecResult,
  SecretBindingsData,
  ResourceLimitsData,
  GitHubActivities,
  FileChangeData,
  LLMActivities,
  AgentStepConfig,
  AgentStepResult,
  IndexActivities,
  IndexResultData,
  RepoMapEntryData,
  PlanActivities,
  FileContentData,
  ValidationActivities,
  TestRunnerConfigData,
  TestRunResultData,
  LintRunnerConfigData,
  LintRunResultData,
  SecurityScanConfigData,
  SecurityScanResultData,
  BlastRadiusConfigData,
  BlastRadiusResultData,
  ValidatorBoundaryConfigData,
  EvidenceActivities,
  EvidenceGenerateInput,
  EvidenceGenerateResult,
  EvidenceValidationData,
  EvidenceAgentResultData,
  EvidenceCapabilityData,
  EvidenceLocatorData,
  RiskCategorizationData,
  ReviewTrackerActivities,
  ReconcilerConfigData,
  ReconcileResultData,
  ReconcileCheckData,
  UpdateReviewStateData,
  MergeActivities,
  MergePrecheckConfigData,
  MergePrecheckData,
  MergeConfigData,
  MergeResultData,
  PostMergeCleanupConfigData,
  LearnActivities,
  TaskMetricsData,
  BroadReconcilerActivities,
  ReconciliationReportData,
} from "./activity-types.js";
