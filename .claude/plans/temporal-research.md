# Temporal Workflow System -- Deep Analysis

**Date:** 2026-03-20
**Scope:** Complete analysis of all Temporal workflow, activity, and worker code

---

## 1. Architecture Overview

The Temporal workflow system spans three packages:
- `packages/temporal-workflows/` -- V8 isolate-safe workflow code (no Node.js APIs)
- `packages/temporal-activities/` -- Node.js activity implementations with side effects
- `packages/worker/` -- Worker process that connects workflows to activities

All three packages pin `@temporalio/*` at version `1.14.1`. The single task queue is `"sf-orchestration"`.

---

## 2. Workflows

### 2.1 `taskOrchestrator` (Parent Orchestrator)

**File:** `packages/temporal-workflows/src/orchestrator.ts` (1025 lines)

The parent workflow that manages the entire lifecycle of a software engineering task. It spawns child workflows for each phase and maintains mutable state across the lifecycle.

**Input:** `TaskWorkflowInput` (line 64-81)
- `taskId`, `repoId`, `repoOwner`, `repoName`, `objective`
- `autonomyLevel`: `"L0" | "L1" | "L2"` -- controls human approval gates
- `config`: `{ reviewTimeoutMs, costBudgetCents, maxImplementationAttempts }`
- `resumeFromPhase?` -- for Continue-As-New resumption
- Persisted state fields for CAN: `trustedContext`, `capabilitySnapshot`, `setupResult`, `implementResult`, `validateResult`

**Phase execution order (line 85-97):**
```
intake -> understand -> plan -> setup -> implement -> validate -> evidence -> review -> pr_creation -> pr_tracking -> learn
```

**Mutable workflow state (lines 121-150):**
- `killed`, `killInfo` -- kill signal state
- `currentPhase` -- current phase name
- `currentState` -- TaskState enum
- `attemptNumber`, `phaseIteration` -- iteration tracking
- `costBudgetCents`, `costCents` -- cost accounting
- `trustedContext`, `capabilitySnapshot` -- security context
- `understandResult`, `planText`, `setupResult`, `implementResult`, `validateResult` -- inter-phase data
- `evidenceLocator`, `prResult` -- downstream phase results
- `addressingFeedback` -- flag for external review feedback loop
- Protected by `async-mutex` Mutex in signal handlers

**Signals handled (lines 154-262):**

| Signal | Handler behavior |
|--------|-----------------|
| `killSignal` | Sets `killed = true` with actor/reason |
| `approveSignal` | Updates `lastActivityAt` (actual processing in child review/implement) |
| `rejectSignal` | Updates `lastActivityAt` (actual processing in child review/implement) |
| `changesRequestedSignal` | Updates `lastActivityAt` (actual processing in child review) |
| `resumeSignal` | Updates `lastActivityAt` |
| `clarifyResponseSignal` | Updates `lastActivityAt` (actual processing in child clarify) |
| `costOverrideSignal` | Modifies `costBudgetCents` at parent level |
| `prReviewSignal` | Updates `lastActivityAt` (actual processing in child pr_tracking) |
| `checkCompleteSignal` | Updates `lastActivityAt` (actual processing in child pr_tracking) |
| `prClosedSignal` | Updates `lastActivityAt` (actual processing in child pr_tracking) |
| `mergeQueueUpdateSignal` | Updates `lastActivityAt` (actual processing in child pr_tracking) |

The parent registers handlers for ALL signals to prevent "unhandled signal" warnings from Temporal. The actual signal processing happens in the child workflows that register their own handlers.

**Queries (lines 266-283):**
- `getStateQuery` -- returns `TaskState`
- `getProgressQuery` -- returns `WorkflowProgress` (taskId, currentPhase, state, attemptNumber, phaseIteration, timing, cost)
- `getPhaseQuery` -- returns current phase name string

**Continue-As-New (lines 303-317):**
Triggered when `continueAsNewSuggested` is true or `historyLength > 10,000`. Drains all handlers via `condition(allHandlersFinished)` first, then continues with persisted state including `resumeFromPhase`, inter-phase results, and iteration counters.

**Versioning (`patched()`) usage:**
- `m12-real-understand`, `m12-real-plan`, `m12-real-setup`, `m12-real-implement`
- `m13-real-validate`
- `m14-real-evidence`
- `m16-real-pr-creation`
- `m17-real-pr-tracking`
- `m18-merge-execution`, `m18-real-learn`, `m18-cleanup-consolidation`

Each `patched()` call gates real implementations vs legacy stubs, enabling safe replay of old workflows while new workflows take full implementation paths.

**Child workflow IDs:**
- Format: `task-{taskId}-{phaseName}` for non-repeating phases
- Format: `task-{taskId}-{phaseName}-{phaseIteration}` for repeating phases
- Phases needing iteration suffix: `implement`, `validate`, `evidence`, `review`, `pr_tracking`

**Feedback loops:**

1. **Internal review loop (lines 629-643):** `review` returns `changes_requested` -> increments `phaseIteration` -> loops back to `implement` (up to `maxImplementationAttempts`). On max exceeded, fails.

2. **External review loop (lines 883-903):** `pr_tracking` returns `changes_requested` -> sets `addressingFeedback = true` -> increments `phaseIteration` -> loops back to `implement`. The `addressingFeedback` flag causes the orchestrator to skip internal `review` and `pr_creation` on re-entry (the PR already exists).

**Merge execution (lines 800-881):**
After `pr_tracking` returns `merge_ready`, the orchestrator (not a child workflow) directly invokes merge activities:
1. `checkMergeReadiness` -- pre-merge safety check
2. `mergePullRequest` -- actual merge (uses `selectMergeMethod` to prefer squash > merge > rebase)
3. `deleteBranch` -- post-merge cleanup in `CancellationScope.nonCancellable`

Merge queue support: if `mergeResult.mergeQueuePosition` is set, treated as optimistic success.

**Cleanup (lines 945-1023):**
Non-cancellable scope that runs on ALL terminal paths:
1. Releases branch lease (best-effort)
2. Destroys sandbox if `setupResult?.sandboxInstance?.containerId` exists (best-effort)
3. Persists terminal state (`merged`, `failed`, or `cancelled`) via `transitionTaskState`

Drains all signal handlers via `condition(allHandlersFinished)` before completing.

---

### 2.2 `intakePhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/intake.ts` (93 lines)

Creates a task record in the database and transitions its state. Checks the kill switch first.

**Activities used:**
- `TaskActivities.createTask` (startToCloseTimeout: 30s, retry: 5)
- `SafetyActivities.checkKillSwitch` (startToCloseTimeout: 10s, retry: 3)
- `TaskActivities.transitionTaskState` (30s, 5)

**Flow:**
1. Check kill switch -> throw `ApplicationFailure.nonRetryable` if active
2. Create task in DB (state: `created`)
3. If `needsClarification`, transition to `needs_clarification` and return
4. Otherwise, transition to `assigned` and return

**State transitions:** `created -> needs_clarification` OR `created -> assigned`

---

### 2.3 `clarifyPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/clarify.ts` (58 lines)

Blocks indefinitely until a human sends a `clarifyResponseSignal`. **No timeout** -- the human must respond.

**Signal:** Registers handler for `clarifyResponseSignal` that sets `clarificationResponse`
**Blocking:** `await condition(() => clarificationResponse !== undefined)`

**Activities:** `TaskActivities.transitionTaskState` (30s, 5)
**State transitions:** `needs_clarification -> assigned`
**Output:** Updated objective with clarification appended

---

### 2.4 `understandPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/understand.ts` (119 lines)

Runs capability scan (discovers GitHub repo settings), captures TrustedBaseContext (pinned base SHA, policies), and indexes the repository for a repo map.

**Activities used:**
- `SafetyActivities.checkKillSwitch` (10s, 3)
- `TaskActivities.transitionTaskState` (30s, 5) -- transitions to `in_progress`
- `GitHubActivities.scanRepository` (5m, 3)
- `GitHubActivities.captureTrustedContext` (5m, 3)
- `IndexActivities.indexRepositoryActivity` (10m, heartbeat 2m, 2)

**Flow:**
1. Kill switch check
2. Transition to `in_progress`
3. Scan repository capabilities (discovers `defaultBranch`, branch protection, merge strategies)
4. Capture TrustedBaseContext using discovered default branch
5. Index repository (tree-sitter parsing, symbol extraction, import analysis)
6. Extract top 20 files by rank from repo map

**Output:** `UnderstandResult` with `capabilitySnapshot`, `trustedContext`, `repoMap`, `relevantFiles`, `indexVersionId`

---

### 2.5 `planPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/plan.ts` (109 lines)

Uses an LLM to generate a structured implementation plan from the repo map and objective. Persists the plan as an audit entry.

**Activities used:**
- `SafetyActivities.checkKillSwitch` (10s, 3)
- `SafetyActivities.checkCostBudget` (10s, 3) -- estimated cost: 50 cents
- `PlanActivities.generatePlan` (5m, 2)
- `AuditActivities.insertAuditEntry` (30s, 3)

**Flow:**
1. Kill switch check
2. Cost budget check
3. LLM generates plan
4. Persist plan as audit entry with deterministic hash
5. Estimate complexity from file count (>10: high, >3: medium, else: low)

Contains workflow-safe `simpleHash` function (no crypto/Node.js APIs) at line 101-108 using bit shifting for audit content hashing.

---

### 2.6 `setupPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/setup.ts` (136 lines)

Provisions a Docker sandbox container and acquires a branch lease.

**Signals:** Defines local `approveSetupSignal` (line 39) for setup contract approval -- separate from the global `approveSignal`.

**Activities:**
- `SafetyActivities.checkKillSwitch` (10s, 3)
- `SandboxActivities.provisionSandbox` (5m, 2)
- `SafetyActivities.acquireBranchLease` (10s, 3) -- TTL: 3600s (1 hour)
- `TaskActivities.transitionTaskState` (30s, 5)

**Flow:**
1. Kill switch check
2. Load setup contract from TrustedBaseContext
3. If no setup contract: generate suggestion, transition to `paused`, block on `approveSetupSignal`, then resume to `in_progress`
4. Provision sandbox from contract
5. Acquire branch lease for `factory/{taskId}`
6. If lease denied: destroy sandbox, throw `ApplicationFailure.nonRetryable`

**Output:** `SetupResult` with `sandboxInstance`, `branchLease`, `setupContractUsed`

---

### 2.7 `implementPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/implement.ts` (226 lines)

Executes the LLM agent to implement changes, then pushes to a candidate branch.

**Autonomy Gate (lines 91-137):** At L0/L1, pauses task and blocks on `approveSignal` or `rejectSignal`. L2 skips entirely.

**Signals:** `approveSignal`, `rejectSignal` (used for L0/L1 autonomy gate)

**Activities:**
- `SafetyActivities.checkKillSwitch` (10s, 3)
- `SafetyActivities.checkCostBudget` (10s, 3) -- estimated cost: 100 cents
- `SafetyActivities.recordCost` (implicit via safety)
- `LLMActivities.executeAgentStep` (30m, heartbeat 5m, **1 retry**)
- `GitHubActivities.createCandidateBranch` (5m, 3) -- only on first iteration
- `GitHubActivities.pushChanges` (5m, 3)
- `SandboxActivities.execInSandbox` (2m, 2) -- for `git diff` and `cat`
- `TaskActivities.transitionTaskState` (30s, 5)

**Flow:**
1. Kill switch check
2. Autonomy gate (L0/L1): pause -> wait for approve/reject -> resume or fail
3. Cost budget check
4. Execute LLM agent (objective + plan -> tool calls -> file modifications)
5. If files modified: create candidate branch (first iteration only), collect changed files from sandbox via `git diff --name-only`, read each file via `cat`, push via Git Database API
6. Record cost

**Output:** `ImplementResult` with `headSha`, `candidateBranch`, `filesChanged`, `agentResult` (files modified, cost, token counts)

---

### 2.8 `validatePhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/validate.ts` (250 lines)

Runs the full validation pipeline inside the sandbox.

**Activities:**
- `SafetyActivities.checkKillSwitch` (10s, 3)
- `AuditActivities.insertAuditEntry` (30s, 5)
- `ValidationActivities.runTests` (10m, heartbeat 2m, 1)
- `ValidationActivities.runLinter` (10m, heartbeat 2m, 1)
- `ValidationActivities.runSecurityScan` (10m, heartbeat 2m, 1)
- `ValidationActivities.computeBlastRadius` (10m, heartbeat 2m, 1)
- `ValidationActivities.checkValidatorBoundary` (10m, heartbeat 2m, 1)
- `ValidationActivities.getChangedFiles` (10m, heartbeat 2m, 1)

**Flow:**
1. Kill switch check
2. Audit: validation started
3. Get changed files (from input or sandbox `git diff`)
4. Determine test/lint commands from `TrustedBaseContext.validationCommandSources` (trusted, not from agent-modified files)
5. Run test suite
6. Run linter
7. Run security scanner (Semgrep)
8. Compute blast radius
9. Check validator boundary integrity (detect if agent modified test/lint config)
10. Determine pass/fail: `testsPassed && lintPassed && noCriticalVulnerabilities`
11. Audit: validation completed

**Output:** `ValidateResult` with full validation data, `passed` boolean, summary string

---

### 2.9 `evidencePhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/evidence.ts` (146 lines)

Generates an evidence packet from validation results, uploads to MinIO, persists to Postgres.

**Activities:**
- `SafetyActivities.checkKillSwitch` (10s, 3)
- `AuditActivities.insertAuditEntry` (30s, 5)
- `EvidenceActivities.generateAndPersistEvidence` (10m, heartbeat 2m, 1)
- `TaskActivities.transitionTaskState` (30s, 5) -- to `evidence_ready`

**Output:** `EvidenceResult` with `bundleId`, `locator` (S3 keys), `riskSummary` (hardBlockers, softConcerns, humanJudgmentRequired, informational), `passed`

---

### 2.10 `reviewPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/review.ts` (107 lines)

Handles internal human review with configurable timeout.

**Signals:** `approveSignal`, `rejectSignal`, `changesRequestedSignal`
**First-signal-wins pattern:** Each handler checks `if (!result)` before setting result.

**Blocking:** `condition(() => result !== undefined, input.reviewTimeoutMs)`

**On timeout:** Inserts escalation audit entry, transitions to `failed`, returns `timed_out`.

**Outcomes:** `"approved"`, `"rejected"`, `"changes_requested"`, `"timed_out"`

---

### 2.11 `prCreationPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/pr-creation.ts` (244 lines)

Creates a GitHub PR with factory check runs and auto-merge configuration.

**Activities (destructured from proxies):**
- `checkKillSwitch` (10s, 3)
- `transitionTaskState` (10s, 3) -- to `pr_created`
- `createPullRequest` (60s, 3)
- `createFactoryCheckRun`, `uploadSarif` (60s, 3)
- `enableAutoMerge`, `enqueuePullRequest` (30s, 2) -- best-effort
- `createReviewState` (10s, 3)

**Flow:**
1. Kill switch check
2. Transition to `pr_created`
3. Create PR (idempotent via side-effects ledger)
4. Create factory check run with validation results
5. Upload SARIF (best-effort)
6. Auto-merge or merge queue (best-effort, based on `capabilitySnapshot.mergeQueue`)
7. Persist review state for PR tracking

**Legacy path:** `patched("m16-real-pr-creation")` gates real vs stub.

---

### 2.12 `prTrackingPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/pr-tracking.ts` (345 lines)

Long-lived child workflow that monitors PR state via signals and reconciliation.

**Signals handled:**
- `prReviewSignal` -- per-reviewer state tracking (approved/changes_requested/commented/dismissed). Approved overrides prior changes_requested from same reviewer and vice versa.
- `checkCompleteSignal` -- tracks CI check results in a Map
- `prClosedSignal` -- terminal signal
- `mergeQueueUpdateSignal` -- updates merge queue status
- `killSignal` -- sets killed flag

**Query:** `getPRStateQuery` -- returns `PRStateSnapshot` with full PR state

**Merge readiness evaluation (lines 129-146):**
```
reviewsMet = approvedBy.length >= requiredReviewCount AND changesRequestedBy.length === 0
codeOwnerMet = !requiresCodeOwnerReview OR approvedBy.length > 0
checksMet = requiredChecks.every(check => checksCompleted.get(check) === "success")
threadsMet = unresolvedThreads === 0
isMergeReady = reviewsMet AND codeOwnerMet AND checksMet AND threadsMet AND !staleReviews
```

**Reconciliation loop (lines 269-328):**
- Tracking timeout: 7 days
- Reconciler interval: 5 minutes
- Uses `condition()` with `Math.min(reconcilerIntervalMs, remainingTimeout)` to wait for signals
- On no signals within interval: calls `reconcileActivities.reconcilePRState` to sync from GitHub API
- Applies reconciliation result (may discover PR was merged/closed externally)
- Updates review state in DB after reconciliation

**Outcomes:** `"merge_ready"`, `"changes_requested"`, `"pr_closed_merged"`, `"pr_closed_unmerged"`, `"timed_out"`

---

### 2.13 `learnPhase` (Child Workflow)

**File:** `packages/temporal-workflows/src/phases/learn.ts` (149 lines)

Records task metrics after completion. **Non-critical** -- all errors are caught and swallowed.

**Metrics computed:**
- `durationMs` -- from `startedAt` to `completedAt`
- `merged`, `attemptCount`, `phaseIterations`
- `totalCostCents`, `filesChanged`
- `linesAdded`, `linesRemoved` -- V1: set to 0 (not available without git diff)
- `timeToFirstEvidence`, `timeToMerge` -- V1: set to 0 (not tracked granularly)

**Activities:** `checkKillSwitch`, `insertAuditEntry` (try/catch, non-blocking), `transitionTaskState` (try/catch, non-blocking)

---

### 2.14 `reconciliationWorkflow` (Standalone Scheduled Workflow)

**File:** `packages/temporal-workflows/src/reconciliation.ts` (21 lines)

Runs as a Temporal scheduled workflow. Calls `BroadReconcilerActivities.reconcileAllResources` (2m timeout, 3 retries). Catches drift in active GitHub PRs.

---

## 3. Signals and Queries

**File:** `packages/temporal-workflows/src/signals.ts` (57 lines)

### 3.1 Human-Initiated Signals

| Signal Name | Temporal ID | Payload |
|---|---|---|
| `killSignal` | `"kill"` | `{ actor: string; reason?: string }` |
| `approveSignal` | `"approve"` | `{ actor: string; scope?: string }` |
| `rejectSignal` | `"reject"` | `{ actor: string; reason: string }` |
| `changesRequestedSignal` | `"changes_requested"` | `{ actor: string; message: string }` |
| `resumeSignal` | `"resume"` | `{ actor: string }` |
| `clarifyResponseSignal` | `"clarify_response"` | `{ actor: string; response: string }` |
| `costOverrideSignal` | `"cost_override"` | `{ actor: string; newBudgetCents: number }` |

### 3.2 GitHub Lifecycle Signals

| Signal Name | Temporal ID | Payload |
|---|---|---|
| `prReviewSignal` | `"pr_review"` | `{ action: string; state: string; reviewer: string }` |
| `checkCompleteSignal` | `"check_complete"` | `{ checkName: string; conclusion: string }` |
| `mergeQueueUpdateSignal` | `"merge_queue_update"` | `{ status: string }` |
| `prClosedSignal` | `"pr_closed"` | `{ merged: boolean }` |

### 3.3 Queries

| Query Name | Temporal ID | Return Type |
|---|---|---|
| `getStateQuery` | `"getState"` | `TaskState` |
| `getProgressQuery` | `"getProgress"` | `WorkflowProgress` |
| `getPhaseQuery` | `"getPhase"` | `string` |

`WorkflowProgress`: `{ taskId, currentPhase, state, attemptNumber, phaseIteration, startedAt, lastActivityAt, costCents, costBudgetCents }`

---

## 4. Task State Machine

**File:** `packages/core/src/state-machine.ts` (97 lines)

16 states total. 13 non-terminal, 3 terminal.

**States:** `created`, `needs_clarification`, `assigned`, `in_progress`, `paused`, `evidence_ready`, `changes_requested`, `approved`, `pr_created`, `external_checks_pending`, `addressing_review_feedback`, `external_blocked`, `merge_ready`, `merged`, `failed`, `cancelled`

**Key transition paths:**
```
created -> needs_clarification -> assigned
created -> assigned -> in_progress
in_progress -> evidence_ready -> approved -> pr_created
in_progress -> paused -> in_progress (resume)
in_progress -> failed
evidence_ready -> changes_requested -> in_progress (feedback loop)
pr_created -> external_checks_pending -> merge_ready -> merged
external_checks_pending -> addressing_review_feedback -> external_checks_pending
external_checks_pending -> external_blocked -> external_checks_pending
merge_ready -> failed
Any non-terminal -> cancelled (wildcard)
```

**Note:** Not all defined state transitions are currently exercised by the workflow code. States like `external_checks_pending`, `addressing_review_feedback`, and `external_blocked` exist in the state machine but the orchestrator workflow currently transitions more directly (e.g., from `pr_created` to `merge_ready`). This suggests the state machine was designed for a more granular future implementation.

---

## 5. Activity Types and Implementations

### 5.1 Activity Type Definitions

**File:** `packages/temporal-workflows/src/activity-types.ts` (832 lines)

This file contains ONLY type definitions -- no runtime code. It is imported by workflow code running in the V8 isolate. All interfaces use `readonly` properties.

**Interface groups:**
- `TaskActivities` (4 methods)
- `AuditActivities` (1 method)
- `SafetyActivities` (6 methods)
- `SandboxActivities` (4 methods)
- `GitHubActivities` (6 methods)
- `LLMActivities` (1 method)
- `IndexActivities` (1 method)
- `PlanActivities` (1 method)
- `ValidationActivities` (6 methods)
- `EvidenceActivities` (1 method)
- `PRActivities` (2 methods)
- `CheckRunActivities` (3 methods)
- `AutoMergeActivities` (2 methods)
- `ReviewStateActivities` (3 methods)
- `ReviewTrackerActivities` (1 method)
- `MergeActivities` (3 methods)
- `LearnActivities` (1 method)
- `BroadReconcilerActivities` (2 methods)

### 5.2 Activity Implementations

#### TaskActivities (DB)
**File:** `packages/temporal-activities/src/db/task-activities.ts` (74 lines)
- `createTask(input)` -- inserts task via `taskRepo.createTask`
- `transitionTaskState(taskId, newState, actor, auditContent)` -- atomic state change + audit entry via `taskRepo.transitionTaskState`
- `getTask(taskId)` -- lookup via `taskRepo.getTask`
- `listActiveTasks(repoId?)` -- list non-terminal tasks
- Uses `neverthrow Result` internally; converts `.isErr()` to `ApplicationFailure` (retryable or nonRetryable based on error code)

#### AuditActivities (DB)
**File:** `packages/temporal-activities/src/db/audit-activities.ts` (37 lines)
- `insertAuditEntry(entry)` -- persists via `auditRepo.insertAuditEntry`, computes content hash if not provided

#### SafetyActivities (Redis)

**Kill check:** `packages/temporal-activities/src/safety/kill-check.ts` (20 lines)
- `checkKillSwitch(taskId)` -- Redis `MGET` on `factory:kill_switch` (global) and `factory:kill:{taskId}` (per-task)

**Cost check:** `packages/temporal-activities/src/safety/cost-check.ts` (60 lines)
- `checkCostBudget(taskId, estimatedCost)` -- reads `factory:cost:{taskId}` and `factory:budget:{taskId}`, projects cost
- `recordCost(taskId, costCents)` -- `INCRBY` on task + daily counters, daily key expires in 86400s

**Branch lease:** `packages/temporal-activities/src/safety/branch-lease.ts` (79 lines)
- `acquireBranchLease` -- Lua: `SET NX EX` (atomic check-and-set with TTL)
- `releaseBranchLease` -- Lua: `GET` + owner check + `DEL` (only release if you own it)
- `renewBranchLease` -- Lua: `GET` + owner check + `EXPIRE`
- Key format: `factory:branch_lease:{branch}`

#### SandboxActivities (Docker)
**Files:** `packages/temporal-activities/src/sandbox/` (9 files: index, activities, supervisor, exec, monitor, cleanup, network, secrets, cache)
- `provisionSandbox(config)` -- Docker container creation with repo, setup commands, resource limits
- `execInSandbox(containerId, cmd, secrets?)` -- Docker exec with secret injection
- `destroySandbox(containerId)` -- container removal
- `cleanupOrphans()` -- finds/removes orphaned factory containers by label

#### GitHubActivities (Octokit)
**File:** `packages/temporal-activities/src/github/activities.ts` (391 lines) -- facade wrapping sub-modules:
- `github/capability-scan.ts` -- discovers branch protection, rulesets, CODEOWNERS, merge strategies
- `github/trusted-context.ts` -- captures base SHA, setup contract, policies from pinned ref
- `github/branch.ts` -- createCandidateBranch, pushChanges, cloneRepo via Git Database API
- `github/pr.ts` -- PR creation with side-effects ledger idempotency
- `github/check-run.ts` -- GitHub check run with validation summary + annotations
- `github/auto-merge.ts` -- GraphQL mutation for auto-merge or merge queue enqueue
- `github/review-tracker.ts` -- reconcilePRState via GraphQL
- `github/merge.ts` -- checkMergeReadiness, mergePullRequest, deleteBranch
- `github/reconciler.ts` -- broad reconciliation of all active PRs
- `github/credential-broker.ts` -- per-phase GitHub App token scoping
- `github/rate-limiter.ts` -- mutation serialization for rate limit compliance

All methods use `CredentialBroker` for scoped tokens and `MutationSerializer` for rate limiting. Errors converted via `toApplicationFailure(error)` which respects the `retryable` flag on `FactoryError`.

#### IndexActivities (Tree-sitter)
**File:** `packages/temporal-activities/src/indexing/activities.ts`
- `indexRepositoryActivity(repoPath, commitSha, repoId, policies)` -- full code indexing pipeline

#### PlanActivities (LLM)
**File:** `packages/temporal-activities/src/llm/plan-activities.ts`
- `generatePlan(objective, repoMap, relevantFiles, model)` -- LLM via OpenRouter

#### LLMActivities (AI Agent)
**File:** `packages/temporal-activities/src/llm/activities.ts`
- `executeAgentStep(config)` -- Vercel AI SDK + OpenRouter with tool calls, guardrails, cost tracking

#### ValidationActivities
**Files:** `packages/temporal-activities/src/validation/` (7 files)
- `runTests` -- runs test suite in sandbox, parses Vitest/Jest/pytest/Go/Rust output
- `runLinter` -- runs linter, parses Biome/ESLint output
- `runSecurityScan` -- Semgrep + Grype, parses SARIF
- `computeBlastRadius` -- dependency graph analysis for impact
- `checkValidatorBoundary` -- detects agent modification of test/lint config
- `getChangedFiles` -- git diff in sandbox

#### EvidenceActivities (MinIO + Postgres)
**Files:** `packages/temporal-activities/src/evidence/` (9 files)
- `generateAndPersistEvidence` -- assembles evidence, uploads to MinIO, persists to Postgres, computes risk categorization

---

## 6. Worker Setup and Configuration

### 6.1 Entry Point
**File:** `packages/worker/src/index.ts` (37 lines)

Loads config, creates worker, registers SIGTERM/SIGINT for graceful shutdown via `worker.shutdown()`.

### 6.2 Worker Creation
**File:** `packages/worker/src/worker.ts` (185 lines)

**Connection:** `NativeConnection.connect({ address: config.temporalAddress })`

**Dependency injection pattern:** Each activity group is created with injected dependencies:
```
const taskActivities = createTaskActivities(db);
const auditActivities = createAuditActivities(db);
const safetyActivities = {
  ...createKillCheckActivity(redis),
  ...createCostCheckActivity(redis),
  ...createBranchLeaseActivity(redis),
};
const sandboxActivities = createSandboxActivities(docker);
const githubActivities = config.githubAppId ? createGitHubActivities({...}) : {};
const indexActivities = createIndexActivities({ db });
const llmActivities = config.openRouterApiKey ? {...} : {};
const evidenceActivities = config.minioSecretKey ? createEvidenceActivities({...}) : {};
```

**Conditional registration:** GitHub, LLM, and evidence activities are only created when their credentials are configured. This means the worker can run in a degraded mode (e.g., for testing without GitHub App credentials).

**Worker.create configuration (lines 151-180):**
- `namespace`: from config (default: `"default"`)
- `taskQueue`: `"sf-orchestration"`
- `workflowsPath`: `require.resolve("@software-factory/temporal-workflows")` -- Temporal bundles this for V8
- `activities`: flat spread of all activity groups
- `sinks`: OTel workflow exporter (if endpoint configured)
- `interceptors.activity`: `OpenTelemetryActivityInboundInterceptor` wraps all activities in OTel spans

### 6.3 Configuration
**File:** `packages/worker/src/config.ts` (47 lines)

**Required:** `DATABASE_URL`, `REDIS_URL`
**Optional with defaults:**
- `TEMPORAL_ADDRESS` -> `localhost:7233`
- `TEMPORAL_NAMESPACE` -> `default`
- `DOCKER_SOCKET_PATH` -> `/var/run/docker.sock`
- `MINIO_ENDPOINT` -> `http://localhost:9000`
- `MINIO_ROOT_USER` -> `factory`
- `MINIO_BUCKET` -> `factory-artifacts`
- `API_URL` -> `http://localhost:3000`
**Optional without defaults:** `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `OPENROUTER_API_KEY`, `MINIO_ROOT_PASSWORD`

### 6.4 Observability
**File:** `packages/worker/src/instrumentation.ts` (71 lines)

3-tier observability:
- **Tier 1 (always on):** Pino JSON logs with OTel trace correlation (`traceId`, `spanId` injected via mixin), Prometheus metrics on port 9464
- **Tier 2 (opt-in):** OTLP trace + metric export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (60s metric export interval)
- **Tier 3 (full):** Grafana/Jaeger via docker compose `--profile observability`

**Custom metrics** (`packages/worker/src/metrics.ts`, 81 lines):
- Task lifecycle: `factory.task.duration` (histogram, ms), `factory.task.count` (counter)
- LLM usage: `factory.llm.tokens`, `factory.llm.cost` (cents), `factory.llm.latency` (ms)
- Evidence: `factory.evidence.review_time` (ms)
- Sandbox: `factory.sandbox.duration` (ms)
- GitHub: `factory.github.api_calls`
- Safety: `factory.safety.kill_activations`, `factory.safety.circuit_trips`, `factory.safety.budget_overrides`

---

## 7. Complete Task Lifecycle

1. **API creates workflow:** `POST /api/tasks` (`packages/api/src/routes/tasks.ts` line 84) -> `temporalClient.workflow.start("taskOrchestrator", { taskQueue: "sf-orchestration", workflowId: "task-{uuid}", ... })`

2. **Intake:** Creates task in DB (`created`), checks kill switch, transitions to `assigned`

3. **Clarify (conditional):** If `needsClarification`, blocks until `clarify_response` signal

4. **Understand:** Scans GitHub repo capabilities, captures TrustedBaseContext, indexes code with tree-sitter, produces ranked repo map (top 20 files)

5. **Plan:** LLM generates structured implementation plan, persisted as audit entry

6. **Setup:** Provisions Docker sandbox, acquires branch lease (`factory/{taskId}`, 1-hour TTL). If no setup contract, blocks for human approval.

7. **Implement:** At L0/L1 blocks on approval. Executes LLM agent, collects modified files via `git diff` in sandbox, pushes to candidate branch via Git Database API. Records cost.

8. **Validate:** Runs tests, linter, security scanner, blast radius analysis in sandbox. Commands from TrustedBaseContext (not agent-modifiable). Detects validator control file edits.

9. **Evidence:** Generates evidence packet, uploads to MinIO, persists to Postgres. Transitions to `evidence_ready`.

10. **Review (internal):** Blocks on approve/reject/changes_requested with timeout. On `changes_requested`, loops back to step 7.

11. **PR Creation:** Creates GitHub PR, factory check run, SARIF upload, auto-merge, review state.

12. **PR Tracking:** Long-lived child monitoring via webhook signals + 5-min reconciliation. Evaluates merge readiness.

13. **Merge (in orchestrator):** Pre-check, merge (squash preferred), post-merge branch deletion.

14. **Learn:** Records metrics. Non-critical.

15. **Cleanup (always):** Releases branch lease, destroys sandbox, persists terminal state.

---

## 8. Retry Policies

| Activity Category | startToCloseTimeout | heartbeatTimeout | maximumAttempts | Notes |
|---|---|---|---|---|
| TaskActivities | 30s | - | 5 | DB operations |
| AuditActivities | 30s | - | 3-5 | Varies by caller |
| SafetyActivities (kill/cost) | 10s | - | 3 | Redis reads |
| SandboxActivities (provision) | 5m | - | 2 | Docker create |
| SandboxActivities (exec) | 2m | - | 2 | Docker exec |
| GitHubActivities (scan/context) | 5m | - | 3 | GitHub API |
| IndexActivities | 10m | 2m | 2 | Tree-sitter parse |
| PlanActivities | 5m | - | 2 | LLM call |
| LLMActivities (agent step) | **30m** | 5m | **1** | Expensive, long |
| ValidationActivities | 10m | 2m | **1** | Expensive |
| EvidenceActivities | 10m | 2m | **1** | Expensive |
| PRActivities | 60s | - | 3 | GitHub API |
| CheckRunActivities | 60s | - | 3 | GitHub API |
| AutoMergeActivities | 30s | - | 2 | GraphQL mutation |
| ReviewTrackerActivities | 60s | - | 3 | GraphQL query |
| MergeActivities | 60s | - | 2 | GitHub API |
| BroadReconcilerActivities | 2m | - | 3 | Scheduled |

**Design principle:** LLM, validation, and evidence activities have `maximumAttempts: 1` -- they are not retried because they are expensive and potentially non-idempotent.

---

## 9. Testing Approach

### 9.1 Workflow Tests (14 test files)

**Location:** `packages/temporal-workflows/__tests__/`
**Framework:** Vitest + `@temporalio/testing` with time-skipping

**Standard pattern:**
1. `TestWorkflowEnvironment.createTimeSkipping()` in `beforeAll` (60s timeout for Java server startup)
2. `Worker.create` with `workflowsPath` pointing to source `src/index.ts` and flat `activities` object of mock functions
3. `testEnv.client.workflow.start(workflowName, { taskQueue, workflowId, args })` to start workflow
4. Signal child workflows via `signalChildWhenRunning(childId, signal, payload)` helper that polls for RUNNING state
5. `handle.result()` to complete workflow (unlocks time-skipping)
6. Assert via `handle.query(queryDef)` for final state/progress

**Time-skipping behavior:** When `handle.result()` is called, the time-skipping server fast-forwards through timers. Signals must be sent BEFORE calling `result()` to prevent timeout conditions from firing prematurely.

**Mock activities pattern:** All mock activities are simple async functions returning hardcoded data. No mocking framework used. Tests verify behavior by:
- Checking query results after workflow completion
- Using spy-like patterns (e.g., `let recordedCost = 0; recordCost: async (_, cents) => { recordedCost = cents; ... }`)
- Overriding specific activities to test failure paths

**Test coverage by file:**

| Test file | What it tests |
|---|---|
| `orchestrator.test.ts` | Phase progression, kill signal, queries, approve/reject, changes_requested loop |
| `orchestrator-feedback-loop.test.ts` | PR tracking merge_ready, external changes_requested loop, max attempts, external merge |
| `merge-execution.test.ts` | merge_ready -> merge, pre-check failure, merge-409, merge queue, external merge, cleanup paths |
| `review-phase.test.ts` | Approve/reject/changes_requested/timeout, first-signal-wins |
| `implement-phase.test.ts` | L1 gate approve/reject, L2 skip, file changes, guardrail trip, cost recording |
| `pr-tracking-phase.test.ts` | merge_ready, changes_requested, pr_closed, kill, per-reviewer state, reconciler, 7-day timeout |
| `learn-phase.test.ts` | Metrics recording, duration, non-blocking failure |
| `m12-pipeline.test.ts` | Plan budget exceeded/audit, setup contract/lease-denied, implement L2 |
| `clarify-phase.test.ts` | Clarification signal handling |
| `understand-phase.test.ts` | Capability scan + index pipeline |
| `validate-phase.test.ts` | Full validation pipeline |
| `evidence-phase.test.ts` | Evidence generation and state transition |
| `pr-creation-phase.test.ts` | PR creation with check runs and auto-merge |
| `signals.test.ts` | Signal/query name verification |

### 9.2 Activity Tests (52 test files)

**Location:** `packages/temporal-activities/__tests__/`
**Pattern:** Pure unit tests with mocked dependencies. Some use Redis Testcontainers for integration tests.

**Categories:**
- `safety/` (7 files): kill-check, cost-check, branch-lease, circuit-breaker, budget-manager, kill-switch, with-circuit-breaker
- `github/` (10 files): credential-broker, rate-limiter, client, workflow-scanner, codeowners-parser, ruleset-analyzer, capability-scan, branch, trusted-context, pr, auto-merge, check-run, review-tracker, merge, reconciler
- `indexing/` (6 files): parser, governance-filter, repo-map, symbol-extractor, import-extractor, index-activities
- `sandbox/` (6 files): secrets, monitor, cache, network, supervisor, cache-integration
- `llm/` (7 files): context, edit-format, prompt-safety, agent, guardrails, cost-tracker, tools
- `validation/` (5 files): blast-radius, lint-runner, test-runner, validator-boundary, security-scanner
- `evidence/` (7 files): redaction, risk-summary, diff-annotator, locator, generator, artifact-store, manifest
- `db/` (1 file): task-activities

### 9.3 E2E Tests

**Location:** `packages/e2e/src/scenarios/` (8 test files)
- `happy-path.test.ts`, `kill-switch.test.ts`, `rejection.test.ts`, `feedback-loop.test.ts`
- `cost-budget.test.ts`, `concurrent-tasks.test.ts`, `safety-controls.test.ts`, `invariants.test.ts`

These use the full Temporal test environment with mock activities.

### 9.4 Worker Tests (2 files)

**Location:** `packages/worker/__tests__/`
- `metrics.test.ts`, `logger.test.ts` -- unit tests for OTel metric definitions and Pino logger mixin

---

## 10. Key Architectural Patterns

1. **V8 Isolate Safety:** `packages/temporal-workflows` uses ONLY `import type` for activity interfaces. Runtime activity access via `proxyActivities<T>()`. No Node.js APIs. Enforced by `verbatimModuleSyntax: true`.

2. **Determinism Patching:** `patched("m*-...")` for versioned evolution. Old workflows replay through stub paths; new workflows take real paths. This is Temporal's standard approach.

3. **Security-First Design:**
   - Kill switch checked at every phase entry
   - Cost budget checked before expensive operations
   - Branch leases prevent concurrent branch writes (atomic Lua scripts)
   - TrustedBaseContext pins validation commands to base ref
   - Per-phase GitHub token scoping via CredentialBroker
   - Side-effects ledger for PR/merge idempotency

4. **Non-Cancellable Cleanup:** Terminal cleanup runs in `CancellationScope.nonCancellable`.

5. **Single Task Queue:** All workflows and activities share `"sf-orchestration"`.

6. **Webhook-to-Signal Bridge:** API layer converts GitHub webhooks into Temporal signals dispatched to the parent orchestrator. Parent registers stub handlers; actual processing in child workflows.

7. **Graceful Degradation:** Worker creates activity implementations conditionally based on available credentials (GitHub App, OpenRouter, MinIO). Missing credentials result in empty activity objects.

8. **Concurrency Protection:** `async-mutex` Mutex in orchestrator signal handlers protects mutable workflow state.

---

## 11. Relevant File Paths

### Workflow Source (17 files)
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/orchestrator.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/signals.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/activity-types.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/reconciliation.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/index.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/intake.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/clarify.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/understand.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/plan.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/setup.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/implement.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/validate.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/evidence.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/review.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/pr-creation.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/pr-tracking.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/src/phases/learn.ts`

### Worker Source (7 files)
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/index.ts`
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/worker.ts`
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/config.ts`
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/interceptors.ts`
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/logger.ts`
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/metrics.ts`
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/instrumentation.ts`

### Key Activity Source
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/github/activities.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/db/task-activities.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/db/audit-activities.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/safety/kill-check.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/safety/cost-check.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/safety/branch-lease.ts`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/index.ts`

### State Machine + Types
- `/Users/seanflanagan/proj/software-factory/packages/core/src/state-machine.ts`
- `/Users/seanflanagan/proj/software-factory/packages/core/src/schemas/task.ts`

### API Integration
- `/Users/seanflanagan/proj/software-factory/packages/api/src/routes/tasks.ts`

### Package Manifests
- `/Users/seanflanagan/proj/software-factory/packages/temporal-workflows/package.json`
- `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/package.json`
- `/Users/seanflanagan/proj/software-factory/packages/worker/package.json`
