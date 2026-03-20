# Testing & Integration Patterns Research

**Date:** 2026-03-20
**Scope:** Complete analysis of testing strategy, test infrastructure, and CI/CD

---

## 1. Testing Strategy Overview

The project uses a **three-tier testing strategy**: unit tests, integration tests (with real infrastructure via Testcontainers), and end-to-end tests (with Temporal's time-skipping test server + mock activities). There are **111 test files** across 9 packages + 1 app.

**Test runner:** Vitest 3.2.x (root `devDependency`)
**Test command:** `pnpm run test` (runs `vitest run`) -- excludes E2E by default
**E2E command:** `pnpm run test:e2e` (separate invocation via `--config packages/e2e/vitest.config.ts`)
**CI/CD:** No `.github/workflows` directory exists. No CI pipeline is configured.

### Key Design Decisions

1. **E2E is excluded from the default `pnpm run test`** -- the root `vitest.config.ts` (line 5) uses `projects: ["packages/!(e2e)/vitest.config.ts", "apps/*/vitest.config.ts"]` to exclude the E2E package
2. **Worker concurrency is capped** -- root config sets `maxWorkers: "50%"` (line 11) to prevent too many Testcontainers/Temporal servers from starting simultaneously
3. **Temporal workflow tests run sequentially** -- `packages/temporal-workflows/vitest.config.ts` uses `pool: "forks"` + `singleFork: true` (lines 16-21) because workflow tests create `TestWorkflowEnvironment` instances with gRPC servers that conflict under parallelism
4. **E2E tests also run sequentially** -- same `singleFork` pattern (line 10-15 of `packages/e2e/vitest.config.ts`)
5. **Safety tests share a Redis container** via `globalSetup` in `packages/temporal-activities/vitest.config.ts` (line 9), with each test file using a separate Redis database number (db: 0-6) to avoid flushdb() interference

---

## 2. Test File Inventory by Package

### packages/core (6 tests) -- Pure unit tests, no external dependencies

| File | Tests |
|------|-------|
| `__tests__/state-machine.test.ts` | Task state machine: 21 valid transitions, 13 invalid transitions, terminal states, `cancelled` reachability, `getValidTransitions` correctness |
| `__tests__/schemas.test.ts` | Zod schema validation for TaskState (16 states), Task, CreateTask, EvidenceBundle (13 fields), PolicyConfig, AutonomyLevel (L0/L1/L2), FactoryConfig defaults, SetupContract. Verifies `.strict()` rejects extra fields |
| `__tests__/policy-decision-service.test.ts` | PolicyDecisionService: DEFAULT_EXCLUSIONS, isGovernanceExcluded (secrets, .env, .pem, .key, .git, node_modules), evaluatePath (read/write/index/search operations), evaluateChangedPaths, picomatch glob matching, policy priority (edit_deny beats edit_allowed) |
| `__tests__/capability-schema.test.ts` | CapabilitySnapshot Zod schema validation |
| `__tests__/validation-schema.test.ts` | Validation-related schema tests |
| `__tests__/errors.test.ts` | Error codes (11 codes), retry policies per code (retryable/maxAttempts/backoffMs), createFactoryError factory function |

### packages/db (7 tests) -- Integration tests with Testcontainers PostgreSQL

| File | Tests |
|------|-------|
| `__tests__/transactional-audit.test.ts` | Transactional atomicity: state change + audit entry in single DB transaction; invalid transition leaves neither state nor audit entry; content hash verification |
| `__tests__/encryption.test.ts` | Envelope encryption round-trip, random IV verification, GCM auth tag tamper detection, serialize/deserialize payload, LocalKmsProvider wrap/unwrap DEK, full secret manager flow |
| `__tests__/webhook-dedup.test.ts` | Webhook deduplication: unique deliveryId succeeds, duplicate fails (unique constraint), isDeliveryProcessed state tracking |
| `__tests__/audit-rls.test.ts` | Audit row-level security |
| `__tests__/state-machine-trigger.test.ts` | DB-level state machine trigger enforcement |
| `__tests__/side-effect-ledger.test.ts` | Side-effect idempotency ledger |
| `__tests__/review-state-repository.test.ts` | Review state CRUD operations |

**Setup helper:** `__tests__/setup.ts` -- `setupTestDb()` creates a Testcontainers PostgreSQL 16 container, applies `scripts/init-db.sql` (roles/extensions), runs Drizzle migrations (0000 + 0001), returns `{ container, pool, db, connectionString }`. Teardown stops the container.

### packages/api (11 tests) -- Integration tests with Testcontainers PostgreSQL + Fastify inject

| File | Tests |
|------|-------|
| `__tests__/webhooks.test.ts` | Webhook endpoint: HMAC signature verification (valid -> 200, invalid -> 401), delivery persistence to DB |
| `__tests__/health.test.ts` | Health endpoints: `/health` (200 + version), `/health/live`, `/health/ready` (checks DB healthy, Redis/Temporal/MinIO unhealthy -> 503 degraded) |
| `__tests__/auth.test.ts` | Authentication middleware |
| `__tests__/role-authorization.test.ts` | Role-based authorization |
| `__tests__/api-keys.test.ts` | API key management endpoints |
| `__tests__/task-signals.test.ts` | Task signal dispatch (approve/reject/changes/kill) |
| `__tests__/webhook-dispatch.test.ts` | Webhook event routing and dispatch |
| `__tests__/metrics-endpoint.test.ts` | Prometheus metrics endpoint |
| `__tests__/events.test.ts` | SSE event stream |
| `__tests__/tasks-api.test.ts` | Task CRUD API |
| `__tests__/safety-routes.test.ts` | Safety control API routes |

**Setup helper:** `__tests__/setup.ts` -- Creates Testcontainers PostgreSQL, applies all 3 migrations (0000, 0001, 0002), creates Fastify server with `createServer()`, registers all route plugins, returns `{ container, dbConnection, app }`.

### packages/temporal-workflows (13 tests) -- Temporal TestWorkflowEnvironment with time-skipping

| File | Tests |
|------|-------|
| `__tests__/orchestrator.test.ts` | Full orchestrator workflow with mock activities, TestWorkflowEnvironment.createTimeSkipping(), signal/query verification |
| `__tests__/orchestrator-feedback-loop.test.ts` | Changes requested -> re-implement -> approve loop |
| `__tests__/signals.test.ts` | Signal/query name definitions (kill, approve, reject, changes_requested, resume, clarify_response, cost_override, pr_review, check_complete, merge_queue_update, pr_closed) |
| `__tests__/review-phase.test.ts` | Review child workflow with approval/rejection signals |
| `__tests__/clarify-phase.test.ts` | Clarification phase workflow |
| `__tests__/implement-phase.test.ts` | Implementation phase with LLM agent steps |
| `__tests__/understand-phase.test.ts` | Repo understanding phase |
| `__tests__/validate-phase.test.ts` | Validation phase (tests, lint, security scan, blast radius) |
| `__tests__/evidence-phase.test.ts` | Evidence generation phase |
| `__tests__/pr-creation-phase.test.ts` | PR creation phase |
| `__tests__/pr-tracking-phase.test.ts` | PR tracking with GitHub signals |
| `__tests__/learn-phase.test.ts` | Post-merge learning/metrics phase |
| `__tests__/merge-execution.test.ts` | Merge execution with readiness checks |
| `__tests__/m12-pipeline.test.ts` | M12 pipeline integration test |

**Pattern:** Each test creates a `TestWorkflowEnvironment.createTimeSkipping()` environment in `beforeAll`, creates a `Worker` with `workflowsPath` pointing to the source workflows and inline mock activities via the `activities` option. Tests start workflows via `client.workflow.start()`, signal them, and assert on query results and workflow completion state.

### packages/temporal-activities (47 tests) -- Mixed unit and integration tests

**GitHub activities (12 files):**
- `github/workflow-scanner.test.ts`, `github/codeowners-parser.test.ts`, `github/ruleset-analyzer.test.ts`, `github/capability-scan.test.ts`, `github/branch.test.ts`, `github/trusted-context.test.ts`, `github/pr.test.ts`, `github/auto-merge.test.ts`, `github/check-run.test.ts`, `github/review-tracker.test.ts`, `github/merge.test.ts`, `github/reconciler.test.ts`

**Indexing activities (6 files):**
- `indexing/parser.test.ts`, `indexing/governance-filter.test.ts`, `indexing/repo-map.test.ts`, `indexing/symbol-extractor.test.ts`, `indexing/import-extractor.test.ts`, `indexing/index-activities.test.ts`

**LLM activities (7 files):**
- `llm/context.test.ts`, `llm/edit-format.test.ts`, `llm/prompt-safety.test.ts`, `llm/agent.test.ts`, `llm/guardrails.test.ts`, `llm/cost-tracker.test.ts`, `llm/tools.test.ts`

**Sandbox activities (6 files):**
- `sandbox/secrets.test.ts`, `sandbox/monitor.test.ts`, `sandbox/cache.test.ts`, `sandbox/network.test.ts`, `sandbox/supervisor.test.ts` (requires Docker -- uses `describe.skipIf(!dockerAvailable)`), `sandbox/cache-integration.test.ts`

**Safety activities (7 files) -- use Redis via globalSetup:**
- `safety/kill-check.test.ts`, `safety/cost-check.test.ts`, `safety/branch-lease.test.ts`, `safety/circuit-breaker.test.ts`, `safety/budget-manager.test.ts`, `safety/kill-switch.test.ts`, `safety/with-circuit-breaker.test.ts`

**Validation activities (5 files):**
- `validation/blast-radius.test.ts`, `validation/lint-runner.test.ts`, `validation/test-runner.test.ts`, `validation/validator-boundary.test.ts`, `validation/security-scanner.test.ts`

**Evidence activities (7 files):**
- `evidence/redaction.test.ts`, `evidence/risk-summary.test.ts`, `evidence/diff-annotator.test.ts`, `evidence/locator.test.ts`, `evidence/generator.test.ts`, `evidence/artifact-store.test.ts`, `evidence/manifest.test.ts`

**Other (3 files):**
- `credential-broker.test.ts`, `rate-limiter.test.ts`, `client.test.ts`, `db/task-activities.test.ts`

**Infrastructure helpers:**
- `safety/global-setup.ts` -- starts a single Redis 7 container via `GenericContainer("redis:7-alpine")`, shares URL via vitest's `provide("redisUrl", ...)` mechanism
- `sandbox/docker-helpers.ts` -- Docker client, test image management, container cleanup, test config/contract/binding factories. Uses `describe.skipIf(!dockerAvailable)` pattern for tests requiring Docker daemon

### packages/worker (2 tests) -- Unit tests

| File | Tests |
|------|-------|
| `__tests__/metrics.test.ts` | 12 OpenTelemetry metric instruments are defined and can be incremented/recorded without error |
| `__tests__/logger.test.ts` | Pino logger with OTel trace correlation mixin |

### packages/cli (5 tests) -- CLI integration tests via execSync

| File | Tests |
|------|-------|
| `__tests__/commands.test.ts` | CLI commands via `execSync("npx tsx src/index.ts ...")`: --help, --version, config path, config show, status, evidence, approve, reject, health |
| `__tests__/evidence-display.test.ts` | Evidence bundle rendering |
| `__tests__/api-client.test.ts` | API client library |
| `__tests__/config.test.ts` | TOML config loading |
| `__tests__/safety-commands.test.ts` | Safety CLI commands (kill switch, circuit breaker) |

### apps/dashboard (4 tests) -- Unit tests with jsdom + @testing-library/svelte

| File | Tests |
|------|-------|
| `src/lib/utils/__tests__/format.test.ts` | formatCost, formatDuration, truncate utilities |
| `src/lib/utils/__tests__/colors.test.ts` | Color utility functions |
| `src/lib/api/__tests__/client.test.ts` | API client wrapper |
| `src/lib/api/__tests__/sse.test.ts` | SSE client: connection, event dispatch (task/system), malformed JSON handling, exponential backoff reconnection, disconnect cleanup |

**Setup:** `vitest-setup.ts` imports `@testing-library/svelte/vitest`. Dashboard config aliases `$lib`, `$app/environment`, `$app/navigation`, `$app/state` to mock modules in `src/__mocks__/`.

---

## 3. E2E Test Suite

**Location:** `packages/e2e/`
**Command:** `pnpm run test:e2e`
**Timeout:** 120s per test, 120s for hooks
**Execution:** Sequential (singleFork)

### E2E Infrastructure

**`src/setup/test-environment.ts`** -- Creates a complete test environment:
1. `TestWorkflowEnvironment.createTimeSkipping()` -- Temporal test server with time-skipping
2. `Worker.create()` with `workflowsPath` pointing to `packages/temporal-workflows/src/index.ts` and mock activities
3. Worker runs in background via `worker.run()` promise
4. `teardown()` shuts down worker and test environment

**`src/setup/mock-activities.ts`** -- Complete mock implementations for all ~50 activities:
- Tracks all calls in a `MockState` object (tasks created, state transitions, audit entries, branches leased, sandboxes created/destroyed, PRs created, merges executed, cost recorded, review states, metrics)
- Supports configurable behavior: globalKill, killedTaskIds, costBudgetCents, costPerStep, mergeNotReady, custom agentStepResult
- Shared fixtures: MOCK_SETUP_CONTRACT, MOCK_TRUSTED_CONTEXT, MOCK_CAPABILITY_SNAPSHOT

**`src/setup/helpers.ts`** -- Test utilities:
- `testTaskId(scenario)` -- unique task IDs for isolation
- `E2E_WORKFLOW_CONFIG` -- short timeouts for fast tests
- `makeE2EInput(taskId, overrides)` -- workflow input builder
- `signalChildWhenRunning(client, childId, signal, payload)` -- polls child workflow until RUNNING, then signals
- `waitForQuery(handle, query, predicate)` -- polls query until predicate matches

### E2E Scenarios (8 test files)

| File | Lifecycle Proven |
|------|-----------------|
| `happy-path.test.ts` | **Full lifecycle:** Submit -> all 11 phases -> merged. Verifies final state, progress query, mock state (tasks, audit, transitions, branch lease release, sandbox cleanup) |
| `kill-switch.test.ts` | Kill signal during review -> cancelled; Kill signal before review -> cancelled. Verifies cleanup |
| `rejection.test.ts` | Submit -> review -> reject -> failed. Verifies branch lease cleanup |
| `feedback-loop.test.ts` | Submit -> review -> changes_requested -> re-implement -> review -> approve -> merged. Verifies phaseIteration increments |
| `cost-budget.test.ts` | Cost accumulation tracking through workflow; workflow completion with high cost budget |
| `concurrent-tasks.test.ts` | Two tasks with unique IDs complete independently; branch leases cleaned up for both |
| `invariants.test.ts` | L1 autonomy gates (implement + review approval required); state transitions produce audit entries; valid phase ordering; rejection terminal state + cleanup; review timeout -> failed |
| `safety-controls.test.ts` | Merge readiness failure -> failed; activity-level kill switch -> workflow throws |

---

## 4. Test Infrastructure Details

### Testcontainers Usage

**PostgreSQL:** Used by `packages/db` and `packages/api`
- Image: `postgres:16-alpine`
- Setup: applies `scripts/init-db.sql` + Drizzle migrations
- Pattern: `beforeAll` creates container, `afterAll` stops it
- Timeout: 120s for beforeAll hooks (container startup)
- Library: `@testcontainers/postgresql` (PostgreSqlContainer)

**Redis:** Used by `packages/temporal-activities` safety tests
- Image: `redis:7-alpine`
- Setup: `globalSetup` starts one container, provides URL via `inject("redisUrl")`
- Each test file uses a separate Redis DB (db: 0-6) to avoid conflicts
- Library: `testcontainers` (GenericContainer)

**Docker (direct):** Used by `packages/temporal-activities` sandbox tests
- Image: `node:22-slim`
- Uses `dockerode` directly (not Testcontainers)
- `describe.skipIf(!dockerAvailable)` pattern for graceful skip when Docker unavailable
- Cleanup: removes containers by `com.factory.task-id` label; removes test images

### Temporal Testing

**TestWorkflowEnvironment.createTimeSkipping():** Used by workflow tests and E2E tests
- Creates a lightweight Temporal server in-process with time-skipping support
- Workers are created with `workflowsPath` pointing to source TS files (bundled at runtime)
- Activities are provided inline as mock objects (not the real activity implementations)
- Tests use `handle.result()` to await workflow completion, `handle.query()` to read state, `handle.signal()` to send signals

**Sequential execution required:** Workflow tests create gRPC servers that contend for resources. Both `packages/temporal-workflows` and `packages/e2e` use `pool: "forks"` + `singleFork: true`.

---

## 5. CI/CD Pipeline

**No CI/CD pipeline exists.** There is no `.github/workflows` directory in the project root. All testing is local-only at this point.

---

## 6. How to Run Tests

```bash
# All unit + integration tests (excludes E2E)
pnpm run test

# E2E tests only (requires Temporal test server, creates in-process)
pnpm run test:e2e

# Watch mode
pnpm run test:watch

# Type-checking
pnpm run typecheck

# Linting
pnpm run lint
```

### Prerequisites for Full Test Suite

1. **Docker daemon running** -- Required for Testcontainers (PostgreSQL, Redis) and sandbox tests
2. **No external services needed** -- All infrastructure is containerized or mocked
3. **Node.js 22** -- Required for temporal-activities sandbox tests (`node:22-slim` image)
4. **pnpm 10+** -- Package manager

---

## 7. Testing Patterns & Conventions

### Pattern: Co-located `__tests__/` directories
All test files live in `__tests__/` directories adjacent to the source they test, following the convention in `.claude/rules/conventions.md`.

### Pattern: Zod schema testing with `.strict()`
Every Zod object schema test includes a "rejects extra fields" test case, enforcing the `.strict()` convention. Example at `packages/core/__tests__/schemas.test.ts` line 75-78.

### Pattern: neverthrow Result assertions
DB and webhook tests assert on `Result<T, E>` values using `result.isOk()`, `result.isErr()`, `result._unsafeUnwrap()`. Example at `packages/db/__tests__/transactional-audit.test.ts` line 50.

### Pattern: Transactional atomicity testing
DB tests verify that state change + audit entry are atomic: both exist on success, neither exists on failure. Example at `packages/db/__tests__/transactional-audit.test.ts` lines 35-100.

### Pattern: Temporal mock activities
Both `packages/temporal-workflows/__tests__/orchestrator.test.ts` and `packages/e2e/src/setup/mock-activities.ts` define complete mock activity objects that mirror the real activity signatures. The E2E mocks are more sophisticated, tracking all calls in a `MockState` object for assertions.

### Pattern: Docker-conditional tests
Sandbox tests use `describe.skipIf(!dockerAvailable)` to gracefully skip when Docker is not available, with `isDockerAvailable()` checking `docker.ping()`.

### Pattern: Redis database isolation
Safety tests sharing a single Redis container use different `db` numbers (0-6) in their `new Redis(url, { db: N })` connections, allowing parallel execution without `flushdb()` interference.

### Pattern: Fastify inject for API tests
API tests use `ctx.app.inject({ method, url, headers, payload })` from `light-my-request` (built into Fastify) for in-process HTTP testing without starting a real server.

### Pattern: CLI integration via execSync
CLI tests spawn the actual CLI process via `execSync("npx tsx src/index.ts ...")` and assert on stdout, testing the full command-line experience.

### Pattern: SvelteKit module mocking
Dashboard tests alias `$app/environment`, `$app/navigation`, `$app/state` to mock modules, and use `@testing-library/svelte` for component testing with jsdom.

---

## 8. Observations & Potential Gaps

1. **No CI/CD** -- All 111 tests are local-only. No automated pipeline runs on push/PR.
2. **No replay testing** -- The conventions specify `Worker.runReplayHistory` for Temporal determinism verification, but no replay test files exist.
3. **Sandbox tests require Docker** -- They skip gracefully but are not run in any automated environment.
4. **E2E tests use mock activities** -- They exercise workflow orchestration logic with realistic mocks, but do not test real activities against real infrastructure.
5. **No load/performance tests** -- Given the concurrent-tasks E2E test, there is some concurrency testing, but no stress testing.
6. **The `packages/temporal-activities` package has the most tests (47)** -- reflecting the largest surface area of the system.
7. **Dashboard tests are minimal (4 files)** -- utilities and API client only; no component rendering tests visible.
