# Software Factory Control Plane — Implementation Plan

**Version:** 1.0
**Date:** 2026-03-18
**PRD Version:** 5.1
**Status:** Awaiting human review

---

## 1. Summary

Build a self-hosted, governance-first control plane that orchestrates AI agents and humans through a validated software delivery workflow — from GitHub issue to merged PR with a complete evidence trail. The architecture is a TypeScript monorepo (7 packages) using Temporal for durable workflow orchestration, PostgreSQL as the system of record, Docker for sandboxed code execution, and a GitHub App for repository integration.

The build is organized into **6 phases with 22 milestones**, starting with a monorepo foundation, progressing through Observer Mode (read-only repo analysis that delivers immediate value), then adding sandboxed code execution, validation + evidence + human review, PR lifecycle management, and finally hardening + dashboard. This ordering is deliberate: it **defers dangerous capabilities** (code execution, PR creation) until the safety infrastructure (audit trail, state machine, policy engine, kill switch) is proven. Each milestone is independently testable, committable, and produces a working increment. Human review gates exist between every phase.

The core architectural decision: **Postgres is the system of record; Temporal is the workflow engine, NOT the source of business truth.** Workflow executions reference versioned domain records in Postgres. This gives us queryable state, relational integrity, audit tamper-resistance, and the ability to rebuild workflow state from the database.

---

## 2. Current State

**Greenfield.** Zero lines of source code. The repository contains:

- `docs/prd.md` — 1,098-line Product Requirements Document (v5.1)
- `docs/research-infrastructure.md` — 1,719 lines of implementation research (stack, Temporal, Docker, Postgres, deployment)
- `docs/research-integrations.md` — 1,951 lines of integration research (GitHub, LLM, code indexing, CLI, dashboard)
- `docs/research-decisions.md` — 1,515 lines of strategic analysis (three-model consensus, disagreements, risks)
- `docs/decisions.md` — Empty ADR log (template only)
- `docs/SYSTEM.md` — Empty architecture document
- `.claude/rules/` — Immutable rules (3), conventions (minimal), stack (all TBD)
- `.gitignore`, `README.md`, `CLAUDE.md`

**No** `package.json`, `tsconfig.json`, `docker-compose.yml`, `Dockerfile`, or any infrastructure files exist.

**Git history:** 3 commits, all documentation. Branch: `main`.

---

## 3. Technology Decisions (Locked)

These decisions are settled based on PRD requirements and three-model research consensus. They are **NOT to be re-debated** during implementation. If a decision proves wrong in practice, escalate — don't silently deviate.

| Area | Decision | Package(s) / Version | Rationale |
|------|----------|---------------------|-----------|
| Runtime | Node.js 22 LTS | `node:22-slim` (Docker) | PRD specifies 22+; LTS stability; upgrade to 24 later if needed |
| Language | TypeScript strict | `typescript` 5.x, `@tsconfig/node22` | 3/3 consensus |
| Package Manager | pnpm 10+ | `pnpm` | Strict deps, workspace-native, fast |
| Monorepo | pnpm workspaces | `pnpm-workspace.yaml` | No Turborepo initially — 7 packages is manageable |
| HTTP Framework | Fastify | `fastify` + `@fastify/type-provider-zod` | 2/3 consensus; strong typing, low overhead |
| Orchestration | Temporal | `@temporalio/*` 1.14.x | 3/3 consensus; **ALL packages MUST share exact version** |
| Primary Database | PostgreSQL 16 | `postgres:16-alpine` | PRD specifies; pgcrypto + pgvector extensions |
| ORM / Query | Drizzle ORM | `drizzle-orm` + `drizzle-kit` + `pg` | SQL-first, TypeScript schemas, ~5KB bundle |
| Cache / PubSub | Redis 7 | `redis:7-alpine` + `ioredis` | PRD specifies; Valkey swap is trivial later |
| Object Storage | MinIO (S3-compatible) | `quay.io/minio/minio` + `@aws-sdk/client-s3` | PRD specifies; use quay.io (Docker Hub deprecated Oct 2025) |
| LLM SDK | Vercel AI SDK | `ai` + `@openrouter/ai-sdk-provider` | Unified interface, OTel built-in, prepareStep hook |
| GitHub Client | Octokit suite | `@octokit/rest` + `@octokit/auth-app` + `@octokit/webhooks` + `@octokit/graphql` | REST + GraphQL required (5 features have no REST API) |
| Docker Client | dockerode | `dockerode` ^4.0.9 + `@types/dockerode` ^4.0.0 | Promise API, stream demux, zero deps |
| Code Parser | tree-sitter (native) | `tree-sitter` + language grammars | ~100K lines/sec; WASM fallback if native fails |
| Glob Matching | picomatch | `picomatch` | ReDoS-safe, 0 deps (minimatch has CVE-2022-3517) |
| Validation | Zod | `zod` | 3/3 consensus; `safeParse` at boundaries |
| Error Handling | neverthrow | `neverthrow` | `Result<T, E>` pattern; ~2KB; monitor maintenance |
| CLI Framework | Commander.js + Ink | `commander` + `ink` + `ink-ui` | 25ms startup vs oclif 135ms; Ink for TUI evidence review |
| Testing | Vitest + Testcontainers | `vitest` + `@testcontainers/postgresql` + `@temporalio/testing` | ESM-native, time-skipping, real Postgres in tests |
| Lint / Format | Biome | `@biomejs/biome` | 10-25x faster than ESLint+Prettier; single tool |
| Build (dev) | tsx | `tsx` | esbuild-based, zero config |
| Build (prod) | tsup | `tsup` + `build-temporal-workflow` | esbuild for prod; Temporal bundler 9-11x faster than Webpack |
| Logging | Pino | `pino` | Fast structured JSON, OTel trace correlation |
| Observability | OpenTelemetry | `@opentelemetry/sdk-node` + 8 more packages | Tiered: built-in → optional export → full Grafana stack |
| Config Format | TOML | `@iarna/toml` | XDG paths, 5-tier precedence |
| Token Counting | js-tiktoken | `js-tiktoken` | Offline estimates only; trust API response for billing |

### Temporal-Specific Constraints (Critical)

- **ALL `@temporalio/*` packages MUST have the same version** — enforced by peer deps
- **Workflow code runs in a V8 isolate** — CANNOT import Node.js APIs (`fs`, `http`, `crypto`)
- **Activities accessed via `proxyActivities<T>()`** — type-only imports in workflow code
- **`verbatimModuleSyntax: true`** in tsconfig — CRITICAL for enforcing `import type`
- **`Math.random()`, `Date`, `setTimeout()`** replaced with deterministic versions in workflows
- **Effect-TS is incompatible** with Temporal's sandbox (GitHub #5986)

---

## 4. Architecture Overview

### System Components

```
┌──────────────────────────────────────────────────────────┐
│                    Control Plane Host                      │
│                                                            │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │   API   │  │  Worker   │  │   CLI    │  │Dashboard │  │
│  │(Fastify)│  │(Temporal) │  │(Cmdr+Ink)│  │(Svelte)  │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │            │              │              │         │
│  ┌────┴────────────┴──────────────┴──────────────┴────┐   │
│  │                  Shared Packages                    │   │
│  │  core │ db │ temporal-workflows │ temporal-activities│   │
│  └──────────────────────┬─────────────────────────────┘   │
│                         │                                  │
│  ┌──────────┐  ┌───────┴──┐  ┌────────┐  ┌──────────┐   │
│  │PostgreSQL│  │  Redis   │  │Temporal │  │  MinIO   │   │
│  │  (SoR)   │  │(PubSub)  │  │(Engine) │  │(Artifacts)│   │
│  └──────────┘  └──────────┘  └─────────┘  └──────────┘   │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │            Docker Sandbox Containers                │   │
│  │  (Agent execution, isolated, phase-separated)       │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### Data Flow (13-Step Workflow)

```
Issue/API → [1.Intake] → [2.RepoAnalysis] → [3.EnvSetup] → [4.Plan] →
[5.Implement] → [6.Validate] → [7.Evidence] →
  ── Internal Trust Boundary ──
[8.HumanReview] → [9.PRCreation] →
  ── External Trust Boundary ──
[10.ExternalChecks] → [11.MergeReady] → [11a.Feedback?] → [12.Merge] → [13.Learn]
```

### Package Dependency Graph

```
core                           (zero deps — pure types, Zod, neverthrow)
  ├── db                       (core)
  ├── temporal-workflows       (core — types only, NO Node.js APIs)
  ├── temporal-activities      (core, db)
  ├── api                      (core, db, temporal-activities)
  ├── worker                   (core, db, temporal-workflows, temporal-activities)
  └── cli                      (core, db)
```

---

## 5. Directory Structure

```
software-factory/
├── packages/
│   ├── core/                          # Domain types, schemas, errors, config
│   │   ├── src/
│   │   │   ├── types/                 # TaskState, EvidenceBundle, Policy, etc.
│   │   │   ├── schemas/               # Zod schemas (validation + type derivation)
│   │   │   ├── errors/                # Typed error classes (neverthrow)
│   │   │   ├── config/                # Configuration schema + loader
│   │   │   └── index.ts               # Public API
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── db/                            # Drizzle schema, repositories, migrations
│   │   ├── src/
│   │   │   ├── schema/                # Drizzle table definitions
│   │   │   ├── repositories/          # Data access layer (pure functions)
│   │   │   ├── encryption/            # Envelope encryption (AES-256-GCM)
│   │   │   └── index.ts
│   │   ├── drizzle/                   # Migration files
│   │   ├── __tests__/
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── temporal-workflows/            # Workflow definitions (V8 isolate)
│   │   ├── src/
│   │   │   ├── orchestrator.ts        # Parent workflow
│   │   │   ├── phases/                # Child phase workflows
│   │   │   │   ├── intake.ts
│   │   │   │   ├── understand.ts
│   │   │   │   ├── plan.ts
│   │   │   │   ├── setup.ts
│   │   │   │   ├── implement.ts
│   │   │   │   ├── validate.ts
│   │   │   │   ├── evidence.ts
│   │   │   │   ├── review.ts
│   │   │   │   ├── pr-creation.ts
│   │   │   │   ├── pr-tracking.ts
│   │   │   │   └── learn.ts
│   │   │   ├── signals.ts             # Signal/query definitions
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── temporal-activities/           # Activity implementations (normal Node.js)
│   │   ├── src/
│   │   │   ├── github/                # GitHub API activities
│   │   │   ├── sandbox/               # Docker sandbox activities
│   │   │   ├── llm/                   # LLM call activities
│   │   │   ├── indexing/              # Code indexing activities
│   │   │   ├── db/                    # Database activities
│   │   │   ├── validation/            # Test/lint/scan activities
│   │   │   ├── evidence/              # Evidence generation activities
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── api/                           # Fastify HTTP server
│   │   ├── src/
│   │   │   ├── server.ts              # Fastify instance
│   │   │   ├── routes/                # Route handlers
│   │   │   │   ├── webhooks.ts        # GitHub webhook receiver
│   │   │   │   ├── tasks.ts           # Task CRUD API
│   │   │   │   ├── health.ts          # Health/ready/live endpoints
│   │   │   │   └── events.ts          # SSE endpoint (Phase 2)
│   │   │   ├── middleware/            # Auth, logging, error handling
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── worker/                        # Temporal worker process
│   │   ├── src/
│   │   │   ├── worker.ts              # Worker setup + registration
│   │   │   ├── interceptors.ts        # OTel, logging interceptors
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── cli/                           # CLI interface
│       ├── src/
│       │   ├── commands/              # submit, status, evidence, approve, etc.
│       │   ├── ui/                    # Ink components for TUI
│       │   └── index.ts
│       ├── __tests__/
│       ├── package.json
│       └── tsconfig.json
├── docker-compose.yml                 # 6 infrastructure services
├── docker-compose.override.yml        # Dev overrides (exposed ports, debug)
├── .env.example                       # Template for required env vars
├── pnpm-workspace.yaml
├── package.json                       # Root package.json (scripts only)
├── tsconfig.base.json                 # Shared TypeScript config
├── biome.json                         # Linter + formatter config
├── vitest.workspace.ts                # Test workspace config
├── .factory/setup.yml                 # Dogfooding — own setup contract
├── docs/
├── .claude/
├── .gitignore
├── README.md
└── CLAUDE.md
```

---

## 6. Milestone Outline

### Phase 0: Foundation — *"Nothing works without this"*

> **Goal:** Establish monorepo, types, database, and infrastructure. Every subsequent milestone depends on this phase.
> **Human review gate:** Review directory structure, type system, and database schema before proceeding.

- [ ] **M1: Monorepo + Build System** — Initialize pnpm workspace with 7 packages, TypeScript config, Biome, and Vitest
- [ ] **M2: Core Domain Package** — Define all domain types, Zod schemas, state machine, error types, and configuration
- [ ] **M3: Docker Compose Infrastructure** — Stand up PostgreSQL, Redis, Temporal, MinIO with health checks
- [ ] **M4: Database Schema + Migrations** — Create all Drizzle schemas, triggers, RLS policies, seed data, and repository layer

### Phase 1: Observer Mode — *"Read-only value, zero risk"*

> **Goal:** Scan repositories and produce readiness reports WITHOUT executing any code or creating any PRs. This is the Observer Mode product surface that delivers value on day 1.
> **Human review gate:** Verify GitHub integration works correctly on a real test repo. Review capability scan accuracy.

- [ ] **M5: GitHub App Foundation** — App registration flow, JWT auth, installation tokens, webhook receiver with signature verification
- [ ] **M6: Repository Capability Scan** — 10-step scan producing structured report (rulesets, CODEOWNERS, merge queue, signed commits)
- [ ] **M7: Code Indexing Pipeline** — tree-sitter parsing, symbol extraction, repo map generation, governance filter
- [ ] **M8: Observer Mode CLI** — `factory repo scan` command producing readiness report with setup contract generation

### Phase 2: Guided Execution — *"The agent can now write code"*

> **Goal:** Wire up Temporal orchestration, Docker sandboxing, and LLM agent to execute the intake → plan → implement loop.
> **Human review gate:** Verify sandbox isolation is correct. Review agent tool execution for safety. Verify Temporal workflows handle failures gracefully.

- [ ] **M9: Temporal Orchestration Core** — Parent/child workflow architecture, worker setup, task queues, signals, basic lifecycle
- [ ] **M10: Docker Sandbox Supervisor** — Container lifecycle (6 phases), network isolation, secret injection, environment caching
- [ ] **M11: LLM Agent Core** — Vercel AI SDK integration, OpenRouter config, tool execution framework, edit format, context management
- [ ] **M12: Task Execution Pipeline** — Wire intake → understand → plan → implement loop through Temporal with sandbox + LLM

### Phase 3: Validation + Evidence — *"Proving the work is safe"*

> **Goal:** Validate code changes, generate evidence packets, and enable human review through the CLI.
> **Human review gate:** Review evidence packet quality. Verify approval flow works correctly. Test rejection/re-do cycle.

- [ ] **M13: Validation Pipeline** — Test execution in sandbox, lint, security scanning (Semgrep/Syft/Grype), blast radius analysis
- [ ] **M14: Evidence Generation** — Evidence packet schema, annotated diffs, risk summary, artifact storage in MinIO
- [ ] **M15: Human Review Flow** — CLI `evidence` / `approve` / `reject` / `changes` commands, review state management

### Phase 4: PR + Merge Lifecycle — *"GitHub becomes involved"*

> **Goal:** Create PRs from candidate branches, submit check runs, track external CI, handle merge queue, and execute merges.
> **Human review gate:** Verify PRs are created correctly with evidence. Verify merge safety checks. Test on repos with branch protection and merge queues.

- [ ] **M16: PR Creation + Check Runs** — Create PR from candidate branch, submit factory check run, handle check requirements
- [ ] **M17: PR Tracking + Feedback Loop** — Webhook-driven PR lifecycle, review feedback → re-implementation cycle, stale review detection
- [ ] **M18: Merge Readiness + Execution** — Merge queue enqueue, merge execution with SHA safety, post-merge learning phase

### Phase 5: Hardening — *"Production-ready safety"*

> **Goal:** Add kill switch, cost controls, reconciliation, observability, and end-to-end testing.
> **Human review gate:** Verify kill switch stops execution immediately. Review cost tracking accuracy. Validate reconciliation recovers from missed webhooks.

- [ ] **M19: Safety Controls** — Redis kill switch (global + per-task), circuit breakers, cost budgets ($10/task, $100/day), retry limits
- [ ] **M20: Reconciliation + Observability** — Periodic GitHub sync, branch lease management, OTel traces/metrics, health endpoints
- [ ] **M21: End-to-End Testing** — Full workflow tests on test repos, adversarial tests (prompt injection, token expiry, webhook loss)

### Phase 6: Dashboard — *"Visual control surface"* (Phase 2 scope)

> **Goal:** Web dashboard for repo readiness, run inspection, approval, and drift detection.
> **Human review gate:** Review UX before deployment.

- [ ] **M22: SvelteKit Dashboard** — SSE real-time updates, review inbox, run timeline, evidence viewer, repo readiness screen

---

## 7. Detailed Milestone Specifications

### M1: Monorepo + Build System

**Goal:** A clean monorepo where `pnpm install`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass with zero source code.

**Files to create:**
- `package.json` — Root with scripts: `typecheck`, `lint`, `lint:fix`, `test`, `test:watch`, `build`, `dev`, `clean`
- `pnpm-workspace.yaml` — Lists `packages/*`
- `tsconfig.base.json` — `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `verbatimModuleSyntax: true`, `composite: true`, `lib: [ES2024]`
- `biome.json` — Formatter (tabs→spaces, 2-width), linter (recommended rules), import organizing
- `vitest.workspace.ts` — Workspace config pointing at all `packages/*/vitest.config.ts`
- `.gitignore` — Update with `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo`
- `packages/{core,db,temporal-workflows,temporal-activities,worker,api,cli}/` — Each with `package.json`, `tsconfig.json`, `src/index.ts`, `vitest.config.ts`

**Key implementation details:**
- Each package's `tsconfig.json` extends `../../tsconfig.base.json`
- Each package's `package.json` uses `"type": "module"` and `"exports"` pointing at `./src/index.ts` (live types pattern — no build step needed for dev)
- `temporal-workflows/tsconfig.json` must NOT include `lib: [DOM]` or any Node.js types
- Root `package.json` uses `"private": true` and `"type": "module"`
- Use `"packageManager": "pnpm@10.x.x"` in root `package.json` for corepack

**Verification:**
- `pnpm install` completes without errors
- `pnpm typecheck` passes (each package compiles)
- `pnpm lint` passes
- `pnpm test` passes (no tests yet, but runner initializes)
- `pnpm -r exec -- node -e "console.log('ok')"` — all packages resolve

**Gotchas:**
- `verbatimModuleSyntax: true` will break any `import` that should be `import type` — this is intentional and critical for Temporal
- pnpm workspace protocol (`workspace:*`) for inter-package deps
- Must set `"node16"` in tsconfig for Octokit packages compatibility later

---

### M2: Core Domain Package

**Goal:** All domain types, Zod schemas, state machine definition, error types, and configuration schema defined and tested.

**Packages affected:** `packages/core`

**Files to create:**
- `src/types/task.ts` — `TaskState` enum (14 values), `Task` type, `TaskTransition` map (18 valid transitions)
- `src/types/evidence.ts` — `EvidenceBundle`, `AnnotatedDiff`, `RiskSummary`, `RevertabilityClass`
- `src/types/policy.ts` — `PolicyType`, `ProtectionClass`, `PolicyConfig`, `AutonomyLevel` (L0/L1/L2)
- `src/types/github.ts` — `CapabilitySnapshot`, `PRState`, `ReviewState`, `WebhookEvent`
- `src/types/sandbox.ts` — `ContainerPhase`, `EnvironmentState`, `SetupContract`
- `src/types/audit.ts` — `AuditEntry`, `AuditActionType`, `ActorType`
- `src/types/llm.ts` — `LLMCallAuditEntry`, `AgentTool`, `EditFormat`
- `src/types/repo.ts` — `Repository`, `RepoClass` (A/B/C), `IndexVersion`
- `src/schemas/` — Zod schemas matching every type (validation at boundaries)
- `src/errors/factory-error.ts` — Typed error hierarchy using neverthrow `Result<T, E>`
- `src/errors/error-codes.ts` — 10-class error taxonomy (policy_denied, github_transient, sandbox_failure, etc.)
- `src/config/schema.ts` — Zod schema for all config (API keys, DB URLs, feature flags)
- `src/config/loader.ts` — 5-tier precedence: flags > env > project > user > defaults
- `src/state-machine.ts` — Pure function: `canTransition(from, to): boolean` and `getValidTransitions(from): TaskState[]`

**Key implementation details:**
- State machine is a pure map — no classes, no side effects
- 14 states: `created`, `needs_clarification`, `assigned`, `in_progress`, `evidence_ready`, `changes_requested`, `approved`, `pr_created`, `external_checks_pending`, `addressing_review_feedback`, `external_blocked`, `merge_ready`, `merged`, `failed`
- 18 transitions defined as `ReadonlyMap<TaskState, ReadonlySet<TaskState>>`
- Terminal states (`merged`, `failed`) have zero outgoing transitions
- Zod schemas generate TypeScript types via `z.infer<>` — single source of truth
- `AutonomyLevel`: L0 (human confirms every action), L1 (human reviews evidence before PR), L2 (human reviews PR)
- Error codes with retry policies: `{ retryable: boolean, maxAttempts: number, backoffMs: number }`

**Verification:**
- Unit tests for state machine: every valid transition returns true, every invalid transition returns false, terminal states have no outgoing
- Unit tests for Zod schemas: valid data passes, invalid data fails with expected errors
- Unit tests for config loader: precedence ordering works correctly
- `pnpm typecheck` passes

**Gotchas:**
- DO NOT import Node.js APIs in this package — it must remain pure TypeScript for Temporal workflow compatibility
- `neverthrow` Result types should wrap all fallible operations — no thrown exceptions at domain boundary
- Zod `.strict()` on all object schemas to catch extra fields early

---

### M3: Docker Compose Infrastructure

**Goal:** `docker compose up -d` brings up PostgreSQL, Redis, Temporal, Temporal UI, and MinIO — all healthy and accessible.

**Files to create:**
- `docker-compose.yml` — 6 services with health checks, volumes, networking
- `docker-compose.override.yml` — Dev overrides (exposed ports for Temporal UI, MinIO console)
- `.env.example` — Template with all required variables
- `scripts/init-db.sql` — PostgreSQL init: create roles (`factory_app`, `factory_admin`), enable extensions (`pgcrypto`)
- `scripts/generate-secrets.sh` — Generate random secrets for first-run

**Service definitions (6):**

| Service | Image | Internal Port | Health Check |
|---------|-------|---------------|-------------|
| postgres | `postgres:16-alpine` | 5432 | `pg_isready -U factory -d factory` |
| redis | `redis:7-alpine` | 6379 | `redis-cli ping` |
| temporal | `temporalio/auto-setup:latest` | 7233 (gRPC) | `temporal operator cluster health` |
| temporal-ui | `temporalio/ui:latest` | 8080 | `wget --spider http://localhost:8080` |
| minio | `quay.io/minio/minio:latest` | 9000/9001 | `mc ready local` |

**Key implementation details:**
- Single internal bridge network `factory-internal`
- Named volumes: `postgres_data`, `redis_data`, `minio_data` (Temporal uses Postgres, no own volume)
- PostgreSQL: `--data-checksums` (init-time only!), `scram-sha-256` auth, tuning params (shared_buffers=256MB, effective_cache_size=768MB, work_mem=4MB, max_connections=100, log_min_duration_statement=200)
- Secrets as files: `postgres_password.txt`, `redis_password.txt`, `minio_root_password.txt`, `encryption_master_key.txt`
- `restart: unless-stopped` (NOT `always` — respects manual stop)
- JSON log driver: `max-size: 50m`, `max-file: 5`
- `depends_on` with `condition: service_healthy` for ordering
- Temporal auto-setup uses same Postgres instance with separate databases (`temporal`, `temporal_visibility`)
- Minimum system requirements: 4 CPU, 8 GB RAM

**Verification:**
- `docker compose up -d` — all services reach healthy state
- `docker compose ps` — all services show "Up (healthy)"
- `psql` can connect and run queries
- `redis-cli ping` returns PONG
- Temporal UI accessible at http://localhost:8080
- MinIO console accessible at http://localhost:9001

**Gotchas:**
- `temporalio/auto-setup` is for schema initialization, NOT production. For now it's fine; production uses `temporalio/server`
- `--data-checksums` can ONLY be set at database initialization. Cannot add later.
- `POSTGRES_PASSWORD_FILE` reads from file path, not env var content
- MinIO Docker Hub deprecated Oct 2025 — use `quay.io/minio/minio`

---

### M4: Database Schema + Migrations

**Goal:** All Postgres tables created with triggers, RLS policies, and seed data. Repository layer provides typed data access.

**Packages affected:** `packages/db`

**Dependencies:** `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`

**Files to create:**
- `src/schema/tasks.ts` — Tasks table with `taskStateEnum` (14 values)
- `src/schema/audit-entries.ts` — Partitioned audit table with RLS
- `src/schema/evidence-bundles.ts` — Hybrid relational + JSONB
- `src/schema/review-states.ts` — Dual-boundary lifecycle
- `src/schema/repos.ts` — Repository metadata
- `src/schema/policy-configs.ts` — Path/file governance rules
- `src/schema/secret-bindings.ts` — Envelope-encrypted secrets
- `src/schema/credential-leases.ts` — Short-lived token tracking
- `src/schema/code-index.ts` — 4 tables (versions, symbols, dependencies, files)
- `src/schema/cost-records.ts` — LLM cost tracking
- `src/schema/environment-states.ts` — Docker environment cache tracking
- `src/repositories/task-repository.ts` — CRUD + state transitions
- `src/repositories/audit-repository.ts` — Append-only insert + query
- `src/repositories/repo-repository.ts` — Repository CRUD
- `src/repositories/policy-repository.ts` — Policy CRUD + glob matching
- `src/encryption/envelope.ts` — AES-256-GCM encrypt/decrypt with KmsProvider interface
- `src/encryption/local-kms.ts` — V1 KmsProvider using `FACTORY_MASTER_KEY` env var
- `src/connection.ts` — `pg.Pool` setup with `max: 20`, Drizzle instance
- `drizzle.config.ts` — Migration config
- Custom SQL migrations for: state transition trigger, RLS policies, partition creation, seed data

**Key schema details (critical for implementer):**

Tasks table — 14-state enum, trigger-validated transitions:
- `id: uuid PK`, `state: task_state enum`, `objective: text NOT NULL`, `scope: jsonb`, `constraints: jsonb`, `budgetCents: numeric(10,0)`, `repoId: uuid FK`, `createdBy: text NOT NULL`, `createdAt/updatedAt: timestamptz`
- Trigger `validate_task_transition` fires `WHEN (OLD.state IS DISTINCT FROM NEW.state)`, queries `task_valid_transitions(from_state, to_state)` composite PK table with 18 seeded rows

Audit entries — Append-only, partitioned, tamper-resistant:
- Monthly RANGE partitions on `timestamp`
- RLS: RESTRICTIVE UPDATE/DELETE (using false), allow INSERT/SELECT
- `FORCE ROW LEVEL SECURITY` on table
- `content_hash: text NOT NULL` — SHA-256 of deterministically serialized JSON (keys sorted)
- `factory_app` role MUST NOT be superuser or BYPASSRLS

Envelope encryption:
- `encryptWithDek(plaintext, dek)` → AES-256-GCM, 96-bit IV
- `KmsProvider` interface: `wrapDek(plaintextDek, kekId)`, `unwrapDek(wrappedDek, kekId)`
- V1: `LocalKmsProvider` using env var as KEK
- Store: `iv + authTag + ciphertext` concatenated in bytea column

**Verification:**
- `drizzle-kit generate` produces migration SQL
- `drizzle-kit migrate` applies without errors
- Integration test: insert task, transition state (valid → succeeds, invalid → trigger rejects)
- Integration test: insert audit entry, attempt UPDATE (→ blocked by RLS)
- Integration test: encrypt secret, decrypt secret, verify round-trip
- Unit test: content hash computation is deterministic

**Gotchas:**
- Drizzle Kit cannot generate triggers, RLS, or partitions — custom SQL migrations required
- `$type<T>()` annotations provide compile-time safety ONLY — runtime validation via Zod in repository layer
- Partitions must be created AHEAD of time (3 months ahead) to prevent INSERT failures
- `factory_app` role for app, `factory_admin` for migrations + GDPR purge
- Source code has a known bug: `decryptWithDek` references `payload.dek` instead of `dek` parameter — fix this

---

### M5: GitHub App Foundation

**Goal:** Register a GitHub App (manifest flow), authenticate via JWT, mint installation tokens, receive and verify webhooks.

**Packages affected:** `packages/api`, `packages/temporal-activities`

**Dependencies:** `@octokit/rest`, `@octokit/auth-app`, `@octokit/webhooks`, `@octokit/graphql`, `fastify`, `@fastify/type-provider-zod`

**Files to create:**
- `packages/api/src/server.ts` — Fastify instance with Zod type provider
- `packages/api/src/routes/webhooks.ts` — GitHub webhook receiver
- `packages/api/src/routes/health.ts` — `/health`, `/health/ready`, `/health/live`
- `packages/api/src/routes/setup.ts` — GitHub App manifest flow endpoint
- `packages/temporal-activities/src/github/auth.ts` — JWT generation, installation token minting
- `packages/temporal-activities/src/github/credential-broker.ts` — Token caching with 50-min rotation
- `packages/temporal-activities/src/github/client.ts` — Configured Octokit instances (REST + GraphQL)

**Key implementation details:**
- JWT: RS256, `iss` = client ID, `iat` = 60 seconds in the past (clock drift), `exp` = max 10 min
- Installation tokens: 1-hour expiry (NOT configurable), rotate at ~50 min
- `@octokit/auth-app` handles token caching internally (toad-cache, 15K entries)
- Webhook verification: `@octokit/webhooks` with `X-Hub-Signature-256` (HMAC-SHA256), timing-safe comparison
- Idempotency: `X-GitHub-Delivery` header stored per webhook for dedup
- Webhook handler: verify → persist → acknowledge → return (NO business logic in handler)
- API version: `2026-03-10`

**Required GitHub App permissions:**
- Repository: `contents:write`, `pull_requests:write`, `checks:write`, `statuses:write`, `issues:read`, `administration:read`, `merge_queues:read`
- Organization: `administration:read`, `members:read`

**Webhook subscriptions:** `pull_request`, `pull_request_review`, `check_suite`, `check_run`, `merge_group` (app-webhook-only), `push`, `installation`

**Verification:**
- Unit test: JWT generation produces valid token structure
- Unit test: webhook signature verification (valid → passes, tampered → rejects)
- Integration test: Fastify server starts, health endpoint returns 200
- Manual test: Register GitHub App on a test org, receive installation webhook

**Gotchas:**
- `merge_group` events are ONLY delivered via app-level webhooks (not repository webhooks)
- Installation token scope cannot be narrowed at creation time — scope enforcement is at the activity level
- Must respond to webhooks within 10 seconds — async processing required
- GitHub does NOT auto-redeliver failed webhooks — reconciliation is required (M20)

---

### M6: Repository Capability Scan

**Goal:** Scan a GitHub repository and produce a structured capability report covering rulesets, branch protection, CODEOWNERS, merge queue, required checks, and signed commits.

**Packages affected:** `packages/temporal-activities`

**Files to create:**
- `packages/temporal-activities/src/github/capability-scan.ts` — 10-step scan implementation
- `packages/temporal-activities/src/github/codeowners-parser.ts` — CODEOWNERS file parser (gitignore-style matching)
- `packages/temporal-activities/src/github/ruleset-analyzer.ts` — Ruleset analysis (18 rule types, bypass actors)
- `packages/core/src/types/capability.ts` — `CapabilitySnapshot` type with all scan fields

**10-step scan sequence:**
1. Authenticate (installation token)
2. Fetch repo metadata (default branch, visibility, features)
3. Fetch rulesets (with `includes_parents` for inherited)
4. Fetch branch rules (legacy branch protection API)
5. Fetch branch protection settings
6. Fetch CODEOWNERS (3 locations: root, `.github/`, `docs/`)
7. Fetch environments
8. Parse all rules into normalized structure (18 rule types)
9. Determine repo class (A/B/C)
10. Generate report

**Key implementation details:**
- 18 ruleset rule types to parse (creation, update, deletion, required_linear_history, merge_queue, required_deployments, required_signatures, pull_request, required_status_checks, non_fast_forward, commit_message_pattern, commit_author_email_pattern, committer_email_pattern, branch_name_pattern, tag_name_pattern, file_path_restriction, max_file_path_length, file_extension_restriction)
- CODEOWNERS parsing: last match wins, case-sensitive, gitignore-style (with specific exceptions), 3 MB limit
- Merge queue detection: check for `merge_queue` rule in rulesets
- Status check bootstrap: must submit check once before it can be required
- Signed commit handling: auto-signed by GitHub when using Git Database API
- `pull_request_target` detection: scan workflow files for this trigger (HIGH RISK flag)

**Verification:**
- Unit test: CODEOWNERS parser handles all patterns correctly
- Unit test: ruleset analyzer normalizes all 18 rule types
- Integration test: scan a real repo with branch protection, produce correct report
- Test: scan a repo with rulesets + inherited rulesets
- Test: scan a repo with merge queue enabled

**Gotchas:**
- `includes_parents` parameter is critical — without it, inherited org rulesets are invisible
- Legacy branch protection API vs modern rulesets — need to check both
- Required-workflow rulesets can IGNORE `branches`, `paths`, and `types` filters — this is not an edge case
- Rate limits: 5,000/hr base, use ETags for 304 responses (free quota)
- CODEOWNERS can be in 3 locations — check all three

---

### M7: Code Indexing Pipeline

**Goal:** Parse a repository with tree-sitter, extract symbols, build a repo map using PageRank, and enforce governance filters.

**Packages affected:** `packages/temporal-activities`, `packages/db`

**Dependencies:** `tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `picomatch`

**Files to create:**
- `packages/temporal-activities/src/indexing/indexer.ts` — Main indexing pipeline (10 steps)
- `packages/temporal-activities/src/indexing/parser.ts` — tree-sitter setup + parsing
- `packages/temporal-activities/src/indexing/symbol-extractor.ts` — .scm query-based symbol extraction
- `packages/temporal-activities/src/indexing/repo-map.ts` — Aider-style PageRank repo map
- `packages/temporal-activities/src/indexing/governance-filter.ts` — picomatch-based security filter
- `packages/temporal-activities/src/indexing/import-extractor.ts` — Import/dependency extraction
- `packages/db/src/repositories/index-repository.ts` — CRUD for code index tables

**10-step pipeline:**
1. `git ls-files` — enumerate files at pinned commit SHA
2. Governance filter (picomatch) — FIRST stage, security boundary
3. Language detection (by extension)
4. Parse with tree-sitter (~100K lines/sec)
5. Extract symbols via `.scm` queries (`@definition.function`, `@definition.class`, `@reference.call`)
6. Extract imports
7. Store in Postgres (code_index_versions, indexed_files, symbols, imports, file_dependencies)
8. Build dependency graph
9. Detect structure (entry points, module groups)
10. Mark index version as ready

**Repo map (Aider-style):**
- Graph: nodes = files, edges = symbol references
- PageRank with personalization vector
- Edge weights: active file ref (x50), chat mention (x10), long identifier (x10), private (x0.1), ubiquitous (x0.1)
- Output: ranked file list with key symbols, ~1000 token budget

**Governance filter defaults:**
- `secrets/**`, `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `.git/**`, `node_modules/**`
- Applied at index time, update time, AND query time
- Resolve symlinks before filtering (prevent symlink escape)

**Verification:**
- Unit test: governance filter blocks excluded paths, allows included paths
- Unit test: symbol extractor finds functions, classes, exports in TypeScript/Python/Go
- Integration test: index a real repo, query symbols via tsvector, verify results
- Performance test: index 1K-file repo in <10 seconds
- Unit test: repo map produces ranked file list within token budget

**Gotchas:**
- tree-sitter native bindings may fail to compile on some systems — WASM fallback via `web-tree-sitter`
- Governance filter must be FIRST in pipeline — never process excluded files
- `'simple'` tsvector config (not 'english') — prevents stemming of code symbols
- Incremental indexing via git diff (1-2ms) to avoid full re-index on every task
- Phase 1 grammars: TypeScript, JavaScript, Python, Go, Rust, Java

---

### M8: Observer Mode CLI

**Goal:** `factory repo scan <owner/repo>` produces a human-readable readiness report and suggests a setup contract.

**Packages affected:** `packages/cli`

**Dependencies:** `commander`, `ink`, `ink-ui`, `chalk`, `@inquirer/prompts`

**Files to create:**
- `packages/cli/src/index.ts` — CLI entry point with Commander.js
- `packages/cli/src/commands/repo.ts` — `repo scan`, `repo list`, `repo status`
- `packages/cli/src/commands/config.ts` — `config set`, `config get`, `config init`
- `packages/cli/src/ui/readiness-report.tsx` — Ink component for readiness display
- `packages/cli/src/config.ts` — TOML config loader (XDG paths)

**Key implementation details:**
- Readiness report shows: repo class, language class, rulesets (inherited + own), branch protection, CODEOWNERS status, merge queue, required checks, signed commit requirements, setup quality score, recommended autonomy level, warnings
- Setup contract generation: suggest `.factory/setup.yml` based on detected languages, package managers, test runners
- Config: `~/.config/software-factory/config.toml` (user), `.factory/config.toml` (project)
- Precedence: CLI flags > env vars > project config > user config > defaults
- `--json` flag for structured output
- `--dry-run` flag where applicable

**Verification:**
- `factory repo scan <real-repo>` produces correct readiness report
- `factory config init` creates config file at correct XDG path
- `factory repo scan --json <repo>` produces valid JSON
- Report correctly identifies repos with merge queue, rulesets, CODEOWNERS

**Gotchas:**
- `chalk` respects `NO_COLOR` environment variable — good for CI
- Commander.js has 25ms startup — keep it fast
- Setup contract suggestion is a BEST EFFORT — user must review and customize
- Config TOML parsing must handle missing files gracefully

---

### M9: Temporal Orchestration Core

**Goal:** Parent workflow spawns child phase workflows, signals work, task queues are configured, and basic lifecycle (start, pause, resume, cancel) functions.

**Packages affected:** `packages/temporal-workflows`, `packages/temporal-activities`, `packages/worker`

**Files to create:**
- `packages/temporal-workflows/src/orchestrator.ts` — Parent workflow: spawns children, accumulates results
- `packages/temporal-workflows/src/phases/intake.ts` — First phase: validate task, persist
- `packages/temporal-workflows/src/signals.ts` — Signal definitions (kill, approve, changes_requested, resume)
- `packages/temporal-workflows/src/queries.ts` — Query definitions (getState, getProgress)
- `packages/temporal-activities/src/db/task-activities.ts` — DB read/write activities for tasks
- `packages/temporal-activities/src/db/audit-activities.ts` — Audit entry creation activities
- `packages/worker/src/worker.ts` — Worker process with 5 task queues
- `packages/worker/src/interceptors.ts` — Logging interceptor (OTel deferred to M20)

**Workflow architecture:**
- Parent workflow ID: `task-{taskId}`
- Child workflow IDs: `task-{taskId}-{phaseName}`
- Parent spawns children sequentially (some phases may retry independently)
- Each child handles its own Continue-As-New if needed
- ~104 parent events total (13 phases x 8 events) — well within 51,200 limit

**5 Task Queues:**

| Queue | Concurrency | Rate Limit | Grace Period |
|-------|------------|------------|-------------|
| `sf-orchestration` | 100 | none | 5s |
| `sf-llm` | 20 | 10/sec | 30s |
| `sf-docker` | 5 | none | 10s |
| `sf-github` | 50 | none | 5s |
| `sf-db` | 100 | none | 5s |

**Activity timeout profiles:**

| Type | startToClose | heartbeat | maxAttempts | Backoff |
|------|-------------|-----------|------------|---------|
| DB | 30s | — | 5 | 1x |
| GitHub | 2m | — | 10 | 2x |
| LLM | 5m | — | 8 | 2x |
| Docker | 15m | 30s | 3 | 1x |

**Key patterns:**
- Kill switch: Signal → set flag → check before every activity → `CancellationScope.nonCancellable` for cleanup
- Human approval: Signal + `wf.condition(allHandlersFinished)` + 7-day timeout
- Idempotent writes: `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`
- Continue-As-New: trigger at `continueAsNewSuggested` OR `historyLength > 10_000`
- Patching: `patched('name')` / `deprecatePatch('name')` for safe code changes from day 1

**Verification:**
- Test: Start parent workflow, verify child phase spawns
- Test: Send kill signal, verify workflow cancels within 5 seconds
- Test: Time-skipping test for 7-day human approval timeout
- Test: `Worker.runReplayHistory` — determinism verification
- Test: Worker starts, connects to Temporal, registers all task queues

**Gotchas:**
- `temporal-workflows` package CANNOT import `temporal-activities` — use `proxyActivities<T>()` with type-only import
- `allHandlersFinished` must be drained before Continue-As-New
- Never call Continue-As-New from inside a signal handler
- 2 MB argument limit — large data goes to Postgres with references
- `async-mutex` is safe in the workflow sandbox (for concurrent signal handlers)

---

### M10: Docker Sandbox Supervisor

**Goal:** Create, configure, run commands in, and tear down Docker containers with phase-separated networking and secret injection.

**Packages affected:** `packages/temporal-activities`

**Files to create:**
- `packages/temporal-activities/src/sandbox/supervisor.ts` — Container lifecycle manager (6 phases)
- `packages/temporal-activities/src/sandbox/network.ts` — Network swap (bridge → disconnect)
- `packages/temporal-activities/src/sandbox/secrets.ts` — Exec-based secret injection
- `packages/temporal-activities/src/sandbox/cache.ts` — Docker commit-based environment caching
- `packages/temporal-activities/src/sandbox/monitor.ts` — Health check, stuck detection, OOM detection
- `packages/temporal-activities/src/sandbox/cleanup.ts` — Container + network cleanup, crash recovery sweep

**6-phase container lifecycle:**
1. RESOLVE — Parse `.factory/setup.yml`, compute cache key, check cache
2. CREATE — `docker.createContainer()` from cached or base image
3. SETUP — Bridge network, `exec -e` setup secrets, run setup commands, health check, `docker commit` → cache
4. MAINTENANCE — If cached: bridge network, run maintenance, health check, disconnect
5. EXECUTION — `none` network, `exec -e` runtime secrets, run agent, monitor
6. CLEANUP — Stop (10s grace), remove container + volumes, clean networks

**Security hardening HostConfig:**
```typescript
{
  CapDrop: ['ALL'],
  SecurityOpt: ['no-new-privileges:true'],
  ReadonlyRootfs: true,
  Tmpfs: {
    '/tmp': 'rw,noexec,nosuid,size=512m',
    '/run': 'rw,noexec,nosuid,size=64m',
    '/home/agent/.cache': 'rw,noexec,nosuid,size=1g',
  },
  Memory: 4 * 1024 * 1024 * 1024,  // 4 GB
  NanoCpus: 2 * 1e9,                // 2 CPUs
  PidsLimit: 256,
  NetworkMode: 'none',              // execution phase
  User: '1000:1000',
}
```

**Secret injection:** `container.exec({ Env: ['KEY=value'] })` — per-exec, per-tool, not visible in `docker inspect`, not captured by `docker commit`.

**Cache key:** `sha256(image + setup + maintenance + secretNames.sort() + controlFileHashes)`

**Verification:**
- Test: Create container, run command, collect stdout/stderr
- Test: Verify network isolation (exec `curl` during execution phase → fails)
- Test: Verify secrets NOT visible via `docker inspect`
- Test: Commit container, create new container from cache, verify state preserved
- Test: OOM detection (run memory-hungry process, verify `State.OOMKilled`)
- Test: Cleanup sweep removes orphaned containers with factory labels

**Gotchas:**
- Docker socket access: the Temporal worker needs Docker socket. Run worker on host, NOT in container.
- `ReadonlyRootfs` requires explicit tmpfs mounts for writable areas
- `docker commit` captures filesystem but NOT volumes, processes, network, or exec-injected secrets
- macOS bind mount performance is slower than Linux — known limitation
- Container labels (`com.factory.task-id`, `com.factory.phase`, `com.factory.repo`) for discovery/cleanup
- Disk quotas require XFS — V1 uses monitoring instead of hard quotas

---

### M11: LLM Agent Core

**Goal:** Send prompts to LLM via OpenRouter, execute tool calls, apply code edits, and manage context within budget constraints.

**Packages affected:** `packages/temporal-activities`

**Dependencies:** `ai`, `@openrouter/ai-sdk-provider`, `js-tiktoken`

**Files to create:**
- `packages/temporal-activities/src/llm/agent.ts` — Main agent loop (ReAct pattern with maxSteps)
- `packages/temporal-activities/src/llm/provider.ts` — OpenRouter provider config
- `packages/temporal-activities/src/llm/tools.ts` — 7 agent tools (file_read, file_write, file_edit, search_codebase, run_command, list_files, search_text)
- `packages/temporal-activities/src/llm/context.ts` — Context assembly with repo map + ordering
- `packages/temporal-activities/src/llm/edit-format.ts` — Search/replace with progressive matching
- `packages/temporal-activities/src/llm/cost-tracker.ts` — Per-task and global cost budgets via Redis
- `packages/temporal-activities/src/llm/guardrails.ts` — 5 self-healing mechanisms

**Agent architecture:** Hybrid plan-and-execute (outer Temporal loop) + ReAct (inner Vercel AI SDK `generateText` with `maxSteps`).

**5-phase agent structure:**
1. UNDERSTAND — Analyze codebase with repo map
2. PLAN — Generate implementation plan
3. IMPLEMENT — Execute plan using tools
4. VALIDATE — Run tests/lint in sandbox
5. EVIDENCE — Generate evidence packet

**OpenRouter config:**
```typescript
{
  allow_fallbacks: false,      // No silent model substitution
  data_collection: 'deny',     // R-017 compliance
  require_parameters: true,    // Fail if model doesn't support params
}
```

**7 agent tools:**

| Tool | Purpose | Security Constraint |
|------|---------|-------------------|
| file_read | Read file content | Governance filter applied |
| file_write | Write entire file | Protected path check |
| file_edit | Search/replace edit | Protected path check, fuzzy match |
| search_codebase | Regex search | Governance filter on results |
| run_command | Execute shell command | Allowlisted commands only |
| list_files | List directory | Governance filter applied |
| search_text | Text search (ripgrep) | Governance filter on results |

**5 self-healing guardrails:**
1. Iteration count: max 10 steps (configurable)
2. No-progress fingerprint: 3 identical state hashes → pause
3. Loop-of-doom: 4 identical failing tool calls → stop
4. Wall-clock timer: 30 minutes max
5. Cost budget: $10/task, $100/day (Redis INCR)

**Edit format:** Search/replace blocks with progressive matching:
1. Exact match
2. Whitespace-tolerant
3. Fuzzy match (>90% similarity)
Whole-file write for files under 400 lines or completely new files.

**Context ordering** (exploiting "lost-in-the-middle" effect):
System prompt (top) → Repo map → Task objective → Plan → Files → Tool history → Previous results (bottom)

**Verification:**
- Unit test: edit format applies search/replace correctly (exact, whitespace-tolerant, fuzzy)
- Unit test: cost tracker enforces budgets
- Unit test: context assembly respects token budget and ordering
- Integration test: agent receives task, calls tools, produces code changes
- Test: guardrail triggers on infinite loop scenario

**Gotchas:**
- OpenRouter `GET /api/v1/generation?id=` for actual cost data (not just token estimates)
- `js-tiktoken` for pre-flight estimates ONLY — always use API response for billing
- `prepareStep` callback in Vercel AI SDK for dynamic context trimming per step
- Model may change behavior between versions — log model ID + version in audit
- Never trust LLM output for security decisions (path validation, secret handling)

---

### M12: Task Execution Pipeline

**Goal:** Submit a task and watch it execute through intake → understand → plan → implement, producing code changes in a candidate branch.

**Packages affected:** `packages/temporal-workflows`, `packages/temporal-activities`, `packages/api`

**Files to create:**
- `packages/temporal-workflows/src/phases/understand.ts` — Code analysis phase
- `packages/temporal-workflows/src/phases/plan.ts` — Planning phase
- `packages/temporal-workflows/src/phases/setup.ts` — Environment setup phase
- `packages/temporal-workflows/src/phases/implement.ts` — Implementation phase (may CAN internally)
- `packages/api/src/routes/tasks.ts` — Task submission API endpoint
- `packages/temporal-activities/src/github/branch.ts` — Candidate branch creation (`factory/{task-id}`)

**Key implementation details:**
- Task submission → Temporal workflow start → intake phase → persist task
- Understand phase: run code indexing (M7), produce repo map, identify relevant files
- Plan phase: LLM generates implementation plan based on objective + code understanding
- Setup phase: Docker sandbox creation (M10) with setup contract
- Implement phase: LLM agent (M11) executes plan in sandbox, produces code changes
- Candidate branch: `factory/{task-id}` created via Git Database API (auto-signed commits)
- Branch lease: Redis `SET NX EX` to prevent concurrent writes to same branch target

**Verification:**
- End-to-end test: submit task → workflow starts → phases execute → code changes appear on candidate branch
- Test: task state transitions correctly through `created → assigned → in_progress`
- Test: branch lease prevents two tasks from writing to same branch
- Test: setup contract is respected (correct Docker image, setup commands)

**Gotchas:**
- Candidate branch must be created BEFORE any code changes (Git Database API 6-step sequence)
- Branch naming: `factory/{task-id}` (not `factory/task-{id}`)
- Branch lease with Lua script for atomic check-and-modify (M19 will add full implementation)
- Implementation phase may need Continue-As-New for long tasks (>10K events)

---

### M13: Validation Pipeline

**Goal:** Run tests, linting, and security scans inside the sandbox and produce structured validation results.

**Packages affected:** `packages/temporal-activities`, `packages/temporal-workflows`

**Files to create:**
- `packages/temporal-workflows/src/phases/validate.ts` — Validation phase workflow
- `packages/temporal-activities/src/validation/test-runner.ts` — Execute tests in sandbox
- `packages/temporal-activities/src/validation/lint-runner.ts` — Execute linter in sandbox
- `packages/temporal-activities/src/validation/security-scanner.ts` — Semgrep + Syft + Grype
- `packages/temporal-activities/src/validation/blast-radius.ts` — Analyze change impact
- `packages/core/src/types/validation.ts` — `ValidationResult`, `TestResult`, `ScanResult`, `BlastRadius`

**Validation steps:**
1. Run project test suite in sandbox → capture results
2. Run linter → capture results
3. Run Semgrep CE (SAST) → SARIF output
4. Run Syft (SBOM) → SPDX output
5. Run Grype (vulnerability scan) → structured results
6. Compute blast radius (files changed, packages affected, protected surface edits)

**Blast radius analysis:**
- Count files changed
- Count packages affected (via dependency graph from M7)
- Check for protected surface edits (per policy config)
- Check for migration impact (schema changes)
- Classify revertability: `clean_revert` | `revert_with_migration` | `non_revertable`

**Verification:**
- Test: run validation on repo with passing tests → all green
- Test: run validation on repo with failing tests → captures failures
- Test: Semgrep detects a known vulnerability pattern
- Test: blast radius correctly identifies protected file edits
- Test: revertability classification is correct

**Gotchas:**
- Test execution happens in the sandbox (M10) — same container, execution phase
- Security scanners need to be installed in the container image (or exec'd separately)
- SARIF 2.1.0 format for GitHub code scanning compatibility
- Validation must run on the candidate branch diff, not the whole repo

---

### M14: Evidence Generation

**Goal:** Generate a versioned evidence packet with annotated diffs, risk summary, validation results, and store artifacts in MinIO.

**Packages affected:** `packages/temporal-activities`, `packages/temporal-workflows`

**Dependencies:** `@aws-sdk/client-s3`

**Files to create:**
- `packages/temporal-workflows/src/phases/evidence.ts` — Evidence generation phase workflow
- `packages/temporal-activities/src/evidence/generator.ts` — Evidence packet assembly
- `packages/temporal-activities/src/evidence/diff-annotator.ts` — Annotated diff generation
- `packages/temporal-activities/src/evidence/risk-summary.ts` — Risk assessment
- `packages/temporal-activities/src/evidence/artifact-store.ts` — MinIO upload/download
- `packages/core/src/schemas/evidence.ts` — Evidence packet Zod schema (versioned)

**Evidence packet contents (10 sections per Codex 5.4):**
1. Objective
2. Authority scope used
3. Files touched
4. Files intentionally excluded
5. Validation steps run
6. Test outcomes
7. Risk summary
8. Known uncertainties
9. Why the system believes the change is safe enough
10. Raw artifacts and reproducibility links

**Artifacts stored in MinIO:**
- `evidence.json` — Main evidence packet
- `manifest.json` — SHA-256 digests of all artifacts
- `diff.patch` — Raw diff
- Scanner results (SARIF, SPDX)
- Test output logs

**Key implementation details:**
- Schema version from day 1 (evidence packet is a versioned product API)
- Hash tree for tamper evidence
- Evidence freshness: stale after rebase or base branch move
- Base SHA, head SHA, merge base SHA, attempt number all recorded
- Distinction categories: Hard blocker / Soft concern / Human judgment required / Informational only

**Verification:**
- Test: generate evidence for a simple change → all 10 sections present
- Test: artifact storage in MinIO → retrieve and verify SHA-256 integrity
- Test: evidence schema validates against Zod schema
- Test: manifest hash tree is consistent

**Gotchas:**
- Evidence packet schema must be VERSIONED — include `schemaVersion` field
- S3 eventual consistency during evidence publish — verify after upload
- No secrets in evidence payloads — mandatory redaction before persistence
- `@aws-sdk/client-s3` works with MinIO (S3-compatible)

---

### M15: Human Review Flow

**Goal:** CLI commands for reviewing evidence, approving tasks, requesting changes, and rejecting tasks.

**Packages affected:** `packages/cli`, `packages/temporal-workflows`, `packages/api`

**Files to create:**
- `packages/cli/src/commands/evidence.ts` — `factory evidence <task-id>` — display evidence packet
- `packages/cli/src/commands/approve.ts` — `factory approve <task-id>`
- `packages/cli/src/commands/reject.ts` — `factory reject <task-id>`
- `packages/cli/src/commands/changes.ts` — `factory changes <task-id> --message "..."`
- `packages/cli/src/commands/review.ts` — `factory review <task-id>` — interactive review
- `packages/cli/src/ui/evidence-viewer.tsx` — Ink component for evidence display
- `packages/cli/src/ui/diff-viewer.tsx` — Annotated diff display
- `packages/temporal-workflows/src/phases/review.ts` — Review phase (waits for signal, 7-day timeout)

**Review flow:**
1. Task reaches `evidence_ready` state
2. Human runs `factory evidence T-001` → sees evidence packet in terminal
3. Human runs `factory review T-001` → interactive menu (approve, request changes, reject, view diff, view tests)
4. On approve: signal sent to workflow → state transitions to `approved`
5. On changes_requested: signal → `changes_requested` → re-implementation → new evidence
6. On reject: signal → `failed` (terminal)

**Evidence display (terminal):**
- Annotated diff (ANSI colored)
- Test results table
- Blast radius summary
- Security scan results (severity-colored)
- Protected files with justification
- Actionable commands at bottom

**Verification:**
- Test: `factory evidence <task>` displays all 10 evidence sections
- Test: `factory approve <task>` sends signal, state transitions to `approved`
- Test: `factory changes <task>` sends signal, state transitions to `changes_requested`
- Test: review phase times out after 7 days (time-skipping test)
- Test: rejected task transitions to `failed` (terminal)

**Gotchas:**
- Review signal must include operator ID (for audit: task submitter ≠ sole approver)
- 7-day timeout on review — escalate or fail
- `@inquirer/prompts` for interactive menu, `--non-interactive` flag for CI
- Evidence may be stale if base branch moves — check freshness before approval

---

### M16: PR Creation + Check Runs

**Goal:** Create a PR from the candidate branch and submit factory check runs.

**Packages affected:** `packages/temporal-workflows`, `packages/temporal-activities`

**Files to create:**
- `packages/temporal-workflows/src/phases/pr-creation.ts` — PR creation phase
- `packages/temporal-activities/src/github/pr.ts` — PR creation, check run submission
- `packages/temporal-activities/src/github/check-run.ts` — Factory check run management

**Key implementation details:**
- PR created from `factory/{task-id}` → default branch
- PR body includes evidence summary + link to full evidence
- Check run created with conclusion based on validation results (50 annotation limit, 1000 per-suite)
- Check runs are GitHub-App-only feature
- Merge endpoint requires SHA safety check (prevent merging stale PR)

**PR creation (idempotent):**
- Idempotency key: `hash(task_id + 'create_pr' + candidate_branch + base_sha)`
- If PR already exists (conflict), update instead of create

**Verification:**
- Test: PR created on test repo with correct title, body, base/head branches
- Test: Check run created with correct status and conclusion
- Test: Idempotent: creating PR twice produces same result
- Test: Evidence link in PR body resolves correctly

**Gotchas:**
- Must submit check run once before it can be made a required check
- 1-second serialization between GitHub mutation API calls
- GraphQL required for `enablePullRequestAutoMerge` if merge queue is configured
- Check run annotations limited to 50 per call, 1000 per suite

---

### M17: PR Tracking + Feedback Loop

**Goal:** Track PR state via webhooks, handle review feedback, and cycle back to re-implementation when changes are requested.

**Packages affected:** `packages/temporal-workflows`, `packages/temporal-activities`, `packages/api`

**Files to create:**
- `packages/temporal-workflows/src/phases/pr-tracking.ts` — PR tracking phase (waits for GitHub events)
- `packages/temporal-activities/src/github/review-tracker.ts` — Stale review detection, thread tracking
- `packages/api/src/routes/webhooks.ts` — (update) Dispatch PR events to workflow signals

**16 webhook-to-state transitions:**
- `pull_request.opened` → `pr_created`
- `pull_request.closed` (merged) → `merged`
- `pull_request.closed` (not merged) → `failed`
- `pull_request_review.submitted` (approved) → update review state
- `pull_request_review.submitted` (changes_requested) → `addressing_review_feedback`
- `check_suite.completed` → update check status
- `merge_group.checks_requested` → monitor merge queue
- etc.

**Stale review detection:** Hybrid webhook + GraphQL (`reviewDecision`) + periodic reconciliation.
**Review thread tracking:** GraphQL query for `isResolved`, `isOutdated`.

**Feedback loop:**
1. External reviewer requests changes on PR
2. Webhook → signal → state: `addressing_review_feedback`
3. Re-implementation: agent addresses feedback in sandbox
4. New evidence generated
5. PR updated with new commits
6. State: `external_checks_pending`

**Verification:**
- Test: webhook for PR review → state transitions correctly
- Test: feedback loop: changes_requested → re-implement → update PR → new checks
- Test: stale review detection identifies reviews invalidated by new commits
- Test: merge queue events are processed correctly

**Gotchas:**
- GitHub does NOT auto-redeliver failed webhooks — reconciliation covers gaps (M20)
- `merge_group` events are app-webhook-only
- Stale review dismissal behavior varies by repo configuration
- Last-pusher cannot approve their own PR (GitHub restriction)

---

### M18: Merge Readiness + Execution

**Goal:** Detect merge readiness, enqueue to merge queue if applicable, execute merge, and run post-merge learning.

**Packages affected:** `packages/temporal-workflows`, `packages/temporal-activities`

**Files to create:**
- `packages/temporal-workflows/src/phases/learn.ts` — Post-merge learning phase
- `packages/temporal-activities/src/github/merge.ts` — Merge execution (REST + GraphQL)

**Merge execution:**
- Check all required checks are passing
- Check all required reviews are approved (not stale)
- Check no unresolved review threads
- Check CODEOWNERS approval
- If merge queue: `enqueuePullRequest` GraphQL mutation
- If no merge queue: `PUT /repos/{owner}/{repo}/pulls/{number}/merge` with SHA safety check
- Post-merge: cleanup candidate branch, release branch lease, trigger learn phase

**Learn phase:**
- Record outcome (merged successfully, attempt count, time-to-merge)
- Store metadata for future context (what worked, what didn't)

**Verification:**
- Test: merge readiness correctly checks all requirements
- Test: merge execution succeeds on test repo
- Test: merge queue enqueue works on merge-queue-enabled repo
- Test: branch cleanup after merge
- Test: learn phase records metrics

**Gotchas:**
- Merge endpoint SHA check prevents merging if PR has been updated since last check
- Merge queue changes the expected event flow
- Branch lease must be released AFTER merge (not before)
- Post-merge learning data feeds back into future task planning

---

### M19: Safety Controls

**Goal:** Kill switch stops execution immediately. Cost budgets prevent runaway spending. Circuit breakers protect external services.

**Packages affected:** `packages/temporal-activities`, `packages/api`, `packages/cli`

**Files to create:**
- `packages/temporal-activities/src/safety/kill-switch.ts` — Redis-based kill check
- `packages/temporal-activities/src/safety/cost-budget.ts` — Redis INCR cost tracking
- `packages/temporal-activities/src/safety/circuit-breaker.ts` — Per-service circuit breakers
- `packages/cli/src/commands/kill.ts` — `factory kill <task-id>` and `factory kill --all`
- `packages/api/src/routes/tasks.ts` — (update) Kill endpoint

**Redis keys:**
- `factory:kill_switch` — Global kill (value: "1" = active)
- `factory:kill:{taskId}` — Per-task kill
- `factory:cost:{taskId}` — Per-task cost accumulator
- `factory:cost:daily:{date}` — Daily cost accumulator
- `factory:circuit:{service}` — Circuit breaker state

**Kill switch check:** `MGET factory:kill_switch factory:kill:{taskId}` at every activity entry point (sub-ms).

**Cost budgets:**
- 80% threshold → notification
- 100% threshold → pause execution, require human override
- Per-task: $10 default (configurable)
- Global daily: $100 default (configurable)
- Check before EVERY LLM call

**Branch lease Lua scripts (CRITICAL — race conditions without atomic operations):**
```lua
-- Acquire
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
  return 1
end
return 0

-- Release (only if we own it)
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
```

**Verification:**
- Test: `factory kill T-001` → task stops within 5 seconds
- Test: global kill switch → all running tasks stop
- Test: cost budget exceeded → task pauses, requires override
- Test: circuit breaker trips after 3 consecutive failures
- Test: branch lease prevents concurrent modification

**Gotchas:**
- Kill switch check must be at EVERY activity entry point, not just between phases
- Redis pub/sub for kill switch activation notification (separate connection required)
- Cost check must happen BEFORE the LLM call, not after
- Lua scripts are mandatory for branch lease — Redis transactions (MULTI/EXEC) are NOT sufficient for check-and-modify

---

### M20: Reconciliation + Observability

**Goal:** Periodic GitHub sync catches missed webhooks. OTel traces, metrics, and structured logging provide operational visibility.

**Packages affected:** `packages/temporal-activities`, `packages/temporal-workflows`, `packages/worker`, `packages/api`

**Dependencies:** `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-grpc`, `@opentelemetry/exporter-metrics-otlp-grpc`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@temporalio/interceptors-opentelemetry`

**Files to create:**
- `packages/temporal-activities/src/github/reconciler.ts` — Periodic sync with GitHub
- `packages/worker/src/instrumentation.ts` — OTel setup (loaded via `--import`)
- `packages/worker/src/interceptors.ts` — (update) Add OTel interceptors
- `packages/api/src/routes/health.ts` — (update) `/health/ready` with dependency checks

**Reconciliation schedule:**

| Target | Frequency | Method |
|--------|-----------|--------|
| Active PRs | Every 5 min | REST + ETag |
| Branch protection | Every 30 min | REST + ETag |
| Rulesets | Every 30 min | REST + ETag |
| Check status | Every 5 min (active tasks) | REST |
| Review status | Every 5 min (active PRs) | GraphQL |
| Repository metadata | Every 60 min | REST + ETag |

**OTel setup (CRITICAL — V8 sandbox constraint):**
- Standard OTel works for activities and API
- Temporal workflow code runs in V8 sandbox — BLOCKS standard OTel
- Must use `@temporalio/interceptors-opentelemetry` with sinks mechanism
- `makeWorkflowExporter()` in worker sinks
- `OpenTelemetryActivityInboundInterceptor` for activities
- `OpenTelemetryWorkflowClientInterceptor` on client

**9 custom metrics:**

| Metric | Type | Labels |
|--------|------|--------|
| `factory.task.duration` | Histogram | status |
| `factory.task.count` | Counter | status |
| `factory.llm.tokens` | Counter | model, provider |
| `factory.llm.cost` | Counter | model, provider |
| `factory.llm.latency` | Histogram | model |
| `factory.evidence.review_time` | Histogram | — |
| `factory.sandbox.duration` | Histogram | phase |
| `factory.github.api_calls` | Counter | endpoint |
| `factory.credential.rotations` | Counter | type |

**3-tier observability:**
1. Built-in: Pino JSON logs + `/health` + `/metrics` (Prometheus)
2. Optional: `OTEL_EXPORTER_OTLP_ENDPOINT` env var enables export
3. Full: `docker compose --profile observability` adds collector + Jaeger + Grafana

**Verification:**
- Test: reconciler catches missed webhook (create PR without webhook → reconciler detects it)
- Test: traces appear in Jaeger for full task lifecycle
- Test: metrics exported in Prometheus format
- Test: health endpoint returns dependency statuses

**Gotchas:**
- ETag conditional requests return 304 (free quota) — always use ETags for reconciliation
- OTel metric label cardinality: NEVER label with task IDs, repo paths, branch names, commit SHAs
- Pino `mixin()` for trace correlation: `{ traceId, spanId }` in every log entry
- Temporal worker metrics: Prometheus `:9464` or OTel collector

---

### M21: End-to-End Testing

**Goal:** Full workflow tests on test repos and adversarial tests for edge cases.

**Packages affected:** All packages

**Files to create:**
- `packages/e2e/` — New package for E2E tests
- `packages/e2e/src/full-workflow.test.ts` — Submit task → merged PR
- `packages/e2e/src/adversarial.test.ts` — Prompt injection, token expiry, webhook loss
- `packages/e2e/src/fixtures/` — Test repo fixtures

**Test scenarios:**
1. Happy path: submit task → code changes → evidence → approve → PR → merge
2. Rejection path: submit → evidence → reject → failed state
3. Changes requested: submit → evidence → changes → re-implement → new evidence → approve
4. Kill switch: submit → kill → stopped
5. Cost exceeded: submit → budget hit → paused
6. Webhook loss: simulate missing webhook → reconciler recovers
7. Token expiry: GitHub token expires mid-task → auto-refresh → continues
8. Prompt injection: repo with malicious content → defenses hold
9. Concurrent tasks: two tasks on same branch target → lease prevents collision
10. Large repo: performance test on 10K+ file repo

**Verification:**
- All 10 scenarios pass
- No test leaves orphaned Docker containers
- No test leaves orphaned GitHub branches/PRs
- Performance: 10K file indexing completes within budget

**Gotchas:**
- E2E tests need real GitHub test repos — set up in advance (Manual Setup Task)
- Tests must be idempotent (can re-run without manual cleanup)
- Use test-specific GitHub App installation (not production)
- Rate limit awareness: don't exceed GitHub quota during test runs

---

### M22: SvelteKit Dashboard (Phase 2)

**Goal:** Web dashboard for repo readiness, run inspection, approval, and real-time updates via SSE.

**Packages affected:** New `apps/dashboard/` directory

**Key screens (per Codex 5.4):**
1. Repo readiness — effective rulesets, branch protection, setup quality, confidence level
2. Run inspection — timeline, artifacts, tool calls, validation matrix
3. Approval — exact action, diff summary, evidence, blockers vs concerns
4. Drift — what changed externally, authority impact, revalidation
5. Policy/setup editor — schema-aware, preview, migration warnings

**SSE for real-time:**
- Multiplex ALL events through single SSE connection (browser 6/domain limit)
- Redis pub/sub → SSE endpoint
- Auto-reconnect with `EventSource`
- Auth: query parameter (EventSource cannot set headers)

**This milestone is Phase 2 scope — detailed planning deferred until Phase 1 is complete.**

---

## 8. Testing Strategy

### Testing Layers (per milestone)

| Layer | What | Tools | Where |
|-------|------|-------|-------|
| Unit | Pure functions, schemas, state machine, parsers | Vitest | Co-located `__tests__/` |
| Workflow replay | Temporal determinism, signal handling, CAN | `@temporalio/testing`, `Worker.runReplayHistory` | `packages/temporal-workflows/__tests__/` |
| Activity unit | Individual activities with mocked deps | Vitest + `MockActivityEnvironment` | `packages/temporal-activities/__tests__/` |
| Integration | Real Postgres, real Redis, real Docker | Vitest + Testcontainers | `packages/db/__tests__/`, `packages/temporal-activities/__tests__/` |
| Contract | GitHub API, OpenRouter API response shapes | Vitest + recorded fixtures | `packages/temporal-activities/__tests__/` |
| E2E | Full workflow on test repos | Vitest + real services | `packages/e2e/` |

### Per-Milestone Testing

| Milestone | Tests to Write |
|-----------|---------------|
| M1 | Verify build system: typecheck, lint, test runner all pass |
| M2 | State machine (all transitions), Zod schemas (valid/invalid), config loader |
| M3 | Docker Compose health checks pass, services accessible |
| M4 | Migration applies, trigger rejects invalid transition, RLS blocks update on audit, encryption round-trip |
| M5 | JWT generation, webhook signature verification, Fastify health endpoint |
| M6 | CODEOWNERS parser, ruleset analyzer, capability scan on real repo |
| M7 | Governance filter, symbol extraction, repo map generation, tsvector search |
| M8 | CLI scan command, readiness report output, JSON format |
| M9 | Workflow start/signal/cancel, time-skipping for timeout, replay determinism |
| M10 | Container create/run/cleanup, network isolation, secret invisibility, OOM detection |
| M11 | Edit format (exact/fuzzy), cost tracker, guardrails trigger |
| M12 | Task submission → workflow → code changes on branch |
| M13 | Test execution, Semgrep scan, blast radius computation |
| M14 | Evidence generation, artifact storage, schema validation |
| M15 | CLI approve/reject/changes, review state transitions |
| M16 | PR creation (idempotent), check run submission |
| M17 | Webhook dispatch, feedback loop, stale review detection |
| M18 | Merge readiness check, merge execution |
| M19 | Kill switch, cost budget, circuit breaker, branch lease Lua |
| M20 | Reconciler catches missed webhook, OTel traces/metrics |
| M21 | Full E2E (10 scenarios) |

### Testing Conventions

- Co-located tests in `__tests__/` directories
- Test file naming: `{module}.test.ts`
- Testcontainers for Postgres (real DB, not mocks — per project rules)
- `@temporalio/testing` for time-skipping workflow tests
- Fixtures in `__tests__/fixtures/` or `packages/e2e/src/fixtures/`
- `vitest.workspace.ts` at root, `vitest.config.ts` per package

---

## 9. Migration & Rollback

### Database Migrations

- **Tool:** Drizzle Kit (`drizzle-kit generate`, `drizzle-kit migrate`)
- **Direction:** Forward-only. No down migrations. Rationale: data-destructive changes cannot be reversed safely
- **Custom SQL:** Required for triggers, RLS policies, partitions, seed data, extension creation
- **Zero-downtime patterns:** `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT`
- **Rollback strategy:** Restore from `pg_dump` backup. `./factory backup` before any migration.

### Schema Evolution Safety

- Always ADD columns as nullable or with DEFAULT
- Never DROP columns in the same release they stop being read
- New indexes via CONCURRENTLY
- Partition creation 3 months ahead
- Migration files in `packages/db/drizzle/NNNN_description/migration.sql`

### Application Rollback

- Each milestone produces a working state that can be tagged in git
- Rollback = `git revert` + restore database backup
- Forward-only is preferred — write a new migration to undo changes

---

## 10. Manual Setup Tasks

These require human action outside of code. Tagged with the milestone that depends on them.

| Task | Description | Depends On |
|------|-------------|-----------|
| **Install Docker** | Docker Engine on development machine | M3 |
| **Create GitHub Test Org** | Organization for testing GitHub App integration | M5 |
| **Register GitHub App** | Create GitHub App (manifest flow or manual) with required permissions | M5 |
| **Store GitHub App Private Key** | Save `.pem` file securely, configure path in `.env` | M5 |
| **Create Test Repos** | 3+ repos with varying branch protection, rulesets, CODEOWNERS, merge queue | M6, M21 |
| **OpenRouter API Key** | Sign up for OpenRouter, get API key | M11 |
| **Configure `.env`** | Copy `.env.example`, fill in secrets | M3 |
| **Install pnpm** | `corepack enable && corepack prepare pnpm@latest --activate` | M1 |

---

## 11. Risks & Mitigations

### High Severity

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Docker socket exposure** | Container escape could compromise host | Worker runs on host (not in container). Never mount socket into agent containers. V1 uses host worker; Phase 3 evaluates execution-plane separation. |
| **Temporal determinism violations** | Broken workflow replay, stuck tasks | `verbatimModuleSyntax: true` enforces import type. Replay testing in CI (`Worker.runReplayHistory`). `patched()` for all code changes. |
| **GitHub drift mid-task** | Stale data leads to wrong decisions | Reconciliation as core loop (M20), not background. ETag conditional requests. Reconcile before critical operations. |
| **Workflow code changes break running tasks** | Long-running tasks fail after deploy | Temporal patching discipline from day 1. Version workflows. Test replay of old histories against new code. |
| **LLM cost runaway** | Unexpected spending | Redis cost budgets checked before EVERY LLM call. Per-task ($10) and daily ($100) limits. Kill switch. |
| **Required-workflow rulesets ignore filters** | Unexpected CI behavior | Capability scan detects this. Surface in readiness report. Document clearly for operators. |

### Medium Severity

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **GraphQL dependency** | 5 features have no REST API | Dual client (REST + GraphQL) from day 1. Test GraphQL operations independently. |
| **tree-sitter native compilation fails** | Code indexing broken on some systems | WASM fallback via `web-tree-sitter`. Test in CI with both. |
| **MinIO Docker Hub deprecated** | Image pulls fail | Use `quay.io/minio/minio`. Documented in Docker Compose. |
| **Event history overflow** | Temporal workflow stuck | Parent-child architecture (~104 events). Continue-As-New at 10K. Monitor `continueAsNewSuggested`. |
| **Effect-TS incompatibility** | Cannot use Effect in workflows | CONFIRMED incompatible (GitHub #5986). Use neverthrow for Result types instead. |
| **Setup contract migration pain** | Every change breaks environments | Versioned schema from day 1. JSON Schema validation. Upgrade/migration tooling. |
| **Compose secrets unencrypted at rest** | Secrets readable on host filesystem | Host filesystem security. App-level envelope encryption for Postgres secrets. Phase 2: external KMS. |

### Lower Severity

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **macOS bind mount performance** | Slower dev experience | Document known limitation. Linux for production. |
| **Redis eviction invalidates leases** | Branch lease lost | Disable eviction for critical keys. Use `noeviction` policy on lease keyspace. |
| **Metric cardinality explosion** | Prometheus OOM | Never label with task IDs, repo paths, branch names, commit SHAs. |
| **Turborepo remote cache data leak** | Sensitive data in cache | No Turborepo initially. If added, local cache only. |
| **neverthrow maintenance stalled** | Dependency risk | ~2KB, minimal surface area. Fork if needed. Monitor quarterly. |
| **Webhook dedup failure** | Duplicate processing | `X-GitHub-Delivery` stored in DB with unique constraint. Idempotent processing. |

---

## 12. Open Questions

These need human input before the relevant milestone. Grouped by domain.

### Architecture (Before M1)

1. **Fastify or no API package?** — Research recommends Fastify. Plan includes `packages/api/`. Confirm this is the right split vs. embedding HTTP in the worker.
2. **7 packages or 6?** — Plan adds `api` package to the research's 6. Confirm.

### Temporal (Before M9)

3. **Separate Postgres instance for Temporal?** — auto-setup uses same instance with separate databases. Sufficient for Phase 1?
4. **Workflow granularity:** 11 child phase workflows per the plan. Too many? Too few?
5. **Namespace:** Single Temporal namespace or multi? Single is simpler.

### Docker / Sandbox (Before M10)

6. **Docker socket access pattern:** Worker on host (recommended) or in container with mounted socket?
7. **macOS dev parity:** How much of the security profile (userns-remap, XFS quotas) must work on macOS?
8. **Concurrent container limit:** What's the default? Based on host resources.

### GitHub (Before M5)

9. **CLI auth mechanism:** API key in config, keychain, env var, or all three?
10. **Which GitHub plan/tier for testing?** Free, Team, or Enterprise affects available features (rulesets, merge queue).

### Product / Business (Before M8)

11. **Observer Mode as explicit product mode?** — Codex 5.4 recommends it strongly. If yes, it's the first user-visible feature (M8).
12. **L2 autonomy evaluation in Phase 1 or Phase 2?** — L2 means agent creates PR without human evidence review. Consider deferring.
13. **Multi-tenant or single-tenant for V1?** — PRD says "self-hosted." Single-tenant is simpler.

### Database (Before M4)

14. **Partition automation:** Temporal workflow, startup check, or cron? Temporal aligns with existing infrastructure.
15. **Read-only dashboard role?** Third DB role beyond `factory_app` and `factory_admin`?

### LLM (Before M11)

16. **Repo map implementation:** Custom or adapt Aider's (Apache 2.0)?
17. **Edit format per-model or standardized?** Some models handle search/replace better than others.
18. **Evidence generation: same model or separate cheaper model?**

---

## 13. Architectural Invariants

These MUST be true at every milestone. Violations are bugs, not features.

1. **Excluded paths never enter the index** — governance filter is FIRST in pipeline
2. **Candidate-branch behavior files never change live behavior** — validator reads base ref only
3. **Validator never reads candidate-branch policy** — policy comes from trusted base ref
4. **PR not created before human approval** (at L0/L1)
5. **No hidden provider failover** unless policy explicitly allows
6. **Every mutating step is auditable** — audit entry for every state change
7. **Every attempt produces portable evidence** — evidence packet is the core product artifact
8. **Secrets never appear in evidence, logs, or UI** — mandatory redaction pipeline
9. **State transitions are enforced by the database** — trigger validates, not just application code
10. **Postgres is the system of record** — Temporal is the workflow engine, not the source of truth

---

## 14. ADR Candidates

Record these in `docs/decisions.md` as milestones lock them in:

1. ADR-001: TypeScript on Node.js 22 LTS (M1)
2. ADR-002: Temporal as workflow engine, Postgres as system of record (M4/M9)
3. ADR-003: Drizzle ORM with forward-only migrations (M4)
4. ADR-004: GitHub App model with REST + GraphQL (M5)
5. ADR-005: Docker sandbox with phase-separated secrets (M10)
6. ADR-006: Vercel AI SDK with OpenRouter (M11)
7. ADR-007: Observer Mode as first product mode (M8)
8. ADR-008: Evidence packet as versioned product API (M14)
9. ADR-009: Redis for kill switch and branch leases (M19)
10. ADR-010: Commander.js + Ink for CLI (M8)

---

*This plan is a living document. Update it as milestones reveal new information. Do not implement without human review of this plan.*
