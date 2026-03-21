# Decisions

Append-only log. Never edit past entries.

## Format
```
### ADR-NNN: [Title]
**Date:** YYYY-MM-DD
**Status:** accepted | superseded by ADR-NNN
**Context:** [Why — 1-2 sentences]
**Decision:** [What — 1-2 sentences]
**Consequences:** [What follows]
```

---

<!-- Add new decisions below this line -->

### ADR-001: Task and repo persistence at the API boundary, not in Temporal workflows
**Date:** 2026-03-20
**Status:** accepted
**Context:** The original implementation created task and repo rows inside the Temporal intake phase workflow. This caused FK violations (random repoId never persisted to repos table), made the 201 API response dishonest (no task existed in DB yet), and violated the architecture doc's own contract (`API → Create task in Postgres → Start Temporal workflow`).
**Decision:** Move repo resolution (`getOrCreateRepo` by github_owner/github_repo slug) and task creation to the `POST /api/tasks` API handler. The Temporal workflow receives persisted IDs. Intake validates and transitions an existing task — it does not create one.
**Consequences:** The API is the source of truth for task/repo existence. Temporal is the source of truth for task execution. The workflow operates only on persisted IDs. If `workflow.start` fails after task creation, the task is orphaned in `created` state (acceptable for V1 — Temporal rejects duplicate workflow IDs so retry is safe).

### ADR-002: Remove Temporal patched() version gates for pre-production codebase
**Date:** 2026-03-20
**Status:** accepted
**Context:** The orchestrator wrapped every phase's real implementation in `patched()` gates — Temporal's backward-compatibility mechanism for already-running workflows. For new executions, `patched()` returns false, routing all new workflows to stub branches. With zero production workflows, every gate was dead code blocking real execution.
**Decision:** Remove all 11 `patched()` gates unconditionally. Reintroduce versioning only when deploying breaking changes to workflows with in-flight executions.
**Consequences:** New workflows execute real phase implementations. E2E tests (verified across all 8 scenarios) pass without modification. When production workflows exist, any breaking orchestrator change must use `patched()` for backward compatibility.

### ADR-003: Single repo identity model — DB UUID as primary key, slug as lookup
**Date:** 2026-03-20
**Status:** accepted
**Context:** Two competing repo identity models existed: the API generated `crypto.randomUUID()`, while `capability-scan.ts` synthesized a fake "UUID v5" by zero-padding GitHub's numeric repo ID. The `repos` table already had a `(github_owner, github_repo)` unique index.
**Decision:** Use the DB auto-generated UUID as the primary key. Resolve repos by `(github_owner, github_repo)` slug via `getOrCreateRepo`. Delete `deterministicRepoUUID`. The `CapabilitySnapshot.repoId` field uses a placeholder UUID (vestigial — no downstream consumer reads it).
**Consequences:** One source of truth for repo identity. The capability scan's `repoId` is meaningless — callers use `input.repoId` from the workflow. Future cleanup: remove `repoId` from `CapabilitySnapshot` schema if the field serves no purpose.

### ADR-004: Auto-approve setup contract for L2 autonomy
**Date:** 2026-03-20
**Status:** accepted
**Context:** When a repo lacks `.factory/setup.yml`, the setup phase generates a default contract (`node:22-slim` + package manager install) and waits for a human `approve_setup` signal. No API route existed to send this signal, so workflows hung indefinitely.
**Decision:** Auto-approve the default setup contract when `autonomyLevel === "L2"` (full autonomy). Keep the human gate for L0/L1. Add `POST /api/tasks/:id/approve-setup` route for explicit approval.
**Consequences:** L2 happy path completes without human intervention at the setup phase. L0/L1 users must explicitly approve via API or CLI. The default contract is conservative (no secrets, generic install command).

### ADR-005: All mutable orchestrator state must survive Continue-As-New
**Date:** 2026-03-20
**Status:** accepted
**Context:** The orchestrator accumulates inter-phase state across 11 sequential phases. Temporal's Continue-As-New (CAN) replaces the running execution with a fresh one to bound event history. The original CAN call preserved only 5 of 13 mutable state variables, silently dropping plan text, understand results, PR data, cost tracking, and timing — causing downstream phases to operate on empty data after CAN.
**Decision:** Every mutable variable in the orchestrator that is read by a later phase must be declared as an optional field on `TaskWorkflowInput`, initialized from `input.*` at startup, and explicitly passed in the `continueAsNew` call. Budget overrides use a separate `costBudgetCentsOverride` field to avoid conflicting with `config.costBudgetCents`.
**Consequences:** Adding a new inter-phase state variable requires updating three locations (interface, initialization, CAN call). This is an invariant that must be enforced in code review. All types on `TaskWorkflowInput` must be serializable (no classes, functions, or Date objects).
