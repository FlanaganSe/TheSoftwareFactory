# Implementation Plan: Fix Orchestration Flow

**Date:** 2026-03-20
**Research:** `.claude/plans/orchestration-flow-research.md`
**Status:** Draft — decisions confirmed, verified against code

---

## 1. Summary

The core orchestration pipeline is structurally well-designed but cannot execute end-to-end due to six wiring gaps between the API surface, the Temporal workflow, and the activity implementations. The fix restores a clean boundary: **the API resolves repos and creates tasks in Postgres first, then starts Temporal with persisted IDs**. All `patched()` version gates (which block real code in new workflows) are removed. Missing wiring (clone step, validation activities, setup approval route) is connected. No new abstractions are introduced — every change follows existing patterns already established in the codebase.

**Core architectural decision:** Task and repo persistence belong at the API boundary (matching `docs/architecture.md:186`), not inside the Temporal workflow. Intake becomes a validation/transition phase, not a creation phase.

---

## 2. Current State

### Submission path (broken)
`POST /api/tasks` (`packages/api/src/routes/tasks.ts:60-117`) generates random `taskId` and `repoId` UUIDs, starts a Temporal workflow immediately, and returns 201. The intake phase (`packages/temporal-workflows/src/phases/intake.ts:47`) then tries to INSERT the task with the random `repoId` as a FK to `repos.id` — but no repo row exists. **Result: every task submission fails with a FK constraint violation.**

### Repo identity (inconsistent)
Two competing models: the API route generates `crypto.randomUUID()` (`tasks.ts:80`), while `capability-scan.ts:629-634` synthesizes a fake "UUID v5" by zero-padding the GitHub numeric repo ID. The `repos` table already has `(github_owner, github_repo)` unique index and `getRepoBySlug()` (`repo-repository.ts:55-81`) — the correct resolution path exists but isn't used.

### Workflow execution (blocked by patched() gates)
The orchestrator (`orchestrator.ts`) wraps real implementations of understand, plan, setup, implement, validate, evidence, pr_creation, pr_tracking, and learn in `patched("m12-*")` / `patched("m13-*")` / etc. guards. For **new** workflow executions, `patched()` always returns `false` — it's Temporal's backward-compatibility mechanism for already-running workflows. Since this project has zero production workflows, all gates produce stub execution. **Result: even if intake succeeds, every subsequent phase runs stub code.**

### Missing wiring
- No `cloneRepo` call before indexing (`understand.ts:99` needs a local repo, nothing clones it)
- `createValidationActivities` never registered in `worker.ts` — validate phase will fail
- No API route for `approve_setup` signal — setup phase hangs indefinitely on repos without `.factory/setup.yml`

---

## 3. Files to Change

| File | What Changes | Why |
|------|-------------|-----|
| `packages/api/src/routes/tasks.ts` | Replace random UUID generation with repo resolution (getRepoBySlug/createRepo) + task creation at the API boundary. Start workflow with persisted IDs. Add `POST /api/tasks/:id/approve-setup` route. | Blockers 1a + 4 |
| `packages/temporal-workflows/src/phases/intake.ts` | Replace `createTask()` call with `getTask()` — validate the existing task instead of creating it. | Intake should validate/transition, not create |
| `packages/temporal-workflows/src/orchestrator.ts` | Remove all `if (patched("m*-..."))` conditionals + their stub `else` branches. Remove `patched()` from cleanup block. Keep only the real implementation branches. | Blocker 5: patched() blocks all real execution |
| `packages/temporal-workflows/src/phases/understand.ts` | Add `githubActivities.cloneRepo()` call before `indexActivities.indexRepositoryActivity()`. | Blocker 2: indexing requires a local clone |
| `packages/worker/src/worker.ts` | Import `createValidationActivities`, create with `{docker, db}`, spread into activities object. | Blocker 3: validation activities not registered |
| `packages/temporal-activities/src/github/capability-scan.ts` | Delete `deterministicRepoUUID` function (lines 629-635). Leave `scanRepository` signature unchanged — callers will ignore `snapshot.repoId` and use `input.repoId` from the DB instead. The snapshot's `repoId` field becomes vestigial (set to a placeholder by `fetchRepoMetadata`). | Blocker 1b: remove competing repo identity model |
| `packages/db/src/repositories/repo-repository.ts` | Add `getOrCreateRepo()` helper that combines slug lookup + create with unique constraint handling. | Race-safe repo resolution for concurrent submissions |
| `README.md` | Update task submission instructions. Document GitHub App setup flow. Remove reference to nonexistent routes. | Blocker 6 + S.3 |

---

## 4. Files to Create

None. All changes are modifications to existing files following established patterns.

---

## 5. Milestone Outline

### Phase A: Fix the Submission Boundary

- [x] **M1: Move repo+task creation to API boundary** — In `POST /api/tasks`: resolve repo by slug (getOrCreateRepo), create task row in DB with correct FK, then start Temporal workflow with persisted IDs. The 201 response now reflects real DB state.
  - [x] Step 1 — Add `getOrCreateRepo(db, owner, repo)` to `repo-repository.ts`
  - [x] Step 2 — Rewrite `POST /api/tasks` handler in `tasks.ts`
  - [x] Step 3 — Full verification (typecheck + lint + 86 API tests pass)
  Commit: 8a22711 "fix: move repo+task creation to API boundary"
- [x] **M2: Adapt intake phase** — Replace `taskActivities.createTask()` with `taskActivities.getTask()`. Intake loads the existing task, validates kill switch, and transitions to `assigned`. No more DB row creation inside Temporal.
  - [x] Step 1 — Replace `createTask()` with `getTask(input.taskId)` in `intake.ts`, update docstring and M12→M4 comment
  - [x] Step 2 — Update `getTask` mock state from `"assigned"` to `"created"` in E2E and 4 unit test files
  - [x] Step 3 — Replace `tasksCreated` assertion with `stateTransitions` check in `happy-path.test.ts`
  Commit: 6ba56a7 "fix: adapt intake phase to load existing task instead of creating one"

### Phase B: Unblock Real Execution

- [ ] **M3: Remove patched() gates** — Delete all `patched()` conditionals and stub `else` branches from the orchestrator. Keep only the real implementation code. Safe because there are zero running production workflows.
  - [x] Step 1 — Remove all 11 patched() gates (understand, plan, setup, implement, validate, evidence, pr_creation, pr_tracking, merge, learn, cleanup) + remove `patched` import
  - [x] Step 2 — Run `pnpm run lint:fix` to fix indentation after mechanical removal
  - [x] Step 3 — Verify: typecheck clean, 1002 tests pass (8 pre-existing MinIO failures), all 15 E2E tests pass
  Commit: "fix: remove patched() version gates from orchestrator"
- [ ] **M4: Add clone step + fix repo identity in understand phase** — Call `githubActivities.cloneRepo(repoOwner, repoName, repoPath)` before indexing. Delete `deterministicRepoUUID` from capability-scan.ts. The orchestrator already carries `input.repoId` (now a real DB UUID) — all downstream consumers (pr_creation, pr_tracking, evidence) use `input.repoId`, not `snapshot.repoId`. The `scanRepository` function signature stays unchanged; `fetchRepoMetadata` will use a placeholder for the vestigial field.

### Phase C: Wire Missing Components

- [ ] **M5: Register validation activities + add approve-setup route** — Wire `createValidationActivities({docker, db})` in the worker. Add `POST /api/tasks/:id/approve-setup` in the API that sends the `approve_setup` signal.

### Phase D: Tests and Docs

- [ ] **M6: Update tests** — Update E2E mock activities / helpers so intake works with pre-existing tasks. Update API tests to verify new submission path creates repo+task rows. Add test for approve-setup route.
- [ ] **M7: Update README and docs** — Fix task submission instructions, document GitHub App setup flow, remove references to nonexistent routes.

---

## 6. Testing Strategy

### M1 (API boundary)
- **Modify:** `packages/api/__tests__/tasks-api.test.ts` — the existing "503 no Temporal" tests still pass (task+repo rows are created before Temporal check). Add a new test: submit a task, verify a `repos` row was created, verify a `tasks` row exists with correct `repo_id` FK. Submit two tasks for the same repo → verify only one `repos` row (upsert).
- **Pattern:** Existing test file structure + `packages/api/__tests__/setup.ts` Testcontainers setup.

### M2 (Intake phase)
- **Verify:** Existing intake tests (if any) or add a focused test — confirm intake calls `getTask` not `createTask`, and transitions to `assigned`.
- **Pattern:** Phase tests use `@temporalio/testing` with mock activities.

### M3 (Remove patched)
- **Verify:** Run `pnpm run test:e2e` after removal. E2E tests use mock activities and don't go through patched gates — the main risk is that the orchestrator now passes more complex args to child workflows. Mock activities must accept them without failing.
- **Key check:** `happy-path.test.ts:66` checks `env.mockState.tasksCreated.length` — this still works because the mock `createTask` activity is still registered (intake just won't call it in real flows; E2E mocks handle it differently).

### M4 (Clone + repo identity)
- **Modify:** Understand phase tests — add `cloneRepo` to expected mock activity calls.
- **Verify:** `scanRepository` callers pass `repoId` — check `CapabilitySnapshot.repoId` consumers.

### M5 (Validation + approve-setup)
- **Add:** Test for `POST /api/tasks/:id/approve-setup` — verify signal sent. Follow pattern of `task-signals.test.ts`.
- **Verify:** Worker registration is implicitly tested by E2E tests.

### M6 (Integration)
- **New assertion in API tests:** POST task → verify `repos` row + `tasks` row with correct FK before Temporal involvement.

---

## 7. Migration & Rollback

### Database
No schema changes needed. The existing `repos` and `tasks` tables already have the correct structure. The `repos` table already has a unique index on `(github_owner, github_repo)`. The only new DB operations use existing functions:
- `repoRepo.getRepoBySlug()` — exists at `repo-repository.ts:55`
- `repoRepo.createRepo()` — exists at `repo-repository.ts:14`
- `taskRepo.createTask()` — moved from Temporal activity to API route

### API Contract
The `POST /api/tasks` request schema is unchanged: `{objective, repoOwner, repoName, autonomyLevel}`. The response adds `repoId` to the existing `{taskId, workflowId, status}`. This is additive and non-breaking. New endpoint `POST /api/tasks/:id/approve-setup` is additive.

### Rollback
All changes are in application code, not database schema. Reverting the commits restores the old behavior. Since there are no production workflows, there is no Temporal state to reconcile.

---

## 8. Manual Setup Tasks

| Task | Depends On | Notes |
|------|-----------|-------|
| **Create a GitHub App** for the target repo/org | M4 (clone needs credentials) | Use `GET /api/setup/github` manifest flow, or create manually. Set `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID` in `.env`. |
| **Set `OPENROUTER_API_KEY` in `.env`** | M3 (plan/implement need LLM) | Required for plan and implement phases. Already documented. |
| **Set MinIO credentials in `.env`** | M5 (evidence needs artifact storage) | `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`. Docker Compose already runs MinIO with defaults. |

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **E2E tests break after patched() removal** | Low (verified) | Medium | Verified: all mock activity signatures match real signatures. No test depends on stub values. `makeE2EInput` passes complete `MOCK_TRUSTED_CONTEXT`. Run `pnpm run test:e2e` after M3 to confirm. |
| **Concurrent repo creation race** | Low | Low | Two simultaneous submissions for the same repo race on `createRepo`. The unique index causes one to fail. `getOrCreateRepo` catches the constraint error and retries with `getRepoBySlug`. |
| **`cloneRepo` fails without GitHub App** | High (if no App configured) | Medium | Without `GITHUB_APP_ID`, GitHub activities are `{}` and `cloneRepo` is not registered. Task will fail at understand with "activity not registered." This is expected graceful degradation — document in README. |
| **`approve_setup` signal name mismatch** | Low | High | Setup phase defines signal as `defineSignal("approve_setup")`. API route must use exact string `"approve_setup"`. Verified in `setup.ts:39`. |
| **`CapabilitySnapshot.repoId` consumers break** | Low (verified) | Low | Verified: orchestrator passes `input.repoId` (not `snapshot.repoId`) to pr_creation, pr_tracking, evidence phases. The snapshot's `repoId` is not used as an authoritative identity anywhere downstream. |

---

## 10. Decisions (Confirmed)

1. **Auto-approve setup contract when `autonomyLevel === "L2"`.** The PRD defines L2 as full autonomy. A default `node:22-slim` + `npm install` contract is low-risk. Keep the human gate for L0/L1. This is a one-line conditional in `setup.ts`.

2. **Two-step `getBySlug → create (catch constraint) → getBySlug` for repo resolution.** Drizzle's `onConflictDoNothing` doesn't return the existing row. The two-step pattern uses existing tested functions (`getRepoBySlug` + `createRepo`) and handles the rare concurrent-submission race cleanly.

3. **No special handling for failed `workflow.start` in V1.** Temporal rejects duplicate workflow IDs (`WorkflowExecutionAlreadyStartedError`), so retry is safe. Orphaned tasks in `created` state are queryable and visible. Outbox pattern is over-engineering for pre-production.

## Verified Assumptions

- `getTask` activity exists in `TaskActivities` interface, returns same `TaskRecord` type as `createTask` — swap is type-safe (verified in `activity-types.ts:73`, `task-activities.ts:58-64`)
- Mock `getTask` exists in E2E mocks with correct shape (verified in `mock-activities.ts:233-247`)
- E2E tests do NOT depend on stub values from `patched()` branches — no test checks `"stub-base-sha"` or similar (verified across all 8 scenario files)
- `scanRepository` activity wrapper takes `(owner, repo)` only — `repoId` is set internally by `deterministicRepoUUID`. The orchestrator already threads `input.repoId` to all downstream phases independently of the snapshot (verified in `orchestrator.ts` pr_creation/pr_tracking/evidence args)
- `cloneRepo` mock exists in E2E mocks (verified in `mock-activities.ts`)

---

## Follow-Up Recommendations (Post-Plan Scope)

These are not blockers but would improve reliability and UX:

1. **`GET /api/tasks/:id` should read from DB** — Currently reads from Temporal (`tasks.ts:148-176`). Should use DB state with optional Temporal enrichment (research S.2).
2. **Idempotent workflow start** — If task row exists but workflow doesn't start, make start idempotent. Temporal already rejects duplicate IDs — catch and handle gracefully.
3. **SSE events on state transitions** — SSE infrastructure exists but isn't wired to emit events on task state changes. Would enable real-time dashboard updates.
4. **CLI `approve-setup` command** — Add `factory approve-setup <task-id>` alongside the API route.
5. **Smoke test script** — A single script that submits a real task and verifies it reaches at least the understand phase.
