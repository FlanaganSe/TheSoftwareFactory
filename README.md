# Software Factory

A self-hosted control plane that turns GitHub issues into validated pull requests using AI agents — with human approval at every critical step.

> **Status:** Active development. The full 11-phase pipeline is implemented and tested end-to-end. Not yet used in production.

## What It Does

Software Factory sits between your GitHub repo and an LLM. When you assign it a task (via GitHub issue or API), it:

1. **Reads your codebase** — indexes symbols with tree-sitter, maps dependencies, scans GitHub capabilities (rulesets, CODEOWNERS, branch protections)
2. **Plans the work** — generates an implementation plan grounded in repo context
3. **Writes code in a sandbox** — executes in an isolated Docker container with no network access
4. **Validates the result** — runs your tests, linter, and security checks using configs from the *base branch* (tamper-proof)
5. **Shows you the evidence** — assembles a structured 13-field report (annotated diffs, blast radius, test results, security findings, owners impacted)
6. **Waits for your approval** — only creates a PR after you explicitly approve
7. **Tracks the PR through merge** — monitors required checks, reviews, merge queue, and addresses feedback automatically

The key idea: **the AI does the work, but you stay in control.** Every file access is governed by policy. Every mutation is auditable. The agent can't merge, can't skip checks, and can't modify its own rules.

## Who This Is For

- **Solo developers or small teams** who want AI help on real tasks (not just autocomplete) but don't trust black-box automation
- **Teams with compliance requirements** who need audit trails and structured evidence for every code change
- **Anyone who wants to delegate implementation** to an AI while keeping approval authority over what ships

## Why This Exists

Most AI coding tools either give you autocomplete (low leverage) or full autonomy (low trust). Software Factory targets the middle ground:

| Gap | What Software Factory Does |
|-----|---------------------------|
| **Customer-owned state** | All orchestration state, audit logs, and policy config live in *your* Postgres — not a vendor's cloud |
| **Model portability** | Uses OpenRouter — swap models without changing anything else |
| **Path-level governance** | Read/write/index policies per file path, enforced at every layer including code indexing |
| **Evaluator integrity** | Validation configs load from the base branch, not the agent's working branch — no self-tampering |
| **Structured evidence** | You review a 13-field evidence packet, not just a diff |
| **Append-only audit** | Every state transition, side effect, and cost is recorded with RLS-protected immutability |

## Architecture

```
GitHub Issue / API Call
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  API Server (Fastify)              Dashboard (SvelteKit)    │
│       │                                  │                  │
│       ▼                                  │                  │
│  Temporal Orchestrator ◄─── signals ─────┘                  │
│       │                                                     │
│       ├─→ intake ──→ understand ──→ plan ──→ setup          │
│       │                                                     │
│       ├─→ implement ──→ validate ──→ evidence ──→ review    │
│       │       ▲              │                     │        │
│       │       └── feedback ──┘                     │        │
│       │                                            │        │
│       └─→ pr-creation ──→ pr-tracking ──→ merge    │        │
│                ▲                                   │        │
│                └──────── changes requested ─────────┘        │
│                                                             │
│  ┌─────────────┐   ┌──────────┐   ┌──────────────────────┐ │
│  │ LLM Agent   │   │ Docker   │   │ Policy Engine        │ │
│  │ (OpenRouter) │   │ Sandbox  │   │ (path-level govnce) │ │
│  └─────────────┘   └──────────┘   └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                  │                  │
    PostgreSQL 16       Redis 7           MinIO (S3)
   (state + audit)    (safety/pubsub)    (artifacts)
```

See [Architecture Guide](docs/architecture.md) for the full breakdown.

## Packages

| Package | Purpose | Key Constraint |
|---------|---------|----------------|
| `core` | Domain types, policy engine, state machine | Pure TS — no Node.js APIs (V8 isolate safe) |
| `db` | Schema, migrations, encrypted storage | Drizzle ORM, 18 tables, RLS-protected audit |
| `temporal-workflows` | 11 pipeline phases + orchestrator | V8 isolate — no Node.js imports |
| `temporal-activities` | Side effects: GitHub, LLM, Docker, indexing, safety | 8 domain modules, ~12K lines |
| `api` | HTTP server, webhooks, auth, SSE | Fastify + Zod validation, RBAC |
| `worker` | Temporal worker process | Wires all activities with DI |
| `cli` | Terminal interface | Commander.js + Ink, 11 commands |
| `e2e` | End-to-end workflow tests | Temporal test environment, time-skipping |

Plus `apps/dashboard` — a SvelteKit app for visual task management.

## Tech Stack

TypeScript (strict) · Node.js 22 · pnpm workspaces · Temporal · PostgreSQL 16 · Redis 7 · Docker · Drizzle ORM · Fastify · Vercel AI SDK · OpenRouter · Octokit · tree-sitter · Zod · neverthrow · Vitest · Biome · SvelteKit

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker & Docker Compose

### Setup

```bash
# Clone and install
git clone <repo-url> && cd software-factory
pnpm install

# Generate local secrets
./scripts/generate-secrets.sh

# Start infrastructure
docker compose up -d

# Run database migrations
pnpm --filter @software-factory/db run db:migrate

# Verify
pnpm run typecheck
pnpm run test
```

### Run the Services

```bash
# Terminal 1: Temporal worker
pnpm run worker:dev

# Terminal 2: API server
pnpm --filter @software-factory/api run dev

# Terminal 3: Dashboard (optional)
cd apps/dashboard && pnpm dev
```

### Local Ports

| Service | Port |
|---------|------|
| API Server | 3000 |
| Dashboard | 5173 |
| PostgreSQL | 5433 |
| Redis | 6380 |
| Temporal gRPC | 7233 |
| Temporal UI | 8080 |
| MinIO API | 9000 |
| MinIO Console | 9001 |

## Using Software Factory

### 1. Register a Repository

```bash
POST /api/github/setup
{
  "owner": "your-org",
  "repo": "your-repo",
  "installationId": 12345
}
```

### 2. Submit a Task

```bash
POST /api/tasks
{
  "objective": "Add input validation to the user registration endpoint",
  "repoId": "<repo-uuid>",
  "createdBy": "you"
}
```

### 3. Monitor Progress

- **Dashboard:** `http://localhost:5173/tasks/<id>`
- **API:** `GET /api/tasks/<id>`
- **SSE:** `GET /api/events?token=<api-key>` for real-time updates
- **CLI:** `factory status <id>`
- **Temporal UI:** `http://localhost:8080` for workflow internals

### 4. Review Evidence & Approve

When the pipeline reaches `evidence_ready`, review the structured evidence packet (annotated diffs, blast radius, test results, security findings). Then:

```bash
# Via API
POST /api/tasks/<id>/approve   { "actor": "you" }

# Via CLI
factory approve <id>

# Via Dashboard
Click "Approve" on the evidence review page
```

### 5. PR Creation & Merge

After approval, Software Factory creates the PR, monitors required checks and reviews, and addresses feedback automatically. It never merges without all GitHub-required approvals passing.

## CLI Commands

| Command | Description |
|---------|-------------|
| `factory status <id>` | Show task state and progress |
| `factory evidence <id>` | Display the evidence packet |
| `factory approve <id>` | Approve evidence → trigger PR creation |
| `factory reject <id>` | Reject with reason → send back for rework |
| `factory changes <id>` | Request specific changes |
| `factory review <id>` | Interactive review flow |
| `factory kill [id]` | Kill a task (or all tasks globally) |
| `factory budget <id>` | View/update cost budget |
| `factory safety` | View safety dashboard (kill switch, circuits, budgets) |
| `factory health` | Check infrastructure health |
| `factory config` | View/edit configuration |

## Configuration

TOML-based with 5-tier precedence:

```
CLI flags > Environment variables > Project config > User config > Defaults
```

Config files follow XDG conventions:
- **User:** `~/.config/software-factory/config.toml`
- **Project:** `.factory/config.toml`

## Safety & Security

- **Kill switch** — instantly halt all agent work (Redis-backed, checked at every activity boundary)
- **Cost budgets** — per-task spending limits with override signals
- **Circuit breakers** — automatic halt on repeated failures
- **Branch leases** — prevent concurrent work on the same branch
- **Credential rotation** — 50-minute phase-separated token scoping
- **Append-only audit** — RLS-enforced immutability with SHA-256 content hashes
- **Trusted base context** — behavioral files pinned to base SHA at intake

See [Security Model](docs/security.md) for the full threat model and controls.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Guide](docs/architecture.md) | Package structure, data flow, infrastructure |
| [Task Lifecycle](docs/task-lifecycle.md) | The 11-phase pipeline in detail |
| [Security Model](docs/security.md) | Threat model, controls, and trust boundaries |
| [Product Requirements](docs/prd.md) | Full PRD with requirements and design rationale |
| [Architecture Decisions](docs/decisions.md) | Append-only ADR log |

## Development

```bash
pnpm run typecheck          # Type-check all packages
pnpm run test               # Run unit + integration tests
pnpm run test:e2e           # Run end-to-end workflow tests
pnpm run lint               # Lint with Biome
pnpm run lint:fix           # Auto-fix lint issues
```

Tests use real databases via Testcontainers (Postgres, Redis) and Temporal's time-skipping test environment. No mocks for infrastructure.

## License

Open source (license TBD).
