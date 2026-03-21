# Product Overview

## What this is

Software Factory is a self-hosted control plane that turns GitHub issues (or API-submitted objectives) into validated pull requests using AI agents. It orchestrates an 11-phase pipeline — from code understanding through sandboxed implementation, test/lint/security validation, structured evidence review, and GitHub PR lifecycle management — with human approval gates at critical steps. The user owns all state (Postgres), audit logs, and policy configuration. Models are pluggable via OpenRouter.

**Target users:** Solo developers and small teams who want AI implementation leverage but require governance, auditability, and control over what ships.

**Status:** Active development. The full pipeline is implemented and tested end-to-end with mock activities. Not yet used in production.

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Language | TypeScript (strict mode) | `verbatimModuleSyntax: true` in all tsconfigs |
| Runtime | Node.js 22 LTS | `node:22-slim` for Docker images |
| Package manager | pnpm 10+ | Workspaces, strict deps |
| Orchestration | Temporal 1.14.x | All `@temporalio/*` packages must share exact version |
| Database | PostgreSQL 16 | System of record for all state |
| ORM | Drizzle ORM + drizzle-kit | Schema-first with SQL migrations |
| Cache/PubSub | Redis 7 | Safety primitives (kill switch, circuit breakers), SSE pub/sub |
| HTTP | Fastify + fastify-type-provider-zod | Zod schemas as the single source of truth for request/response types |
| LLM | Vercel AI SDK + OpenRouter | Model-agnostic; default `anthropic/claude-sonnet-4-20250514` |
| GitHub | Octokit (REST + GraphQL + Webhooks) | App-based auth with phase-scoped credential rotation |
| Sandbox | Docker (dockerode) | CapDrop ALL, readonly rootfs, network isolation |
| Code parsing | tree-sitter (native N-API) | 6 languages: JS, TS, Python, Go, Java, Rust |
| Object storage | MinIO (S3-compatible) | Evidence artifact persistence |
| Validation | Zod | `.strict()` on all schemas; types derived via `z.infer<>` |
| Error handling | neverthrow | `Result<T, FactoryError>` at domain boundaries; no thrown exceptions |
| CLI | Commander.js + chalk + ora + @inquirer/prompts | Terminal interface with interactive review |
| Frontend | SvelteKit (Svelte 5 runes) + Tailwind CSS v4 | Dashboard for task management, evidence review, safety controls |
| Tests | Vitest + Testcontainers + @temporalio/testing | Real databases in tests; time-skipping for workflow tests |
| Lint/Format | Biome | Single tool for both |

---

## Architecture

### Request flow

```
User (API/CLI/Dashboard/GitHub webhook)
  │
  ▼
API Server (Fastify, port 3000)
  ├── Validates input (Zod)
  ├── Auth check (Bearer token, RBAC)
  ├── Creates/resolves repo row in Postgres (getOrCreateRepo)
  ├── Creates task row in Postgres
  └── Starts Temporal workflow with persisted IDs
        │
        ▼
  Temporal Orchestrator (parent workflow)
  ├── intake: validate task, check kill switch, transition to assigned
  ├── understand: clone repo, scan capabilities, index code (tree-sitter)
  ├── plan: LLM generates implementation plan from repo context
  ├── setup: provision Docker sandbox, acquire branch lease
  ├── implement: LLM agent writes code in sandbox (7 governed tools)
  ├── validate: run tests, lint, security scan (from base branch configs)
  ├── evidence: assemble 13-field evidence packet, persist to S3
  ├── review: WAIT for human approval signal
  ├── pr_creation: create GitHub PR with evidence summary
  ├── pr_tracking: monitor checks, reviews, merge queue, handle feedback
  └── learn: record metrics, update repo understanding
        │
        ▼
  Cleanup: release branch lease, destroy sandbox, persist terminal state
```

### Key architectural boundary (ADR-001)

**The API creates persistent state. Temporal orchestrates execution.**

The API is the source of truth for task/repo existence. It creates rows in Postgres before starting the workflow. The workflow receives persisted IDs and never fabricates them. This means:
- The 201 response is honest — the task exists in the DB
- If the workflow fails, the task is still queryable
- The intake phase validates and transitions an existing task, it does not create one

### Package dependency graph

```
                    ┌───────────┐
                    │   core    │  ← Pure TS, zero Node.js APIs
                    └─────┬─────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
        ┌──────────┐ ┌────────────┐ ┌──────────────────┐
        │    db    │ │  temporal-  │ │    temporal-      │
        │          │ │  workflows │ │    activities     │
        └────┬─────┘ └────────────┘ └───────┬──────────┘
             │                              │
             ▼         ┌────────────────────┤
        ┌────────┐ ┌────────┐        ┌──────────┐
        │  api   │ │ worker │        │   cli    │
        └────────┘ └────────┘        └──────────┘
```

**Critical constraints:**
- `core` must be pure TypeScript — imported by `temporal-workflows` which runs in Temporal's V8 isolate (no Node.js APIs)
- `temporal-workflows` uses `proxyActivities<T>()` with type-only imports — no runtime imports from `temporal-activities`
- `verbatimModuleSyntax: true` enforces `import type` discipline across all packages

---

## Directory structure

```
software-factory/
├── packages/
│   ├── core/                 # Domain types, state machine, policy engine, error system
│   ├── db/                   # Drizzle schema, migrations, repositories, encryption
│   ├── temporal-workflows/   # Orchestrator + 11 phase workflows (V8 isolate)
│   ├── temporal-activities/  # Side effects: GitHub, LLM, Docker, indexing, validation, evidence
│   ├── api/                  # Fastify HTTP server, webhooks, auth, SSE
│   ├── worker/               # Temporal worker process, activity wiring
│   ├── cli/                  # Terminal interface (Commander.js + chalk + ora)
│   └── e2e/                  # End-to-end workflow tests with mock activities
├── apps/
│   └── dashboard/            # SvelteKit visual interface
├── docs/                     # Architecture, PRD, security model, decisions
├── scripts/                  # generate-secrets.sh, init-db.sql
├── docker-compose.yml        # Core infrastructure (Postgres, Redis, Temporal, MinIO)
└── docker-compose.override.yml  # Dev port exposure
```

---

## Core concepts

### Task lifecycle (state machine)

16 states, 22 explicit transitions (including `evidence_ready → failed`), 1 wildcard (any non-terminal → cancelled). 3 terminal states: `merged`, `failed`, `cancelled`.

```
created → assigned → in_progress → evidence_ready → approved → pr_created
    │                     │              │                         │
    ▼                     ▼              ▼                         ▼
needs_clarification    paused    changes_requested    external_checks_pending
                                      │                    │         │
                                      └── in_progress      ▼         ▼
                                                    merge_ready  addressing_review_feedback
                                                                 external_blocked
```

The state machine is enforced by a database trigger on the `tasks` table that checks against the `task_valid_transitions` lookup table (seeded by migration `0001`). The application-level `canTransition()` in `state-machine.ts` exists but is never called — the DB trigger is the sole enforcer. The orchestrator calls `transitionTaskState` activity to persist state changes; if the transition is invalid, the trigger rejects it.

### Policy engine

`PolicyDecisionService` evaluates path-level governance decisions. Pure functions, no side effects.

4 policy types in priority order: `read_exclusion` > `edit_deny` > `edit_protected` > `edit_allowed`.

Default exclusions are always enforced: `.env*`, `*.pem`, `*.key`, `.git/**`, `node_modules/**`.

Policies are defined per-repo in the `policy_configs` table and loaded from the base branch at task intake (part of `TrustedBaseContext`).

### Trusted base context

Captured at the understand phase from the **base branch** (not the agent's working branch). Contains:
- `baseSha` — pinned commit hash
- `setupContract` — from `.factory/setup.yml` (or null → default generated)
- `policySnapshot` — path-level governance rules
- `behavioralControlFiles` — CLAUDE.md, AGENTS.md, etc. (treated as policy surfaces, not trusted input)
- `validationCommandSources` — test/lint/security commands from base branch configs

This prevents the agent from tampering with its own evaluation criteria.

### Autonomy levels

| Level | Behavior |
|-------|----------|
| L0 | Maximum oversight — human approval at every gate |
| L1 | Balanced — human review required; setup approval if no `.factory/setup.yml` |
| L2 | Full autonomy — auto-approves setup contract; human review still required before merge |

### Error system

11 error codes with declarative retry policies via `FactoryError` + neverthrow `Result<T, E>`:

| Code | Retryable | Max Attempts | Use case |
|------|-----------|-------------|----------|
| `policy_denied` | No | 1 | Policy engine blocked the operation |
| `github_transient` | Yes | 8 | Rate limits, network errors |
| `github_auth_expired` | Yes | 3 | Token rotation needed |
| `sandbox_failure` | Yes | 3 | Docker container issues |
| `model_rate_limited` | Yes | 6 | LLM provider throttling |
| `evidence_invariant_fail` | No | 1 | Evidence packet validation failure |
| `unknown_internal` | No | 1 | Catch-all |

Activities convert between `FactoryResult<T>` and Temporal's `ApplicationFailure` at the boundary.

---

## Key patterns and conventions

### Zod as single source of truth
All types are derived from Zod schemas via `z.infer<>`. No hand-written parallel types. All object schemas use `.strict()` to catch extra fields at boundaries.

### Result types at domain boundaries
```typescript
// DB operations, external calls → FactoryResult<T>
export async function createRepo(db, input): Promise<FactoryResult<Repo>> {
  try { return ok(row); }
  catch (e) { return err(createFactoryError("unknown_internal", msg)); }
}
```
Temporal activities convert: `result.isErr() → throw ApplicationFailure`.

### Activity dependency injection
```typescript
// worker.ts
const validationActivities = createValidationActivities({ docker, db });
// → spread into Worker.create({ activities: { ...validationActivities } })
```
Required activities (task, safety, validation) are always registered. Optional activities (GitHub, LLM, evidence) are conditional on config.

### State change + audit in single transaction
Every task state transition writes to both `tasks` and `audit_entries` in one DB transaction. The `audit_entries` table has RLS preventing UPDATE/DELETE.

### Webhook idempotency
GitHub webhook deliveries are deduplicated via `X-GitHub-Delivery` header, persisted in `webhook_deliveries` before processing. Side effects use an idempotency ledger (`side_effects` table) with `ON CONFLICT` checks.

### Orchestrator state persistence
The orchestrator explicitly calls `transitionTaskState` activities to persist state transitions to Postgres — the DB trigger is the sole enforcer. Three areas require special care:
- **Review phase**: All paths that set `currentState = "approved"` (L2 auto-approve, feedback auto-skip, human approval) must also call `transitionTaskState`.
- **PR creation skip**: When `addressingFeedback === true`, the `prCreationPhase` child is skipped, so the orchestrator calls `transitionTaskState("pr_created")` directly.
- **0-change guard**: If the implement phase produces zero file changes and a guardrail tripped, the orchestrator breaks early with `currentState = "failed"` rather than running 4 more phases.

### Re-implementation feedback loop
When external review returns `changes_requested`, the orchestrator increments `phaseIteration` and loops back to implement. On iteration 1+, the `baseSha` is set to the previous iteration's `headSha` (not `trustedContext.baseSha`) so that the new commit is a fast-forward descendant of the branch tip. The `noProgressThreshold` guardrail (10 read-only tool calls) prevents infinite loops.

### Repo identity model (ADR-003)
One canonical identity: DB auto-generated UUID as PK, `(github_owner, github_repo)` unique index as lookup key. Resolved via `getOrCreateRepo(db, owner, repo)` — a two-step slug lookup + create with unique constraint retry.

---

## Data layer

### Tables (18 + 1 lookup)

**Core:**
- `repos` — GitHub repositories; PK uuid, unique on (github_owner, github_repo)
- `tasks` — Work items; FK to repos, state machine enforced by DB trigger
- `audit_entries` — Append-only log; RLS prevents mutation; SHA-256 content hash

**Evidence & Review:**
- `evidence_bundles` — 13-field structured evidence packets; FK to tasks
- `review_states` — Maps PR numbers to workflow IDs for webhook routing

**Operations:**
- `api_keys` — SHA-256 hashed bearer tokens; `sf_` prefix; 3 roles (admin/operator/viewer)
- `webhook_deliveries` — Dedup ledger for GitHub webhook events
- `side_effects` — Idempotency ledger for external mutations
- `cost_records` — Per-task LLM cost tracking
- `credential_leases` — Phase-scoped GitHub token leases

**Policy & Security:**
- `policy_configs` — Path-level governance rules; FK to repos
- `secret_bindings` — AES-256-GCM encrypted secrets with envelope encryption

**Code Understanding:**
- `capability_snapshots` — 10-step repo capability scan results
- `code_index_versions` — tree-sitter index snapshots
- `code_symbols` — Extracted symbols (functions, classes, interfaces)
- `code_dependencies` — Import/export relationships between files
- `code_files` — Indexed file metadata
- `environment_states` — Docker sandbox cache state

**Infrastructure:**
- `task_valid_transitions` — Lookup table seeded by migration; used by DB trigger
- `task_state_enum` — PostgreSQL enum for the 16 task states

### Repositories

11 repository modules in `packages/db/src/repositories/`, each exporting pure functions that take `(db: DbInstance, ...)` and return `FactoryResult<T>`:

`taskRepo` · `repoRepo` · `auditRepo` · `policyRepo` · `webhookRepo` · `sideEffectRepo` · `apiKeyRepo` · `indexRepo` · `evidenceRepo` · `reviewStateRepo` · `capabilitySnapshotRepo`

---

## API surface

### Auth
Bearer tokens with SHA-256 hashed API keys. Three roles: `admin`, `operator`, `viewer`. Admin key auto-generated on first boot (printed to stdout).

### Endpoints

**Tasks:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/tasks` | admin, operator | Submit task (resolves repo, creates task, starts workflow) |
| GET | `/api/tasks` | any | List active tasks from DB |
| GET | `/api/tasks/:id` | any | Get task details (DB state + Temporal progress). Returns `status` (DB lifecycle state) and `workflowStatus` (Temporal runtime status like "RUNNING") as separate fields |

**Signals:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/tasks/:id/approve` | admin, operator | Approve evidence (separation of duties enforced) |
| POST | `/api/tasks/:id/reject` | admin, operator | Reject with reason |
| POST | `/api/tasks/:id/changes` | admin, operator | Request specific changes |
| POST | `/api/tasks/:id/approve-setup` | admin, operator | Approve setup contract (L0/L1 only) |
| POST | `/api/tasks/:id/kill` | admin | Kill task (Redis flag + Temporal signal) |

**Evidence:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/tasks/:id/evidence` | any | Get evidence bundle |
| GET | `/api/tasks/:id/freshness` | any | Check if evidence is stale |

**Repos:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/repos` | any | List repos |
| GET | `/api/repos/:id` | any | Get repo details |
| POST | `/api/repos/scan` | admin, operator | Trigger capability scan |

**Infrastructure:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | none | Health check (+ `/health/live`, `/health/ready`) |
| GET | `/metrics` | none | Prometheus metrics |
| GET | `/api/events` | token in query | SSE stream (Redis pub/sub) |
| POST | `/api/webhooks/github` | HMAC-SHA256 | GitHub webhook receiver |
| GET | `/api/setup/github` | none (skipAuth) | GitHub App manifest flow |
| GET | `/api/setup/github/callback` | none (skipAuth) | GitHub App setup callback |

**API Keys & Safety:**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/keys` | admin | Create API key |
| GET | `/api/keys` | admin | List API keys |
| DELETE | `/api/keys/:id` | admin | Revoke API key |
| GET/POST | `/api/safety/*` | admin | Kill switch, circuit breakers, cost budgets |

---

## Environment and config

### Required environment variables
```
DATABASE_URL=postgresql://factory:...@localhost:5433/factory
REDIS_URL=redis://localhost:6380
TEMPORAL_ADDRESS=localhost:7233
WEBHOOK_SECRET=<from generate-secrets.sh>
```

### Optional (feature-gating)
```
# GitHub App (required for repo cloning and PR operations)
GITHUB_APP_ID=<app-id>
GITHUB_PRIVATE_KEY=<base64-encoded-key>
GITHUB_INSTALLATION_ID=<installation-id>

# LLM (required for plan and implement phases)
OPENROUTER_API_KEY=<key>

# MinIO (required for evidence artifacts)
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=factory
MINIO_SECRET_KEY=<from generate-secrets.sh>
```

Without GitHub credentials, the worker degrades gracefully — GitHub activities return empty objects. Tasks will fail at the understand phase with a clear "activity not registered" error.

### Infrastructure (Docker Compose)
5 core services: PostgreSQL 16, Redis 7, Temporal Server, Temporal UI, MinIO.
3 optional observability services (via `--profile observability`): OpenTelemetry Collector, Jaeger, Grafana.

---

## Testing

### Structure
- Co-located `__tests__/` directories within each package
- File naming: `{module}.test.ts`
- Real databases via Testcontainers (Postgres, Redis) — no mocks for infrastructure
- `@temporalio/testing` with time-skipping for workflow tests
- E2E tests use mock activities that return realistic fixtures

### Commands
```bash
pnpm run test          # All unit + integration tests
pnpm run test:e2e      # E2E workflow scenarios (8 scenarios, 15 tests)
pnpm run test:watch    # Watch mode
pnpm run typecheck     # TypeScript strict across all packages
pnpm run lint          # Biome
```

### Coverage highlights
- 1000+ unit/integration tests across all packages
- 8 E2E workflow scenarios: happy path, kill switch, rejection, feedback loop, concurrent tasks, cost budget, safety controls, invariants
- API route tests: auth, validation, signal delivery
- Workflow phase tests: each phase tested individually with mock activities
- DB repository tests: CRUD operations against real Testcontainers Postgres

### Known gaps
- No integration test exercises the full API → Temporal → real activities → real DB path (E2E uses mock activities)
- 8 pre-existing MinIO/artifact-store test failures (infrastructure — MinIO container connectivity)
- 18 pre-existing workflow test failures: orchestrator, feedback-loop, and merge-execution tests fail because `publishPhaseEvent` activity (observability) is not registered in test workers. The activity runs fine in production but is missing from the test worker setup

---

## Important decisions and tradeoffs

See `docs/decisions.md` for the full ADR log (6 ADRs). Key decisions:

**ADR-001: Persistence at the API boundary.** The API creates repo + task rows before starting the Temporal workflow. This means 201 is honest, tasks are always queryable, and the workflow never fabricates identities. Tradeoff: if `workflow.start` fails after task creation, the task is orphaned in `created` state (acceptable for V1).

**ADR-002: No patched() gates in pre-production.** Temporal's `patched()` API is for backward compatibility with running workflows. With zero production history, all gates blocked real code. They were removed — reintroduce when deploying breaking changes to in-flight workflows.

**ADR-003: Single repo identity model.** DB UUID as PK, slug as lookup. Deleted the synthetic `deterministicRepoUUID` that competed with real DB identity. `CapabilitySnapshot.repoId` is vestigial (placeholder UUID, not read downstream).

**ADR-004: L2 auto-approves setup contracts.** Repos without `.factory/setup.yml` get a default contract. L2 autonomy auto-approves it. L0/L1 wait for human signal via `POST /api/tasks/:id/approve-setup`.

**ADR-005: All orchestrator state survives Continue-As-New.** Every mutable variable read by a later phase is declared on `TaskWorkflowInput`, initialized from input, and passed in the `continueAsNew` call. Adding a new state variable requires updating three locations.

**ADR-006: Parent-forwards-signals for webhook delivery.** Webhook signals are dispatched to the parent orchestrator (stable ID). The parent forwards to the active pr_tracking child using `getExternalWorkflowHandle`. This avoids the webhook dispatcher needing to know the current `phaseIteration`.

**neverthrow over thrown exceptions.** Domain boundaries use `Result<T, FactoryError>` to make error paths explicit and composable. Temporal activities convert at the boundary to `ApplicationFailure` (Temporal's error type).

**Zod strict mode everywhere.** `.strict()` on all object schemas catches field drift early. Types are always derived, never hand-written.

**Continue-As-New at 10K events.** The orchestrator checks Temporal's history length and calls `continueAsNew` to avoid the 51,200 event limit.

---

## Gotchas

1. **`packages/core` cannot use Node.js APIs.** It's imported by `temporal-workflows` which runs in Temporal's V8 isolate. Even `Buffer` or `crypto` will crash at runtime. This is enforced by convention, not by tooling.

2. **`temporal-workflows` cannot import activity code at runtime.** Use `proxyActivities<T>()` with type-only imports (`import type`). `verbatimModuleSyntax: true` enforces this. Violation compiles but crashes in the V8 sandbox.

3. **All `@temporalio/*` packages must share the exact same version (1.14.1).** Version mismatch causes opaque runtime errors in the workflow sandbox.

4. **The `repos` table has a unique index on `(github_owner, github_repo)`.** `getOrCreateRepo` handles the race condition on concurrent submissions — catch constraint violation, retry with lookup.

5. **`CapabilitySnapshot.repoId` is vestigial.** It exists on the schema (validated as `.uuid()`) but no downstream consumer reads it. The orchestrator passes `input.repoId` (the DB UUID) everywhere. Don't rely on `snapshot.repoId` for identity.

6. **The kill switch is dual-mechanism.** Redis flag (checked at every activity boundary for instant effect) + Temporal signal (for the workflow's signal handler). Both must fire for reliable termination.

7. **`baseSha` on `UnderstandInput` is dead.** The understand phase now uses `cloneResult.headSha` from the actual clone. The input field exists for interface compatibility but is not used for indexing.

8. **Webhook routing uses the `review_states` table.** GitHub PR events are matched to Temporal workflow IDs via `review_states.prNumber`. If a PR isn't tracked there, the webhook is silently dropped.

9. **Docker Desktop on Mac requires a monkey-patch.** `docker-modem` has a redirect handling bug. The sandbox code patches it. If Docker operations fail on Mac, check this path first.

10. **drizzle-kit's bundled dotenv loads from `process.cwd()`.** Migration scripts use `DOTENV_CONFIG_PATH=../../.env` to find the root `.env` file. If migrations fail silently, this is usually why.

11. **`response.status` vs `response.workflowStatus` in the task detail API.** `status` is the DB lifecycle state (e.g., `evidence_ready`). `workflowStatus` is the Temporal runtime status (e.g., `RUNNING`). Dashboard polling uses `workflowStatus`; state badges and action guards use `status`. Mixing them up causes the dashboard to show wrong states or fail to poll.

12. **The application-level state machine is dead code.** `canTransition()` in `state-machine.ts` is never called. The DB trigger on the `tasks` table is the sole enforcement mechanism. If you need a new transition, add it to `task_valid_transitions` via a migration, not in `state-machine.ts`.

13. **Signal forwarding only works during `pr_tracking` phase.** The parent orchestrator's signal handlers forward to the child only when `currentPhase === "pr_tracking"`. Signals arriving during other phases are silently absorbed (updating `lastActivityAt` only). If pr_tracking relies on a signal that arrives before the phase starts, it will miss it and must fall back to polling.

14. **`phaseIteration` affects child workflow IDs.** Phases that repeat across feedback loops (implement, validate, evidence, review, pr_tracking) include `phaseIteration` in their child workflow ID: `task-{taskId}-{phase}-{phaseIteration}`. Signal forwarding, task queries, and any code that computes child IDs must use the current `phaseIteration` value.
