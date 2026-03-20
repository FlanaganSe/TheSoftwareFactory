# Software Factory Control Plane — Implementation Plan

**Version:** 1.2
**Date:** 2026-03-18
**PRD Version:** 5.1
**Status:** Ready for implementation — all decisions locked

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

- [x] **M1: Monorepo + Build System** — Initialize pnpm workspace with 7 packages, TypeScript config, Biome, and Vitest
  - [x] Step 1 — Root config: package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, vitest.config.ts, .gitignore → verify: `pnpm install`
  - [x] Step 2 — Create 7 packages with package.json, tsconfig.json, src/index.ts, vitest.config.ts; wire inter-package deps → verify: `pnpm install && pnpm typecheck`
  - [x] Step 3 — Verify all quality checks pass → verify: `pnpm lint && pnpm test && pnpm -r exec -- node -e "console.log('ok')"`
  - [x] Step 4 — Verify constraints: no @types/node in temporal-workflows, no Node.js imports in core → verify: manual check
  Commit: "feat: initialize pnpm monorepo with 7 packages, TypeScript strict, Biome, and Vitest"
- [x] **M2: Core Domain Package** — Define all domain types, Zod schemas, state machine, error types, and configuration
  - [x] Step 1 — Install picomatch + @types/picomatch in packages/core → verify: `pnpm install`
  - [x] Step 2 — Create 12 schema files in packages/core/src/schemas/ (task, evidence, policy, autonomy, audit, auth, repo, sandbox, github, llm, cost, config) → verify: `pnpm typecheck`
  - [x] Step 3 — Create state-machine.ts, trusted-context.ts, errors/, policy/decision-service.ts → verify: `pnpm typecheck`
  - [x] Step 4 — Create barrel index.ts with all re-exports → verify: `pnpm typecheck`
  - [x] Step 5 — Write 4 test files (state-machine, schemas, policy-decision-service, errors) with 141 tests → verify: `pnpm test`
  - [x] Step 6 — Verify all quality checks: typecheck, lint, test, no Node.js imports → verify: `pnpm typecheck && pnpm lint && pnpm test`
  Commit: "feat: add core domain package with Zod schemas, state machine, policy engine, and error types"
- [x] **M3: Docker Compose Infrastructure** — Stand up PostgreSQL, Redis, Temporal, MinIO with health checks
  - [x] Step 1 — Create `docker-compose.yml` (5 services, health checks, volumes, network, logging), `docker-compose.override.yml` (dev port exposure), `.env.example` → verify: `docker compose config > /dev/null`
  - [x] Step 2 — Create `scripts/init-db.sql` (roles, extensions, temporal DBs) and `scripts/generate-secrets.sh` → verify: `bash -n scripts/generate-secrets.sh`
  - [x] Step 3 — Generate secrets, start stack, verify all services healthy → verify: `docker compose ps` shows all healthy
  - [x] Step 4 — Verify Postgres (roles, extensions, checksums, temporal DBs), Redis, MinIO → verify: all QR checks pass
  - [x] Step 5 — Verify data persistence across restart → verify: `docker compose down && docker compose up -d` data persists
  Commit: "feat: add Docker Compose infrastructure with PostgreSQL, Redis, Temporal, and MinIO"
- [x] **M4: Database Schema + Migrations** — Create all Drizzle schemas, triggers, RLS policies, seed data, and repository layer
  - [x] Step 1 — Install deps (drizzle-orm, drizzle-kit, pg, @types/pg, neverthrow), create connection.ts → verify: `pnpm install && pnpm typecheck`
  - [x] Step 2 — Create all schema files (17 files: enums, 14 tables, barrel) → verify: `pnpm typecheck`
  - [x] Step 3 — Create encryption utilities + content hash → verify: `pnpm typecheck`
  - [x] Step 4 — Create repository layer (7 repos, all Result<T,E>) → verify: `pnpm typecheck`
  - [x] Step 5 — Create drizzle.config.ts, generate + apply migrations with custom SQL (trigger, RLS, seed) → verify: migrations apply, tables exist
  - [x] Step 6 — Write integration tests (6 test files, Testcontainers) → verify: `pnpm test --filter @software-factory/db`
  - [x] Step 7 — Full quality pass → verify: `pnpm typecheck && pnpm lint && pnpm test`
  Commit: "feat: add database schema, migrations, encryption, and repository layer"

### Phase 1: Observer Mode — *"Read-only value, zero risk"*

> **Goal:** Scan repositories and produce readiness reports WITHOUT executing any code or creating any PRs. This is the Observer Mode product surface that delivers value on day 1.
> **Human review gate:** Verify GitHub integration works correctly on a real test repo. Review capability scan accuracy.

- [x] **M5: GitHub App Foundation** — App registration flow, JWT auth, installation tokens, webhook receiver with signature verification
  - [x] Step 1 — Install deps (api: fastify, fastify-type-provider-zod, @fastify/sensible, @octokit/webhooks; temporal-activities: @octokit/rest, @octokit/auth-app, @octokit/graphql) → verify: `pnpm install`
  - [x] Step 2 — Create API server core (server.ts, app.ts, middleware/auth.ts, middleware/require-role.ts, middleware/error-handler.ts, bootstrap/seed-admin-key.ts) + add listApiKeys to db repo → verify: `pnpm typecheck --filter @software-factory/api`
  - [x] Step 3 — Create API routes (health, webhooks, api-keys, tasks stubs, setup) → verify: `pnpm typecheck --filter @software-factory/api`
  - [x] Step 4 — Create GitHub auth modules (credential-broker, client, rate-limiter) in temporal-activities → verify: `pnpm typecheck --filter @software-factory/temporal-activities`
  - [x] Step 5 — Write tests (API: health, auth, role-auth, webhooks, api-keys; GitHub: credential-broker, rate-limiter, client) → verify: `pnpm test`
  Commit: "feat: add GitHub App foundation, API server with auth, webhooks, and role enforcement"
- [x] **M6: Repository Capability Scan** — 10-step scan producing structured report (rulesets, CODEOWNERS, merge queue, signed commits)
  - [x] Step 1 — Create CapabilitySnapshot Zod schemas in core (all sub-schemas + barrel export) → verify: `pnpm typecheck --filter @software-factory/core`
  - [x] Step 2 — Install yaml dep, create codeowners-parser, workflow-scanner, ruleset-analyzer in temporal-activities → verify: `pnpm typecheck --filter @software-factory/temporal-activities`
  - [x] Step 3 — Create capability-scan orchestrator (10-step scan) + barrel export → verify: `pnpm typecheck --filter @software-factory/temporal-activities`
  - [x] Step 4 — Write all tests (core schema, codeowners, workflow-scanner, ruleset-analyzer, capability-scan) → verify: `pnpm test`
  - [x] Step 5 — Final verification (typecheck + lint + test all pass) → verify: `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
  Commit: "feat: add repository capability scan with CODEOWNERS parser, ruleset analyzer, and workflow scanner"
- [x] **M7: Code Indexing Pipeline** — tree-sitter parsing, symbol extraction, repo map generation, governance filter
  - [x] Step 1 — Install tree-sitter deps, create parser.ts + governance-filter.ts + types → verify: `pnpm typecheck --filter @software-factory/temporal-activities`
  - [x] Step 2 — Create symbol-extractor.ts + import-extractor.ts → verify: `pnpm typecheck --filter @software-factory/temporal-activities`
  - [x] Step 3 — Create repo-map.ts (PageRank) + queries.ts + index-repository.ts (db) + indexer.ts (10-step pipeline) + barrel exports → verify: `pnpm typecheck`
  - [x] Step 4 — Write all unit tests (governance-filter, symbol-extractor, import-extractor, repo-map, parser) + db tests (index-repository) → verify: `pnpm test`
  - [x] Step 5 — Final verification (typecheck + lint + test all pass) → verify: `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
  Commit: "feat: add code indexing pipeline with tree-sitter parsing, symbol extraction, and PageRank repo map"
- [ ] **M8: Observer Mode CLI** — `factory repo scan` command producing readiness report with setup contract generation

### Phase 2: Guided Execution — *"The agent can now write code"*

> **Goal:** Wire up Temporal orchestration, Docker sandboxing, and LLM agent to execute the intake → plan → implement loop.
> **Human review gate:** Verify sandbox isolation is correct. Review agent tool execution for safety. Verify Temporal workflows handle failures gracefully.

- [x] **M9: Temporal Orchestration Core** — Parent/child workflow architecture, worker setup, task queues, signals, basic lifecycle
  - [x] Step 1 — Install Temporal deps + safety deps (ioredis, async-mutex) across all 3 packages → verify: `pnpm install && pnpm typecheck`
  - [x] Step 2 — Create activity-types.ts (type-only interfaces), signals.ts, and all stub/real phase workflows (orchestrator, intake, clarify, review, 8 stubs) → verify: `pnpm typecheck --filter @software-factory/temporal-workflows`
  - [x] Step 3 — Create safety primitives (redis-client, kill-check, cost-check, branch-lease) + DB activities (task-activities, audit-activities) + barrel exports → verify: `pnpm typecheck --filter @software-factory/temporal-activities`
  - [x] Step 4 — Create worker process (worker.ts, index.ts, interceptors.ts, config) → verify: `pnpm typecheck --filter @software-factory/worker`
  - [x] Step 5 — Write all tests (safety primitives, workflow tests, activity tests) + final verification → verify: `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
  Commit: "feat: add Temporal orchestration core with parent/child workflows, safety primitives, and worker process"
- [x] **M10: Docker Sandbox Supervisor** — Container lifecycle (6 phases), network isolation, secret injection, environment caching
  - [x] Step 1 — Install dockerode deps, create secrets.ts, cache.ts, exec.ts (pure functions) → verify: `pnpm typecheck`
  - [x] Step 2 — Create network.ts, monitor.ts, cleanup.ts → verify: `pnpm typecheck`
  - [x] Step 3 — Create supervisor.ts (6-phase lifecycle orchestrator) → verify: `pnpm typecheck`
  - [x] Step 4 — Create activities.ts, update activity-types.ts, worker.ts, index.ts → verify: `pnpm typecheck && pnpm lint`
  - [x] Step 5 — Write unit tests (secrets, cache, monitor) + integration tests (supervisor, network, cache) → verify: `pnpm test`
  Commit: "feat: add Docker sandbox supervisor with 6-phase lifecycle, network isolation, and secret injection"
- [x] **M11: LLM Agent Core** — Vercel AI SDK integration, OpenRouter config, tool execution framework, edit format, context management
  - [x] Step 1 — Install deps (`ai`, `@openrouter/ai-sdk-provider`, `js-tiktoken`, `diff`, `@types/diff`) + create `src/llm/` directory with provider.ts, edit-format.ts, prompt-safety.ts, guardrails.ts → verify: `pnpm install && pnpm typecheck`
  - [x] Step 2 — Create context.ts, cost-tracker.ts, tools.ts, agent.ts, activities.ts, barrel index.ts; update temporal-activities/src/index.ts and temporal-workflows/src/activity-types.ts → verify: `pnpm typecheck && pnpm lint`
  - [x] Step 3 — Write unit tests: edit-format.test.ts (15), guardrails.test.ts (16), prompt-safety.test.ts (15), context.test.ts (10) → verify: all pass
  - [x] Step 4 — Write unit tests: tools.test.ts (15), cost-tracker.test.ts (8), agent.test.ts (6) → verify: all pass
  - [x] Step 5 — Full quality pass → verify: typecheck + lint pass, 85 new tests pass (530 total, 3 pre-existing failures in safety/Redis tests)
  Commit: "feat: add LLM agent core with OpenRouter provider, 7 governance-enforced tools, progressive edit format, and 5 self-healing guardrails"
- [x] **M12: Task Execution Pipeline** — Wire intake → understand → plan → implement loop through Temporal with sandbox + LLM
  - [x] Step 1 — New activities: branch.ts (Git Database API), trusted-context.ts (capture TrustedBaseContext), indexing/activities.ts (wrap indexer), llm/plan-activities.ts (LLM planning); extend activity-types.ts with serializable interfaces; update temporal-activities index.ts → verify: `pnpm typecheck`
  - [x] Step 2 — Replace phase workflows: understand.ts (index + repo map), plan.ts (LLM plan), setup.ts (sandbox + branch lease + setup contract), implement.ts (autonomy gate + agent + push); update orchestrator.ts for inter-phase data flow + patching; update index.ts → verify: `pnpm typecheck`
  - [x] Step 3 — Update worker.ts to register all new activities (GitHub branch, trusted context, index, LLM); add @temporalio/client to api/package.json; wire POST/GET /api/tasks to start Temporal workflows → verify: `pnpm install && pnpm typecheck && pnpm lint`
  - [x] Step 4 — Write activity tests: branch.test.ts (7), trusted-context.test.ts (5), index-activities.test.ts (3) → verify: `pnpm test`
  - [x] Step 5 — Write workflow tests: understand-phase.test.ts (4), implement-phase.test.ts (6), m12-pipeline.test.ts (5), tasks-api.test.ts (9); fix orchestrator.test.ts for real phases (6); fix auth/role/api-key tests for 503 responses → verify: `pnpm test && pnpm typecheck && pnpm lint`
  Commit: "feat: add task execution pipeline with real phase workflows, Git Database API, TrustedBaseContext, and L1 autonomy gate"

### Phase 3: Validation + Evidence — *"Proving the work is safe"*

> **Goal:** Validate code changes, generate evidence packets, and enable human review through the CLI.
> **Human review gate:** Review evidence packet quality. Verify approval flow works correctly. Test rejection/re-do cycle.

- [x] **M13: Validation Pipeline** — Test execution in sandbox, lint, security scanning (Semgrep/Syft/Grype), blast radius analysis
  - [x] Step 1 — Create validation schemas (core) + activity type interfaces → verify: `pnpm --filter @software-factory/core typecheck`
  - [x] Step 2 — Create validation activity implementations (test-runner, lint-runner, security-scanner, blast-radius, validator-boundary) + activity wrapper → verify: `pnpm --filter @software-factory/temporal-activities typecheck`
  - [x] Step 3 — Replace validate phase stub with real workflow + update orchestrator → verify: `pnpm typecheck`
  - [x] Step 4 — Write unit tests (parsers, blast radius, boundary) + workflow tests + schema tests → verify: `pnpm test`
  - [x] Step 5 — Final verification: lint, typecheck, full test suite → verify: `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
  Commit: "feat: add validation pipeline with trusted validator boundary, test/lint/security runners, and blast radius analysis"
- [x] **M14: Evidence Generation** — Evidence packet schema, annotated diffs, risk summary, artifact storage in MinIO
- [x] **M15: Human Review Flow** — CLI `evidence` / `approve` / `reject` / `changes` commands, review state management
  - [x] Step 1 — Install CLI deps (commander, chalk, ora, @inquirer/prompts, @iarna/toml) + CLI config + API client → verify: `pnpm install && pnpm typecheck --filter @software-factory/cli`
  - [x] Step 2 — API signal endpoints (approve/reject/changes/kill/evidence/freshness) + Temporal client augmentation → verify: `pnpm typecheck --filter @software-factory/api`
  - [x] Step 3 — CLI commands (status, evidence, approve, reject, changes, review, config, health) + evidence display UI → verify: `cd packages/cli && npx tsx src/index.ts --help`
  - [x] Step 4 — CLI tests (config, api-client, evidence-display, commands) → verify: `pnpm test --filter @software-factory/cli`
  - [x] Step 5 — API signal tests (task-signals) → verify: `pnpm test --filter @software-factory/api`
  Commit: "feat: add human review flow with CLI commands, API signal endpoints, and evidence display"

### Phase 4: PR + Merge Lifecycle — *"GitHub becomes involved"*

> **Goal:** Create PRs from candidate branches, submit check runs, track external CI, handle merge queue, and execute merges.
> **Human review gate:** Verify PRs are created correctly with evidence. Verify merge safety checks. Test on repos with branch protection and merge queues.

- [x] **M16: PR Creation + Check Runs** — Create PR from candidate branch, submit factory check run, handle check requirements
  - [x] Step 1 — Create activity modules: `pr.ts` (PR creation + body generation), `check-run.ts` (check run + annotations), `auto-merge.ts` (GraphQL merge queue/auto-merge), review-state-repository.ts → verify: `pnpm typecheck`
  - [x] Step 2 — Update activity-types.ts with PR/CheckRun/AutoMerge/ReviewState interfaces, register in worker, export from index.ts → verify: `pnpm typecheck`
  - [x] Step 3 — Replace pr-creation.ts workflow stub with real implementation (patched), update orchestrator → verify: `pnpm typecheck`
  - [x] Step 4 — Write tests: pr.test.ts (14), check-run.test.ts (22), auto-merge.test.ts (6), review-state-repository.test.ts (6), pr-creation-phase.test.ts (7) → verify: `pnpm test`
  - [x] Step 5 — Final verification: lint, typecheck, full test suite → verify: `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
  Commit: "feat: add PR creation with check runs, auto-merge, and evidence-linked PR body"
- [ ] **M17: PR Tracking + Feedback Loop** — Webhook-driven PR lifecycle, review feedback → re-implementation cycle, stale review detection
- [ ] **M18: Merge Readiness + Execution** — Merge queue enqueue, merge execution with SHA safety, post-merge learning phase

### Phase 5: Hardening — *"Production-ready safety"*

> **Goal:** Add kill switch, cost controls, reconciliation, observability, and end-to-end testing.
> **Human review gate:** Verify kill switch stops execution immediately. Review cost tracking accuracy. Validate reconciliation recovers from missed webhooks.

- [x] **M19: Safety Controls** — Redis kill switch (global + per-task), circuit breakers, cost budgets ($10/task, $100/day), retry limits
  - [x] Step 1 — Add `service_unavailable` error code to core + build safety infrastructure (circuit-breaker.ts, kill-switch.ts, budget-manager.ts, with-circuit-breaker.ts) → verify: `pnpm typecheck`
  - [x] Step 2 — Add API safety routes (safety.ts) + update tasks.ts kill endpoint for Redis dual approach + add Redis to server → verify: `pnpm typecheck`
  - [x] Step 3 — Update CLI api-client + add kill/budget/safety commands + register in index.ts → verify: `pnpm typecheck`
  - [x] Step 4 — Write all tests (circuit-breaker, kill-switch, budget-manager, with-circuit-breaker, safety-routes, CLI commands) → verify: `pnpm test`
  - [x] Step 5 — Lint fixes → verify: `pnpm lint`
  Commit: "feat: add safety controls — circuit breaker, kill switch UX, budget management, CLI commands"
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
- `src/types/task.ts` — `TaskState` enum (16 values — see below), `Task` type, `TaskTransition` map (22 valid transitions)
- `src/types/evidence.ts` — `EvidenceBundle` (13 PRD R-008 fields), `AnnotatedDiff`, `RiskSummary`, `RevertabilityClass`
- `src/types/policy.ts` — `PolicyType`, `ProtectionClass`, `PolicyConfig`, `AutonomyLevel` (L0/L1/L2)
- `src/types/github.ts` — `PRState`, `ReviewState`, `WebhookEvent` (NOT CapabilitySnapshot — that goes in M6)
- `src/types/sandbox.ts` — `ContainerPhase`, `EnvironmentState`, `SetupContract`
- `src/types/audit.ts` — `AuditEntry`, `AuditActionType`, `ActorType`
- `src/types/llm.ts` — `LLMCallAuditEntry`, `AgentTool`, `EditFormat`
- `src/types/repo.ts` — `Repository`, `RepoClass` (A/B/C), `IndexVersion`
- `src/types/auth.ts` — `Role` (admin/operator/viewer), `ApiKeyCredential`, `ActorIdentity`
- `src/types/trusted-context.ts` — `TrustedBaseContext` (pinned base SHA, parsed control files, setup contract, policy snapshot, validation commands)
- `src/schemas/` — Zod schemas matching every type (validation at boundaries) — **single source of truth, all types derived via `z.infer<>`**
- `src/errors/factory-error.ts` — Typed error hierarchy using neverthrow `Result<T, E>`
- `src/errors/error-codes.ts` — 10-class error taxonomy (policy_denied, github_transient, sandbox_failure, etc.)
- `src/policy/decision-service.ts` — Centralized `PolicyDecisionService`: pure functions for path-level read/write/deny/flag decisions using picomatch. ALL tool, index, query, and command entry points must route through this.
- `src/state-machine.ts` — Pure function: `canTransition(from, to): boolean` and `getValidTransitions(from): TaskState[]`

**IMPORTANT: No config loader in this package.** Config loading requires Node.js APIs (`process.env`, `fs`, XDG paths) which break the Temporal V8 sandbox. Config loading belongs in `packages/api`, `packages/worker`, and `packages/cli` — NOT in `core`. Core exports only the config Zod schema for validation.

**Key implementation details:**
- State machine is a pure map — no classes, no side effects
- **16 states** (added `paused` and `cancelled` to support kill switch, cost budget stops, and human-initiated cancellation):
  `created`, `needs_clarification`, `assigned`, `in_progress`, `paused`, `evidence_ready`, `changes_requested`, `approved`, `pr_created`, `external_checks_pending`, `addressing_review_feedback`, `external_blocked`, `merge_ready`, `merged`, `failed`, `cancelled`
- **22 transitions** (original 18 plus: `in_progress → paused`, `paused → in_progress`, `paused → cancelled`, `* → cancelled` from any non-terminal state)
- Terminal states: `merged`, `failed`, `cancelled` — zero outgoing transitions
- Zod schemas generate TypeScript types via `z.infer<>` — single source of truth
- **Autonomy levels per PRD R-009:**
  - `L0`: Human confirms every action (branch creation, file writes, PR creation, merge)
  - `L1`: Agent produces diffs and plans; human approval required BEFORE branch creation and file writes; human reviews evidence before PR (DEFAULT)
  - `L2`: Agent can create branches, edit code, run tests, push to candidate branch autonomously; human approval required only for PR creation, merge, and editing hard-protected files. Requires evaluation baseline — **deferred to Phase 2**
- Error codes with retry policies: `{ retryable: boolean, maxAttempts: number, backoffMs: number }`
- **TrustedBaseContext** — Captured at intake phase, pinned to base SHA. Contains: base commit SHA, parsed `.factory/setup.yml`, parsed behavioral control files (from base ref only), policy snapshot, validation command sources. All downstream phases (M10, M11, M13) consume ONLY this artifact for control/policy/validation inputs. Candidate-branch edits to these files are treated as diff content in evidence, not as live inputs.

**Verification:**
- Unit tests for state machine: every valid transition returns true, every invalid transition returns false, terminal states have no outgoing, `paused` and `cancelled` transitions work correctly
- Unit tests for Zod schemas: valid data passes, invalid data fails with expected errors
- Unit tests for PolicyDecisionService: read/write/deny/flag decisions correct for all policy types
- `pnpm typecheck` passes
- **Workflow bundle test: verify that importing `core` into a Temporal workflow bundle does NOT pull in Node.js built-ins**

**Gotchas:**
- **CRITICAL: DO NOT put config loading, file I/O, or any Node.js APIs in this package** — it must remain pure TypeScript for Temporal workflow compatibility. Add a workflow-bundle CI test that fails if Node builtins leak into the dependency graph.
- `neverthrow` Result types should wrap all fallible operations — no thrown exceptions at domain boundary
- Zod `.strict()` on all object schemas to catch extra fields early
- `CapabilitySnapshot` type is defined in M6, not here — avoid duplicate type definitions

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
- `src/schema/webhook-deliveries.ts` — Durable webhook dedup (`X-GitHub-Delivery` unique key, payload hash, status, processed_at)
- `src/schema/side-effects.ts` — Idempotent external side-effect ledger (idempotency_key unique, effect_type, target_ref, request_hash, response_payload, status, timestamps)
- `src/repositories/task-repository.ts` — **Transactional state+audit:** methods like `transitionTaskState(taskId, newState, actor, auditContent)` that wrap state mutation AND audit entry INSERT in a single `db.transaction()`. NEVER model state-change auditing as a separate operation.
- `src/repositories/audit-repository.ts` — Append-only insert + query (for non-state-change audit entries)
- `src/repositories/repo-repository.ts` — Repository CRUD
- `src/repositories/policy-repository.ts` — Policy CRUD + glob matching
- `src/repositories/webhook-repository.ts` — Webhook dedup: persist delivery before processing, check before re-processing
- `src/repositories/side-effect-repository.ts` — Side-effect ledger: consult before creating GitHub resources, persist after
- `src/encryption/envelope.ts` — AES-256-GCM encrypt/decrypt with KmsProvider interface
- `src/encryption/local-kms.ts` — V1 KmsProvider using `FACTORY_MASTER_KEY` env var
- `src/connection.ts` — `pg.Pool` setup with `max: 20`, Drizzle instance
- `drizzle.config.ts` — Migration config
- Custom SQL migrations for: state transition trigger, RLS policies, partition creation, seed data

**Key schema details (critical for implementer):**

Tasks table — 16-state enum, trigger-validated transitions:
- `id: uuid PK`, `state: task_state enum`, `objective: text NOT NULL`, `scope: jsonb`, `constraints: jsonb`, `budgetCents: numeric(10,0)`, `repoId: uuid FK`, `createdBy: text NOT NULL`, `createdAt/updatedAt: timestamptz`
- Trigger `validate_task_transition` fires `WHEN (OLD.state IS DISTINCT FROM NEW.state)`, queries `task_valid_transitions(from_state, to_state)` composite PK table with **22 seeded rows** (includes paused/cancelled transitions)

Webhook deliveries table — Durable dedup for GitHub webhooks:
- `id: uuid PK`, `deliveryId: text UNIQUE NOT NULL` (X-GitHub-Delivery), `event: text NOT NULL`, `action: text`, `payloadHash: text NOT NULL`, `status: text NOT NULL` (received/processing/processed/failed), `processedAt: timestamptz`, `createdAt: timestamptz NOT NULL`
- Unique index on `deliveryId` — reprocessing checks this before enqueueing

Side effects table — Idempotent external operation ledger:
- `id: uuid PK`, `taskId: uuid FK`, `effectType: text NOT NULL` (create_pr/update_pr/post_comment/set_status/create_check_run), `idempotencyKey: text UNIQUE NOT NULL`, `targetRef: text`, `requestPayloadHash: text`, `responsePayload: jsonb`, `status: text NOT NULL` (pending/completed/failed), `errorMessage: text`, `createdAt/updatedAt: timestamptz`
- M16/M17 MUST consult this ledger before creating/updating GitHub resources

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
- Integration test: `transitionTaskState()` atomically writes state change AND audit entry in one transaction — verify both exist or neither exists on failure
- Integration test: insert audit entry, attempt UPDATE (→ blocked by RLS)
- Integration test: encrypt secret, decrypt secret, verify round-trip
- Integration test: webhook dedup — inserting duplicate `deliveryId` is rejected
- Integration test: side-effect ledger — consult before create, idempotency key prevents duplicates
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
- `packages/api/src/routes/webhooks.ts` — GitHub webhook receiver (persists to `webhook_deliveries` BEFORE processing)
- `packages/api/src/routes/health.ts` — `/health`, `/health/ready`, `/health/live`
- `packages/api/src/routes/setup.ts` — GitHub App manifest flow endpoint
- `packages/api/src/middleware/auth.ts` — API key validation middleware, role enforcement (Admin/Operator/Viewer per R-018)
- `packages/api/src/middleware/actor.ts` — Actor identity propagation (every request carries actor identity for audit)
- `packages/db/src/schema/api-keys.ts` — API key table (hashed key, role, created_by, expires_at, last_used_at)
- `packages/db/src/repositories/api-key-repository.ts` — API key CRUD, validation
- `packages/temporal-activities/src/github/auth.ts` — JWT generation, installation token minting with **per-phase permission scoping**
- `packages/temporal-activities/src/github/credential-broker.ts` — Token caching with 50-min rotation, per-phase scoped token creation
- `packages/temporal-activities/src/github/client.ts` — Configured Octokit instances (REST + GraphQL)

**Key implementation details:**
- JWT: RS256, `iss` = client ID, `iat` = 60 seconds in the past (clock drift), `exp` = max 10 min
- Installation tokens: 1-hour expiry (NOT configurable), rotate at ~50 min
- **Per-phase token scoping:** Installation tokens CAN and MUST be narrowed at creation time using `permissions` and `repositories` parameters. Per-phase scoping table:

| Task Phase | Permissions Scoped |
|---|---|
| Capability scan | `contents:read`, `administration:read`, `checks:read` |
| Implementation | `contents:write`, `checks:write` |
| PR creation | `contents:write`, `pull_requests:write` |
| PR tracking | `pull_requests:read`, `checks:read`, `statuses:read` |
| Merge queue enqueue | `contents:write`, `pull_requests:write` |

- `@octokit/auth-app` handles token caching internally (toad-cache, 15K entries)
- Webhook verification: `@octokit/webhooks` with `X-Hub-Signature-256` (HMAC-SHA256), timing-safe comparison
- Idempotency: `X-GitHub-Delivery` header persisted to `webhook_deliveries` table BEFORE processing
- Webhook handler: verify → persist to DB → acknowledge → enqueue for async processing (NO business logic in handler)
- API version: `2026-03-10`
- **Auth (R-018):** API key middleware on all mutating routes. Three roles: Admin (full), Operator (submit/review/kill), Viewer (read-only). Separation of duties: task submitter cannot be sole approver (configurable for solo developers). API key lifecycle: issue via CLI (`factory config api-key create`), hash stored in DB, role bound at creation.

**Required GitHub App permissions:**
- Repository: `contents:write`, `pull_requests:write`, `checks:write`, `statuses:write`, `issues:read`, `administration:read`, `merge_queues:read`
- Organization: `administration:read`, `members:read`

**Webhook subscriptions:** `pull_request`, `pull_request_review`, `check_suite`, `check_run`, `merge_group` (app-webhook-only), `push`, `installation`

**Verification:**
- Unit test: JWT generation produces valid token structure
- Unit test: webhook signature verification (valid → passes, tampered → rejects)
- Unit test: per-phase token scoping produces minimal permission set
- Integration test: Fastify server starts, health endpoint returns 200
- Integration test: mutating routes reject unauthenticated requests (401)
- Integration test: Viewer role cannot access mutating endpoints (403)
- Integration test: webhook delivery persisted to DB before processing
- Manual test: Register GitHub App on a test org, receive installation webhook

**Gotchas:**
- `merge_group` events are ONLY delivered via app-level webhooks (not repository webhooks)
- Installation tokens CAN be scoped — always mint with minimum permissions for the current phase
- Must respond to webhooks within 10 seconds — async processing required
- GitHub does NOT auto-redeliver failed webhooks — reconciliation is required (M17 scoped + M20 full)
- Handle 401 from GitHub by refreshing token before retry (not just retrying with same expired token)

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
- `packages/temporal-workflows/src/orchestrator.ts` — Parent workflow: spawns children, accumulates results, handles Continue-As-New for loop scenarios
- `packages/temporal-workflows/src/phases/intake.ts` — First phase: validate task, capture `TrustedBaseContext` (pin base SHA, load control files from base ref), persist
- `packages/temporal-workflows/src/phases/clarify.ts` — Clarification phase: blocks until human responds (R-002 AC: "Ambiguous objective enters `needs_clarification` and blocks until human responds")
- `packages/temporal-workflows/src/signals.ts` — **Versioned signal union** with typed payloads: `kill` (actor), `approve` (actor, scope), `reject` (actor, reason), `changes_requested` (actor, message), `resume` (actor), `clarify_response` (actor, response), plus GitHub lifecycle signals (pr_review, check_complete, merge_queue_update). Include precedence rules (kill > any other signal).
- `packages/temporal-workflows/src/queries.ts` — Query definitions (getState, getProgress, getPhase)
- `packages/temporal-activities/src/db/task-activities.ts` — DB read/write activities using **transactional** repository methods (state change + audit in one call)
- `packages/temporal-activities/src/db/audit-activities.ts` — Non-state-change audit entries only
- `packages/temporal-activities/src/safety/kill-check.ts` — **Pulled forward from M19:** Redis kill switch check (`MGET factory:kill_switch factory:kill:{taskId}`), used at every activity entry point
- `packages/temporal-activities/src/safety/cost-check.ts` — **Pulled forward from M19:** Redis cost budget check before every LLM call
- `packages/temporal-activities/src/safety/branch-lease.ts` — **Pulled forward from M19:** Lua-based atomic acquire/release/heartbeat (NOT temporary — production-grade from day 1)
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
- Kill switch: Signal → set flag → check before every activity → `CancellationScope.nonCancellable` for cleanup → transition to `cancelled` state
- Human approval: Signal + `wf.condition(allHandlersFinished)` + **configurable timeout (default 4 hours per PRD R-007)** with escalation
- Idempotent writes: `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`
- Continue-As-New: trigger at `continueAsNewSuggested` OR `historyLength > 10_000`. **Explicit CAN rules for every looping phase:** review loops (changes_requested → re-implement → new evidence), PR feedback loops (external changes_requested → re-implement), and long waits (review, external checks). Persist `attempt` / `phaseIteration` counter so CAN restarts are lossless.
- Patching: `patched('name')` / `deprecatePatch('name')` for safe code changes from day 1. **Workflow versioning policy:** patch names per behavior change, versioned workflow input/result types, replay fixtures captured before each milestone that changes workflow behavior, worker rollout rules for in-flight executions.
- Clarification: `needs_clarification` signal + `wf.condition()` blocks until `clarify_response` signal received. No timeout — human must respond.
- Autonomy gating: Before any branch creation or file write (M12), check autonomy level. At L0/L1, wait for explicit approval signal. At L2 (Phase 2 only), proceed with candidate branch autonomously.
- Cost budget: Check Redis before every LLM activity. 80% → notification, 100% → transition to `paused`, require human override to resume.

**Verification:**
- Test: Start parent workflow, verify child phase spawns
- Test: Send kill signal, verify workflow transitions to `cancelled` within 5 seconds
- Test: Time-skipping test for **4-hour** human approval timeout with escalation
- Test: Time-skipping test for review loop (changes_requested → re-implement → new evidence → re-review)
- Test: `Worker.runReplayHistory` — determinism verification
- Test: Worker starts, connects to Temporal, registers all task queues
- Test: needs_clarification signal blocks until clarify_response received
- Test: Kill switch check fires at every activity entry point (Redis `MGET`)
- Test: Cost budget pause transitions task to `paused` state
- Test: Branch lease acquire/release with Lua scripts prevents concurrent writes
- **Replay test: capture fixture with one internal review loop and one external review loop, verify replay succeeds after code changes**

**Gotchas:**
- `temporal-workflows` package CANNOT import `temporal-activities` — use `proxyActivities<T>()` with type-only import
- `allHandlersFinished` must be drained before Continue-As-New
- Never call Continue-As-New from inside a signal handler
- 2 MB argument limit — large data goes to Postgres with references
- `async-mutex` is safe in the workflow sandbox (for concurrent signal handlers)
- **Parent workflow history will exceed 104 events when review/feedback loops occur.** The estimate of 104 assumes a single linear pass. Add explicit CAN triggers for the parent when loop count exceeds threshold.
- **Safety primitives (kill check, cost check, branch lease) are production-grade in this milestone**, NOT temporary stubs. M19 adds operator UX, global controls, circuit breakers, and override flows on top of this foundation.

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
| file_read | Read file content | PolicyDecisionService: governance filter applied |
| file_write | Write entire file | PolicyDecisionService: protected path check, deny on excluded paths |
| file_edit | Search/replace edit | PolicyDecisionService: protected path check, fuzzy match |
| search_codebase | Regex search | PolicyDecisionService: governance filter on results |
| run_command | Execute shell command | Allowlisted commands + **post-command diff validation** (see below) |
| list_files | List directory | PolicyDecisionService: governance filter applied |
| search_text | Text search (ripgrep) | PolicyDecisionService: governance filter on results |

**CRITICAL: `run_command` governance enforcement.** Allowlisting alone is insufficient — any allowed command (generators, test runners updating snapshots, `git apply`, etc.) can mutate protected or denied paths. Enforcement strategy:
1. Capture `git diff --name-only` before and after command execution
2. Run PolicyDecisionService on every changed path
3. If ANY changed path would be denied or flagged by policy, FAIL the step and revert the changes
4. Log all changed paths in audit trail
This ensures the governance boundary is enforced regardless of which tool the agent uses.

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
- Task submission → Temporal workflow start → intake phase → **capture TrustedBaseContext** (pin base SHA, load `.factory/setup.yml` and behavioral control files from base ref ONLY) → persist task
- If objective is ambiguous: transition to `needs_clarification`, block until `clarify_response` signal
- **Autonomy gate (L1 default):** Before branch creation or ANY file writes, check autonomy level. At L0/L1, transition to `evidence_ready`-like state and wait for human approval signal before proceeding. At L2 (Phase 2 only), proceed autonomously.
- Understand phase: run code indexing (M7), produce repo map, identify relevant files
- Plan phase: LLM generates implementation plan based on objective + code understanding
- Setup phase: Docker sandbox creation (M10) with setup contract **loaded from TrustedBaseContext (base ref), NOT from candidate branch**
- Implement phase: LLM agent (M11) executes plan in sandbox, produces code changes
- Candidate branch: `factory/{task-id}` created via Git Database API (auto-signed commits). **Consult EffectiveRepoConstraints from capability scan (M6) for branch naming rules, push restrictions, and commit message patterns.**
- Branch lease: **Production-grade Lua-based** acquire/release/heartbeat (defined in M9 safety primitives)
- **For repos without `.factory/setup.yml`:** Generate suggested contract from devcontainer.json/Dockerfile/GitHub Actions (per PRD Section 7.1), present to human for approval before use. Factory never silently infers and executes setup.
- **All tool invocations route through PolicyDecisionService** (from M2) for path governance enforcement

**Verification:**
- End-to-end test: submit task → workflow starts → phases execute → code changes appear on candidate branch
- Test: task state transitions correctly through `created → assigned → in_progress`
- Test: **L1 autonomy gate: task blocks before branch creation until human approves**
- Test: branch lease prevents two tasks from writing to same branch
- Test: setup contract is loaded from base ref, NOT candidate branch
- Test: TrustedBaseContext pin — candidate-branch edits to `.factory/setup.yml` do NOT affect agent behavior
- Test: repo without `.factory/setup.yml` → generates suggestion → blocks for human approval
- Test: EffectiveRepoConstraints from capability scan are consumed for branch naming and push validation

**Gotchas:**
- Candidate branch must be created BEFORE any code changes (Git Database API 6-step sequence)
- Branch naming: `factory/{task-id}` (not `factory/task-{id}`) — but check EffectiveRepoConstraints for repo-specific rules
- Branch lease is production-grade with Lua scripts — NOT a temporary stub
- Implementation phase may need Continue-As-New for long tasks (>10K events)
- **TrustedBaseContext must be captured at intake and passed to all downstream phases.** If implementers load workspace files directly instead, the trusted-boundary invariant is violated.

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

**Trusted Validator Boundary (CRITICAL):**
Validation runs in a **fresh workspace or separate container context** where:
- Behavioral control files (`.factory/setup.yml`, test configs, CI definitions, Semgrep config, evaluator scripts) come from the **pinned base SHA** (via TrustedBaseContext from intake)
- Candidate-branch changes are overlaid ONLY onto allowed source paths
- Agent edits to validator-control files are **ignored** — they appear in evidence as diff content but do NOT alter validation behavior
- This ensures the agent cannot modify what "validation" means in the same attempt

**Validation steps:**
1. Run project test suite in sandbox → capture results (test config from base ref)
2. Run linter → capture results (linter config from base ref)
3. Run Semgrep CE (SAST) → SARIF output (Semgrep rules from base ref)
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
- **Test: candidate-branch edits to `.factory/setup.yml` do NOT change validation behavior (base-ref version used)**
- **Test: candidate-branch edits to test config files do NOT alter which tests run or how they're configured**
- **Test: candidate-branch edits to Semgrep rules do NOT alter security scanning**

**Gotchas:**
- **Validator isolation is a SECURITY BOUNDARY** — the agent must not be able to influence its own evaluation
- Test execution happens in the sandbox (M10) — validator reads control files from TrustedBaseContext, not workspace
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

**Evidence packet fields (13 required per PRD R-008):**
1. Objective
2. Annotated diff (with per-hunk explanations)
3. Blast radius (files changed, packages affected)
4. Owners impacted (from CODEOWNERS analysis)
5. Test results (pass/fail/skip counts, output)
6. Security scan results (Semgrep SARIF)
7. Lint/type-check results
8. Protected-surface edits (flagged paths with justification)
9. Migration/schema impact (if applicable)
10. Revertability class (clean_revert | revert_with_migration | non_revertable)
11. Unresolved assumptions (what the agent wasn't sure about)
12. Commands and checks run (exact commands with exit codes)
13. Pending external checks (what still needs to pass after PR creation)

**NOTE:** PRD explicitly says "evidence-derived fields only — no model self-assessed confidence scores." Do NOT include "why the system believes the change is safe" as a field. The evidence speaks for itself.

**Presentation layer (optional, for CLI/dashboard):**
The Codex 5.4 10-section layout (objective, authority scope, files touched, files excluded, validation steps, test outcomes, risk summary, uncertainties, safety rationale, artifacts) can be used as a PRESENTATION format on top of the 13 required data fields — but the underlying schema MUST match R-008.

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
- `packages/temporal-workflows/src/phases/review.ts` — Review phase (waits for signal, configurable timeout — default **4 hours** per PRD R-007, with escalation)

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
- Test: review phase times out after **4 hours** (configurable, time-skipping test) and fires escalation
- Test: rejected task transitions to `failed` (terminal)

**Gotchas:**
- Review signal must include operator ID (for audit: task submitter ≠ sole approver per R-018)
- Default **4-hour timeout** on evidence review (configurable per PRD R-007) — escalation fires on timeout. Long-lived PR tracking (days/weeks) is a SEPARATE concern handled in M17, not the evidence review SLA.
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

**PR creation (idempotent via side-effects ledger):**
- Consult `side_effects` table BEFORE creating GitHub resources
- Idempotency key: `hash(task_id + 'create_pr' + candidate_branch + base_sha)`
- If side-effect already recorded as completed, skip. If failed, retry.
- If PR already exists (conflict), update instead of create
- Record result in `side_effects` ledger AFTER successful creation
- Handles partial failure: "PR created but DB write failed" is recoverable on retry

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

**Scoped active-PR reconciler (pulled forward from M20):**
While a PR is open, poll on a schedule (every 5 min) for: PR state, `reviewDecision` (GraphQL), unresolved threads, check status. This prevents runs from stranding in `external_checks_pending` or `addressing_review_feedback` if webhooks are lost. M20 adds broader scheduled reconciliation for inactive resources.

**Stale review detection:** Hybrid webhook + GraphQL (`reviewDecision`) + scoped reconciler.
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

### M19: Safety Controls — Operator UX + Hardening

**Goal:** Operator-facing kill/cost/override UX, circuit breakers for external services, and global safety controls. NOTE: Core safety primitives (kill check, cost check, branch lease) were built production-grade in M9 — this milestone adds operator tooling and hardening on top.

**Packages affected:** `packages/temporal-activities`, `packages/api`, `packages/cli`

**Files to create:**
- `packages/temporal-activities/src/safety/circuit-breaker.ts` — Per-service circuit breakers (GitHub, OpenRouter, Docker)
- `packages/cli/src/commands/kill.ts` — `factory kill <task-id>` and `factory kill --all`
- `packages/cli/src/commands/budget.ts` — `factory budget --task <id> --override` for human cost-override
- `packages/api/src/routes/tasks.ts` — (update) Kill endpoint, budget override endpoint
- `packages/api/src/routes/safety.ts` — Global kill switch, circuit breaker status

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

## 12. Resolved Decisions (formerly Open Questions)

All questions resolved. Decisions are locked unless implementation reveals a concrete problem.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Separate API package? | **Yes — 7 packages** | HTTP lifecycle differs from Temporal worker; clean webhook/REST separation |
| 2 | 7 packages or 6? | **7** | `packages/api` is well-justified (see above) |
| 3 | Separate Postgres for Temporal? | **Same instance, separate databases** | Standard pattern; no benefit to separation at Phase 1 scale |
| 4 | Workflow granularity? | **One child workflow per PRD step** | Granular = independently testable, restartable, evolvable |
| 5 | Temporal namespace? | **Single namespace** | Multi-namespace adds zero value for single-tenant product |
| 6 | Docker socket pattern? | **Worker on host** | Socket-in-container is OWASP anti-pattern |
| 7 | macOS dev parity? | **Reduced profile acceptable** | Full security on Linux production; macOS dev works without userns-remap/XFS quotas |
| 8 | Concurrent container limit? | **Default 5, configurable** | Matches `sf-docker` task queue concurrency |
| 9 | CLI auth? | **API key in TOML config + `FACTORY_API_KEY` env var** | Aligns with 5-tier config precedence |
| 10 | GitHub tier for testing? | **Team tier minimum** | Free tier lacks rulesets and merge queue |
| 11 | Observer Mode? | **Yes — explicit Stage 1 product mode** | Strong consensus; first value delivery with zero risk |
| 12 | L2 in Phase 1? | **No — deferred to Phase 2** | L0/L1 only in Phase 1; L2 requires evaluation baseline per PRD |
| 13 | Multi-tenant? | **Single-tenant for V1** | PRD says self-hosted; multi-tenancy is a known later migration |
| 14 | Partition automation? | **Temporal scheduled workflow** | Aligns with existing infrastructure; creates partitions 3 months ahead |
| 15 | Dashboard DB role? | **No separate DB role** | Viewer API role (R-018) handles read-only access at application layer |
| 16 | Repo map implementation? | **Custom, following Aider's documented algorithm** | Apache 2.0 algorithm well-documented; Aider code is Python, not portable |
| 17 | Edit format? | **Standardized search/replace** | Works across models; per-model adds complexity for marginal gain |
| 18 | Evidence model? | **Same model Phase 1, configurable Phase 2** | Simplicity first; model-class routing is a Phase 2 feature |

---

## 13. Architectural Invariants

These MUST be true at every milestone. Violations are bugs, not features.

1. **Excluded paths never enter the index** — governance filter is FIRST in pipeline
2. **Candidate-branch behavior files never change live behavior** — TrustedBaseContext captures control files from base ref at intake; all downstream phases consume ONLY that artifact
3. **Validator never reads candidate-branch policy/config** — validation commands, test configs, security rules, and policy come from the pinned base SHA via TrustedBaseContext
4. **PR not created before human approval** (at L0/L1) — and at L1, branch creation and file writes also require approval
5. **No hidden provider failover** unless policy explicitly allows
6. **Every mutating step is auditable** — state change AND audit entry in a single database transaction, never separate operations
7. **Every attempt produces portable evidence** — evidence packet is the core product artifact with all 13 PRD R-008 fields
8. **Secrets never appear in evidence, logs, or UI** — mandatory redaction pipeline
9. **State transitions are enforced by the database** — trigger validates, not just application code
10. **Postgres is the system of record** — Temporal is the workflow engine, not the source of truth
11. **Path governance is enforced on ALL mutation paths** — file_write, file_edit, AND run_command all route through PolicyDecisionService. run_command has post-execution diff validation.
12. **External side effects are idempotent** — all GitHub mutations (PR creation, check runs, comments) use the side_effects ledger with idempotency keys
13. **Webhook processing is durable** — every webhook is persisted to `webhook_deliveries` BEFORE processing; dedup on `X-GitHub-Delivery`

---

## 14. P0 Requirement Traceability (R-001 — R-018)

| Req | Description | Milestone(s) | Status |
|-----|-------------|-------------|--------|
| R-001 | Task creation from issue/API | M9 (intake), M12 (submission API) | Complete |
| R-002 | Task lifecycle (state machine, transitions) | M2 (types), M4 (DB trigger), M9 (workflows), M12-M18 (phases) | Complete — includes `needs_clarification` flow |
| R-003 | Repository analysis (index + capability) | M6 (capability scan), M7 (code indexing) | Complete |
| R-004 | GitHub App integration | M5 (auth/webhooks), M6 (scan), M16-M18 (PR/merge) | Complete |
| R-005 | PR lifecycle | M16 (creation), M17 (tracking), M18 (merge) | Complete — per-phase token scoping enforced |
| R-006 | Sandboxed execution | M10 (Docker supervisor), M13 (validation in sandbox) | Complete |
| R-007 | Human review + approval | M15 (CLI review), M9 (4h configurable timeout + escalation) | Complete |
| R-008 | Evidence packet (13 fields) | M14 (generation), M15 (display) | Complete — all 13 PRD fields |
| R-009 | Autonomy levels (L0/L1/L2) | M2 (types), M9 (workflow gates), M12 (L1 branch-creation gate) | Complete for L0/L1 — L2 deferred to Phase 2 |
| R-010 | Path/file governance | M2 (PolicyDecisionService), M7 (index filter), M11 (tool enforcement + run_command diff validation) | Complete |
| R-011 | Behavioral control files from trusted base ref | M2 (TrustedBaseContext type), M12 (capture at intake), M13 (validator isolation) | Complete |
| R-012 | Audit trail (append-only, tamper-resistant) | M4 (DB schema, RLS, partitions), M9 (transactional audit) | Complete |
| R-013 | Secret management (phase-separated, encrypted) | M4 (envelope encryption), M10 (exec-based injection), M5 (per-phase token scoping) | Complete |
| R-014 | Code understanding (index, repo map) | M7 (tree-sitter + PageRank repo map) | Complete |
| R-015 | Repository setup (.factory/setup.yml) | M10 (parsing/execution), M12 (generation for repos without contract) | Complete |
| R-016 | Validation pipeline | M13 (tests, lint, Semgrep/Syft/Grype, blast radius) | Complete |
| R-017 | Cost tracking + budgets | M9 (Redis cost check), M11 (OpenRouter cost tracking), M19 (operator overrides) | Complete |
| R-018 | Auth + roles (Admin/Operator/Viewer) | M5 (API key middleware, role model, separation of duties) | Complete |

---

## 15. ADR Candidates

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
