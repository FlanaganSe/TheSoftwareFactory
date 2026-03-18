# Software Factory — Comprehensive Research Synthesis

**Date:** 2026-03-18
**PRD Version:** 5.1
**Status:** Complete — ready for planning phase

This document synthesizes findings from 9 deep-research investigations into a unified technology and architecture picture. Each section references the detailed research file for implementation specifics.

---

## Table of Contents

1. [Consolidated Technology Stack](#1-consolidated-technology-stack)
2. [Architecture & Project Structure](#2-architecture--project-structure)
3. [Temporal Orchestration](#3-temporal-orchestration)
4. [GitHub Integration](#4-github-integration)
5. [Code Indexing](#5-code-indexing)
6. [Docker Sandbox](#6-docker-sandbox)
7. [LLM Integration & Agent Pattern](#7-llm-integration--agent-pattern)
8. [PostgreSQL Data Layer](#8-postgresql-data-layer)
9. [Deployment & Operations](#9-deployment--operations)
10. [CLI & User Experience](#10-cli--user-experience)
11. [Cross-Cutting Concerns](#11-cross-cutting-concerns)
12. [Resolved Conflicts](#12-resolved-conflicts)
13. [Critical Risks](#13-critical-risks)
14. [PRD Feasibility Assessment](#14-prd-feasibility-assessment)
15. [PRD Change Recommendations](#15-prd-change-recommendations)
16. [Open Questions for Planning](#16-open-questions-for-planning)
17. [Detailed Research Index](#17-detailed-research-index)

---

## 1. Consolidated Technology Stack

Every choice below has been validated against the PRD requirements and cross-checked for compatibility across the system.

| Layer | Technology | Version | Rationale | Research File |
|-------|-----------|---------|-----------|---------------|
| **Language** | TypeScript (strict) | Node.js 22+ | PRD spec. MCP SDK, shared types, Temporal SDK support | architecture |
| **Package Manager** | pnpm | 10+ | Strict deps, workspace-native, fast | architecture |
| **Monorepo** | pnpm workspaces (no Turborepo initially) | — | Temporal requires separate workflow/activity modules; 6 packages sufficient for Phase 1 | architecture |
| **Orchestration** | Temporal | SDK 1.15.x | Battle-tested durable execution; parent-child workflow pattern | temporal |
| **Primary DB** | PostgreSQL | 16 | Relational state + append-only audit + code index | postgres |
| **ORM** | Drizzle ORM | latest | SQL-first, TypeScript schemas, no binary dep, transparent migrations | postgres, architecture |
| **DB Driver** | node-postgres (pg) | latest | Mature, built-in pooling | postgres |
| **Cache/PubSub** | Redis | 7 | Kill switch, branch leases, pub/sub for dashboard | deployment-ux |
| **Redis Client** | ioredis | latest | Full TypeScript, Pub/Sub, Lua scripting | deployment-ux |
| **Object Store** | MinIO (self-hosted) | latest (quay.io) | Evidence bundles, audit exports. Use quay.io or Chainguard image (Docker Hub deprecated Oct 2025) | deployment-ux |
| **LLM SDK** | Vercel AI SDK (`ai` + `@openrouter/ai-sdk-provider`) | latest | Unified interface, streaming, tool use, OTel telemetry, stopConditions | llm-integration |
| **GitHub Client** | @octokit/rest + @octokit/auth-app + @octokit/webhooks | latest | REST for CRUD, GraphQL for merge queue + review threads | github |
| **Docker Client** | dockerode | 4.x | Most popular, TypeScript types, Promise API, zero meaningful deps | docker-sandbox |
| **Code Parser** | tree-sitter (native N-API) | latest | Fastest; 87+ language grammars; tags.scm for symbol extraction | code-index |
| **Glob Matching** | picomatch | latest | Governance-aware path filtering at index-time and runtime | code-index |
| **Validation** | Zod | latest | Runtime validation, shared schemas, safeParse at boundaries | architecture |
| **Error Handling** | neverthrow | latest | Lightweight Result types; typed errors without Effect's weight | architecture |
| **CLI Framework** | Commander.js + Ink | latest | Lightweight CLI + React-based TUI for evidence review | architecture |
| **Testing** | Vitest + @temporalio/testing + Testcontainers | latest | ESM-native, fast, Temporal-integrated, real Postgres in tests | architecture |
| **Linter/Formatter** | Biome | latest | Single tool, 25x faster than ESLint, sufficient for backend | architecture |
| **Build (dev)** | tsx | latest | Fast TypeScript execution, zero config | architecture |
| **Build (prod)** | tsup + @temporalio/worker build | latest | Optimized bundles; Temporal workflows need separate bundling | architecture |
| **Logging** | Pino | latest | Fast structured JSON, OTel trace correlation | deployment-ux |
| **Observability** | OpenTelemetry SDK + Temporal OTel interceptors | latest | Tracing, metrics, log correlation; tiered approach (built-in → export → full stack) | deployment-ux |
| **Dashboard (Phase 2)** | SvelteKit | latest | Small bundle, TypeScript-first, SSE for real-time | deployment-ux |
| **Documentation** | VitePress (Phase 2; plain Markdown initially) | latest | Lightweight, fast, TypeScript-aligned | deployment-ux |

---

## 2. Architecture & Project Structure

**Detail:** `research-architecture.md`

### Monorepo Layout (6 packages)

```
software-factory/
├── packages/
│   ├── core/                  # Domain types, Zod schemas, errors, config
│   ├── db/                    # Drizzle schema, repositories, migrations
│   ├── temporal-workflows/    # Workflow definitions (bundled into V8 isolate)
│   ├── temporal-activities/   # Activity implementations (normal Node.js)
│   ├── worker/                # Temporal worker process setup
│   └── cli/                   # CLI interface (Commander.js + Ink)
├── pnpm-workspace.yaml
├── tsconfig.base.json         # Shared: strict, NodeNext, composite
├── biome.json
├── vitest.workspace.ts
├── docker-compose.yml
└── .factory/setup.yml         # Dogfooding
```

### Key Structural Constraints

- **Temporal workflows** are bundled into a V8 isolate — they cannot import Node.js APIs or activity code directly. Workflows must be in a separate package.
- **"Live types" pattern** (Colin McDonnell): internal packages export TypeScript source directly; no build step during dev. Only `temporal-workflows` and `cli` need production builds.
- **Dependency injection** via closure-based factory functions (Temporal's official pattern). No DI container.

### TypeScript Configuration

- Base: `@tsconfig/node22` + strict mode + `"module": "NodeNext"` + `"moduleResolution": "NodeNext"`
- Composite projects for incremental builds
- Path aliases via `exports` in package.json (not tsconfig paths)

---

## 3. Temporal Orchestration

**Detail:** `research-temporal.md`

### Workflow Architecture: Parent Orchestrator + Child Phases

**Recommended over sequential Continue-As-New.** A parent orchestrator workflow spawns child workflows per phase:

```
TaskOrchestrator (parent)
  ├── IntakePhase (child)
  ├── UnderstandPhase (child)
  ├── PlanPhase (child)
  ├── SetupPhase (child)
  ├── ImplementPhase (child) ← may Continue-As-New internally
  ├── ValidatePhase (child)
  ├── EvidencePhase (child)
  ├── ReviewPhase (child)    ← waits for human signal
  ├── PRCreationPhase (child)
  ├── PRTrackingPhase (child) ← waits for GitHub events
  └── LearnPhase (child)
```

**Event budget:** Parent accumulates ~104 events for 13 phases — well within 51,200 limit. Each child can Continue-As-New independently if needed (implement phase with many iterations).

### Key Patterns

| Pattern | Implementation |
|---------|---------------|
| Human approval | Signal (`reviewDecisionSignal`) + `wf.condition(wf.allHandlersFinished)` with 7-day timeout |
| Kill switch | Signal-based (not activity-based) — zero event history cost, instantaneous |
| State queries | `wf.setHandler(taskStateQuery, () => currentState)` — synchronous, read-only |
| Activity retry | Per-class timeouts: DB 30s, GitHub 2m, LLM 5m, Docker 15m with heartbeats |
| Idempotent writes | `INSERT ... ON CONFLICT DO NOTHING` with idempotency keys |
| Branch lease | Dedicated workflow with TTL sleep + renewal signal |
| Cost budget | Check activity before each LLM call; kill switch signal on breach |

### Task Queues (separate per workload type)

- `sf-orchestration` — workflow tasks (fast, lightweight)
- `sf-llm` — LLM API calls (slow, expensive)
- `sf-docker` — sandbox operations (medium, resource-intensive)
- `sf-github` — GitHub API calls (rate-limited)
- `sf-db` — database operations (fast)

### Testing

- `@temporalio/testing` provides `TestWorkflowEnvironment` with time-skipping
- `MockActivityEnvironment` for unit testing activities
- `Worker.runReplayHistory` for determinism verification in CI

---

## 4. GitHub Integration

**Detail:** `research-github.md`

### GitHub App Permissions (minimum required)

| Permission | Level | Purpose |
|-----------|-------|---------|
| `contents` | write | Branches, commits, push, CODEOWNERS |
| `pull_requests` | write | PRs, review requests |
| `checks` | write | Check runs for factory validation |
| `issues` | read | Task intake from issues |
| `administration` | read | Rulesets, branch protection (capability scan) |
| `merge_queues` | read | merge_group events |
| Org: `administration` | read | Org-level rulesets |
| Org: `members` | read | Team ownership for CODEOWNERS |

### Critical Finding: REST + GraphQL Required

| Operation | API |
|-----------|-----|
| CRUD on PRs, branches, check runs | REST |
| Capability scan (rulesets, protection) | REST |
| **Review thread tracking (isResolved)** | **GraphQL only** |
| **Merge queue enqueue/dequeue** | **GraphQL only** |
| **Auto-merge enablement** | **GraphQL only** |
| **Stale review detection (reviewDecision)** | **GraphQL only** |

This means the factory needs both REST and GraphQL clients. Use `@octokit/graphql` alongside `@octokit/rest`.

### Credential Broker

- JWT auth for app-level endpoints (10-min lifetime, RS256)
- Installation tokens via `POST /app/installations/{id}/access_tokens` with scoped permissions
- 50-minute rotation timer (tokens expire at 60 min)
- `@octokit/auth-app` handles token caching (toad-cache, 15K entries)

### Capability Scan Sequence

10-step scan: authenticate → repo metadata → rulesets (with `includes_parents=true`) → branch rules → protection → CODEOWNERS → environments → parse push rules/signed commits/bypass actors → determine repo class → generate report.

### CODEOWNERS Parsing

No API returns "owners for these changed files" — must implement gitignore-style pattern matching client-side. Pattern: last matching rule wins (reverse precedence).

---

## 5. Code Indexing

**Detail:** `research-code-index.md`

### Pipeline

```
git ls-files → Governance Filter (picomatch) → Language Detection →
Parse (tree-sitter) → Symbol Extraction (tags.scm) → Import Extraction →
Store (Postgres) → Build Dependency Graph → Detect Structure → Mark Ready
```

### Symbol Extraction

- `tree-sitter` native N-API bindings (fastest, ~280K weekly downloads)
- `tags.scm` query files for extracting functions, classes, interfaces, methods
- Phase 1 grammars: TypeScript, JavaScript, Python, Go, Rust, Java
- Query API: `new Parser.Query(language, queryString)` → `query.matches(rootNode)`

### Repo Map (Aider-style)

- Tree-sitter extracts definitions and references
- Build graph: files → symbols → references between files
- Rank by connectivity (simplified PageRank in Phase 1)
- Compress to fit token budget: `{file: symbols[]}` format
- Provides compressed codebase awareness for the LLM without shipping entire files

### Storage

- Postgres tables: `code_files`, `code_symbols`, `code_dependencies`, `code_index_versions`
- `tsvector` with `'simple'` config + GIN index for symbol search (exact/prefix match, no stemming)
- `pgvector` extension installed early for Phase 3+ semantic search

### Incremental Updates

- `git diff --name-only <last-sha> HEAD` → re-parse only changed files
- Update symbols + imports + dependency edges for changed files
- Update `code_index_versions` with new commit SHA

---

## 6. Docker Sandbox

**Detail:** `research-docker-sandbox.md`

### Container Lifecycle per Task

```
1. RESOLVE ENVIRONMENT — parse .factory/setup.yml, compute cache key
2. CREATE CONTAINER — from cache or base image
3. SETUP PHASE — bridge network, setup-only secrets via exec -e, run setup, health check, docker commit
4. MAINTENANCE PHASE (if cached) — bridge network, run maintenance, health check
5. EXECUTION PHASE — 'none' network, runtime secrets via exec -e, run agent, monitor
6. CLEANUP — stop, remove container
```

### Security Baseline (V1)

| Layer | Implementation |
|-------|---------------|
| Capabilities | `CapDrop: ALL` |
| Seccomp | Default Docker profile (~44 blocked syscalls) |
| Privilege escalation | `SecurityOpt: ['no-new-privileges']` |
| Network (execution) | `NetworkMode: 'none'` (default) or Squid proxy for allowlists |
| Filesystem | Read-only root + tmpfs for `/tmp`, `/workspace` |
| User | Non-root (UID 1000) |
| Resources | Memory limit, CPU limit, PID limit |
| Secrets | `exec -e` injection, phase-separated, no layer persistence |

### Network Allowlist

For repos that need network during execution (API calls, etc.): Squid HTTP proxy on an internal Docker network. Domain-level allowlist, HTTPS CONNECT support, audit logging. Container talks to proxy only.

### Environment Caching

- `docker commit` snapshots container filesystem after setup
- Cache key: SHA-256 of `.factory/setup.yml` + behavioral control file hashes
- Invalidation: on setup contract, maintenance script, secret binding, or control file change
- ~1-3 second restore from cached image vs. minutes for full setup

---

## 7. LLM Integration & Agent Pattern

**Detail:** `research-llm-integration.md`

### Agent Architecture

**Hybrid plan-and-execute + ReAct:**
- **Outer loop (plan-and-execute):** Understand → Plan → Implement → Validate → Evidence. Controlled by Temporal workflow.
- **Inner loop (ReAct):** Implementation phase uses tool-calling loop. Tools: file_read, file_write, shell_exec, search_code, search_symbols. Controlled by Vercel AI SDK `generateText` with `maxSteps`.

### Edit Format

**Search/replace blocks** (Aider-style). Progressive matching: exact → whitespace-tolerant → fuzzy. Whole-file generation for small new files only.

### OpenRouter Configuration for PRD Compliance

```typescript
{
  model: "anthropic/claude-sonnet-4",  // or configured model
  provider: {
    allow_fallbacks: false,     // R-017: no silent failover
    order: ["Anthropic"],       // single provider
    data_collection: "deny",    // governance
    require_parameters: true,   // ensure tool support
  }
}
```

### Cost Tracking

- Query OpenRouter generation stats endpoint after each call (`GET /api/v1/generation?id={id}`)
- Returns: `total_cost`, token counts (prompt/completion/cached/reasoning), latency, model, provider
- Accumulate in Postgres per task
- Enforce budgets: Vercel AI SDK `stopConditions` + Redis counter for global budget
- 80% → notify, 100% → pause (kill switch signal to Temporal workflow)

### Self-Healing Guardrails

| Guard | Implementation |
|-------|---------------|
| Max iterations | Vercel AI SDK `maxSteps: 10` |
| No-progress detector | Hash agent state every iteration; 3 identical hashes → pause |
| Loop-of-doom | 4+ identical failing tool calls → pause |
| Time budget | 30 min wall-clock timer in Temporal activity |
| Cost budget | Redis counter checked before each LLM call |
| Kill switch | Redis key checked at every tool invocation; Temporal signal for immediate stop |

### Prompt Injection Defense

- Trust classification (R-023) applied to all context
- Delimiter-based content separation in prompts
- HTML/hidden-comment stripping on untrusted content
- Tool-call validation (untrusted content cannot parameterize destructive tools)
- Behavioral control files loaded from trusted base ref only (R-011)

---

## 8. PostgreSQL Data Layer

**Detail:** `research-postgres.md`

### Schema Design

| Entity | Key Design Decision |
|--------|-------------------|
| `tasks` | PG enum for states + trigger-based transition validation via `task_valid_transitions` lookup table |
| `audit_entries` | Append-only (INSERT only), RLS prevents UPDATE/DELETE, partitioned by month, SHA-256 per-entry content hash |
| `evidence_bundles` | Relational columns for fixed fields (objective, blast_radius, revertability_class) + JSONB for variable data (annotations, scan results) |
| `review_states` | Dual fields: `internal_status` (factory evidence) + `external_status` (GitHub merge readiness) |
| `credential_leases` | Token (encrypted), scope, expiry, rotation schedule |
| `secret_bindings` | Name, class (setup_only/runtime/per_tool), encrypted value, source |
| `code_symbols` | File, name, kind, line, signature; tsvector index |
| `policy_configs` | JSONB for path patterns + rules; per-repo |

### Encryption

- **Application-layer AES-256-GCM** (not pgcrypto) — Postgres never sees plaintext secrets
- Envelope encryption: DEK encrypts data, KEK encrypts DEK
- V1: KEK from operator environment variable
- Later: pluggable KMS interface (AWS KMS, GCP KMS)

### Audit Table

- Per-entry SHA-256 hash of content (not a hash chain — simpler, parallel-safe, sufficient for tamper detection)
- Partitioned by month (`audit_entries_2026_03`, `audit_entries_2026_04`, etc.)
- Retention: metadata + hash retained 2 years; full content purged after 90 days
- GDPR purge: null content column, retain metadata + hash
- Periodic export to MinIO as JSONL (Parquet in Phase 2 if analytics needed)

### Migrations

- Drizzle Kit, forward-only (no down migrations)
- Version-controlled SQL migration files
- Applied on startup or via CLI command

---

## 9. Deployment & Operations

**Detail:** `research-deployment-ux.md`

### Docker Compose (Phase 1)

6 services: app, postgres, redis, temporal, temporal-ui (optional), minio

- All services have health checks with `depends_on: condition: service_healthy`
- Temporal: use `temporalio/auto-setup` for initial schema, then switch to `temporalio/server`
- MinIO: use `quay.io/minio/minio` or Chainguard (Docker Hub deprecated)
- Resource estimates: ~4 CPU, 4 GB RAM minimum for dev

### Self-Hosted Distribution

- Docker Compose as primary distribution format
- `factory setup` command for first-run configuration (GitHub App manifest flow, secret generation, database init)
- Upgrade path: `docker compose pull && docker compose up -d` + automatic migration on startup
- Backup: Postgres pg_dump + MinIO bucket sync

### Observability (Tiered)

| Tier | What | When |
|------|------|------|
| Built-in | Pino JSON logs + `/health` + `/metrics` endpoint | Always (default) |
| Export | OTel traces/metrics to collector | Opt-in via env vars |
| Full stack | Grafana + Tempo + Prometheus | User provisions |

Temporal has built-in OTel interceptors for the TypeScript SDK — add from day 1.

### Redis Patterns

| Pattern | Use |
|---------|-----|
| `SET NX EX` | Branch leases with TTL |
| `GET` on hot key | Kill switch (checked every tool invocation) |
| Pub/Sub | Real-time dashboard updates |
| `INCR` + `GET` | Global cost counter for budget enforcement |

---

## 10. CLI & User Experience

**Detail:** `research-deployment-ux.md`, `research-architecture.md`

### CLI Structure (Commander.js)

```
factory setup github-app     # Manifest flow onboarding
factory setup repo            # Repo capability scan + setup contract generation
factory submit --issue 42     # Create task from GitHub issue
factory status                # List active tasks
factory evidence --task T-001 # Display evidence packet (Ink TUI)
factory approve --task T-001  # Approve → create PR
factory reject --task T-001   # Reject with reason
factory review --task T-001   # Request changes with feedback
factory kill --task T-001     # Emergency stop
factory config                # View/edit configuration
```

### Evidence Review (Ink TUI)

Rich terminal UI for reviewing evidence packets:
- Annotated diff with syntax highlighting
- Blast radius summary
- Test results with pass/fail indicators
- Security scan results
- Protected-file edit highlights
- Keyboard-driven approval/rejection/request-changes

### Configuration

- Config file: `~/.config/software-factory/config.toml` (or `$FACTORY_CONFIG`)
- Per-repo config: `.factory/config.toml`
- Environment variables override config file
- API key stored in config file or env var

---

## 11. Cross-Cutting Concerns

### Error Handling Strategy

| Layer | Pattern |
|-------|---------|
| Domain logic | `neverthrow` Result types (`ok(value)` / `err(error)`) |
| Temporal workflows | `ApplicationFailure.create({ nonRetryable: true })` for validation; retryable for transient |
| Temporal activities | Map external errors to `ApplicationFailure` with appropriate retry flags |
| CLI | Catch Results, format user-friendly error messages |
| API boundaries | Zod `safeParse` → Result conversion |

### Testing Strategy

| Level | Tool | What |
|-------|------|------|
| Unit | Vitest | Pure functions, domain logic, Zod schemas |
| Activity | `MockActivityEnvironment` | Individual Temporal activities |
| Workflow | `TestWorkflowEnvironment` (time-skipping) | Temporal workflows with mocked activities |
| Integration | Testcontainers (Postgres, Redis) | Data layer, repository functions |
| Replay | `Worker.runReplayHistory` in CI | Workflow determinism |
| E2E | Testcontainers + real Temporal | Full workflow execution |

### Dependency Injection

Closure-based factory functions (Temporal's official pattern):

```typescript
// activities/factories.ts
export const createGitHubActivities = (deps: { octokit: Octokit; db: Database }) => ({
  async createPR(input: CreatePRInput): Promise<PRResult> { ... },
  async scanCapabilities(input: ScanInput): Promise<ScanResult> { ... },
});

// worker.ts
const activities = {
  ...createGitHubActivities({ octokit, db }),
  ...createSandboxActivities({ docker, db }),
  ...createLLMActivities({ aiSdk, db }),
};
```

---

## 12. Resolved Conflicts

Research agents produced a few conflicting recommendations. Resolutions:

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| **CLI framework:** Commander.js (architecture) vs. oclif (deployment-ux) | **Commander.js + Ink** | oclif is heavier and its plugin architecture isn't needed for Phase 1. Commander.js is simpler, lighter, and Ink handles the TUI evidence review. Can migrate to oclif later if plugin extensibility is needed. |
| **Config format:** TOML (deployment-ux) vs. no recommendation (architecture) | **TOML** | Human-readable, well-typed, standard for developer tools (Rust, Python, Biome all use TOML). Better for self-hosted product than YAML (less footgun-prone) or JSON (no comments). |
| **Content hashing:** Hash chain vs. per-entry SHA-256 | **Per-entry SHA-256** | Simpler, parallel-safe, sufficient for tamper detection. Hash chains add complexity without proportionate benefit for this use case. |
| **Audit export format:** JSONL vs. Parquet | **JSONL for V1, Parquet later** | JSONL is simplest to implement. Parquet enables analytics but isn't needed until Phase 2+. |

---

## 13. Critical Risks

### Technical Risks Surfaced by Research

| Risk | Severity | Detail | Mitigation |
|------|----------|--------|-----------|
| **Docker socket access** | High | Control plane needs Docker socket to manage containers — a powerful capability OWASP warns against | Run worker on host (not in container) for V1; or mount socket with read-only where possible; gVisor in Phase 3 |
| **Temporal workflow determinism** | High | Any non-deterministic code in workflows (random, Date, I/O) breaks replay | Temporal V8 sandbox catches most issues; replay tests in CI catch the rest; strict no-import rules in workflow package |
| **GraphQL dependency for core features** | Medium | Merge queue and review thread tracking require GraphQL — adds complexity | Build thin GraphQL wrapper early; use `@octokit/graphql` alongside REST |
| **tree-sitter native compilation** | Medium | Native N-API bindings require compilation on deployment host | Pre-built binaries available for common platforms; WASM fallback if needed |
| **MinIO Docker Hub deprecation** | Medium | Official MinIO Docker Hub images stopped updating Oct 2025 | Use `quay.io/minio/minio` or Chainguard image; document in install guide |
| **Event history overflow** | Medium | Long-running implement phases could hit 51,200 event limit | Continue-As-New at `historyLength > 10_000`; parent-child pattern limits parent to ~104 events |
| **LLM cost runaway** | Medium | A stuck agent loop can burn through budget quickly | SDK maxSteps + Redis cost counter + kill switch signal + no-progress detector |
| **macOS Docker differences** | Low | Docker Desktop on macOS lacks XFS quotas, userns-remap, has slower bind mounts | Document Linux as production target; dev mode with relaxed security profile |

### Integration Risks (Multiple Systems)

| Risk | Components | Mitigation |
|------|-----------|-----------|
| Temporal + Postgres + GitHub state consistency | All | Idempotent activities; Postgres is source of truth for app state; Temporal for orchestration state; GitHub for repo state; periodic reconciliation |
| Secret lifecycle across sandbox phases | Docker + Postgres + Temporal | Strict phase separation; exec-based injection; never in environment layers; audit trail for all secret operations |
| Kill switch latency | Redis + Temporal + Docker | Redis key check is O(1); Temporal signal is immediate; Docker exec timeout handles stuck processes |

---

## 14. PRD Feasibility Assessment

### Fully Feasible (Clear Path)

- R-001 (Application State) — Drizzle + Postgres relational tables, well-understood
- R-002 (Task Lifecycle) — PG enum + trigger, Temporal state machine
- R-003 (Candidate Branch) — Temporal parent-child workflows, GitHub REST API
- R-005 (Credential Broker) — @octokit/auth-app + rotation timer
- R-006 (Sandbox) — dockerode, well-documented patterns
- R-007 (Human Review Gates) — Temporal signals with timeout
- R-008 (Evidence Packet) — structured data assembly, LLM annotation
- R-009 (Autonomy Levels) — policy config check before each operation
- R-012 (Audit Trail) — append-only Postgres with RLS + partitioning
- R-013 (Cost Tracking) — OpenRouter generation stats API
- R-016 (CLI) — Commander.js + Ink
- R-017 (Provider Routing) — OpenRouter with `allow_fallbacks: false`
- R-018 (Basic Auth) — API key middleware

### Feasible with Complexity

- R-004 (GitHub Integration) — requires both REST and GraphQL; CODEOWNERS parsing is client-side; 10-step capability scan is substantial but well-defined
- R-010 (Path/File Policy) — picomatch for glob matching; enforcement at two layers (index-time + runtime) requires careful integration
- R-011 (Protected File Classes) — base-ref-only loading is straightforward; behavioral control file trust boundary needs clear implementation
- R-014 (Code Understanding) — tree-sitter + Postgres is well-understood; repo map quality depends on extraction/ranking heuristics; Phase 3 semantic search (pgvector) is proven tech
- R-015 (Repo Setup) — setup contract is straightforward; devcontainer.json import requires parsing a complex spec

### Risks to Watch

- **Phase 1 scope** — 18 requirements in 6 weeks is aggressive. The PRD already simplified (no event sourcing, Docker-only sandbox, single provider). Further de-risking: consider shipping L0/L1 only and deferring L2 eval baseline to Phase 2.
- **Code index quality** — tree-sitter symbol extraction is proven, but building a useful repo map with good ranking is an iterative process. Budget time for tuning.
- **Evidence packet richness** — generating high-quality annotated diffs with blast radius analysis requires good prompts and iteration.

---

## 15. PRD Change Recommendations

Based on research findings, these PRD changes would reduce risk and improve quality:

### Recommended Changes

| # | Change | Rationale |
|---|--------|-----------|
| 1 | **Add GraphQL to tech stack table (§17)** | Merge queue, review threads, and auto-merge require GitHub GraphQL API. REST alone is insufficient. |
| 2 | **Specify Vercel AI SDK in tech stack (§17)** | Research confirms it's the best-fit LLM library: unified interface, streaming, tool use, OTel, OpenRouter provider support. |
| 3 | **Add `@octokit/graphql` to tech stack** | Required for 4 core features (merge queue enqueue, review thread resolution, stale review detection, auto-merge). |
| 4 | **Clarify MinIO image source** | Docker Hub images deprecated Oct 2025. Use `quay.io/minio/minio` or Chainguard. |
| 5 | **Consider deferring L2 autonomy eval baseline from Phase 1 to Phase 2** | Phase 1 already has 18 requirements. L2 qualification (R-021: historical issue replay, minimum 10 replays) could ship with the eval layer in Phase 2 (R-021 is already listed as P1). The current wording in R-009 says "L2 available with eval baseline" — but the eval layer itself is Phase 2. |
| 6 | **Add picomatch and tree-sitter to tech stack** | Key dependencies for code index and path policy that aren't listed in §17. |

### Things the PRD Got Right (Confirmed by Research)

- **Relational state + audit (not event-sourced)** — research confirms this is the right call
- **Per-phase workflow design with Continue-As-New** — parent-child pattern works better than sequential CAN
- **Candidate branch model** — safer than draft PR; well-supported by GitHub API
- **Phase-separated secrets** — Docker exec -e makes this clean
- **Single worker agent** — research on multi-agent diminishing returns confirms this
- **OpenRouter + pause-on-failure** — `allow_fallbacks: false` maps perfectly
- **Docker-only sandbox for V1** — gVisor gaps (nested Docker, iptables) justify deferring

---

## 16. Open Questions for Planning

### Architecture

1. **Temporal database sharing:** Should Temporal use a separate Postgres instance or a separate database on the same instance? Separate instance is cleaner but adds ops overhead.
2. **Workflow granularity:** The parent-child pattern is recommended — but how many child workflow types? One per PRD step (13) or grouped (intake+clarify, implement+validate, review+PR, track+merge)?
3. **CLI auth storage:** Config file (`~/.config/software-factory/config.toml`)? Keychain? Environment variable? All three with precedence?

### Implementation

4. **Repo map approach:** Build custom tree-sitter indexer or adapt Aider's open-source implementation (Apache 2.0)? Aider's repo map code is well-tested.
5. **Edit format per model:** Should the factory select edit format based on which model is in use, or standardize on search/replace blocks?
6. **Evidence annotation:** Same model that did implementation, or separate model with fresh context? Same model risks self-serving explanations.
7. **Docker socket access pattern:** Worker on host vs. worker in container with mounted socket? Host is simpler and safer for V1.

### Operations

8. **Upgrade strategy:** Auto-migrate on startup or require explicit `factory migrate` command? Auto is simpler for solo users; explicit is safer.
9. **Partition automation:** Should audit partition creation be a Temporal workflow, startup check, or cron? Temporal workflow aligns with existing infra.
10. **CODEOWNERS parser:** Build custom or find existing Node.js library? Must implement gitignore-style matching with last-match-wins semantics.

---

## 17. Detailed Research Index

| File | Size | Sections | Covers |
|------|------|----------|--------|
| `research.md` (prior) | 275 lines | 8 | Temporal event history vs. event-sourced Postgres — settled: CRUD + audit |
| `research-temporal.md` | 1,124 lines | 12 | SDK, workflow patterns, activities, signals/queries, testing, workers, deployment |
| `research-github.md` | 928 lines | 9 | App setup, permissions, JWT, installation tokens, capability scan, PR lifecycle, webhooks, rate limits, Octokit |
| `research-code-index.md` | 844 lines | 12 | tree-sitter, grammars, symbol extraction, dependency graphs, repo maps, incremental indexing, storage |
| `research-docker-sandbox.md` | 881 lines | 11 | dockerode, network isolation, secret injection, caching, security hardening, gVisor, monitoring |
| `research-architecture.md` | 770 lines | 14 | Monorepo, project structure, TypeScript config, ORM, DI, errors, validation, CLI, testing, build |
| `research-llm-integration.md` | 751 lines | 13 | OpenRouter, agent patterns, code generation, evidence, prompts, Vercel AI SDK, cost, observability, self-healing |
| `research-postgres.md` | 1,160 lines | 11 | Schema design, state machine, audit, encryption, migrations, performance, operational patterns |
| `research-deployment-ux.md` | 1,197 lines | 12 | Docker Compose, distribution, CLI UX, OTel, Redis, notifications, SvelteKit, upgrades, documentation |
| **Total** | **~7,930 lines** | | |

All research files include concrete code examples, API references, and external source citations.

---

*Research complete. Ready for `/plan` phase.*
