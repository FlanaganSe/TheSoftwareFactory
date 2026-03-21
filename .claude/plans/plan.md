# Plan: Fix Pipeline Execution, Signal Routing, and Robustness

## Summary

The pipeline has 10 confirmed bugs causing tasks to get stuck, fail silently, or lose data. The root causes cluster into three areas: (1) the agent loop runs unproductively because the no-progress guardrail is dead code and guardrail trips kill the workflow instead of returning a degraded result, (2) signal routing sends approve/reject to the wrong Temporal child workflow so L0/L1 tasks block forever, and (3) the orchestrator loses critical state on Continue-As-New and the task detail API has no Postgres fallback. This plan fixes all confirmed bugs in 3 milestones, each independently verifiable. No architectural changes — only targeted fixes to existing code.

---

## Files to Change

### `packages/temporal-activities/src/llm/agent.ts`
- **Fix no-progress guardrail (line 280-286)**: Remove `auditLog.length` from the `computeFingerprint` call. Currently passed as `actionCount`, which increments every step, making fingerprints always unique. The `no_progress` guardrail (3 identical fingerprints) can never trigger. Replace with a count of *write actions only* (count of `file_write`/`file_edit` entries with `"OK:"` prefix in `auditLog`) — this stays stable when the agent is reading/searching without making changes, which is exactly what "no progress" means.
- **Add `gpt-5.4-nano` to pricing table (line 440-444)**: The orchestrator defaults to `"openai/gpt-5.4-nano"` but the rate table only has 3 models. Unknown models fall back to Claude Sonnet pricing (300/1500 per 1M tokens), likely over-estimating by 10-20x for a nano model, causing premature budget guardrail trips. Add a reasonable rate entry. Also add a catch-all comment noting the fallback behavior.

### `packages/temporal-activities/src/llm/activities.ts`
- **Fix guardrail trip handling (lines 83-88)**: Currently, when `executeAgent` returns `ok({ success: false, guardrailTripped: "..." })`, the activity throws `ApplicationFailure.nonRetryable("GUARDRAIL_TRIPPED")`. This kills the entire workflow. Instead, return the result normally — the caller (implement phase) can inspect `agentResult.guardrailTripped` and decide what to do. The agent already did useful work (files may have been modified); throwing destroys that context. Remove lines 83-88 entirely — the `guardrailTripped` field on `AgentStepResult` already carries this information to the workflow.

### `packages/temporal-workflows/src/phases/implement.ts`
- **Add timeout to autonomy gate (line 115)**: Change `await condition(() => approved || rejected)` to `await condition(() => approved || rejected, "4h")` (or `input.config?.approvalTimeoutMs`). Currently blocks forever if no signal arrives. The 4-hour default matches the review timeout.
- **Fix git diff to capture new files (lines 180-188)**: `git diff --name-only --diff-filter=ACMR HEAD` only shows changes to tracked files. New files created by the agent's `file_write` tool are untracked and invisible to `git diff HEAD`. Add a second command: `git ls-files --others --exclude-standard` to capture untracked files, then merge both lists. Alternatively, run `git add -A && git diff --cached --name-only HEAD` to stage everything first, then diff.
- **Handle guardrail trips gracefully**: After the `executeAgentStep` call, check `agentResult.guardrailTripped`. If it tripped but files were modified, continue with the push (the agent made partial progress). If it tripped with zero files modified, throw a descriptive `ApplicationFailure.nonRetryable` explaining which guardrail tripped and that no changes were made.

### `packages/temporal-workflows/src/phases/setup.ts`
- **Add timeout to setup approval gate (line 101)**: Change `await condition(() => approvedContract !== null)` to include a 4-hour timeout. If timeout fires, throw `ApplicationFailure.nonRetryable("Setup approval timed out after 4 hours")`.

### `packages/temporal-workflows/src/orchestrator.ts`
- **Fix Continue-As-New state preservation (lines 340-354)**: The CAN call preserves `trustedContext`, `capabilitySnapshot`, `setupResult`, `implementResult`, `validateResult` but drops `understandResult`, `planText`, `evidenceLocator`, `prResult`, `addressingFeedback`, `mergedSha`. These must be added to `TaskWorkflowInput` and passed through CAN. Without them, phases after CAN operate on empty data (e.g., `planText` becomes `undefined`, falling back to `input.objective`; `understandResult?.repoMap` becomes `[]`).
- **Fix evidence validation data mapping (lines 549-571)**: `securityScanResults.vulnerabilities`, `migrationImpact.migrationFiles`, and `migrationImpact.schemaChanges` are hardcoded to empty arrays regardless of actual validation results. These should be populated from `vr` (the validate result) if available.

### `packages/api/src/routes/tasks.ts`
- **Add implementation approval endpoint**: Add `POST /api/tasks/:id/approve-implementation` that sends the approve signal to `task-{id}-implement-{phaseIteration}` (mirroring the existing `approve-setup` pattern at lines 399-439). The current approve endpoint (line 261-285) targets the review child workflow (`task-{id}-review-{phaseIteration}`), which doesn't exist when implement is paused at the L0/L1 autonomy gate. The implement phase registers its own `approveSignal` handler (implement.ts lines 106-108).
- **Add implementation rejection endpoint**: Same pattern, `POST /api/tasks/:id/reject-implementation`, targeting the implement child workflow.
- **Fix GET /api/tasks/:id to fallback to Postgres (lines 200-256)**: Currently queries only Temporal. If the workflow completed or Temporal is slow, returns 404. Add a Postgres fallback: query `taskRepo.getTask(db, id)` first, then enrich with Temporal progress data if the workflow is still running. Return the Postgres data as the base response regardless.

### `apps/dashboard/src/routes/tasks/[id]/+page.svelte`
- **Fix canApprove to include "paused" state**: The `canApprove` derived value (around line 169-171) only enables the approve button for `evidence_ready` or `changes_requested`. Add `paused` to the condition, AND differentiate between setup-paused and implement-paused so the UI sends the signal to the correct endpoint (`/approve-setup` vs `/approve-implementation`).
- **Show the paused state context**: When task is paused, display what is being waited on (setup contract approval vs implementation approval) and the plan/contract being proposed, so the user has context for their decision.

### `packages/worker/src/worker.ts`
- **Add startup validation for critical activities (after line 192)**: After composing the activities object, check that critical activity functions exist. If `githubActivities`, `llmActivities`, or `evidenceActivities` resolved to `{}`, log a clear warning with the missing config key name. Don't fail startup (the worker can still run other task types), but make it visible.

---

## Files to Create

None. All fixes are to existing files.

---

## Milestone Outline

### ~~M1: Fix Agent Loop and Implement Phase~~ ✓

The core pipeline fixes — ensures the agent loop terminates productively, guardrail trips don't kill workflows, new files are captured, and blocking conditions have timeouts.

- [x] M1.1: Fix no-progress guardrail — remove `actionCount` param from `guardrails.ts:computeFingerprint`, remove `auditLog.length` arg from `agent.ts:280`, raise `noProgressThreshold` to 5, update tests → verify: `pnpm --filter @software-factory/temporal-activities run test`
- [x] M1.2: Fix guardrail trip handling — remove throw in `activities.ts:83-88`, add guardrail-trip state transition in `implement.ts` after `executeAgentStep` → verify: `pnpm run typecheck`
- [x] M1.3: Fix git diff to capture untracked files — add `git ls-files --others --exclude-standard` in `implement.ts:179-188`, deduplicate with tracked changes → verify: `pnpm run typecheck`
- [x] M1.4: Add model pricing for `gpt-5.4-nano` in `agent.ts:440-444`, add fallback comment → verify: grep for `gpt-5.4-nano` in agent.ts
- [x] M1.5: Add 4h timeouts to `condition()` calls in `implement.ts:115` and `setup.ts:101`, add timeout handling with state transitions → verify: `pnpm run typecheck`
  Commit: "fix: agent loop guardrails, git diff, pricing, and condition timeouts"

**Verify**: `pnpm run typecheck` + `pnpm --filter @software-factory/temporal-activities run test` + verification greps

### M2: Fix Signal Routing and Dashboard

Ensures L0/L1 approval signals reach the correct workflow and the dashboard shows the right UI for paused states.

- [x] M2.1: Add `getImplementHandle` helper + `POST /approve-implementation` + `POST /reject-implementation` in `tasks.ts` → verify: `grep -c 'approve-implementation' packages/api/src/routes/tasks.ts`
- [x] M2.2: Add `approveImplementation`, `rejectImplementation`, `approveSetup` client methods; add `isPausedAtImplement`/`isPausedAtSetup` derived state; update `handleApprove`/`handleReject` routing; add paused-state banner; hide "Request Changes" for paused states → verify: `pnpm run typecheck`
- [x] M2.3: Rewrite `GET /api/tasks/:id` to Postgres-first with Temporal enrichment; add `objective`/`updatedAt` to `TaskDetailResponse` → verify: `pnpm run typecheck`
  Commit: "fix: signal routing, dashboard paused state, and task detail Postgres fallback"

### M3: Fix Orchestrator Robustness

Ensures the orchestrator preserves all inter-phase data across Continue-As-New and doesn't silently drop evidence data.

- [ ] M3.1: Add 6 missing fields to `TaskWorkflowInput`, initialize mutable state from `input.*`, expand CAN call → verify: `pnpm run typecheck`
- [ ] M3.2: Add explanatory comments to hardcoded empty arrays in evidence validation mapping → verify: grep for "not yet surfaced" in orchestrator.ts
- [ ] M3.3: Add startup activity validation warnings in `worker.ts` → verify: grep for "missingActivities" in worker.ts
  Commit: "fix: orchestrator CAN state preservation, evidence mapping docs, worker startup validation"

**Verify**: `pnpm run typecheck` + verification greps

---

## Manual Setup Tasks

None required. All fixes are code-only changes to existing files.

---

## Risks

1. **Guardrail trip handling change (M1.2)**: Removing the `ApplicationFailure.nonRetryable` throw means the implement phase now receives results from guardrail-tripped agents. The implement phase must correctly handle `agentResult.guardrailTripped` — if the agent modified files, it should push them; if not, it should fail cleanly. The current code after the `executeAgentStep` call (implement.ts lines 168-218) already checks `agentResult.filesModified.length > 0` before pushing, so this should work naturally. But test manually to confirm.

2. **CAN state expansion (M3.1)**: Adding fields to `TaskWorkflowInput` changes the workflow's input type. Existing running workflows that trigger CAN will pass the old shape (without the new fields). The receiving side already uses `input.understandResult ?? undefined` patterns for optional fields, so this should be backward compatible. But verify with the Temporal determinism constraint — adding optional fields to workflow input is safe; changing required fields is not.

3. **Temporal `condition()` timeout behavior**: When a `condition()` times out, it resolves to `false` (the condition was not met). The code must explicitly check for this. The pattern is:
   ```typescript
   const met = await condition(() => approved || rejected, "4h");
   if (!met) {
     throw ApplicationFailure.nonRetryable("Approval timed out after 4 hours");
   }
   ```
   Confirm this is the correct Temporal SDK behavior for `condition` with timeout.

4. **No-progress fingerprint fix**: Removing `actionCount` from the fingerprint changes when `no_progress` triggers. If the agent reads files extensively before writing (legitimate exploration), 3 consecutive steps of reading could trigger `no_progress`. Consider whether the threshold should be raised from 3 to 5, or whether the fingerprint should include a coarser progress signal (e.g., count of write-type tool calls only).

---

## Open Questions

1. **What pricing should `openai/gpt-5.4-nano` use?** Need actual OpenRouter pricing. If unavailable, use a conservative low estimate (e.g., `{ input: 10, output: 40 }` cents per 1M tokens) to avoid premature budget trips. The `fetchGenerationStats` function in `cost-tracker.ts` already has the ability to get actual costs from OpenRouter — should we use that as the primary cost source instead of the hardcoded table?

2. **Should the paused-state UI show the proposed plan/contract?** The implement phase transitions to "paused" with `auditContent: { plan: input.plan }`. The dashboard could display this to give the user context for their approval decision. Is this desired, or is a simple "Approve implementation?" prompt sufficient?

3. **Should L0 and L1 behave differently at the implement gate?** Currently both block identically. L0 (no automation) might warrant a different UX than L1 (suggest, human approves). The current plan treats them identically — both show an approve button. Is that correct, or should L0 show more detail / require more explicit confirmation?
