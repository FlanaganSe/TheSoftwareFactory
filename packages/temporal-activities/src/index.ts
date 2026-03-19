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
