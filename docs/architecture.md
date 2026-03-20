# Architecture Guide

Software Factory is a pnpm monorepo with 8 packages and 1 app, orchestrated by Temporal and backed by PostgreSQL as the system of record.

## System Overview

```
                    ┌─────────────────┐
                    │   GitHub        │
                    │  (webhooks,     │
                    │   API, PRs)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │  API Server  │ │Dashboard │ │     CLI      │
     │  (Fastify)   │ │(Svelte)  │ │ (Commander)  │
     │  port 3000   │ │port 5173 │ │              │
     └──────┬───────┘ └────┬─────┘ └──────┬───────┘
            │              │              │
            │    REST + SSE (real-time)   │
            └──────────────┼──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
     ┌──────────────┐ ┌────────┐ ┌──────────┐
     │  Temporal    │ │Postgres│ │  Redis   │
     │  Server      │ │  16    │ │  7       │
     │  port 7233   │ │port5433│ │ port6380 │
     └──────┬───────┘ └────────┘ └──────────┘
            │
     ┌──────┴───────┐
     │   Worker     │
     │  (activities │
     │   + workflows)│
     └──────┬───────┘
            │
   ┌────────┼────────┬──────────┐
   ▼        ▼        ▼          ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│Docker│ │ LLM  │ │GitHub│ │MinIO │
│Sndbox│ │Agent │ │ API  │ │ (S3) │
└──────┘ └──────┘ └──────┘ └──────┘
```

## Package Dependency Graph

```
                    ┌───────────┐
                    │   core    │  ← Pure TS, zero deps
                    │           │     Domain types, policy,
                    │           │     state machine, errors
                    └─────┬─────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
        ┌──────────┐ ┌────────┐ ┌──────────────────┐
        │    db    │ │temporal│ │    temporal-      │
        │          │ │workflows│ │    activities    │
        │ Schema,  │ │        │ │                  │
        │ queries  │ │V8 isolate│ │ Side effects   │
        └────┬─────┘ └────────┘ └───────┬──────────┘
             │                          │
             │         ┌────────────────┤
             │         │                │
             ▼         ▼                ▼
        ┌────────┐ ┌────────┐    ┌──────────┐
        │  api   │ │ worker │    │   cli    │
        └────────┘ └────────┘    └──────────┘
                        │
                   ┌────┘ (imports all 4 shared packages)
                   ▼
              ┌─────────┐
              │   e2e   │  (test-only, uses temporal-workflows)
              └─────────┘
```

**Critical constraints:**
- `core` must be pure TypeScript — it's imported by `temporal-workflows` which runs in Temporal's V8 isolate (no Node.js APIs)
- `temporal-workflows` uses `proxyActivities<T>()` with **type-only** imports from `temporal-activities` — no runtime imports allowed in the V8 sandbox
- `verbatimModuleSyntax: true` in all tsconfigs enforces `import type` discipline
- All `@temporalio/*` packages must share the exact same version (1.14.1)

## Package Details

### `packages/core` — Domain Foundation

Pure TypeScript with zero Node.js dependencies. Contains:

- **State machine** — 16 states, 21 explicit transitions + wildcard cancellation. 3 terminal states: `merged`, `failed`, `cancelled`
- **Policy engine** (`PolicyDecisionService`) — path-level governance with priority ordering: `read_exclusion` > `edit_deny` > `edit_protected` > `edit_allowed`. Default exclusions always enforced (`.env*`, `*.pem`, `*.key`, `.git/**`, `node_modules/**`)
- **Trusted base context** — pins behavioral control files to the base branch SHA at task intake, preventing agent self-tampering
- **Zod schemas** — single source of truth for all types (task, evidence, capability, policy, repo). All schemas use `.strict()`
- **Error system** — 11 error codes with declarative retry policies via neverthrow `Result<T, FactoryError>`

### `packages/db` — Data Layer

PostgreSQL 16 via Drizzle ORM:

- **18 tables** across 6 domains: core (repos, tasks), evidence/review, audit/operations, policy/security, code understanding, infrastructure
- **State machine enforcement** — database trigger validates transitions against `task_valid_transitions` lookup table
- **Audit immutability** — Row-level security prevents UPDATE/DELETE on `audit_entries`
- **Encrypted storage** — `secret_bindings` with AES-256-GCM encryption
- **Full-text search** — tsvector index on code symbols

### `packages/temporal-workflows` — Orchestration

Runs in Temporal's V8 isolate:

- **1 parent orchestrator** — spawns child workflows per phase, handles all 11 signals + 3 queries
- **11 pipeline phase workflows** — intake, understand, plan, setup, implement, validate, evidence, review, pr-creation, pr-tracking, learn (plus a `clarify` sub-workflow spawned conditionally)
- **2 feedback loops** — internal (review → implement) and external (PR feedback → implement), both bounded by `maxImplementationAttempts`
- **Continue-As-New** — designed in from day one to stay within Temporal's 51,200 event limit
- **11 patch gates** — versioned with `patched()` for safe deployment with in-flight workflows

### `packages/temporal-activities` — Side Effects

8 domain modules (~12,600 lines):

| Module | Responsibility |
|--------|---------------|
| `github` | Repo scanning, capability detection, PR operations, CODEOWNERS parsing |
| `llm` | LLM agent with 7 governance-enforced tools and 5 guardrails |
| `sandbox` | Docker container lifecycle, network isolation, secret injection |
| `indexing` | tree-sitter parsing (6 languages), symbol extraction, PageRank repo maps |
| `validation` | Test runner, lint runner, security scanner, validator boundary |
| `evidence` | Evidence bundle assembly (13 mandatory fields) |
| `safety` | Kill switch, cost tracking, circuit breakers, branch leases |
| `db` | Task state transitions, audit entries, credential management |

### `packages/api` — HTTP Layer

Fastify with Zod type provider:

- **30+ endpoints** across 8 route groups (tasks, safety, API keys, GitHub setup, webhooks, health, metrics, SSE)
- **Auth** — Bearer tokens with SHA-256 hashed API keys, `sf_` prefix, 3 roles (admin/operator/viewer)
- **Webhooks** — HMAC-SHA256 verification, deduplication via `X-GitHub-Delivery`, signals routed to Temporal workflows
- **SSE** — Redis pub/sub multiplexed through single endpoint, per-client subscriber, 30s heartbeat, exponential backoff reconnection
- **First-run bootstrap** — seeds admin API key, printed to stdout

### `packages/worker` — Runtime

Creates Temporal worker with all activities wired via dependency injection. Single task queue `sf-orchestration`. Gracefully degrades — GitHub, LLM, and evidence activities conditionally registered based on available credentials.

### `packages/cli` — Terminal Interface

11 commands via Commander.js with Ink for rich terminal UI:

`status` · `evidence` · `approve` · `reject` · `changes` · `review` (interactive) · `kill` · `budget` · `safety` · `health` · `config`

5-tier config precedence: CLI flags > env vars > project config > user config > defaults.

### `apps/dashboard` — Visual Interface

SvelteKit (Svelte 5 runes) with dark theme:

- Task list and detail views with real-time SSE updates
- Evidence review page with approve/reject actions
- Safety dashboard (kill switch, circuit breakers, cost tracking)
- Auth via localStorage with API key

## Infrastructure

Docker Compose provides 5 core services + 3 optional observability services:

**Core:**
- PostgreSQL 16 (tuned: 256MB shared buffers, SCRAM-SHA-256 auth, data checksums)
- Redis 7 (safety primitives, pub/sub for SSE)
- Temporal Server + Temporal UI
- MinIO (S3-compatible artifact storage)

**Observability (optional, via `--profile observability`):**
- OpenTelemetry Collector
- Jaeger (distributed tracing)
- Grafana (dashboards)

Secrets are managed via Docker secrets with `./scripts/generate-secrets.sh` for local development.

## Data Flow: Task Lifecycle

```
API/Webhook ──→ Create task in Postgres
                     │
                     ▼
              Start Temporal workflow
                     │
    ┌────────────────┼──── Phase Loop ────────────────┐
    │                ▼                                 │
    │  intake: validate task, load trusted context     │
    │       ▼                                          │
    │  understand: index repo, scan capabilities       │
    │       ▼                                          │
    │  plan: generate implementation plan via LLM      │
    │       ▼                                          │
    │  setup: prepare Docker sandbox environment       │
    │       ▼                                          │
    │  implement: LLM agent writes code in sandbox     │
    │       ▼                                          │
    │  validate: run tests/lint/security (base-ref)    │
    │       │                                          │
    │       ├── fail → retry implement (bounded)       │
    │       ▼                                          │
    │  evidence: assemble 13-field evidence packet     │
    │       ▼                                          │
    │  review: WAIT for human signal                   │
    │       │                                          │
    │       ├── reject → retry implement               │
    │       ├── changes_requested → retry implement    │
    │       ▼                                          │
    │  pr-creation: create GitHub PR                   │
    │       ▼                                          │
    │  pr-tracking: monitor checks, reviews, queue     │
    │       │                                          │
    │       ├── review feedback → retry implement      │
    │       ▼                                          │
    │  merge: PR merged → terminal state               │
    └──────────────────────────────────────────────────┘
```

Every state transition is recorded in the audit log. The kill switch is checked at every activity entry point.
