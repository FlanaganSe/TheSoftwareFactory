# Software Factory -- Comprehensive Product Overview Research

Date: 2026-03-20
Scope: Deep codebase read across all 10 areas requested
Status: Complete

---

## 1. Entry Points

### 1.1 API Server (`packages/api/src/app.ts`)

Boot sequence:
1. Creates a Drizzle DB connection via `createDb(databaseUrl)` (from `@software-factory/db`)
2. Creates a Fastify server via `createServer()` which sets up:
   - Zod validator/serializer compilers (fastify-type-provider-zod)
   - CORS (allowlisted origins, defaults to `localhost:5173` and `localhost:4173`)
   - Custom error handler that maps `FactoryError` codes to HTTP status codes
   - Decorates the Fastify instance with `db`, `dbPool`, `webhookSecret`, `redisUrl`, `temporalAddress`, `minioEndpoint`
3. Optionally connects a Temporal client (dynamic import of `@temporalio/client`); if connection fails, logs a warning and task endpoints return 503
4. Registers 8 route modules in order: health, metrics, webhooks, api-keys, tasks, safety, setup, events
5. Seeds an admin API key on first run (prints to console -- cannot be retrieved again)
6. Starts listening on `port` / `host`
7. Installs SIGTERM/SIGINT handlers for graceful shutdown (closes server, ends DB pool)

Env vars: `DATABASE_URL` (required), `WEBHOOK_SECRET` (required), `PORT` (default 3000), `HOST` (default 0.0.0.0), `REDIS_URL`, `TEMPORAL_ADDRESS`, `MINIO_ENDPOINT`, `CORS_ORIGINS`.

Key files:
- `/Users/seanflanagan/proj/software-factory/packages/api/src/app.ts` (lines 1-111)
- `/Users/seanflanagan/proj/software-factory/packages/api/src/server.ts` (lines 1-56)
- `/Users/seanflanagan/proj/software-factory/packages/api/src/bootstrap/seed-admin-key.ts` (lines 1-33)

### 1.2 Worker (`packages/worker/src/index.ts`)

Boot sequence:
1. Applies a docker-modem monkey-patch to disable redirects (fixes Docker Desktop for Mac issue with exec calls)
2. Calls `loadWorkerConfig()` which reads env vars: `DATABASE_URL` (required), `REDIS_URL` (required), `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `DOCKER_SOCKET_PATH`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `OPENROUTER_API_KEY`, `MINIO_ENDPOINT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`, `API_URL`
3. Calls `createWorker(config)` which:
   - Connects to Temporal via NativeConnection
   - Creates DB and Redis connections
   - Constructs activity implementations with dependency injection: task, audit, safety (kill check + cost check + branch lease), sandbox (Docker), validation, GitHub (conditional on `githubAppId`), index, LLM (conditional on `openRouterApiKey`), evidence (conditional on `minioSecretKey`)
   - Sets up OTel workflow exporter for V8 sandbox trace bridging
   - Creates `Worker` on task queue `"sf-orchestration"`, with workflow bundle loaded from `@software-factory/temporal-workflows`
4. Installs graceful shutdown handlers
5. Runs the worker (blocks until shutdown)

Key detail: GitHub, LLM, and evidence activities are CONDITIONALLY registered -- the worker operates in degraded mode without those credentials.

Key files:
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/index.ts` (lines 1-47)
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/worker.ts` (lines 1-191)
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/config.ts` (lines 1-47)

### 1.3 CLI (`packages/cli/src/index.ts`)

Commander.js program named `factory` with version `0.1.0`.

Global options: `--json`, `--no-color`, `--api-url <url>`, `--api-key <key>`.

Config is loaded lazily via `loadConfig()` which merges global options with config file.

11 commands registered:
- `status <task-id>` -- Show task status (supports `--watch` for polling)
- `evidence <task-id>` -- View evidence bundle
- `approve <task-id>` -- Approve a task
- `reject <task-id>` -- Reject a task (requires `--reason`)
- `changes <task-id>` -- Request changes (requires `--message`)
- `review <task-id>` -- View review state
- `config` -- Manage CLI configuration
- `health` -- Check API server health
- `kill [task-id]` -- Kill a task or activate global kill switch (`--all`, `--deactivate`, `--reason`, `--yes`)
- `budget` -- View/set cost budgets
- `safety` -- View safety dashboard (kill switches, circuit breakers, costs)

File: `/Users/seanflanagan/proj/software-factory/packages/cli/src/index.ts` (lines 1-55)

### 1.4 Dashboard (`apps/dashboard/src/routes/+layout.svelte`)

SvelteKit app with:
- Auth check on mount: redirects to `/login` if not authenticated
- SSE client connection on auth success (via `createSSEClient(apiUrl, apiKey)`)
- Layout: Sidebar + Header + main content area
- CSS: Tailwind with custom `surface-0`, `text-muted` tokens

Routes:
- `/` -- Home page
- `/login` -- Login page
- `/tasks` -- Task list
- `/tasks/[id]` -- Task detail
- `/tasks/[id]/evidence` -- Evidence bundle view
- `/repos` -- Repository list (placeholder)
- `/repos/[id]` -- Repository detail (placeholder)
- `/safety` -- Safety dashboard

File: `/Users/seanflanagan/proj/software-factory/apps/dashboard/src/routes/+layout.svelte` (lines 1-52)

---

## 2. Core Domain Models (`packages/core/src/schemas/`)

14 schema files, all using `.strict()` on Zod objects.

### 2.1 Task (`schemas/task.ts`)

16 states: `created`, `needs_clarification`, `assigned`, `in_progress`, `paused`, `evidence_ready`, `changes_requested`, `approved`, `pr_created`, `external_checks_pending`, `addressing_review_feedback`, `external_blocked`, `merge_ready`, `merged`, `failed`, `cancelled`.

`TaskSchema`: `id` (uuid), `state`, `objective`, `scope` (nullable JSON), `constraints` (nullable JSON), `budgetCents` (nullable int), `repoId` (uuid), `createdBy`, `createdAt`, `updatedAt`.

`CreateTaskSchema`: `objective`, `scope`, `constraints`, `budgetCents`, `repoId`, `createdBy`.

### 2.2 State Machine (`state-machine.ts`)

21 explicit transitions + wildcard (any non-terminal -> cancelled). Terminal states: `merged`, `failed`, `cancelled`.

Key transitions: `created -> needs_clarification | assigned`, `assigned -> in_progress`, `in_progress -> evidence_ready | failed | paused`, `evidence_ready -> changes_requested | approved`, `changes_requested -> in_progress` (re-implementation loop), `approved -> pr_created`, `pr_created -> external_checks_pending`, `external_checks_pending -> addressing_review_feedback | external_blocked | merge_ready`, `merge_ready -> merged | failed`.

Exported functions: `canTransition(from, to)`, `getValidTransitions(from)`, `isTerminal(state)`.

File: `/Users/seanflanagan/proj/software-factory/packages/core/src/state-machine.ts` (lines 1-97)

### 2.3 Autonomy Levels (`schemas/autonomy.ts`)

Three levels: `L0` (human confirms every action), `L1` (agent produces diffs/plans; human approval before branch creation and file writes; DEFAULT), `L2` (agent autonomous; human approval only for PR/merge -- deferred to Phase 2).

### 2.4 Auth (`schemas/auth.ts`)

Roles: `admin`, `operator`, `viewer`. Actor types: `system`, `operator`.

`ApiKeyCredentialSchema`: `keyHash`, `role`, `createdBy`, `expiresAt`, `lastUsedAt`.
`ActorIdentitySchema`: `actorId`, `actorType`, `role`.

### 2.5 Audit (`schemas/audit.ts`)

18 action types covering the full lifecycle: `task_state_change`, `task_created`, `evidence_generated`, `review_decision`, `pr_created`, `pr_merged`, `pr_closed`, `policy_check`, `llm_call`, `sandbox_exec`, `file_read`, `file_write`, `command_run`, `credential_rotation`, `secret_access`, `kill_switch_activated`, `budget_warning`, `config_changed`.

8 target types: `task`, `repository`, `policy`, `evidence`, `pr`, `sandbox`, `secret`, `config`, `system`.

`AuditEntrySchema`: `id`, `timestamp`, `actor`, `actionType`, `targetType`, `targetId`, `result`, `costCents`, `taskId`, `content` (unknown), `contentHash`.

### 2.6 Policy (`schemas/policy.ts`)

4 policy types: `read_exclusion`, `edit_deny`, `edit_protected`, `edit_allowed`.
3 protection classes: `hard_protected`, `flagged`, `light_protected`.

`PolicyConfigSchema`: `repoId`, `name`, `policyType`, `protectionClass`, `pathPatterns` (array of globs), `autonomyLevel`, `requiresApproval`, `approverRole`, `isActive`.

### 2.7 Evidence (`schemas/evidence.ts`)

The 13-field evidence bundle per PRD R-008: `objective`, `annotatedDiff`, `blastRadius`, `ownersImpacted`, `testResults`, `securityScanResults`, `lintResults`, `protectedSurfaceEdits`, `migrationImpact`, `revertabilityClass`, `unresolvedAssumptions`, `commandsRun`, `pendingExternalChecks`. Plus metadata fields.

Sub-schemas: `DiffAnnotation` (file, hunkIndex, annotation, riskLevel, affectedConsumers), `TestResults` (passed/failed/skipped + details), `SecurityScanResults` (vulnerabilities array with severity), `LintResults`, `ProtectedEdit`, `MigrationImpact`, `CommandRecord`, `BlastRadius`.

3 revertability classes: `clean_revert`, `revert_with_migration`, `non_revertable`.

### 2.8 Capability Snapshot (`schemas/capability.ts`)

A detailed GitHub repository capability model (~364 lines, 30+ fields):
- Branch protection (legacy API): review counts, stale reviews, code owner review, status checks, admin enforcement, restrictions
- Rulesets (modern): 18 rule types as a discriminated union
- CODEOWNERS parsing (3 locations searched)
- Merge queue configuration
- Dangerous workflow detection (`pull_request_target`, `workflow_run`)
- Repository classification (A/B/C), `supportedByFactory` flag, `unsupportedReasons`, warnings

### 2.9 LLM (`schemas/llm.ts`)

11 workflow phases: `intake`, `understand`, `plan`, `setup`, `implement`, `validate`, `evidence`, `review`, `pr_creation`, `pr_tracking`, `learn`.

7 agent tool names: `file_read`, `file_write`, `file_edit`, `search_codebase`, `run_command`, `list_files`, `search_text`.

`LLMCallAuditEntrySchema`: model, provider, token counts (input/output/reasoning/cached), cost, latency, phase, finishReason, contentHash.

### 2.10 Sandbox (`schemas/sandbox.ts`)

6 container phases: `resolve`, `create`, `setup`, `maintenance`, `execution`, `cleanup`.
3 secret classes: `setup_only`, `runtime`, `per_tool`.

`SetupContractSchema`: `version`, `image`, `setup` (commands), `maintenance` (commands), `secrets` (3 classes), `health_check` (commands).

### 2.11 TrustedBaseContext (`trusted-context.ts`)

Pinned at task intake to prevent candidate-branch edits from altering agent behavior (PRD R-011):
- `baseSha`: HEAD SHA of default branch at intake time
- `setupContract`: parsed from `.factory/setup.yml` at pinned SHA
- `policySnapshot`: policy configs at intake
- `behavioralControlFiles`: contents of `AGENTS.md`, `CLAUDE.md`, `.factory/config.toml` at pinned SHA
- `validationCommandSources`: content hashes of control files
- `capturedAt`: timestamp

File: `/Users/seanflanagan/proj/software-factory/packages/core/src/trusted-context.ts` (lines 1-21)

### 2.12 Validation (`schemas/validation.ts`)

`ValidationResultSchema`: test/lint/security/SBOM/vulnerability/blast-radius/migration/revertability/validator-boundary results, plus `passed` boolean and `summary` string.

### 2.13 Config (`schemas/config.ts`)

`FactoryConfigSchema`: 10 sections -- api, database, redis, temporal, objectStorage, github, llm, autonomy, review, sandbox. Defaults: port 3000, L1 autonomy, 4-hour review timeout, $10/task budget, $100/day budget, 4GB sandbox memory, 2 CPUs, network:none.

### 2.14 Policy Decision Service (`policy/decision-service.ts`)

Pure function (no side effects, V8-safe). Default governance exclusions: `secrets/**`, `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `.git/**`, `node_modules/**`.

`evaluatePath(path, operation, policies)` returns `PolicyDecision`:
- First checks governance exclusions (always deny)
- Then matches policies in priority order: `read_exclusion > edit_deny > edit_protected > edit_allowed`
- Uses picomatch for glob matching (ReDoS-safe)
- Default (no matching policy): allow without approval

File: `/Users/seanflanagan/proj/software-factory/packages/core/src/policy/decision-service.ts` (lines 1-143)

---

## 3. API Surface (`packages/api/src/routes/`)

8 route files, 30+ endpoints total.

### Health (`routes/health.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Basic liveness: `{status: "ok", version: "0.1.0"}` |
| GET | `/health/live` | None | Kubernetes liveness probe |
| GET | `/health/ready` | None | Readiness probe: checks DB, Redis, Temporal, MinIO in parallel |

### Metrics (`routes/metrics.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/metrics` | IP-restricted (loopback/private) | Prometheus metrics (prom-client). Custom: `factory_api_http_request_duration_seconds`, `factory_api_http_requests_total`. |

### Webhooks (`routes/webhooks.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/webhooks/github` | HMAC-SHA256 (skipAuth) | GitHub webhook receiver. Verifies signature against raw bytes, deduplicates via `X-GitHub-Delivery`, dispatches to Temporal workflow signals. |

### API Keys (`routes/api-keys.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/keys` | Bearer + admin | Create API key with label, role, optional expiry |
| GET | `/api/keys` | Bearer + admin | List all API keys |
| DELETE | `/api/keys/:id` | Bearer + admin | Revoke (soft-delete) |

### Tasks (`routes/tasks.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/tasks` | Bearer + admin/operator | Create task, start `taskOrchestrator` workflow |
| GET | `/api/tasks` | Bearer (any) | List active tasks from DB |
| GET | `/api/tasks/:id` | Bearer (any) | Task status via Temporal describe |
| POST | `/api/tasks/:id/approve` | Bearer + admin/operator | Approve signal (separation of duties enforced) |
| POST | `/api/tasks/:id/reject` | Bearer + admin/operator | Reject signal (reason required) |
| POST | `/api/tasks/:id/changes` | Bearer + admin/operator | Changes requested signal (message required) |
| POST | `/api/tasks/:id/kill` | Bearer + admin | Dual: Redis kill flag + Temporal signal |
| POST | `/api/tasks/:id/approve-setup` | Bearer + admin/operator | Signals child setup workflow |
| GET | `/api/tasks/:id/evidence` | Bearer (any) | Most recent evidence bundle |
| GET | `/api/tasks/:id/freshness` | Bearer (any) | Evidence freshness (stub: always fresh) |

### Safety (`routes/safety.ts`)

All require Redis; disabled if not configured.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/safety/status` | Bearer + admin/operator | Dashboard: global kill, active kills, circuits, daily cost |
| POST | `/api/safety/kill/global` | Bearer + admin | Activate global kill + signal all running workflows |
| DELETE | `/api/safety/kill/global` | Bearer + admin | Deactivate global kill |
| GET | `/api/safety/kill` | Bearer + admin/operator | List active kill switches |
| GET | `/api/safety/circuits` | Bearer + admin/operator | Circuit breaker status |
| POST | `/api/safety/circuits/:service/reset` | Bearer + admin | Force-close circuit |
| POST | `/api/safety/circuits/:service/trip` | Bearer + admin | Force-open circuit |
| GET | `/api/safety/costs/daily` | Bearer + admin/operator | Today's cost |
| GET | `/api/safety/costs/daily/:date` | Bearer + admin/operator | Specific date cost |
| POST | `/api/safety/budget/daily` | Bearer + admin | Set daily budget |
| GET | `/api/safety/costs/task/:id` | Bearer + admin/operator | Task cost summary |
| POST | `/api/tasks/:id/budget` | Bearer + admin | Override task budget |

### Setup (`routes/setup.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/setup/github` | None (skipAuth) | GitHub App manifest JSON + registration URL |
| GET | `/api/setup/github/callback` | None (skipAuth) | Exchange manifest code for app credentials |

### Events (`routes/events.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/events?token=<apiKey>` | Query param | SSE stream via Redis pub/sub (`factory:tasks`, `factory:system`) |

---

## 4. Data Layer

### 4.1 Database Schema (`packages/db/src/schema/`)

16 tables, 7 pgEnums:

| Table | Key Columns | FK | Purpose |
|-------|-------------|-----|---------|
| `repos` | id, github_owner, github_repo, default_branch, repo_class, autonomy_level, setup_contract_path | -- | Root entity. Unique on (owner, repo). |
| `tasks` | id, state (enum), objective, scope (jsonb), constraints (jsonb), budget_cents, repo_id, autonomy_level, created_by | repos | Partial index on active states. |
| `task_valid_transitions` | from_state, to_state | -- | Composite PK. Enforced by DB trigger. |
| `audit_entries` | id, timestamp, actor, action_type, target_type, target_id, result, cost_cents, task_id, content (jsonb), content_hash | tasks | Indexed on task_id, actor, action_type. |
| `evidence_bundles` | id, task_id, version, schema_version, objective, base_sha, head_sha, merge_base_sha, revertability_class, blast_radius_files/packages, 9 jsonb columns | tasks | Full PRD R-008 evidence packet. |
| `review_states` | id, task_id (unique), evidence_bundle_id, internal_approved_by/at, pr_number, pr_url, pr_node_id, head_sha, required_checks (jsonb), codeowners_status, unresolved_threads, stale_reviews, merge_queue_status, last_github_sync | tasks, evidence_bundles | Internal + external review tracking. |
| `policy_configs` | id, repo_id, name, policy_type (enum), protection_class (enum), path_patterns (jsonb), autonomy_level, requires_approval, approver_role, is_active | repos | GIN index on path_patterns. |
| `secret_bindings` | id, repo_id, name, secret_class (enum), tool_scope, encrypted_value (bytea), encrypted_dek (bytea), kek_id | repos | Envelope encryption. Unique on (repo, name). |
| `credential_leases` | id, task_id, token_type, scope (jsonb), expires_at, rotated_at, revoked_at | tasks | Per-phase GitHub token scoping. |
| `code_index_versions` | id, repo_id, commit_sha, status | repos | building / ready / stale. Unique on (repo, sha). |
| `code_symbols` | id, index_version_id, file_path, symbol_name, symbol_kind, line_start, line_end, parent_symbol, signature, is_exported | code_index_versions | function/class/interface/type/variable/export |
| `code_dependencies` | id, index_version_id, source_file, target_file, import_type | code_index_versions | static/dynamic/type_only |
| `code_files` | id, index_version_id, file_path, file_hash, language, line_count, is_entry_point, module_group, governance_excluded | code_index_versions | -- |
| `cost_records` | id, task_id, model_id, input_tokens, output_tokens, cost_cents, latency_ms, timestamp | tasks | Indexed on task_id, timestamp, model_id. |
| `environment_states` | id, repo_id, image_ref, setup_contract_hash, cache_valid, last_health_check, health_status | repos | -- |
| `webhook_deliveries` | id, delivery_id (unique), event, action, payload_hash, status, processed_at | -- | Dedup via delivery_id. |
| `side_effects` | id, task_id, effect_type, idempotency_key (unique), target_ref, request_payload_hash, response_payload (jsonb), status, error_message | tasks | Idempotency ledger for external mutations. |
| `api_keys` | id, key_hash (unique), label, role (enum), created_by, expires_at, last_used_at, is_active | -- | SHA-256 hashed keys with `sf_` prefix. |

### 4.2 Repositories (`packages/db/src/repositories/`)

10 repository modules (functional style, all return `Result<T, FactoryError>` via neverthrow):

- **task-repository**: `createTask`, `getTask`, `transitionTaskState` (state change + audit entry in single transaction), `listActiveTasks`
- **api-key-repository**: `createApiKey` (generates `sf_` prefixed key, stores SHA-256 hash), `validateApiKey` (hash + expiry check, updates lastUsedAt), `listApiKeys`, `countApiKeys`, `revokeApiKey`
- **audit-repository**: audit entry insert operations
- **evidence-repository**: evidence bundle CRUD, `getEvidenceForTask`
- **webhook-repository**: `isDeliveryProcessed`, `recordDelivery`, `markDeliveryProcessed`
- **policy-repository**: policy config CRUD
- **repo-repository**: `createRepo`, `getRepo`, `getRepoBySlug`, `getOrCreateRepo`, `listRepos`
- **review-state-repository**: review state CRUD, `getReviewStateByPrNumber`
- **side-effect-repository**: idempotency ledger operations
- **index-repository**: code index operations

Key pattern: `transitionTaskState` writes both the state change and audit entry in a single DB transaction -- this is an explicit invariant documented in `CLAUDE.md`.

---

## 5. Worker and Activities

### 5.1 Activity Registration (conditional)

Activities spread into a single object. **Conditional registration**:
- **Always registered**: taskActivities, auditActivities, safetyActivities (kill check, cost check, branch lease), sandboxActivities (Docker), validationActivities
- **Conditional on `githubAppId`**: githubActivities (CredentialBroker, MutationSerializer)
- **Conditional on `openRouterApiKey`**: llmActivities + planActivities
- **Conditional on `minioSecretKey`**: evidenceActivities (MinIO artifact store)

Task queue: `"sf-orchestration"`.

### 5.2 Activity Categories (`packages/temporal-activities/src/`)

60+ source files organized by domain:

- **GitHub** (14 files): credential-broker, rate-limiter, client, ruleset-analyzer, workflow-scanner, codeowners-parser, branch, trusted-context, capability-scan, pr, check-run, review-tracker, auto-merge, merge, reconciler, activities
- **Sandbox** (8 files): supervisor, exec, cleanup, network, secrets, monitor, cache, activities
- **LLM** (10 files): agent, tools, context, edit-format, guardrails, cost-tracker, prompt-safety, provider, plan-activities, activities
- **Indexing** (8 files): parser (tree-sitter), symbol-extractor, import-extractor, governance-filter, repo-map, indexer, types, activities
- **Validation** (7 files): test-runner, lint-runner, security-scanner, blast-radius, validator-boundary, activities
- **Evidence** (8 files): generator, diff-annotator, redaction, risk-summary, locator, manifest, artifact-store, activities
- **Safety** (8 files): kill-check, kill-switch, cost-check, budget-manager, branch-lease, circuit-breaker, with-circuit-breaker, redis-client
- **DB** (2 files): task-activities, audit-activities

---

## 6. Temporal Workflows

### 6.1 Orchestrator (`packages/temporal-workflows/src/orchestrator.ts`, 932 lines)

Parent workflow `taskOrchestrator` manages the full task lifecycle. Each of the 11 phases is a **child workflow** executed via `executeChild()`.

**Phase order**: intake, understand, plan, setup, implement, validate, evidence, review, pr_creation, pr_tracking, learn.

**Continue-As-New**: Triggers when `continueAsNewSuggested` or `historyLength > 10,000`. Persists inter-phase state.

**Re-implementation loop**: On `changes_requested` from review or pr_tracking, increments `phaseIteration` and jumps back to implement. Max attempts configurable (default 3).

**Merge execution**: Happens in the orchestrator (not a child). Pre-merge safety check, merge via REST/GraphQL (squash preferred), post-merge branch deletion in non-cancellable scope.

**Cleanup**: Non-cancellable scope in ALL terminal paths: releases branch lease, destroys sandbox, persists terminal state.

**Signal handling**: 12 signals registered at parent level. Most update `lastActivityAt` -- actual processing in child workflows. Exception: `killSignal` sets `killed = true`, `costOverrideSignal` updates budget.

**Query handlers**: `getState`, `getProgress` (full snapshot), `getPhase`.

### 6.2 Signals (`packages/temporal-workflows/src/signals.ts`)

7 human-initiated: `kill`, `approve`, `reject`, `changes_requested`, `resume`, `clarify_response`, `cost_override`.
4 GitHub lifecycle: `pr_review`, `check_complete`, `merge_queue_update`, `pr_closed`.
3 queries: `getState`, `getProgress`, `getPhase`.

### 6.3 Phase Pattern

Every phase:
1. Check kill switch (`safetyActivities.checkKillSwitch`)
2. Domain-specific work via proxied activities
3. Return typed result struct

Key phases:

**Intake**: Loads task, transitions to `assigned` (or `needs_clarification`).

**Clarify**: Blocks indefinitely for `clarifyResponseSignal`. No timeout. Appends to objective.

**Understand**: Clones repo, capability scan, TrustedBaseContext capture, code indexing (tree-sitter), top 20 relevant files.

**Plan**: LLM plan generation via frontier model. Uses `simpleHash()` (not crypto) for V8 isolate safety.

**Setup**: Loads setup contract from TrustedBaseContext. If missing, generates suggestion. L0/L1: pauses for human approval. Provisions Docker sandbox, acquires branch lease.

**Implement**: **Autonomy gate at L0/L1** -- pauses for approval before code execution. Cost budget check. LLM agent (30-min timeout, 50 steps max, 25-min wall clock). Collects files from sandbox via `git diff`, pushes via Git Database API.

**Validate**: Runs tests, linter, Semgrep security scan, blast radius, validator boundary check. Commands from TrustedBaseContext.

**Evidence**: Generates and persists evidence bundle (MinIO + Postgres).

**Review**: Signal-driven approve/reject/changes. 4-hour timeout with escalation audit entry.

**PR Creation**: Creates PR, factory check run, SARIF upload, auto-merge/merge queue. Uses `patched()` for replay compatibility.

**PR Tracking**: Long-lived. Signal-driven + 5-minute reconciliation interval. 7-day timeout. Uses `patched()`.

**Learn**: Records task metrics. Non-critical. Uses `patched()`.

**Reconciliation** (separate): Scheduled workflow calling `reconcileAllResources()`.

### 6.4 Activity Types (`activity-types.ts`, 832 lines)

Pure type-only file (V8-safe). Defines all activity interfaces: TaskActivities, AuditActivities, SafetyActivities, SandboxActivities, GitHubActivities, LLMActivities, IndexActivities, PlanActivities, ValidationActivities, EvidenceActivities, PRActivities, CheckRunActivities, AutoMergeActivities, ReviewStateActivities, ReviewTrackerActivities, MergeActivities, LearnActivities, BroadReconcilerActivities.

---

## 7. CLI

See section 1.3 for command listing. All commands follow the same pattern:
1. Parse args (Commander.js)
2. Get config (`getConfig()`)
3. Create API client (`createApiClient(config)`)
4. Call API method
5. Format/display (text or JSON via `--json`)
6. Handle errors with `chalk.red()`

Key details:
- `status --watch` polls every 5 seconds
- `kill --all` requires typing `KILL ALL` unless `--yes`
- Config: 5-tier precedence (CLI flags > env > project config > user config > defaults)
- Uses `@iarna/toml` for config, XDG paths for user config location

---

## 8. Configuration and Infrastructure

### 8.1 Docker Compose (`docker-compose.yml`)

5 core services + 3 optional observability:

**Core**:
- `postgres` (16-alpine): DB `factory`, tuned (shared_buffers=256MB, data checksums, scram-sha-256). Init script. Password via Docker secret.
- `redis` (7-alpine): Password-protected.
- `temporal` (auto-setup): Postgres backend, databases `temporal` + `temporal_visibility`.
- `temporal-ui`: Web UI.
- `minio`: S3-compatible object storage.

**Observability** (profile `observability`, opt-in):
- `otel-collector`: OpenTelemetry collector.
- `jaeger`: Trace visualization.
- `grafana`: Dashboards.

All on `factory-internal` bridge network. Named volumes.

### 8.2 Docker Compose Override

Local dev port mappings: postgres:5433, redis:6380, temporal:7233, temporal-ui:8080, minio:9000+9001.

### 8.3 Environment Variables

No `.env.example` file. Variables documented across config files:
- API: `DATABASE_URL`, `WEBHOOK_SECRET`, `PORT`, `HOST`, `REDIS_URL`, `TEMPORAL_ADDRESS`, `MINIO_ENDPOINT`, `CORS_ORIGINS`
- Worker: above plus `TEMPORAL_NAMESPACE`, `DOCKER_SOCKET_PATH`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `OPENROUTER_API_KEY`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`, `API_URL`
- Docker Compose: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD`
- Encryption: `FACTORY_MASTER_KEY` (64 hex chars = 32 bytes)

---

## 9. Test Structure

### 9.1 Framework and Configuration

Vitest everywhere. Root config uses workspace project mode:
- `projects: ["packages/!(e2e)/vitest.config.ts", "apps/*/vitest.config.ts"]`
- `maxWorkers: "50%"` to avoid too many Testcontainers

Per-package notes:
- **temporal-workflows** and **e2e**: `pool: "forks"`, `singleFork: true` (sequential). 60s/120s timeouts. Required because TestWorkflowEnvironment instances cause resource contention.
- **e2e**: 120s test/hook timeouts. Uses mock activities.

### 9.2 Test File Count

~90 test files across the project (excluding node_modules):

- `packages/core/__tests__/`: 5 tests (state-machine, schemas, policy-decision-service, capability-schema, validation-schema, errors)
- `packages/db/__tests__/`: 6 tests (encryption, audit-rls, transactional-audit, state-machine-trigger, side-effect-ledger, webhook-dedup, review-state-repository)
- `packages/temporal-workflows/__tests__/`: 8 tests (review-phase, clarify-phase, signals, validate-phase, evidence-phase, pr-creation-phase, pr-tracking-phase, learn-phase)
- `packages/temporal-activities/__tests__/`: ~45 tests across github, sandbox, llm, indexing, validation, evidence, safety, db domains
- `packages/api/__tests__/`: 6 tests (webhooks, webhook-dispatch, health, metrics-endpoint, tasks-api, events)
- `packages/worker/__tests__/`: 2 tests (metrics, logger)
- `packages/cli/__tests__/`: 5 tests (commands, evidence-display, api-client, config, safety-commands)
- `apps/dashboard/src/lib/`: 4 tests (format, colors, client, sse)

### 9.3 E2E Test Structure (`packages/e2e/`)

Setup: `test-environment.ts`, `helpers.ts`, `mock-activities.ts`.
8 scenarios: happy-path, rejection, feedback-loop, kill-switch, cost-budget, concurrent-tasks, safety-controls, invariants.

### 9.4 Test Conventions

- Co-located in `__tests__/` directories
- Real databases via Testcontainers for DB integration tests
- `@temporalio/testing` with time-skipping for workflow tests
- Mocked external services (GitHub API, LLM) in activity tests

---

## 10. Non-Obvious Patterns

### 10.1 Middleware (`packages/api/src/middleware/`)

**auth.ts**: Bearer token -> SHA-256 hash lookup -> `request.actor` decoration. Extends Fastify types to add `actor`, `db`, `dbPool`, `webhookSecret`, `redisUrl`, `temporalAddress`, `temporalClient`, `minioEndpoint`.

**require-role.ts**: Factory function returning preHandler. Variadic: `requireRole("admin", "operator")`.

**error-handler.ts**: Maps `FactoryError` codes to HTTP status. Never leaks stack traces for 5xx.

### 10.2 Encryption (`packages/db/src/encryption/`)

Envelope encryption for `secret_bindings` table:

- `kms-provider.ts`: Interface with `wrapDek`/`unwrapDek`.
- `local-kms.ts`: `LocalKmsProvider` using AES-256-ECB wrapping. Requires `FACTORY_MASTER_KEY` (64 hex = 32 bytes). Noted as "acceptable for local dev."
- `envelope.ts`: AES-256-GCM with 96-bit IV.
- `secret-manager.ts`: High-level `encryptSecret` (random DEK, encrypt, wrap) and `decryptSecret` (unwrap, decrypt).

### 10.3 Trusted Base Context System

Security-critical pattern (PRD R-011). Captured during understand phase. Pins: base SHA, setup contract, policy snapshot, behavioral control files (`AGENTS.md`, `CLAUDE.md`, `.factory/config.toml`). Consumed by ALL downstream phases. Prevents candidate-branch edits from altering agent behavior or validation criteria.

Activity: `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/github/trusted-context.ts`

### 10.4 Sandbox Supervisor

Docker-based sandboxing with defense-in-depth:
- `CapDrop: ["ALL"]`, limited add for setup only (CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID)
- `no-new-privileges:true`, `ReadonlyRootfs: true`
- Tmpfs mounts for /tmp, /run, /home/agent/.cache (noexec, nosuid, size-limited)
- `NetworkMode: "none"` for execution (bridge for setup only)
- User `1000:1000`, PID limit 256, memory 4GB, CPU 2
- Environment caching: commits container to image after setup, reuses on next run
- Secret phase separation: setup-only secrets NOT available during execution

File: `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/sandbox/supervisor.ts`

### 10.5 LLM Guardrails

5 checks after every agent step:
1. **max_steps**: Hard limit (default 10)
2. **no_progress**: Identical state fingerprints (default 3 consecutive)
3. **loop_of_doom**: Repeated identical tool calls (default 4 occurrences)
4. **wall_clock**: Timeout (default 30 minutes)
5. **cost_budget**: Cost cap (default $10)

Fingerprinting: SHA-256 of modified files + test/lint counts.

File: `/Users/seanflanagan/proj/software-factory/packages/temporal-activities/src/llm/guardrails.ts`

### 10.6 Kill Switch (Dual Mechanism)

Two independent mechanisms:
1. **Redis flag**: Checked by every activity. Instant effect. Global and per-task scopes. Published to `factory:system` channel for SSE.
2. **Temporal signal**: Processed in next `condition()` check.

Activities check kill before doing work. Orchestrator checks between phases.

### 10.7 Circuit Breaker

Redis-backed with Lua scripts for atomic state transitions. Default services: `github` (5 failures, 60s reset), `openrouter` (3 failures, 30s reset), `docker` (3 failures, 120s reset). States: closed -> open -> half_open -> closed/open. Admin can force-open/force-close via API.

### 10.8 Webhook Dispatcher

Routes GitHub webhooks to correct Temporal workflow signal. Maps: `pull_request.closed` -> `pr_closed`, `pull_request_review.submitted/dismissed` -> `pr_review`, `check_suite/check_run.completed` -> `check_complete`, `merge_group.*` -> `merge_queue_update`. Resolves workflow ID via `review_states` table lookup by PR number + repo.

File: `/Users/seanflanagan/proj/software-factory/packages/api/src/webhooks/dispatcher.ts`

### 10.9 Separation of Duties (R-018)

`POST /api/tasks/:id/approve` checks `request.actor.actorId !== task.createdBy`. Task submitter cannot be sole approver.

### 10.10 Admin Key Seeding

On first API startup, if no API keys exist, creates `initial-admin` key with `admin` role, prints to console. SHA-256 hashed before storage. Cannot be retrieved again.

### 10.11 Replay Compatibility (`patched()`)

PR creation, PR tracking, and learn phases use `patched()` for backward-compatible evolution. Old code paths return stubs; new paths execute real logic. Allows in-flight workflows to complete.

### 10.12 SSE Architecture

API uses Redis pub/sub to multiplex events to SSE clients. Each client gets dedicated Redis subscriber. Channels: `factory:tasks`, `factory:system`. 30s heartbeat. Newlines sanitized to prevent injection. Auth via query param (EventSource limitation).

### 10.13 Monorepo Structure

pnpm workspaces: `packages/*` (9 packages), `apps/*` (1 app: dashboard).

Critical constraint: `packages/core` must be pure TypeScript (no Node.js APIs) for V8 isolate. `packages/temporal-workflows` uses type-only imports for activities. `verbatimModuleSyntax: true` enforced.

### 10.14 docker-modem Fix

Worker entry point monkey-patches `docker-modem/lib/http` to set `maxRedirects = 0`. Docker Desktop for Mac returns 3xx redirects for Unix socket API calls (e.g. exec). The redirect handler constructs URLs without socketPath, causing DNS lookup failures.

### 10.15 Idempotency

- Webhooks: Deduplicated via `X-GitHub-Delivery` persisted BEFORE processing
- Side effects: `idempotency_key` unique constraint on `side_effects` table
- Branch leases: Redis-backed with TTL auto-expiry

### 10.16 Budget Management

Redis-backed via `BudgetManager`. Tracks daily and per-task costs. Activities record costs after LLM calls. Budget checks before expensive operations. Admin can override per-task budgets.
