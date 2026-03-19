export {
  CredentialBroker,
  PHASE_PERMISSIONS,
} from "./github/credential-broker.js";
export type { TaskPhase } from "./github/credential-broker.js";
export {
  createRestClient,
  createGraphQLClient,
  RATE_LIMIT_HEADERS,
} from "./github/client.js";
export {
  parseRateLimitHeaders,
  shouldThrottle,
  MutationSerializer,
} from "./github/rate-limiter.js";
export type { RateLimitInfo, ThrottleDecision } from "./github/rate-limiter.js";

export { scanRepository } from "./github/capability-scan.js";
export type { ScanLogger } from "./github/capability-scan.js";
export { createBranchActivities } from "./github/branch.js";
export type { BranchActivityDeps, FileChange } from "./github/branch.js";
export { createTrustedContextActivities } from "./github/trusted-context.js";
export type { TrustedContextDeps } from "./github/trusted-context.js";
export { createGitHubActivities } from "./github/activities.js";
export type { GitHubActivityDeps } from "./github/activities.js";
export {
  parseCodeowners,
  getOwners,
} from "./github/codeowners-parser.js";
export type { CodeownersParseResult } from "./github/codeowners-parser.js";
export {
  parseRulesetResponse,
  getEffectiveRules,
  hasInheritedRulesets,
} from "./github/ruleset-analyzer.js";
export type {
  EffectiveRules,
  GitHubRulesetResponse,
} from "./github/ruleset-analyzer.js";
export {
  scanWorkflowContent,
  scanWorkflows,
} from "./github/workflow-scanner.js";
export type { WorkflowScanResult } from "./github/workflow-scanner.js";

export {
  createPRActivities,
  generatePRBody,
  buildPRTitle,
  computePRIdempotencyKey,
} from "./github/pr.js";
export type {
  CreatePRConfig,
  PRResult,
  PRUpdates,
  PRActivityDeps,
  SideEffectOps,
  SideEffectRecord,
  ValidationSummaryForPR,
  ValidatorControlFileEditForPR,
  ChangedFileForPR,
} from "./github/pr.js";

export {
  createCheckRunActivities,
  computeConclusion,
  generateCheckRunSummary,
  buildAnnotations,
  computeCheckRunIdempotencyKey,
} from "./github/check-run.js";
export type {
  CheckRunConfig,
  CheckRunResult,
  CheckRunUpdates,
  CheckRunActivityDeps,
  CheckRunAnnotation,
  LintAnnotationSource,
  SecurityAnnotationSource,
  ProtectedEditSource,
} from "./github/check-run.js";

export { createAutoMergeActivities } from "./github/auto-merge.js";
export type {
  AutoMergeActivityDeps,
  MergeMethod,
} from "./github/auto-merge.js";

// === Safety Primitives ===
export {
  createRedisClient,
  createRedisPubSubClient,
} from "./safety/redis-client.js";
export { createKillCheckActivity } from "./safety/kill-check.js";
export type { KillCheckResult } from "./safety/kill-check.js";
export { createCostCheckActivity } from "./safety/cost-check.js";
export type { CostCheckResult, CostStatus } from "./safety/cost-check.js";
export { createBranchLeaseActivity } from "./safety/branch-lease.js";
export type { LeaseResult } from "./safety/branch-lease.js";

// === DB Activities ===
export { createTaskActivities } from "./db/task-activities.js";
export type { CreateTaskInput } from "./db/task-activities.js";
export { createAuditActivities } from "./db/audit-activities.js";
export type { AuditEntryInput } from "./db/audit-activities.js";

// === Index Activities ===
export { createIndexActivities } from "./indexing/activities.js";
export type { IndexActivityDeps } from "./indexing/activities.js";

// === Code Indexing ===
export {
  indexRepository,
  createParser,
  detectLanguage,
  extractSymbols,
  extractImports,
  generateRepoMap,
  filterPaths,
} from "./indexing/index.js";
export type {
  Tag,
  SymbolKind,
  ImportEdge,
  ImportType,
  SupportedLanguage,
  ParseResult,
  ParserBackend,
  RepoMapEntry,
  RepoMapOptions,
  IndexOptions,
  IndexResult,
  FilterResult,
  IndexedFile,
} from "./indexing/index.js";

// === Docker Sandbox ===
export { createSandboxSupervisor } from "./sandbox/index.js";
export type {
  SandboxConfig,
  SandboxInstance,
  ResourceLimits,
  ResolvedEnvironment,
  SandboxSupervisor,
  ExecResult,
  ExecOptions,
  SecretBindings,
  MonitorHandle,
  MonitorOptions,
  MonitorStatus,
  MonitorReason,
} from "./sandbox/index.js";
export {
  execInContainer,
  buildExecEnv,
  buildToolExecEnv,
  verifyNoSecretLeakage,
  computeCacheKey,
  getCachedImage,
  cacheContainer,
  invalidateCache,
  createNetworkManager,
  createMonitor,
  checkOomKilled,
  destroyContainer,
  cleanupOrphans,
  createSandboxActivities,
} from "./sandbox/index.js";

// === Validation ===
export { createValidationActivities } from "./validation/index.js";
export type { ValidationActivityDeps } from "./validation/index.js";
export {
  runTests,
  parseTestOutput,
  parseVitestJest,
  parsePytest,
  parseGoTest,
  parseRustTest,
  parseJunitXml,
  runLinter,
  parseLintOutput,
  parseBiomeJson,
  parseEslintJson,
  parseLintFallback,
  runSecurityScan,
  parseSarifFindings,
  parseGrypeJson,
  parseSyftSpdxJson,
  computeBlastRadius,
  checkValidatorBoundary,
  categorizeControlFile,
  computeHash,
} from "./validation/index.js";
export type {
  TestRunnerConfig,
  TestRunResult,
  ParsedCounts,
  LintRunnerConfig,
  LintRunResult,
  ParsedLint,
  SecurityScanConfig,
  SecurityScanResult,
  BlastRadiusConfig,
  BlastRadiusResult,
  ValidatorBoundaryConfig,
} from "./validation/index.js";

// === LLM Agent ===
export {
  createProvider,
  buildRequestConfig,
  applyEdit,
  applyEditSafe,
  classifyTrust,
  wrapUntrustedContent,
  stripInjectionPatterns,
  createGuardrails,
  assembleContext,
  trimStepMessages,
  truncateToolResult,
  createCostTracker,
  createAgentTools,
  executeAgent,
  createLLMActivities,
} from "./llm/index.js";
export type {
  ProviderConfig,
  EditResult,
  TrustLevel,
  GuardrailTrip,
  GuardrailState,
  GuardrailConfig,
  GuardrailName,
  ContextConfig,
  FileContent,
  ToolCallSummary,
  CostTrackerDeps,
  GenerationStats,
  LLMCostCheckResult,
  LLMCostStatus,
  ToolDeps,
  FlaggedEdit,
  AuditLogEntry,
  AgentConfig,
  AgentResult,
  LLMActivityDeps,
  AgentStepConfig,
  AgentStepResult,
} from "./llm/index.js";
export { createPlanActivities } from "./llm/plan-activities.js";
export type { PlanActivityDeps } from "./llm/plan-activities.js";

// === Evidence ===
export {
  createArtifactStore,
  generateAnnotatedDiff,
  classifyRisk,
  generateEvidence,
  buildLocator,
  withOptionalArtifacts,
  createManifest,
  verifyManifest,
  redactSecrets,
  isContentSafe,
  sha256,
  categorizeRisks,
  createEvidenceActivities,
} from "./evidence/index.js";
export type {
  ArtifactStore,
  ArtifactStoreConfig,
  ArtifactRef,
  DiffAnnotatorConfig,
  AnnotatedDiffResult,
  EvidenceGeneratorConfig,
  ValidationData,
  AgentResultData,
  CapabilityData,
  GenerateEvidenceResult,
  EvidenceLocator,
  ManifestEntry,
  ManifestMeta,
  EvidenceManifest,
  RiskCategorization,
  EvidenceActivityDeps,
} from "./evidence/index.js";
