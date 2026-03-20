# Research: End-to-End Orchestration Flow — Gap Analysis

**Date:** 2026-03-20
**Scope:** Complete structural analysis + end-to-end wiring gap analysis
**Status:** Complete — M1 and M2 fixes applied, remaining blockers documented

---

## Part A: Structural Analysis

*The original structural analysis (API surface, DB schema, CLI, dashboard, SSE, package graph, etc.) remains valid. See `docs/architecture.md` for the canonical system overview.*

---

## Part B: End-to-End Wiring Gap Analysis

### Problem Statement

The orchestration logic (Temporal workflows, phase state machine, domain types) is well-designed and passes E2E tests with mock activities. However, a real task submission (`POST /api/tasks` → Temporal workflow → activities → database/GitHub/LLM) cannot complete. The gaps are in the wiring between the API surface and activity implementations.

### Methodology

Every finding below is verified against specific source code. No assumptions.

---

### B.1 Code Path Tracing: Task Submission to Failure

**Entry point:** `POST /api/tasks` (`packages/api/src/routes/tasks.ts:60-117`)

```
API Route (tasks.ts:60)
  → Zod validates {objective, repoOwner, repoName, autonomyLevel}
  → [FIXED M1] Resolves repo by slug via getOrCreateRepo (creates if needed)
  → [FIXED M1] Creates task row in Postgres with correct repo FK
  → Starts Temporal workflow "taskOrchestrator" with {taskId, repoId, ...} (persisted IDs)
  → Returns 201 {taskId, repoId, workflowId, status: "started"}
```

**Intake phase** (`packages/temporal-workflows/src/phases/intake.ts:37-93`)

```
intakePhase(input)
  → safetyActivities.checkKillSwitch(taskId) — succeeds
  → [FIXED M2] taskActivities.getTask(input.taskId) — loads existing task
  → taskActivities.transitionTaskState(task.id, "assigned", ...)
  → Returns {taskId, state, baseSha, needsClarification}
```

**Next failure point: understand phase** — real code paths are blocked by `patched()` gates (Blocker 5), and even if unblocked, `cloneRepo` is never called before indexing (Blocker 2).

---

### B.2 Blocker Inventory (Ordered by Execution Sequence)

Each blocker is annotated with whether it's a **wiring gap** (code exists but isn't connected), a **missing implementation** (code doesn't exist), or a **design gap** (no clear path from PRD to code).

#### ~~Blocker 1: Task creation in wrong layer + broken repo identity~~ → FIXED (M1 + M2)

**1a. Task creation moved to API boundary.** (Fixed in M1, commit 8a22711)
- `POST /api/tasks` now calls `repoRepo.getOrCreateRepo()` then `taskRepo.createTask()` before starting the workflow
- The 201 response reflects real DB state

**1b. Repo identity model resolved.** (Fixed in M1)
- API resolves repos by `(github_owner, github_repo)` slug using `getOrCreateRepo`
- Internal auto-generated UUID is the DB primary key
- `deterministicRepoUUID` in capability-scan.ts still exists (vestigial) — planned for removal in M4

**Intake adapted.** (Fixed in M2)
- Intake calls `getTask(input.taskId)` instead of `createTask()`
- Validates and transitions existing task, does not create

#### Blocker 2: understand phase calls GitHub API without clone
- **Type:** Wiring gap
- **Where:** `packages/temporal-workflows/src/orchestrator.ts:372` sets `repoPath = /tmp/factory/${taskId}/repo` but nothing clones the repo there
- **What:** The understand phase (`packages/temporal-workflows/src/phases/understand.ts:99`) passes `repoPath` to `indexRepositoryActivity()` which expects a local filesystem path. But no phase calls `githubActivities.cloneRepo()` first.
- **Existing code:** `packages/temporal-activities/src/github/activities.ts:138-146` has `cloneRepo(owner, repo, targetPath)` that shallow-clones using GitHub App installation tokens. `packages/temporal-activities/src/github/branch.ts:171-214` has the implementation.
- **Fix pattern:** The understand phase (or a step before indexing in it) must call `githubActivities.cloneRepo(repoOwner, repoName, repoPath)` before `indexActivities.indexRepositoryActivity()`.
- **PRD alignment:** R-003 says "all implementation, validation, and evidence assembly happen on a candidate branch." The repo must be cloned for any of this to work.

#### Blocker 3: Validation activities not registered in worker
- **Type:** Wiring gap
- **Where:** `packages/worker/src/worker.ts` — `createValidationActivities` is never imported or called
- **What:** The validate phase (`packages/temporal-workflows/src/phases/validate.ts:33`) proxies `ValidationActivities` which includes `runTests`, `runLinter`, `runSecurityScan`, `computeBlastRadius`, `checkValidatorBoundary`, `getChangedFiles`. None of these are registered with the worker.
- **Existing code:** `packages/temporal-activities/src/validation/activities.ts:46` exports `createValidationActivities(deps)` which needs `{docker, db}`. `packages/temporal-activities/src/index.ts:219` re-exports it.
- **Fix pattern:** Import `createValidationActivities` in `worker.ts`, create with `{docker, db}`, spread into the activities object.
- **Impact:** Without this, any task reaching the validate phase will fail with "activity not registered."

#### Blocker 4: No `approve_setup` signal route
- **Type:** Missing implementation
- **Where:** The setup phase (`packages/temporal-workflows/src/phases/setup.ts:38-39`) defines `approve_setup` signal locally via `defineSignal`. When a repo has no `.factory/setup.yml`, setup pauses and waits for this signal.
- **What:** No API route, CLI command, or dashboard action sends this signal. The workflow will hang indefinitely (until the review timeout fires).
- **API routes checked:** `packages/api/src/routes/tasks.ts` — only `approve`, `reject`, `changes`, `kill` signals. No `approve_setup`.
- **CLI commands checked:** `packages/cli/src/index.ts` — no `approve-setup` command.
- **Fix options:**
  1. Add `POST /api/tasks/:id/approve-setup` route that sends the `approve_setup` signal
  2. Add `factory approve-setup <task-id>` CLI command
  3. For V1: if `autonomyLevel === "L2"` and no `.factory/setup.yml`, auto-approve the default contract (skip the human gate)
- **PRD alignment:** R-015 says "Generated contract is presented to the human for review and approval before being used." A route is needed for L0/L1. L2 (full autonomy) can auto-approve.
- **Confirmed decision:** Auto-approve default setup contract when `autonomyLevel === "L2"`. Keep human gate for L0/L1. Add API route for explicit approval.

#### Blocker 5: `patched()` version gates block real execution
- **Type:** Design gap
- **Where:** `packages/temporal-workflows/src/orchestrator.ts` — 11 locations:
  - Line 369: `patched("m12-real-understand")` — understand phase
  - Line 408: `patched("m12-real-plan")` — plan phase
  - Line 431: `patched("m12-real-setup")` — setup phase
  - Line 463: `patched("m12-real-implement")` — implement phase
  - Line 508: `patched("m13-real-validate")` — validate phase
  - Line 539: `patched("m14-real-evidence")` — evidence phase
  - Line 654: `patched("m16-real-pr-creation")` — pr_creation phase
  - Line 773: `patched("m17-real-pr-tracking")` — pr_tracking phase
  - Line 800: `patched("m18-merge-execution")` — merge execution (nested in pr_tracking)
  - Line 913: `patched("m18-real-learn")` — learn phase
  - Line 953: `patched("m18-cleanup-consolidation")` — cleanup block
- **What:** Real implementations are all gated behind `patched()`. For **new** workflow executions (not replayed), `patched()` always returns `false` — it's a Temporal versioning mechanism for backward compatibility with already-running workflows.
- **Impact:** New workflows execute the `else` (stub) branches, not the real implementations. The stubs pass trivially (e.g., understand phase with `baseSha: "stub-base-sha"`).
- **Critical insight:** `patched()` is designed for deployed workflow versioning. For a project that has never had production workflows, all `patched()` calls should be removed or replaced with unconditional execution of the real branches. The stub branches are dead code.
- **Fix pattern:** Remove all `if (patched("m*-..."))` guards and keep only the real implementation branches. Delete the stub `else` branches. This is safe because there are no running production workflows that need backward compatibility.
- **E2E test impact (verified):** E2E tests use mock activities that accept all real-branch arguments. No test depends on stub-specific values. All 8 E2E scenario files verified — zero test failures expected from gate removal.

#### Blocker 6: Missing GitHub App credentials (configuration gap)
- **Type:** Configuration + documentation gap
- **Where:** `packages/worker/src/worker.ts:55-67` — GitHub activities only created if `config.githubAppId` is set
- **What:** Without `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID` in `.env`, `githubActivities = {}`. Any phase calling a GitHub activity will fail.
- **The setup path exists:** `packages/api/src/routes/setup.ts:28-113` provides `GET /api/setup/github` which returns a GitHub App manifest URL. The callback exchanges the manifest code for App credentials. But this flow is undocumented in the README.
- **Fix:** Document the GitHub App setup flow. The route exists and works — it just needs to be in the setup instructions.
- **PRD alignment:** R-004 and R-005 require GitHub App credentials for the credential broker.

---

### B.3 Secondary Issues (Not Blockers, But Quality Gaps)

#### S.1: `GET /api/tasks/:id` returns Temporal status, not DB state
- **Where:** `packages/api/src/routes/tasks.ts:148-176`
- **What:** List endpoint reads from Postgres. Single-task endpoint reads from Temporal. These may disagree.
- **PRD alignment:** R-001 says "Task state queryable via SQL." The single-task endpoint should also use DB state (with optional Temporal enrichment).

#### S.2: README documents nonexistent routes
- **Where:** `README.md` documents `POST /api/github/setup` with `{owner, repo, installationId}`
- **What:** This route doesn't exist. The actual route is `GET /api/setup/github` (returns manifest URL, no request body).
- **Fix:** Update README to document the actual setup flow and the corrected task submission flow.

#### S.3: Migration 0002 has broken SQL (already fixed)
- **Where:** `packages/db/drizzle/0002_last_argent.sql:1`
- **What:** Fixed by adding `USING schema_version::integer` clause.

#### S.4: Dev scripts had no .env loading (already fixed)
- **Where:** `package.json`, `packages/api/package.json`, `packages/db/package.json`
- **What:** Fixed with `--env-file` and `DOTENV_CONFIG_PATH`.

---

### B.4 Dependency Mapping: What Breaks If We Fix the Blockers

#### Fixing Blocker 2 (add cloneRepo call):
- **Changes:** `packages/temporal-workflows/src/phases/understand.ts`
- **Dependencies:** `GitHubActivities.cloneRepo` is already in `activity-types.ts:292-296`. Already proxied in understand.ts:29-32.
- **Downstream:** Once the repo is cloned, `indexRepositoryActivity` can read the filesystem. The `repoPath` variable used in setup, implement, and validate phases will resolve correctly.
- **Test impact:** `packages/temporal-workflows/__tests__/understand.test.ts`, E2E mock activities (cloneRepo mock exists and returns `{ path: targetPath, headSha: "abc123def456" }`)

#### Fixing Blocker 3 (register validation activities):
- **Changes:** `packages/worker/src/worker.ts`
- **Imports needed:** `createValidationActivities` from `@software-factory/temporal-activities`
- **Dependencies:** Needs `{docker, db}` — both already available in `createWorker()`
- **Downstream:** validate phase will execute. Evidence phase input (`validationResult`) will contain real data.
- **Test impact:** None — worker.ts has minimal tests; E2E tests use mocks

#### Fixing Blocker 5 (remove patched() gates):
- **Changes:** `packages/temporal-workflows/src/orchestrator.ts` (11 locations)
- **CRITICAL:** This is safe ONLY because there are no running production workflows. Once workflows are running in production, `patched()` guards must be reintroduced for any breaking changes.
- **Downstream:** All phases will execute their real implementations.
- **E2E test impact (verified):** All mock activities accept real-branch arguments. No test depends on stub values. All 8 scenarios verified safe. Zero test modifications needed.
- **Import cleanup:** Remove `patched` from the `@temporalio/workflow` import statement.

---

### B.5 Pattern Catalog: How Similar Problems Are Solved

#### Pattern 1: Activity creation with dependency injection
```typescript
// packages/worker/src/worker.ts — all activities follow this pattern:
const someActivities = createSomeActivities({ db, redis, docker, ... });
// Then spread into Worker.create({ activities: { ...someActivities, ... } })
```
Validation activities should follow the same pattern.

#### Pattern 2: DB operations return FactoryResult<T>
```typescript
// packages/db/src/repositories/*
export async function createRepo(db: DbInstance, input: NewRepo): Promise<FactoryResult<Repo>> {
  try { ... return ok(row); }
  catch (e) { return err(createFactoryError("unknown_internal", msg)); }
}
```
Any new DB operation in the API route should follow this pattern.

#### Pattern 3: Upsert via lookup-then-create (confirmed decision)
```typescript
// packages/db/src/repositories/repo-repository.ts:83-103
// getOrCreateRepo: getBySlug → if not found → create → if constraint violation → retry getBySlug
```
This is the established pattern for concurrent-safe repo resolution.

#### Pattern 4: Temporal patched() for forward-compatible versioning
Used correctly when there ARE running production workflows. For a project with zero production history, the `patched()` guards are premature and block the real code paths.

#### Pattern 5: Conditional activity registration
```typescript
// packages/worker/src/worker.ts:55-67
const githubActivities = config.githubAppId ? createGitHubActivities({...}) : {};
```
This is the established pattern for optional features. Validation activities should NOT be optional — they're core pipeline functionality.

#### Pattern 6: Test the seams
Any boundary between API → Temporal → DB must have at least one integration test that exercises the real path, not mocks.

---

### B.6 Test Landscape

| Area | Test Type | Framework | Status |
|------|-----------|-----------|--------|
| E2E workflows | Integration (mock activities) | Vitest + @temporalio/testing | 8 scenario files, all passing |
| Workflow phases | Unit | Vitest + @temporalio/testing | 14 test files |
| Activity implementations | Unit + integration | Vitest + Testcontainers | 54 test files |
| API routes | Unit | Vitest | 11 test files, 86 tests passing |
| DB repositories | Integration | Vitest + Testcontainers | 7 test files |
| CLI | Unit | Vitest | 5 test files |
| Dashboard | Unit | Vitest + jsdom + svelte-testing | 4 test files |

**Key gap:** No integration test exercises the real path from API → Temporal → real activities → real DB. The E2E tests use `packages/e2e/src/setup/mock-activities.ts` which returns hardcoded successful results.

**E2E mock compatibility (verified for M3):**
- All mock activity signatures match real activity signatures
- Mock `getTask` returns `state: "created"` (updated in M2)
- Mock `scanRepository`, `captureTrustedContext`, `cloneRepo`, `indexRepositoryActivity`, `generatePlan`, `provisionSandbox`, `executeAgentStep`, `runTests`, `runLinter`, `runSecurityScan`, `computeBlastRadius`, `generateAndPersistEvidence`, `createPullRequest`, `checkMergeReadiness`, `mergePullRequest`, `deleteBranch`, `recordTaskMetrics` — all accept full real-branch arguments without error
- No E2E test asserts on stub-specific values (`"stub-base-sha"`, empty snapshots, etc.)

---

### B.7 Risk Inventory (Ranked by Impact)

1. ~~**Task creation in wrong layer + broken repo identity**~~ → FIXED (M1 + M2)

2. **`patched()` gates block all real execution** — Even with M1+M2 fixes, new workflows execute stub code unless these are removed. This is a fundamental misuse of Temporal's versioning API for a pre-production project. **E2E impact verified: safe to remove.**

3. **No clone before index** — Without a cloned repo on the filesystem, the understand phase produces empty/broken results. Every downstream phase depends on understand's output.

4. **Missing validation activities** — The validate phase is core to the PRD's evidence-based review model (R-003, R-007, R-008). Without it, no evidence packet can be generated with real test/lint/security results.

5. **No approve_setup signal route** — Any repo without `.factory/setup.yml` (i.e., most repos) will hang at the setup phase with no way for the user to unblock it. **Decision confirmed: auto-approve for L2, human gate for L0/L1.**

6. **GitHub App credentials undocumented** — Even with all code fixes, users can't complete the flow without GitHub App setup, which isn't in the README's quick start.

7. **No integration test covers the real submission path** — The test suite will not catch regressions on the fixed path unless a new test is added that exercises API → Temporal → real DB.

---

### B.8 Key Patterns to Follow

1. **DB-first, then orchestrate:** Create persistent state (repo, task, audit entry) at the API boundary. Start the Temporal workflow only after the DB rows exist. The workflow operates on persisted IDs, never fabricates them. This matches `docs/architecture.md:186`. **(Implemented in M1.)**
2. **Activity DI pattern:** `createXActivities(deps)` → spread into worker activities object. Required activities (task, safety, validation) are always registered. Optional activities (GitHub, LLM, evidence) are conditional on config.
3. **FactoryResult returns:** All DB/external ops return `Result<T, FactoryError>`, never throw. API routes map FactoryError codes to HTTP status codes.
4. **Single repo identity model:** Internal auto-generated UUID as PK. `(github_owner, github_repo)` unique index as lookup key. No synthetic UUIDs from GitHub numeric IDs. `getOrCreateRepo()` is the canonical resolution path. **(Implemented in M1.)**
5. **Unconditional real code paths:** Remove `patched()` guards; reintroduce only when deploying breaking changes to running workflows.
6. **Test the seams:** Any boundary between API → Temporal → DB must have at least one integration test that exercises the real path, not mocks.

---

### B.9 Confirmed Decisions

1. **Auto-approve setup contract when `autonomyLevel === "L2"`.** PRD defines L2 as full autonomy. Default `node:22-slim` + `npm install` contract is low-risk. Human gate kept for L0/L1.
2. **Two-step repo resolution:** `getBySlug → create (catch constraint) → getBySlug`. Uses existing tested functions. **(Implemented in M1.)**
3. **No outbox pattern for V1.** Temporal rejects duplicate workflow IDs, so retry is safe. Orphaned tasks in `created` state are queryable.
4. **Leave `scanRepository` signature unchanged.** Callers ignore `snapshot.repoId` and use `input.repoId` (the real DB UUID) instead. Delete `deterministicRepoUUID` as dead code in M4.
