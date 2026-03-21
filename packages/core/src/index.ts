// === Task & State Machine ===
export {
  TASK_STATES,
  TaskStateSchema,
  TaskSchema,
  CreateTaskSchema,
} from "./schemas/task.js";
export type { TaskState, Task, CreateTask } from "./schemas/task.js";

export {
  TASK_TRANSITIONS,
  canTransition,
  getValidTransitions,
  isTerminal,
} from "./state-machine.js";

// === Autonomy ===
export {
  AUTONOMY_LEVELS,
  AutonomyLevelSchema,
  DEFAULT_AUTONOMY_LEVEL,
} from "./schemas/autonomy.js";
export type { AutonomyLevel } from "./schemas/autonomy.js";

// === Policy ===
export {
  POLICY_TYPES,
  PolicyTypeSchema,
  PROTECTION_CLASSES,
  ProtectionClassSchema,
  PolicyConfigSchema,
} from "./schemas/policy.js";
export type {
  PolicyType,
  ProtectionClass,
  PolicyConfig,
} from "./schemas/policy.js";

// === Policy Decision Service ===
export {
  DEFAULT_EXCLUSIONS,
  isGovernanceExcluded,
  evaluatePath,
  evaluateChangedPaths,
} from "./policy/decision-service.js";
export type { PolicyDecision } from "./policy/decision-service.js";

// === Evidence ===
export {
  RISK_LEVELS,
  RiskLevelSchema,
  DiffAnnotationSchema,
  TestDetailSchema,
  TestResultsSchema,
  VulnerabilitySchema,
  SecurityScanResultsSchema,
  LintDetailSchema,
  LintResultsSchema,
  ProtectedEditSchema,
  MigrationImpactSchema,
  CommandRecordSchema,
  REVERTABILITY_CLASSES,
  RevertabilityClassSchema,
  BlastRadiusSchema,
  EvidenceBundleSchema,
} from "./schemas/evidence.js";
export type {
  RiskLevel,
  DiffAnnotation,
  TestDetail,
  TestResults,
  Vulnerability,
  SecurityScanResults,
  LintDetail,
  LintResults,
  ProtectedEdit,
  MigrationImpact,
  CommandRecord,
  RevertabilityClass,
  BlastRadius,
  EvidenceBundle,
} from "./schemas/evidence.js";

// === Validation ===
export {
  SBOMEntrySchema,
  SBOMResultSchema,
  ValidatorControlFileEditSchema,
  ValidationResultSchema,
} from "./schemas/validation.js";
export type {
  SBOMEntry,
  SBOMResult,
  ValidatorControlFileEdit,
  ValidationResult,
} from "./schemas/validation.js";

// === Audit ===
export {
  AUDIT_ACTION_TYPES,
  AuditActionTypeSchema,
  AUDIT_TARGET_TYPES,
  AuditTargetTypeSchema,
  AuditEntrySchema,
} from "./schemas/audit.js";
export type {
  AuditActionType,
  AuditTargetType,
  AuditEntry,
} from "./schemas/audit.js";

// === Auth ===
export {
  ROLES,
  RoleSchema,
  ACTOR_TYPES,
  ActorTypeSchema,
  ApiKeyCredentialSchema,
  ActorIdentitySchema,
} from "./schemas/auth.js";
export type {
  Role,
  ActorType,
  ApiKeyCredential,
  ActorIdentity,
} from "./schemas/auth.js";

// === Repository ===
export {
  REPO_CLASSES,
  RepoClassSchema,
  RepositorySchema,
} from "./schemas/repo.js";
export type { RepoClass, Repository } from "./schemas/repo.js";

// === Sandbox ===
export {
  CONTAINER_PHASES,
  ContainerPhaseSchema,
  SECRET_CLASSES,
  SecretClassSchema,
  SetupContractSchema,
  HEALTH_STATUSES,
  HealthStatusSchema,
  EnvironmentStateSchema,
} from "./schemas/sandbox.js";
export type {
  ContainerPhase,
  SecretClass,
  SetupContract,
  HealthStatus,
  EnvironmentState,
} from "./schemas/sandbox.js";

// === GitHub ===
export {
  PR_STATES,
  PRStateSchema,
  REVIEW_STATES,
  ReviewStateSchema,
  WEBHOOK_EVENT_TYPES,
  WebhookEventTypeSchema,
  WebhookEventSchema,
} from "./schemas/github.js";
export type {
  PRState,
  ReviewState,
  WebhookEventType,
  WebhookEvent,
} from "./schemas/github.js";

// === LLM ===
export {
  WORKFLOW_PHASES,
  WorkflowPhaseSchema,
  LLMCallAuditEntrySchema,
  AGENT_TOOL_NAMES,
  AgentToolNameSchema,
  AgentToolSchema,
  EDIT_FORMATS,
  EditFormatSchema,
} from "./schemas/llm.js";
export type {
  WorkflowPhase,
  LLMCallAuditEntry,
  AgentToolName,
  AgentTool,
  EditFormat,
} from "./schemas/llm.js";

// === Events ===
export {
  TASK_EVENT_TYPES,
  TaskEventTypeSchema,
  PhaseEventSchema,
  AgentStepEventSchema,
} from "./schemas/events.js";
export type {
  TaskEventType,
  PhaseEvent,
  AgentStepEvent,
} from "./schemas/events.js";

// === Cost ===
export { CostRecordSchema } from "./schemas/cost.js";
export type { CostRecord } from "./schemas/cost.js";

// === Config ===
export {
  FactoryConfigSchema,
  REVIEW_TIMEOUT_MS_DEFAULT,
} from "./schemas/config.js";
export type { FactoryConfig } from "./schemas/config.js";

// === Trusted Base Context ===
export { TrustedBaseContextSchema } from "./trusted-context.js";
export type { TrustedBaseContext } from "./trusted-context.js";

// === Capability Scan ===
export {
  BypassActorSchema,
  RequiredStatusCheckSchema,
  RequiredWorkflowSchema,
  PushRestrictionsSchema,
  CodeownersEntrySchema,
  CODEOWNERS_LOCATIONS,
  CodeownersSchema,
  MergeQueueConfigSchema,
  BranchProtectionSchema,
  RulesetRuleSchema,
  RULESET_RULE_TYPES,
  RulesetSchema,
  DANGEROUS_TRIGGERS,
  DangerousWorkflowSchema,
  CapabilitySnapshotSchema,
} from "./schemas/capability.js";
export type {
  BypassActor,
  RequiredStatusCheck,
  RequiredWorkflow,
  PushRestrictions,
  CodeownersEntry,
  Codeowners,
  MergeQueueConfig,
  BranchProtection,
  RulesetRule,
  RulesetRuleType,
  Ruleset,
  DangerousTrigger,
  DangerousWorkflow,
  CapabilitySnapshot,
} from "./schemas/capability.js";

// === Errors ===
export {
  ERROR_CODES,
  ErrorCodeSchema,
  ERROR_RETRY_POLICIES,
  getRetryPolicy,
} from "./errors/error-codes.js";
export type { ErrorCode, ErrorRetryPolicy } from "./errors/error-codes.js";

export { createFactoryError } from "./errors/factory-error.js";
export type { FactoryError, FactoryResult } from "./errors/factory-error.js";
