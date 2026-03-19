# Software Factory

A self-hosted control plane that turns GitHub issues into validated pull requests using AI agents — with human approval at every critical step.

> **Status:** Active development. Core infrastructure is built (database, orchestration, sandbox, policy engine). The end-to-end task pipeline is in progress. Not yet usable for production work.

## What It Does

Software Factory sits between your GitHub repo and an LLM. When you assign it a task (via GitHub issue or API), it:

1. **Reads your codebase** — indexes symbols, maps dependencies, understands structure
2. **Plans the work** — generates an implementation plan from repo context
3. **Writes code in a sandbox** — executes in an isolated Docker container with no network access
4. **Validates the result** — runs your tests, linter, and security checks
5. **Shows you the evidence** — assembles a structured report (what changed, blast radius, test results, risks)
6. **Waits for your approval** — only creates a PR after you say so
7. **Tracks the PR through merge** — monitors required checks, CODEOWNERS reviews, merge queue

The key idea: **the AI does the work, but you stay in control.** Every file write is governed by policy. Every mutation is auditable. The agent can't merge, can't skip checks, and can't modify its own rules.

## Who This Is For

- **Solo developers or small teams** who want AI help on real tasks (not just autocomplete) but don't trust black-box automation
- **Teams with compliance requirements** who need audit trails and evidence for every code change
- **Anyone who wants to delegate implementation** to an AI while keeping approval authority over what ships

## Who This Is NOT For

- Teams looking for a chat-based coding assistant (use Cursor, Copilot, etc.)
- Teams that need multi-repo orchestration (single-repo only in V1)
- Anyone who wants fully autonomous AI with no human oversight

## How It's Different

Most AI coding tools either give you autocomplete (low leverage) or full autonomy (low trust). Software Factory is designed for the middle ground:

- **You define policy** — which files the agent can read/write, what commands it can run, what requires approval
- **Evidence before PRs** — you review structured proof of what happened, not just a diff
- **Behavioral control files are tamper-proof** — agent instructions load from the base branch, not the branch the agent is editing
- **Secrets are phase-separated** — install-time credentials are removed before the agent runs
- **Everything is auditable** — append-only audit log, every state transition recorded

## Architecture

```
GitHub Issue
    ↓
┌──────────────────────────────────────────────────┐
│  API Server (Fastify)                            │
│  ↓ webhook / API call                            │
│  Temporal Orchestrator                           │
│  ↓                                               │
│  intake → understand → plan → implement →        │
│  validate → evidence → review → PR → merge       │
│                                                  │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │
│  │ LLM Agent   │  │ Docker   │  │ Policy     │  │
│  │ (OpenRouter)│  │ Sandbox  │  │ Engine     │  │
│  └─────────────┘  └──────────┘  └────────────┘  │
└──────────────────────────────────────────────────┘
    ↓                ↓               ↓
PostgreSQL 16     Redis 7         MinIO (S3)
(state + audit)   (safety/cache)  (artifacts)
```

**7 packages** in a pnpm monorepo:

| Package | Purpose |
|---------|---------|
| `core` | Domain types, policy engine, state machine (pure TS — no Node.js APIs) |
| `db` | PostgreSQL schema, migrations, encrypted storage (Drizzle ORM) |
| `temporal-workflows` | Orchestration logic — 12 phase workflows (runs in V8 isolate) |
| `temporal-activities` | Side effects — GitHub, LLM, Docker, indexing, safety checks |
| `api` | HTTP server, webhook intake, auth (Fastify) |
| `worker` | Temporal worker process |
| `cli` | Command-line interface (planned) |

## Tech Stack

TypeScript (strict) · Node.js 22 · Temporal · PostgreSQL 16 · Redis 7 · Docker · Drizzle ORM · Fastify · Vercel AI SDK · OpenRouter · Octokit · tree-sitter · Zod · neverthrow · Vitest · Biome

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker & Docker Compose

## Getting Started

```bash
# Install dependencies
pnpm install

# Generate secrets (.env from .env.example)
./scripts/generate-secrets.sh

# Start infrastructure (Postgres, Redis, Temporal, MinIO)
docker compose up -d

# Run database migrations
pnpm --filter @software-factory/db run db:migrate

# Verify everything works
pnpm run typecheck
pnpm run test
```

### Running the services

```bash
# Terminal 1: Temporal worker
pnpm run worker:dev

# Terminal 2: API server
pnpm --filter @software-factory/api run dev
```

### Local ports

| Service | Port |
|---------|------|
| API | 3000 |
| PostgreSQL | 5433 |
| Redis | 6380 |
| Temporal | 7233 |
| Temporal UI | 8080 |
| MinIO API | 9000 |
| MinIO Console | 9001 |

## Project Status

### Built
- 22-state task lifecycle with policy-governed transitions
- Temporal orchestration with 12 phase workflows and human-in-the-loop signals
- Docker sandbox with network isolation, resource limits, secret injection
- LLM agent with 7 governance-enforced tools and 5 self-healing guardrails
- Path-level policy engine (read/write/search/index governance)
- GitHub integration (capability scanning, CODEOWNERS, ruleset analysis, rate limiting)
- Code indexing (tree-sitter, 6 languages, symbol extraction, repo mapping)
- PostgreSQL with encrypted secrets, transactional audit, row-level security
- Redis-backed safety primitives (kill switch, cost tracking, branch leases)
- API with webhook signature verification, RBAC, API key management

### In Progress
- Wiring the end-to-end task execution pipeline (intake → implement)
- Phase implementations (understand, plan, setup, implement)

### Planned
- Validation pipeline (tests, lint, security scanning)
- Evidence generation and human review flow
- PR creation, tracking, and merge lifecycle
- CLI interface
- SvelteKit dashboard

## Key Concepts

**Autonomy Levels** — Configurable from L0 (read-only observation) through L2 (constrained execution). Higher levels require qualification gates. The factory never merges without human approval.

**Evidence Packets** — Before any PR is created, the factory assembles structured evidence: annotated diffs, blast radius analysis, test results, security scan results, and impacted CODEOWNERS. You review evidence, not just code.

**Trusted Base Context** — The agent's behavioral rules (CLAUDE.md, AGENTS.md, etc.) are loaded from the base branch at task creation and pinned. If the agent edits these files on its working branch, the edits don't change the agent's behavior — they're just treated as diff content.

**Setup Contracts** — A `.factory/setup.yml` file explicitly declares how to build and test a repo. No silent inference from Dockerfiles. Humans approve the contract before the factory uses it.

## Documentation

- [Product Requirements](docs/prd.md) — Full PRD with requirements, threat model, and design rationale
- [Architecture Decisions](docs/decisions.md) — Append-only ADR log

## License

Open source (license TBD).
