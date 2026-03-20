# Core Domain Logic -- Deep Analysis (`packages/core`)

**Date:** 2026-03-20
**Scope:** Complete analysis of every source file and test in `packages/core`

---

## Overview

`packages/core` is the pure-TypeScript domain kernel of the software factory. It has **zero Node.js API dependencies** -- a hard constraint because it is imported by Temporal workflows running in a V8 isolate. It contains only domain types (Zod schemas), a state machine, a policy decision service, and structured error types. All runtime logic (DB, file I/O, HTTP) lives in other packages.

**Dependencies** (from `package.json`):
- `zod ^3.25.17` -- schema definitions + validation
- `neverthrow ^8.2.0` -- `Result<T, E>` error handling
- `picomatch ^4.0.3` -- ReDoS-safe glob matching (used in policy engine)

**Source files:** 18 (in `src/`), **Test files:** 6 (in `__tests__/`)

---

## 1. Domain Model: Entities and Relationships

### 1.1 Task (primary aggregate root)

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/task.ts`

The central entity representing a unit of work dispatched to the factory.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | UUID string | required |
| `state` | `TaskState` enum (16 values) | required |
| `objective` | string | min(1) |
| `scope` | `Record<string, unknown> \| null` | nullable free-form |
| `constraints` | `Record<string, unknown> \| null` | nullable free-form |
| `budgetCents` | int | nonnegative, nullable |
| `repoId` | UUID string | FK to Repository |
| `createdBy` | string | min(1), actor identifier |
| `createdAt` | ISO datetime string | required |
| `updatedAt` | ISO datetime string | required |

`CreateTaskSchema` is the write-side DTO (omits `id`, `state`, timestamps; makes `scope`, `constraints`, `budgetCents` optional).

### 1.2 Repository

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/repo.ts`

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | UUID | required |
| `githubOwner` | string | min(1) |
| `githubRepo` | string | min(1) |
| `defaultBranch` | string | min(1) |
| `repoClass` | `"A" \| "B" \| "C"` | enum (A=full V1, B=partial, C=V2+) |
| `autonomyLevel` | `AutonomyLevel` | per-repo override |
| `setupContractPath` | string \| null | path to `.factory/setup.yml` |

**Relationship:** Task has a `repoId` FK pointing to Repository.

### 1.3 EvidenceBundle

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/evidence.ts`

The structured evidence packet presented to humans before PR creation (PRD R-008). Contains **13 mandatory evidence fields** plus metadata:

1. `objective` -- what the task aimed to do
2. `annotatedDiff` -- array of `DiffAnnotation` (file, hunk index, annotation, risk level, affected consumers)
3. `blastRadius` -- `{ files: int, packages: int }`
4. `ownersImpacted` -- CODEOWNERS teams affected
5. `testResults` -- passed/failed/skipped counts + `TestDetail[]`
6. `securityScanResults` -- vulnerabilities array + counts by severity
7. `lintResults` -- error/warning counts + `LintDetail[]`
8. `protectedSurfaceEdits` -- array of `ProtectedEdit` (path, protection class, justification, before/after content)
9. `migrationImpact` -- boolean + migration file list + schema changes
10. `revertabilityClass` -- `"clean_revert" | "revert_with_migration" | "non_revertable"`
11. `unresolvedAssumptions` -- array of strings (uncertainty flags)
12. `commandsRun` -- array of `CommandRecord` (command, exit code, duration, output)
13. `pendingExternalChecks` -- array of strings

**Metadata:** `schemaVersion`, `taskId` (FK), `attemptNumber`, `baseSha`, `headSha`, `mergeBaseSha`, `createdAt`.

### 1.4 PolicyConfig

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/policy.ts`

Path-level governance rules. Each policy is scoped to a repository.

| Field | Type | Notes |
|-------|------|-------|
| `repoId` | UUID | FK to Repository |
| `name` | string | human-readable identifier |
| `policyType` | `PolicyType` | see below |
| `protectionClass` | `ProtectionClass \| null` | see below |
| `pathPatterns` | `string[]` | min(1) array, picomatch globs |
| `autonomyLevel` | `AutonomyLevel` | per-policy override |
| `requiresApproval` | boolean | for `edit_protected` type |
| `approverRole` | `"admin" \| "operator" \| null` | who can approve |
| `isActive` | boolean | inactive policies are skipped |

**Policy types** (priority order, highest first):
1. `read_exclusion` -- blocks read, index, search operations
2. `edit_deny` -- blocks write operations entirely
3. `edit_protected` -- allows write but requires human approval
4. `edit_allowed` -- allows write without approval

**Protection classes:**
- `hard_protected` -- CI, workflows, behavioral control files (never writable by agent)
- `flagged` -- test files, config (allowed but highlighted in evidence)
- `light_protected` -- low-sensitivity protected files

### 1.5 AuditEntry

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/audit.ts`

Append-only audit record for compliance and forensics.

| Field | Type |
|-------|------|
| `id` | UUID |
| `timestamp` | ISO datetime |
| `actor` | string (who performed action) |
| `actionType` | one of 18 `AuditActionType` values |
| `targetType` | one of 9 `AuditTargetType` values |
| `targetId` | string |
| `result` | string |
| `costCents` | number \| null (optional) |
| `taskId` | UUID \| null (optional) |
| `content` | unknown (optional, free-form payload) |
| `contentHash` | string (tamper detection) |

**Action types (18):** `task_state_change`, `task_created`, `evidence_generated`, `review_decision`, `pr_created`, `pr_merged`, `pr_closed`, `policy_check`, `llm_call`, `sandbox_exec`, `file_read`, `file_write`, `command_run`, `credential_rotation`, `secret_access`, `kill_switch_activated`, `budget_warning`, `config_changed`.

**Target types (9):** `task`, `repository`, `policy`, `evidence`, `pr`, `sandbox`, `secret`, `config`, `system`.

### 1.6 ActorIdentity / Auth

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/auth.ts`

| Entity | Fields |
|--------|--------|
| `ActorIdentity` | `actorId`, `actorType` (`system` \| `operator`), `role` |
| `ApiKeyCredential` | `keyHash`, `role`, `createdBy`, `expiresAt`, `lastUsedAt` |

**Roles:** `admin`, `operator`, `viewer`.

### 1.7 SetupContract / Sandbox / EnvironmentState

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/sandbox.ts`

**SetupContract** -- the explicit `.factory/setup.yml` shape:
- `version`, `image` (Docker base), `setup` commands, `maintenance` commands
- `secrets` with three classes: `setup_only` (removed before agent), `runtime` (available during execution), `per_tool` (scoped to named tools)
- `health_check` commands

**Container phases (6):** `resolve`, `create`, `setup`, `maintenance`, `execution`, `cleanup`.

**EnvironmentState:** `repoId`, `imageRef`, `setupContractHash`, `cacheValid`, `lastHealthCheck`, `healthStatus` (`healthy` | `unhealthy` | `unknown`).

### 1.8 GitHub Integration Types

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/github.ts`

- **PRState (4):** `draft`, `open`, `closed`, `merged`
- **ReviewState (10):** `pending_evidence`, `evidence_ready`, `approved`, `changes_requested`, `pr_created`, `external_checks_pending`, `external_blocked`, `merge_ready`, `merged`, `closed`
- **WebhookEvent (16 types):** Covering PR lifecycle, reviews, checks, merge groups, push, and installation events. Each event has `deliveryId` for dedup (PRD webhook dedup requirement).

### 1.9 LLM / Agent Types

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/llm.ts`

**Workflow phases (11 total, maps to PRD section 6.1):** `intake`, `understand`, `plan`, `setup`, `implement`, `validate`, `evidence`, `review`, `pr_creation`, `pr_tracking`, `learn`.

**LLMCallAuditEntry:** Full audit record per LLM call -- model, provider, token counts (input, output, reasoning, cached), cost, latency, phase, finish reason, content hash.

**Agent tools (7):** `file_read`, `file_write`, `file_edit`, `search_codebase`, `run_command`, `list_files`, `search_text`. Each tool has a `securityConstraint` field.

**Edit formats:** `search_replace`, `whole_file`.

### 1.10 CapabilitySnapshot

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/capability.ts` (the largest schema file, ~364 lines)

A comprehensive snapshot of a GitHub repository's configuration, captured during onboarding. This is the output of the "repo capability scan" (PRD R-004).

Key sub-schemas:
- `BranchProtection` -- legacy GitHub API (12 boolean/array fields)
- `RulesetRule` -- discriminated union of **18 rule types** (creation, update, deletion, required_linear_history, merge_queue, required_deployments, required_signatures, pull_request, required_status_checks, non_fast_forward, plus 5 pattern rules, plus 3 file restriction rules)
- `Ruleset` -- id, name, target (branch/tag), enforcement (active/disabled/evaluate), sourceType (repository/organization), bypass actors, ref conditions, rules array
- `Codeowners` -- found flag, location (3 standard paths), entries (pattern + owners), parse errors
- `MergeQueueConfig` -- enabled, merge method, grouping, timeouts
- `BypassActor` -- actorId, actorType (User/Team/App/OrganizationAdmin), bypassMode (always/pull_request_only)

The snapshot includes: visibility (public/private/internal), archive/fork status, branch protection, rulesets (with inherited), codeowners, merge queue, allowed merge strategies (merge/squash/rebase), required checks/workflows, signing/linear history requirements, review config, dangerous workflow detection (`pull_request_target`, `workflow_run`), push restrictions, bypass actors, environments, repo class (A/B/C), factory support status with reasons, and warnings.

### 1.11 Validation Types

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/validation.ts`

**ValidationResult** -- the complete output of the deterministic validator bundle. References evidence sub-schemas. Adds:
- `testCommand`, `testExitCode`, `lintCommand`, `lintExitCode`
- `sarifOutput` (optional SAST output)
- `sbom` (optional SBOM in SPDX format, `SBOMEntry` supports npm/pip/go/cargo/maven/other)
- `vulnerabilityScan` (optional dependency scan)
- `filesChanged`, `packagesAffected`, `protectedSurfaceEdits`
- `validatorControlFileEdits` -- tracks edits to test/lint/security/CI/factory config files with base ref vs workspace hashes (evaluator integrity, PRD R-011)
- `trustedContextUsed` -- boolean confirming trusted base context was used
- `passed`, `summary`

**ValidatorControlFileEdit categories (5):** `test_config`, `lint_config`, `security_config`, `ci_config`, `factory_config`.

### 1.12 Cost / Config

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/cost.ts` -- per-call cost record (taskId, modelId, tokens, cost, latency, timestamp).

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/config.ts` -- `FactoryConfig` schema. Full system configuration:

| Section | Key Defaults |
|---------|-------------|
| `api` | port 3000, host 0.0.0.0 |
| `database` | maxConnections 20 |
| `temporal` | localhost:7233, namespace "default" |
| `objectStorage` | bucket "factory-artifacts" |
| `llm` | provider "openrouter", budgetPerTaskCents 1000 ($10), budgetDailyCents 10000 ($100) |
| `autonomy` | defaultLevel "L1", soloDevMode false |
| `review` | timeoutMs 14,400,000 (4 hours), escalationEnabled true |
| `sandbox` | memoryLimitBytes 4GB, cpuLimit 2, pidsLimit 256, networkMode "none" |

### 1.13 TrustedBaseContext

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/trusted-context.ts`

Captured at task intake, consumed by all downstream phases. **This is the R-011 trust boundary** -- behavioral control files are pinned to the base SHA so candidate-branch edits cannot alter agent behavior or validation criteria.

| Field | Type | Purpose |
|-------|------|---------|
| `baseSha` | string | pinned commit for trusted files |
| `setupContract` | `SetupContract \| null` | environment config at base |
| `policySnapshot` | `PolicyConfig[]` | policies active at intake |
| `behavioralControlFiles` | `Record<string, string>` | file path -> content map |
| `validationCommandSources` | `string[]` | where test/lint commands came from |
| `capturedAt` | ISO datetime | when context was captured |

### 1.14 Autonomy Levels

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/autonomy.ts`

Per PRD R-009:
- **L0:** Human confirms every action (branch creation, file writes, PR, merge)
- **L1:** Agent produces diffs/plans; human approval BEFORE branch creation and file writes; human reviews evidence before PR. **DEFAULT.**
- **L2:** Agent can create branches, edit code, run tests, push autonomously; human approval only for PR creation, merge, hard-protected edits. Deferred to Phase 2.

---

## 2. State Machine

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/state-machine.ts`

### 2.1 States (16 total)

**Non-terminal (13):** `created`, `needs_clarification`, `assigned`, `in_progress`, `paused`, `evidence_ready`, `changes_requested`, `approved`, `pr_created`, `external_checks_pending`, `addressing_review_feedback`, `external_blocked`, `merge_ready`

**Terminal (3):** `merged`, `failed`, `cancelled`

### 2.2 Transitions (21 explicit + wildcard)

```
created -> needs_clarification | assigned
needs_clarification -> assigned
assigned -> in_progress
in_progress -> evidence_ready | failed | paused
paused -> in_progress | cancelled
evidence_ready -> changes_requested | approved
changes_requested -> in_progress
approved -> pr_created
pr_created -> external_checks_pending
external_checks_pending -> addressing_review_feedback | external_blocked | merge_ready
addressing_review_feedback -> external_checks_pending
external_blocked -> external_checks_pending
merge_ready -> merged | failed
```

**Wildcard rule:** Any non-terminal state can transition to `cancelled`. This is the universal kill switch path.

**Terminal states have zero outgoing transitions** (enforced by explicit empty sets in the map).

### 2.3 Public API

- `canTransition(from, to): boolean` -- check if transition is valid
- `getValidTransitions(from): readonly TaskState[]` -- list valid targets from a state
- `isTerminal(state): boolean` -- check if state is terminal
- `TASK_TRANSITIONS: ReadonlyMap<TaskState, ReadonlySet<TaskState>>` -- the full immutable transition map

### 2.4 Lifecycle Phases Mapped to States

| PRD Phase | States |
|-----------|--------|
| Intake/Clarify | `created` -> `needs_clarification` -> `assigned` |
| Execution | `assigned` -> `in_progress` -> `evidence_ready` |
| Pause/Resume | `in_progress` <-> `paused` |
| Internal Review | `evidence_ready` -> `changes_requested` -> `in_progress` (loop) |
| Approval | `evidence_ready` -> `approved` |
| PR creation | `approved` -> `pr_created` |
| External tracking | `pr_created` -> `external_checks_pending` -> `addressing_review_feedback` / `external_blocked` / `merge_ready` |
| Merge | `merge_ready` -> `merged` |
| Failure | `in_progress` -> `failed`, `merge_ready` -> `failed` |
| Cancellation | any non-terminal -> `cancelled` |

### 2.5 Key State Machine Invariants

1. **No skip transitions:** States must follow the defined adjacency graph. `created` cannot jump to `in_progress`.
2. **Terminal states are absorbing:** Once `merged`, `failed`, or `cancelled`, no further transitions are possible.
3. **Universal cancellation:** Any non-terminal state can reach `cancelled` (PRD principle: user retains control).
4. **Dual failure points:** Only `in_progress` (execution failure) and `merge_ready` (merge failure) can reach `failed`.
5. **Changes loop:** `changes_requested` -> `in_progress` forces full re-execution of implement->validate->evidence.
6. **Feedback loop:** `addressing_review_feedback` -> `external_checks_pending` handles post-PR GitHub review iterations.
7. **External blocked recovery:** `external_blocked` can return to `external_checks_pending` when the blocking condition is resolved.
8. **Single path to PR:** Evidence must be approved (`approved`) before PR creation. No shortcutting.

---

## 3. Policy Decision Service

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/policy/decision-service.ts`

### 3.1 Architecture

Pure function-based policy engine. No side effects, no state -- takes a path, operation, and policy list, returns a decision. This is the `PolicyDecisionService` referenced in the conventions (`.claude/rules/conventions.md`, line 23).

### 3.2 Default Governance Exclusions

Always blocked regardless of policy configuration (lines 15-25):
```
secrets/**, .env*, *.pem, *.key, *.p12, *.pfx, *.jks, .git/**, node_modules/**
```

These are checked **first**, before any user-defined policies. Checked via `isGovernanceExcluded()`.

### 3.3 Policy Evaluation Algorithm (`evaluatePath`, lines 80-136)

1. Check default governance exclusions first -- if matched, deny immediately
2. Call `findMatchingPolicy()` which:
   a. Filters to active policies only (`isActive === true`)
   b. Iterates through priority tiers: `read_exclusion` -> `edit_deny` -> `edit_protected` -> `edit_allowed`
   c. Within each tier, checks all policies for path pattern matches (picomatch)
   d. Returns the first matching policy
3. If no policy matches: default-allow with no approval required
4. If policy matches: apply the policy type's semantics based on the operation

### 3.4 Operation Semantics

| Policy Type | `read` | `write` | `index` | `search` |
|-------------|--------|---------|---------|----------|
| `read_exclusion` | DENY | no effect | DENY | DENY |
| `edit_deny` | no effect | DENY | no effect | no effect |
| `edit_protected` | no effect | ALLOW + requiresApproval | no effect | no effect |
| `edit_allowed` | no effect | ALLOW | no effect | no effect |

### 3.5 PolicyDecision Shape (lines 8-13)

```typescript
interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;           // human-readable explanation
  readonly protectionClass?: ProtectionClass;  // if applicable
  readonly requiresApproval: boolean;
}
```

### 3.6 Key Policy Behaviors

- **Default-allow:** If no policy matches, the operation is allowed with no approval required
- **Priority trumps array order:** An `edit_deny` always beats an `edit_allowed` for the same path, regardless of position in the policies array
- **Inactive policies are invisible:** Setting `isActive: false` effectively removes a policy from evaluation
- **read_exclusion covers indexing:** This implements PRD R-010 (path-level data governance at index time, not just runtime)
- **Batch evaluation:** `evaluateChangedPaths(paths, policies)` evaluates all paths as `write` operations and returns per-path decisions

---

## 4. Error Handling

### 4.1 Error Codes (11 total)

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/errors/error-codes.ts`

| Code | Retryable | Max Attempts | Backoff |
|------|-----------|-------------|---------|
| `policy_denied` | No | 1 | 0 |
| `github_transient` | Yes | 8 | 15s |
| `github_auth_expired` | Yes | 3 | 5s |
| `workflow_timeout` | Yes | 3 | 30s |
| `sandbox_failure` | Yes | 3 | 5s |
| `model_rate_limited` | Yes | 6 | 10s |
| `model_validation_fail` | Yes | 2 | 1s |
| `evidence_invariant_fail` | No | 1 | 0 |
| `storage_unavailable` | Yes | 5 | 30s |
| `service_unavailable` | Yes | 3 | 10s |
| `unknown_internal` | No | 1 | 0 |

### 4.2 Non-retryable Errors (hard stops)

- `policy_denied` -- governance violation, retrying will not change the outcome
- `evidence_invariant_fail` -- evidence integrity violation, data is corrupt
- `unknown_internal` -- unexpected error, needs human investigation

### 4.3 FactoryError Interface

**File:** `/Users/seanflanagan/proj/software-factory/packages/core/src/errors/factory-error.ts`

```typescript
interface FactoryError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;   // derived from error code, not manually set
  readonly context?: Readonly<Record<string, unknown>>;
}
```

**Key design decision (line 17):** `retryable` is **derived from the error code's retry policy** via `getRetryPolicy(code).retryable`, not set manually. This prevents inconsistencies between error classification and retry behavior.

### 4.4 FactoryResult Type (line 20)

```typescript
type FactoryResult<T> = Result<T, FactoryError>;
```

This is the `neverthrow` `Result` type parameterized with `FactoryError`. Used extensively throughout the codebase (88+ import sites across `packages/db`, `packages/temporal-activities`, `packages/temporal-workflows`). It is the primary error-handling pattern at domain boundaries.

---

## 5. Type System and Validation

### 5.1 Zod as Single Source of Truth

Every domain type is derived from a Zod schema via `z.infer<>`. There are zero hand-written parallel type definitions. This convention is documented in `.claude/rules/conventions.md`.

### 5.2 `.strict()` on All Object Schemas

Every `z.object()` call uses `.strict()`, which rejects extra/unknown fields at parse time. This is a defense-in-depth measure against field injection. Explicitly tested in:
- `__tests__/schemas.test.ts` lines 75-78 (TaskSchema), 170-176 (EvidenceBundle), 206-212 (PolicyConfig), 298-304 (SetupContract)
- `__tests__/capability-schema.test.ts` lines 76-80 (CapabilitySnapshot)
- `__tests__/validation-schema.test.ts` lines 60-66 (ValidationResult)

### 5.3 Enum Pattern

All enums follow a consistent three-line pattern:
```typescript
export const VALUES = ["a", "b", "c"] as const;        // runtime array
export const Schema = z.enum(VALUES);                   // Zod schema
export type Type = z.infer<typeof Schema>;              // TypeScript type
```

This gives runtime value array, Zod validator, and TypeScript type from a single source.

### 5.4 Discriminated Unions

`RulesetRuleSchema` (capability.ts lines 125-225) uses `z.discriminatedUnion("type", [...])` with 18 variants. Each variant has `type` as the discriminator literal. This is the most complex schema in the codebase.

### 5.5 Null vs Undefined Convention

- `nullable()` -- fields that exist but may have no value (e.g., `budgetCents`, `protectionClass`, `setupContractPath`)
- `optional()` -- fields that may be entirely absent (e.g., `LLMCallAuditEntry.reasoningTokens`, `TestDetail.durationMs`)
- `.nullable().optional()` -- maximum flexibility on write DTOs (e.g., `CreateTaskSchema.scope`)

---

## 6. All Invariants and Business Rules Encoded in Code

### 6.1 State Machine Invariants (state-machine.ts)

1. **Adjacency enforcement:** Only transitions defined in `TASK_TRANSITIONS` are legal. No implicit transitions.
2. **Terminal absorption:** `merged`, `failed`, `cancelled` have empty transition sets. No recovery from terminal states.
3. **Universal cancellation:** Every non-terminal state has `cancelled` as a valid target (wildcard rule, lines 65-68).
4. **Dual failure paths:** Only `in_progress` and `merge_ready` can transition to `failed`.
5. **Mandatory evidence review:** Must pass through `evidence_ready` before reaching `approved`. Cannot skip from `in_progress` to `approved`.
6. **Mandatory approval before PR:** Must pass through `approved` to reach `pr_created`. Cannot skip from `evidence_ready` to `pr_created`.
7. **Changes re-enter execution:** `changes_requested` -> `in_progress` forces full re-execution cycle.

### 6.2 Policy Invariants (decision-service.ts)

1. **Default exclusions are always enforced:** Even with zero user-defined policies, secrets/keys/env files/.git/node_modules are blocked (lines 15-25).
2. **Priority ordering is fixed and hardcoded:** `read_exclusion` > `edit_deny` > `edit_protected` > `edit_allowed` (lines 42-47). Cannot be changed by configuration.
3. **Inactive policies are transparent:** Setting `isActive: false` removes a policy from evaluation without deleting it (line 39).
4. **Index-time governance:** `read_exclusion` blocks `index` and `search` operations, not just `read` (lines 59-67). Prevents excluded content from leaking into code indexes.
5. **Default-allow:** No matching policy means allowed with no approval (lines 96-102).

### 6.3 Trusted Base Context Invariants (trusted-context.ts)

1. **Base SHA pinning:** Behavioral control files and policies are captured from the base branch SHA at task intake.
2. **Immutability:** The trusted context is frozen at capture time -- candidate branch edits cannot alter agent behavior or validation criteria.
3. **Policy snapshot isolation:** Downstream phases consume the policy snapshot from intake, not live policy state.
4. **Validation command provenance:** `validationCommandSources` tracks where test/lint commands originated (for evaluator integrity auditing).

### 6.4 Error Handling Invariants (error-codes.ts, factory-error.ts)

1. **Retryability is code-derived:** `FactoryError.retryable` comes from `getRetryPolicy(code).retryable`, not manual assignment. Tested at `__tests__/errors.test.ts` lines 83-89.
2. **Policy violations are never retryable:** `policy_denied` has `retryable: false, maxAttempts: 1`.
3. **Evidence integrity failures are never retryable:** `evidence_invariant_fail` has `retryable: false, maxAttempts: 1`.
4. **Every error code has a retry policy:** Complete coverage enforced by `Record<ErrorCode, ErrorRetryPolicy>` type.

### 6.5 Evidence Bundle Invariants (evidence.ts)

1. **13 mandatory evidence fields:** All fields must be present (enforced by strict Zod schema, tested at `__tests__/schemas.test.ts` line 165-168).
2. **Schema versioning:** `schemaVersion` field (positive integer) enables future evolution.
3. **Attempt tracking:** `attemptNumber` (positive integer) distinguishes retried attempts.
4. **Three SHA references:** `baseSha`, `headSha`, `mergeBaseSha` provide full merge context.
5. **Risk levels are constrained:** `low`, `medium`, `high` only.
6. **Revertability is classified:** `clean_revert`, `revert_with_migration`, `non_revertable` only.

### 6.6 Validation Invariants (validation.ts)

1. **Validator control file edit tracking:** Any edit to test_config, lint_config, security_config, ci_config, or factory_config files is tracked with both base ref hash and workspace hash (evaluator integrity).
2. **Trusted context usage flag:** `trustedContextUsed` boolean confirms the trusted base context was actually used during validation.

### 6.7 Autonomy Level Invariants (autonomy.ts)

1. **L1 is the default:** `DEFAULT_AUTONOMY_LEVEL = "L1"`.
2. **Per-repo and per-policy override:** Both `Repository.autonomyLevel` and `PolicyConfig.autonomyLevel` can override the system default.
3. **L2 is deferred:** Documented as "Deferred to Phase 2" in the comment (lines 8-10).

### 6.8 Configuration Invariants (config.ts)

1. **Review timeout default:** 4 hours (14,400,000 ms). Exported as `REVIEW_TIMEOUT_MS_DEFAULT`.
2. **Sandbox defaults:** 4GB memory, 2 CPUs, 256 PIDs, network mode "none" (no network access for agents).
3. **LLM budget defaults:** $10/task, $100/daily.

### 6.9 Schema-Level Invariants (all schema files)

1. **All object schemas use `.strict()`:** Rejects unknown fields.
2. **UUIDs validated:** `z.string().uuid()` on all ID fields.
3. **Non-empty strings:** `z.string().min(1)` on all human-readable/identifier strings.
4. **Non-negative integers:** `z.number().int().nonnegative()` on all count/metric fields.
5. **ISO datetime validation:** `z.string().datetime()` on all timestamp fields.
6. **Path patterns must be non-empty:** `z.array(z.string().min(1)).min(1)` on PolicyConfig.pathPatterns.

---

## 7. Cross-Package Consumption

`@software-factory/core` is imported by every other package in the monorepo:

| Consumer Package | Primary Imports |
|-----------------|-----------------|
| `packages/db` | `TaskState`, `FactoryResult`, `createFactoryError`, evidence types |
| `packages/temporal-workflows` | `TaskState`, `TrustedBaseContext`, `PolicyConfig`, `SetupContract`, `AutonomyLevel`, `CodeownersEntry` |
| `packages/temporal-activities` | Nearly everything -- `FactoryResult`, `createFactoryError`, `evaluatePath`, `PolicyConfig`, `EvidenceBundleSchema`, `CapabilitySnapshot`, capability sub-schemas, `LLMCallAuditEntry`, `SetupContract`, `TrustedBaseContext` |
| `packages/api` | `ActorIdentity`, `Role`, `RoleSchema`, `FactoryError` |
| `apps/dashboard` | `TaskState`, `WorkflowPhase`, `WORKFLOW_PHASES`, `TASK_STATES` |
| `packages/e2e` | Evidence types, task types |

---

## 8. Test Coverage Summary

6 test files, covering all major domain surfaces:

### `__tests__/schemas.test.ts`
- TaskState: all 16 valid states, rejects invalid
- TaskSchema: uuid validation, required fields, `.strict()` rejects extras
- CreateTaskSchema: required objective, valid minimal input
- EvidenceBundle: 13 mandatory fields, revertability enum, `.strict()`
- PolicyConfig: pathPatterns min 1, `.strict()`
- AutonomyLevel: L0/L1/L2 accepted, L3 rejected, lowercase rejected
- FactoryConfig: defaults (review timeout 4h)
- SetupContract: required version/image, `.strict()`

### `__tests__/state-machine.test.ts`
- All 21 explicit valid transitions (positive tests)
- 13 invalid transitions (negative tests, including terminal-to-anything)
- Terminal states have zero outgoing transitions
- `isTerminal` correctness for all 16 states
- Universal cancellation from all 13 non-terminal states
- Paused transitions (resume and cancel)
- `getValidTransitions` cardinality for created (3), in_progress (4), external_checks_pending (4), merged (0)
- `TASK_TRANSITIONS` map has entry for every state

### `__tests__/policy-decision-service.test.ts`
- Default exclusion patterns (secrets, .env, .pem, .key, .p12, .pfx, .jks, .git, node_modules)
- Governance exclusion matching (12 blocked paths, 4 allowed paths)
- `evaluatePath`: governance exclusion deny, default allow, read_exclusion deny, edit_deny deny (with protection class), edit_protected allow+requiresApproval (with protection class), edit_allowed allow
- Inactive policy skipping
- read_exclusion blocking index and search operations
- `evaluateChangedPaths` batch evaluation
- Picomatch glob patterns: `**/*.pem`, `secrets/**`, `.env*`
- Policy priority: edit_deny beats edit_allowed for same path

### `__tests__/errors.test.ts`
- Exactly 11 error codes
- Every code has a retry policy with correct types
- Specific policies: policy_denied (non-retryable, 1 attempt), github_transient (retryable, 8), sandbox_failure (retryable, 3), model_rate_limited (retryable, 6), evidence_invariant_fail (non-retryable, 1), unknown_internal (non-retryable, 1)
- `createFactoryError` with and without context
- Retryable derived from error code (not manual)

### `__tests__/capability-schema.test.ts`
- Full CapabilitySnapshot validation
- Missing required fields rejected
- Invalid enum values rejected (repoClass "D", visibility "secret")
- `.strict()` rejects extras
- Full branchProtection with all fields
- Rulesets with bypass actors and rules
- Codeowners with entries
- Merge queue config
- All sub-schemas independently: BypassActor, RequiredStatusCheck, RequiredWorkflow, PushRestrictions, Codeowners, MergeQueue, BranchProtection, RulesetRule (pull_request, required_status_checks, pattern), Ruleset

### `__tests__/validation-schema.test.ts`
- Full ValidationResult validation
- Missing required fields rejected
- `.strict()` rejects extras
- ValidatorControlFileEdit: valid categories, invalid category rejected
- SBOMEntry: all 6 supported types, invalid type rejected

---

## 9. Observations and Potential Gaps

### 9.1 Design Strengths

- Pure domain kernel with zero runtime dependencies -- safe for Temporal V8 isolate
- Zod single-source-of-truth eliminates type drift between schemas and TypeScript types
- `.strict()` on every object schema catches field injection at parse boundaries
- Policy engine is pure functions with deterministic, priority-based evaluation
- Error handling is structured with code-derived retry policies preventing inconsistency
- State machine covers the full PRD dual-boundary lifecycle (internal evidence + external merge readiness)
- TrustedBaseContext implements the evaluator integrity guarantee (R-011)
- Comprehensive test coverage of all domain invariants

### 9.2 Potential Gaps / Areas for Future Work

1. **No domain events:** State transitions do not emit events. Audit logging is handled at the activity/repository layer, not in core. This means the state machine is purely a transition validator, not an event source.

2. **No transition guards beyond adjacency:** The state machine validates _which_ transitions are legal but does not encode _conditions_ (e.g., "evidence_ready requires an evidence bundle to exist"). Those guards presumably live in the Temporal workflow layer.

3. **No AutonomyLevel enforcement in core:** The autonomy level is defined and typed here, but the enforcement logic (what operations require approval at each level) lives in the workflow/activity layer.

4. **ReviewState vs TaskState are disconnected:** Two separate state enums exist -- `ReviewState` in `github.ts` has 10 states; `TaskState` in `task.ts` has 16 states. There is significant overlap (both have `evidence_ready`, `approved`, `changes_requested`, `merged`). The mapping between them is not codified in core.

5. **WORKFLOW_PHASES vs TaskState mapping is implicit:** 11 workflow phases vs 16 task states. The correspondence is not encoded in code.

6. **`scope` and `constraints` are untyped:** Both use `z.record(z.string(), z.unknown())` -- free-form bags with no structure. Future work may want structured schemas for common scope/constraint patterns.

7. **No schema migration story:** `EvidenceBundleSchema` has `schemaVersion` but there is no migration/upgrade logic in core for handling older schema versions.

8. **Policy evaluation does not consider autonomy level:** The `PolicyConfig` has an `autonomyLevel` field, but `evaluatePath` does not use it. The autonomy-level-based decision branching presumably happens in the calling code.
