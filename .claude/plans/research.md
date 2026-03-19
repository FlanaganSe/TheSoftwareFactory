# M2: Core Domain Package -- Research Findings

**Date:** 2026-03-18
**Sources:** `docs/prd.md`, `docs/research-infrastructure.md`, `docs/research-integrations.md`, `.claude/plans/plan.md`

---

## 1. Current State

Package `@software-factory/core` exists with:
- `zod` ^3.25.17 and `neverthrow` ^8.2.0 as dependencies
- A single `src/index.ts` exporting `VERSION = "0.0.0"`
- tsconfig extending `../../tsconfig.base.json` (ES2023, NodeNext, strict, verbatimModuleSyntax)
- Biome configured with double quotes, semicolons, 2-space indent

`picomatch` is NOT yet a dependency -- needs to be added for `PolicyDecisionService`.

---

## 2. Files to Create (from plan.md lines 358-374)

```
packages/core/src/
  types/
    task.ts
    evidence.ts
    policy.ts
    github.ts
    sandbox.ts
    audit.ts
    llm.ts
    repo.ts
    auth.ts
    trusted-context.ts
  schemas/          -- Zod schemas (single source of truth, types derived via z.infer<>)
  errors/
    factory-error.ts
    error-codes.ts
  policy/
    decision-service.ts   -- PolicyDecisionService with picomatch
  state-machine.ts        -- Pure function map
  index.ts                -- Public API re-exports
```

---

## 3. Task State Machine

### 3.1 States (16 values)

From plan.md line 380:

```typescript
type TaskState =
  | "created"
  | "needs_clarification"
  | "assigned"
  | "in_progress"
  | "paused"                      // Added beyond PRD for kill switch / cost budget
  | "evidence_ready"
  | "changes_requested"
  | "approved"
  | "pr_created"
  | "external_checks_pending"
  | "addressing_review_feedback"
  | "external_blocked"
  | "merge_ready"
  | "merged"
  | "failed"
  | "cancelled"                   // Added beyond PRD for human-initiated cancellation
```

NOTE: The PRD R-002 (line 492-499) defines 14 states. The plan adds `paused` and `cancelled` (plan.md line 379-380). The DB schema in research-infrastructure.md Section 5.1 uses 14 states (no `paused`/`cancelled`). The plan.md M2 spec is authoritative -- use 16 states.

### 3.2 Terminal States

`merged`, `failed`, `cancelled` -- zero outgoing transitions.

### 3.3 Valid Transitions (22 total)

From plan.md lines 381:

Original 18 (from research-infrastructure.md lines 833-845):
1. created -> needs_clarification
2. created -> assigned
3. needs_clarification -> assigned
4. assigned -> in_progress
5. in_progress -> evidence_ready
6. in_progress -> failed
7. evidence_ready -> changes_requested
8. evidence_ready -> approved
9. changes_requested -> in_progress
10. approved -> pr_created
11. pr_created -> external_checks_pending
12. external_checks_pending -> addressing_review_feedback
13. external_checks_pending -> external_blocked
14. external_checks_pending -> merge_ready
15. addressing_review_feedback -> external_checks_pending
16. external_blocked -> external_checks_pending
17. merge_ready -> merged
18. merge_ready -> failed

Plus 4 new transitions for paused/cancelled (plan.md line 381):
19. in_progress -> paused
20. paused -> in_progress
21. paused -> cancelled
22. Any non-terminal state -> cancelled (this is a wildcard -- needs expansion)

IMPORTANT: Transition 22 is described as `* -> cancelled from any non-terminal state`. This means the following transitions must exist for `cancelled`:
- created -> cancelled
- needs_clarification -> cancelled
- assigned -> cancelled
- in_progress -> cancelled
- paused -> cancelled (already #21)
- evidence_ready -> cancelled
- changes_requested -> cancelled
- approved -> cancelled
- pr_created -> cancelled
- external_checks_pending -> cancelled
- addressing_review_feedback -> cancelled
- external_blocked -> cancelled
- merge_ready -> cancelled

That would be 13 transitions to `cancelled`, plus the 21 above (minus the duplicate paused->cancelled). Total: 18 + 2 (paused transitions) + 13 (cancelled transitions) - 1 (duplicate) = 32. But the plan says "22 transitions". The plan likely means: 18 original + 4 explicitly listed = 22, where `* -> cancelled` is listed as a single conceptual transition but implemented as 13 concrete entries.

DECISION NEEDED: Clarify with user whether "22 transitions" is the total or whether `* -> cancelled` should be expanded to all non-terminal source states.

---

## 4. Evidence Bundle Fields (13 fields from R-008)

From prd.md lines 544-561 and research-infrastructure.md lines 919-943:

### 4.1 Relational (fixed) columns:
- `id`: uuid PK
- `taskId`: uuid FK -> tasks.id, NOT NULL
- `version`: integer, default 1, NOT NULL
- `objective`: text, NOT NULL
- `revertabilityClass`: enum (`clean_revert` | `revert_with_migration` | `non_revertable`), NOT NULL
- `blastRadiusFiles`: integer, NOT NULL
- `blastRadiusPackages`: integer, NOT NULL
- `hasProtectedSurfaceEdits`: boolean, default false, NOT NULL
- `hasMigrationImpact`: boolean, default false, NOT NULL
- `artifactUrl`: text, nullable
- `createdAt`: timestamptz, NOT NULL

### 4.2 JSONB (variable-structure) columns:
- `annotatedDiff`: `AnnotatedDiff` type
- `ownersImpacted`: `string[]`
- `testResults`: `TestResults` type
- `securityScanResults`: `ScanResults` type
- `lintResults`: `LintResults` type
- `protectedSurfaceEdits`: `ProtectedEdit[]` type
- `migrationImpact`: `MigrationImpact` type
- `unresolvedAssumptions`: `string[]`
- `commandsRun`: `CommandRecord[]` type
- `pendingExternalChecks`: `string[]`

### 4.3 The 13 PRD R-008 fields:
| # | Field | Purpose |
|---|-------|---------|
| 1 | Objective | What was attempted |
| 2 | Annotated diff | What changed, with inline annotations |
| 3 | Blast radius | Files, packages, downstream consumers affected |
| 4 | Owners impacted | CODEOWNERS paths touched |
| 5 | Test results | Suite results, new/modified/deleted tests highlighted |
| 6 | Security scan results | Vulnerability findings |
| 7 | Lint/type-check results | Static analysis findings |
| 8 | Protected-surface edits | Behavioral control / protected file edits with justification |
| 9 | Migration/schema impact | Database or data model changes detected |
| 10 | Revertability class | clean_revert / revert_with_migration / non_revertable |
| 11 | Unresolved assumptions | What the agent was uncertain about |
| 12 | Commands and checks run | Exact validation commands executed |
| 13 | Pending external checks | GitHub-required checks not yet run (post-PR) |

### 4.4 Supporting types to define:

```typescript
// DiffAnnotation (from research-integrations.md lines 1119-1125)
interface DiffAnnotation {
  file: string;
  hunk_index: number;
  annotation: string;  // What this change does and why
  risk_level: "low" | "medium" | "high";
  affected_consumers: string[];  // Functions/modules that depend on this
}

type AnnotatedDiff = DiffAnnotation[];

interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
  newTests: string[];
  modifiedTests: string[];
  deletedTests: string[];
  details: TestDetail[];
}

interface ScanResults {
  vulnerabilities: Vulnerability[];
  totalFindings: number;
  criticalCount: number;
  highCount: number;
}

interface LintResults {
  errorCount: number;
  warningCount: number;
  details: LintDetail[];
}

interface ProtectedEdit {
  filePath: string;
  protectionClass: ProtectionClass;
  justification: string;
  beforeContent?: string;
  afterContent?: string;
}

interface MigrationImpact {
  hasMigrations: boolean;
  migrationFiles: string[];
  schemaChanges: string[];
}

interface CommandRecord {
  command: string;
  exitCode: number;
  durationMs: number;
  output?: string;
}
```

CRITICAL: No scalar confidence scores. No generic rollback prose. Evidence must be derived from actual analysis.

---

## 5. Policy Types and Protection Classes

### 5.1 Policy Types (from R-010, research-infrastructure.md line 987)

```typescript
type PolicyType =
  | "read_exclusion"   // Deny read AND index (e.g., secrets/**, .env*, *.pem)
  | "edit_deny"        // Deny edit without admin approval (e.g., .github/workflows/**)
  | "edit_protected"   // Require separate approval (see protection classes)
  | "edit_allowed"     // Allow within autonomy level (e.g., src/**)
```

### 5.2 Protection Classes (from R-011, research-infrastructure.md line 988)

```typescript
type ProtectionClass =
  | "hard_protected"   // CI workflows, CODEOWNERS, .factory/**, holdout eval fixtures, behavioral control files. Deny by default, requires admin approval.
  | "flagged"          // **/*.test.*, **/*.spec.*, **/test/** (product tests). Allowed but highlighted in evidence with justification. Configurable to require approval.
  | "light_protected"  // **/__snapshots__/**, **/*.snap, **/fixtures/**, **/testdata/**. Flagged in evidence, auto-allowed at L2.
```

### 5.3 Behavioral Control Files (hard_protected, from R-011 lines 605-610)
- `.github/copilot-instructions.md`
- `.github/instructions/**/*.instructions.md`
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
- MCP configuration files
- `.factory/setup.yml` and related setup contracts
- Any factory-owned policy files (`.factory/**`)

### 5.4 PolicyConfig columns (from research-infrastructure.md lines 990-993)
- `repoId`: uuid FK
- `name`: text
- `policyType`: policy_type enum
- `protectionClass`: protection_class enum
- `pathPatterns`: JSONB string[] NOT NULL
- `autonomyLevel`: L0/L1/L2
- `requiresApproval`: boolean, default false
- `approverRole`: admin | operator
- `isActive`: boolean, default true
- `createdBy`, `createdAt`, `updatedAt`

NOTE: Glob pattern matching MUST happen at the application layer (picomatch), NOT in SQL.

---

## 6. Autonomy Levels (from R-009, prd.md lines 565-572)

```typescript
type AutonomyLevel = "L0" | "L1" | "L2";
```

| Level | Name | What Agent Can Do | What Requires Human Approval |
|-------|------|-------------------|------------------------------|
| L0 | Observe | Read code, summarize, recommend | Everything else |
| L1 | Propose | All of L0 + generate plans, produce diffs | Creating branches, writing files, creating PRs |
| L2 | Constrained Execute | All of L1 + create branches, edit code, run tests, push to candidate branch | Creating PRs, merging, editing hard-protected files |

Default: L1. L2 requires eval baseline evidence before activation (deferred to Phase 2).

Plan.md refinement (line 385-387):
- L0: Human confirms every action (branch creation, file writes, PR creation, merge)
- L1: Agent produces diffs and plans; human approval required BEFORE branch creation and file writes; human reviews evidence before PR (DEFAULT)
- L2: Agent can create branches, edit code, run tests, push to candidate branch autonomously; human approval required only for PR creation, merge, and editing hard-protected files

---

## 7. Error Taxonomy (from plan.md lines 371-372, 388)

10-class error taxonomy with retry policies:

```typescript
interface ErrorRetryPolicy {
  retryable: boolean;
  maxAttempts: number;
  backoffMs: number;
}
```

Error classes to define (inferred from PRD and research -- exact names from plan.md line 372):
1. `policy_denied` -- Policy engine blocked the action
2. `github_transient` -- GitHub API temporary failure (rate limit, 5xx)
3. `github_permanent` -- GitHub API permanent failure (404, 403 permission)
4. `sandbox_failure` -- Docker container failure (OOM, timeout, crash)
5. `llm_transient` -- LLM provider temporary failure (rate limit, 502, 503)
6. `llm_permanent` -- LLM response error (moderation, invalid output)
7. `state_invalid` -- Invalid state transition attempted
8. `auth_failure` -- Authentication/authorization failure
9. `budget_exceeded` -- Cost budget exceeded (task or global)
10. `validation_failure` -- Zod validation / schema mismatch

Each wraps a `Result<T, FactoryError>` via neverthrow.

---

## 8. Auth Roles (from R-018, prd.md lines 687-696)

```typescript
type AuthRole = "admin" | "operator" | "viewer";
```

| Role | Permissions |
|------|------------|
| admin | Full access: configure repos, set policies, manage roles |
| operator | Submit tasks, approve actions, view audit |
| viewer | Read-only |

Separation of duties: task submitter cannot be sole approver (configurable for solo developers).

---

## 9. Secret Classes (from Section 7.2, prd.md lines 454-458)

```typescript
type SecretClass = "setup_only" | "runtime" | "per_tool";
```

| Class | Available During | Removed Before | Example |
|-------|-----------------|----------------|---------|
| setup_only | Environment setup (dependency install, build) | Agent execution phase | NPM_TOKEN, registry creds |
| runtime | Agent execution phase | Sandbox teardown | DATABASE_URL, API_KEY |
| per_tool | Only when specific tool is invoked | Between tool invocations | GITHUB_TOKEN for gh CLI |

---

## 10. Review Timeout Defaults

From prd.md R-007 (line 539):
- Configurable timeout: **default 4 hours** -> escalation fires

From research-infrastructure.md (Temporal, line 107):
- ReviewPhase: waits for human signal, **7-day timeout**

From prd.md R-024 (lines 735-736):
- Max iteration limit: 10
- No-progress detector: 3 loops without state change
- Time budget: 30 min per repair
- Loop-of-doom detector: 4+ identical failing calls

From prd.md R-013 (lines 628-629):
- Budget ceiling per task: default $10
- Budget ceiling global: default $100/day
- 80% -> notify, 100% -> pause

---

## 11. Setup Contract Fields (from prd.md Section 7.1, lines 419-437)

```typescript
interface SetupContract {
  image: string;                    // e.g., "node:22-slim" or prebuilt image ref
  setup: string[];                  // Runs once when building environment
  maintenance: string[];            // Runs when resuming from cache
  secrets: {
    setup_only: string[];           // Available during setup, removed before agent
    runtime: string[];              // Available during agent execution
    per_tool: PerToolSecret[];      // Scoped to specific MCP tools
  };
  health_check: string[];           // Must pass before agent starts
}

interface PerToolSecret {
  name: string;
  tools: string[];
}
```

Canonical path: `.factory/setup.yml`

---

## 12. Container Phases (from plan.md line 363)

```typescript
type ContainerPhase =
  | "resolving"       // Parsing setup contract, computing cache key
  | "creating"        // Creating container from image
  | "setup"           // Running setup commands with network access
  | "maintenance"     // Running maintenance commands (if cached)
  | "executing"       // Agent running, no network
  | "cleanup"         // Stopping and removing container
```

From research-infrastructure.md Section 4.10 (lines 715-749), the 6 container lifecycle phases:
1. RESOLVE ENVIRONMENT
2. CREATE CONTAINER
3. SETUP PHASE (if not cached)
4. MAINTENANCE PHASE (if cached)
5. EXECUTION PHASE
6. CLEANUP

EnvironmentState fields (research-infrastructure.md lines 1034-1040):
- `repoId`: uuid FK
- `imageRef`: text nullable
- `setupContractHash`: text nullable
- `cacheValid`: boolean, default false
- `lastHealthCheck`: timestamptz nullable
- `healthStatus`: "healthy" | "unhealthy" | "unknown"

---

## 13. PR States and Review States

### 13.1 ReviewState enum (10 values)

From research-infrastructure.md lines 950:

```typescript
type ReviewState =
  | "pending_evidence"
  | "evidence_ready"
  | "approved"
  | "changes_requested"
  | "pr_created"
  | "external_checks_pending"
  | "external_blocked"
  | "merge_ready"
  | "merged"
  | "closed"
```

### 13.2 ReviewState table fields (research-infrastructure.md lines 952-968)

Relationship: 1:1 with tasks (unique constraint on task_id).

Internal (factory) boundary fields:
- `evidenceBundleId`: uuid FK -> evidence_bundles.id
- `internalApprovedBy`: text
- `internalApprovedAt`: timestamptz

External (GitHub) boundary fields (NULL until PR created):
- `prNumber`: integer
- `prUrl`: text
- `requiredChecks`: jsonb `RequiredCheck[]`
- `codeownersStatus`: jsonb `CodeownersStatus[]`
- `unresolvedThreads`: integer, default 0
- `staleReviews`: boolean, default false
- `mergeQueueStatus`: text

Reconciliation fields:
- `lastGithubSync`: timestamptz
- `githubReconciliationData`: jsonb

### 13.3 GitHub PR types (plan.md line 362)

For `src/types/github.ts` -- PRState and ReviewState types, WebhookEvent types. NOT CapabilitySnapshot (deferred to M6).

---

## 14. LLM Audit Entry Fields (from research-integrations.md lines 1095-1111)

```typescript
interface LLMCallAuditEntry {
  timestamp: string;           // ISO 8601
  task_id: string;
  workflow_phase: string;      // understand, plan, implement, evidence
  model_requested: string;
  model_used: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cost_usd: number;
  latency_ms: number;
  finish_reason: string;
  content_hash: string;        // SHA-256 of prompt + response
}
```

---

## 15. General Audit Entry Fields (from R-012, prd.md lines 617-624)

```typescript
interface AuditEntry {
  id: string;                  // uuid
  timestamp: string;           // ISO 8601
  actor: string;
  actionType: string;
  targetType: string;
  targetId: string;
  result: string;
  costCents?: number;
  taskId?: string;
  content?: unknown;           // Full content (90-day retention)
  contentHash: string;         // SHA-256 of serialized content (2-year retention)
}
```

Action types to enumerate (inferred from PRD):
- task_state_change
- task_created
- evidence_generated
- review_decision
- pr_created
- pr_merged
- pr_closed
- policy_check
- llm_call
- sandbox_exec
- file_read
- file_write
- command_run
- credential_rotation
- secret_access
- kill_switch_activated
- budget_warning
- config_changed

---

## 16. Config Schema Fields

From plan.md line 374 and prd.md:

```typescript
interface FactoryConfig {
  api: {
    port: number;                     // default 3000
    host: string;                     // default "0.0.0.0"
    apiKeys: string[];                // or loaded from DB
  };
  database: {
    connectionString: string;
    maxConnections: number;           // default 20
  };
  redis: {
    url: string;
  };
  temporal: {
    address: string;                  // default "localhost:7233"
    namespace: string;                // default "default"
  };
  objectStorage: {
    endpoint: string;
    bucket: string;                   // default "factory-artifacts"
    accessKey: string;
    secretKey: string;
  };
  github: {
    appId: string;
    privateKeyPath: string;
    clientId: string;
    clientSecret: string;
    webhookSecret: string;
  };
  llm: {
    provider: string;                 // default "openrouter"
    apiKey: string;
    defaultModel: string;
    budgetPerTaskCents: number;       // default 1000 ($10)
    budgetDailyCents: number;         // default 10000 ($100)
  };
  autonomy: {
    defaultLevel: AutonomyLevel;      // default "L1"
    soloDevMode: boolean;             // default false (enables submitter=approver)
  };
  review: {
    timeoutHours: number;             // default 4
    escalationEnabled: boolean;       // default true
  };
  sandbox: {
    memoryLimitBytes: number;         // default 4 * 1024^3 (4 GB)
    cpuLimit: number;                 // default 2
    pidsLimit: number;                // default 256
    networkMode: string;              // default "none"
  };
}
```

IMPORTANT: Core exports ONLY the Zod schema for this config. Actual config loading (process.env, fs, TOML, XDG paths) lives in packages/api, packages/worker, packages/cli.

---

## 17. Agent Tools (from research-integrations.md Section 2.7, lines 997-1007)

7 core tools:

```typescript
type AgentTool =
  | "file_read"
  | "file_write"
  | "file_edit"
  | "search_codebase"
  | "run_command"
  | "list_files"
  | "search_text"
```

---

## 18. Edit Format (from research-integrations.md Section 2.5, lines 957-965)

```typescript
type EditFormat = "search_replace" | "whole_file";
```

Search/replace blocks as primary format with progressive matching:
1. Exact match
2. Whitespace-tolerant
3. Fuzzy

Whole-file generation for small new files (under ~400 lines).
Avoid line numbers in edit formats.

---

## 19. Guardrail Defaults (from research-integrations.md Section 2.8)

| Guardrail | Threshold | Action |
|-----------|-----------|--------|
| Max iterations | 10 | Hard stop |
| No-progress fingerprint | 3 identical consecutive | Pause + notify |
| Loop-of-doom hash | 4 identical failing calls | Pause + notify |
| Wall-clock timer | 30 minutes per repair | Pause |
| Cost budget (task) | $10 default (80% notify, 100% pause) | Pause |
| Cost budget (daily) | $100 default (80% notify, 100% pause) | Pause all |

---

## 20. TrustedBaseContext (from plan.md line 389)

Captured at intake phase, pinned to base SHA:

```typescript
interface TrustedBaseContext {
  baseSha: string;                          // Pinned commit SHA
  setupContract: SetupContract | null;      // Parsed .factory/setup.yml from base ref
  behavioralControlFiles: BehavioralControlFile[];  // Parsed from base ref ONLY
  policySnapshot: PolicyConfig[];           // Active policies at task creation
  validationCommands: string[];             // Validation command sources from base ref
}

interface BehavioralControlFile {
  path: string;
  content: string;
  sha: string;
}
```

All downstream phases consume ONLY this artifact. Candidate-branch edits to behavioral control files are treated as diff content in evidence, not as live inputs.

---

## 21. Repository Type (from research-infrastructure.md lines 1027-1032)

```typescript
interface Repository {
  id: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;           // default "main"
  repoClass: RepoClass;           // default "A"
  autonomyLevel: AutonomyLevel;   // default "L1"
  setupContractPath?: string;
}

type RepoClass = "A" | "B" | "C";
```

---

## 22. External Failure Classes (from R-002, prd.md lines 507-512)

```typescript
type ExternalFailureClass =
  | "transient_infra"     // Flaky CI, runner timeout -> Rerun (max 2)
  | "mergeability_drift"  // Base branch moved -> Rebase + revalidate
  | "code_policy"         // CodeQL finding, push ruleset violation -> Pause + notify
  | "manual_gate"         // Deployment approval pending -> Pause + notify
```

---

## 23. Webhook Event Types (for github.ts)

From research-integrations.md Section 1.5 (lines 199-217), the 16 webhook-to-state transitions:
- pull_request: opened, synchronize, closed, enqueued, dequeued, ready_for_review, converted_to_draft
- pull_request_review: submitted (changes_requested, approved), dismissed
- check_run: completed
- check_suite: completed
- merge_group: checks_requested, destroyed
- push (to agent branch by non-factory actor)
- installation: deleted, suspend

---

## 24. Cost Records (from research-infrastructure.md lines 1043-1049)

```typescript
interface CostRecord {
  id: string;
  taskId?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;          // numeric(10, 4)
  latencyMs?: number;
  timestamp: string;
}
```

---

## 25. Critical Constraints for Implementation

1. **NO Node.js APIs in packages/core** -- must remain pure TypeScript for Temporal V8 sandbox compatibility. No `fs`, `http`, `crypto`, `process.env`. Add a workflow-bundle CI test.

2. **Zod .strict() on ALL object schemas** to catch extra fields early.

3. **Types derived via z.infer<>** -- Zod schemas are the single source of truth. Do NOT hand-write parallel type interfaces.

4. **Config loading is NOT in this package** -- only the config Zod schema. Loading happens in api/worker/cli.

5. **neverthrow Result<T, E>** for all fallible operations at domain boundaries.

6. **picomatch** for glob matching in PolicyDecisionService -- ReDoS-safe, 0 deps.

7. **State machine is a pure map** -- no classes, no side effects. `canTransition(from, to): boolean` and `getValidTransitions(from): TaskState[]`.

8. **CapabilitySnapshot** type belongs in M6, NOT in M2.

9. **verbatimModuleSyntax: true** enforces `import type` for all type-only imports.

10. Biome formatting: double quotes, semicolons, 2-space indent, LF line endings.

---

## 26. Verification Criteria (from plan.md lines 392-396)

- Unit tests for state machine: every valid transition returns true, every invalid transition returns false, terminal states have no outgoing, paused and cancelled transitions work correctly
- Unit tests for Zod schemas: valid data passes, invalid data fails with expected errors
- Unit tests for PolicyDecisionService: read/write/deny/flag decisions correct for all policy types
- `pnpm typecheck` passes
- Workflow bundle test: verify that importing `core` into a Temporal workflow bundle does NOT pull in Node.js built-ins

---

## 27. Open Questions / Decisions Needed

1. **Transition count:** Plan says "22 transitions" but `* -> cancelled from any non-terminal state` expands to 13 concrete transitions. Is the total 22 (treating `* -> cancelled` as 4 explicit transitions: in_progress, paused, evidence_ready, approved) or 32 (expanding to all non-terminal states)?

2. **Workflow phases list for LLMCallAuditEntry.workflow_phase:** The research lists `understand`, `plan`, `implement`, `evidence` but the full phase list from Temporal (research-infrastructure.md line 107) is: Intake, Understand, Plan, Setup, Implement, Validate, Evidence, Review, PRCreation, PRTracking, Learn. Should the enum cover all 11?

3. **HealthStatus type for EnvironmentState:** research-infrastructure.md line 1039 lists `healthy | unhealthy | unknown`. Should this be a separate enum or inline literal union?
