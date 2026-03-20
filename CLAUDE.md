# Software Factory

An exploratory project to build a secure, modern software factory workflow — similar to BMAD/OpenClaw but with a high level of user control.

## Commands
```bash
# Install dependencies
pnpm install

# Start infrastructure (Postgres, Redis, Temporal, MinIO)
docker compose up -d

# Run database migrations
pnpm --filter @software-factory/db run db:migrate

# Type-check all packages
pnpm run typecheck

# Run tests
pnpm run test

# Start Temporal worker (dev)
pnpm run worker:dev

# Start API server (dev)
pnpm --filter @software-factory/api run dev
```

## Rules
<!-- Auto-discovered from .claude/rules/ — listed here for visibility -->
@.claude/rules/immutable.md
@.claude/rules/conventions.md
@.claude/rules/stack.md

## System

## Decisions
See `docs/decisions.md` — append-only ADR log. Read during planning, not loaded every session.

## Personal Overrides
Create `CLAUDE.local.md` (gitignored) for personal, project-specific preferences.

## Workflow
`/prd` → `/research` → `/plan` → `/milestone` (repeat) → `/complete`

## Escalation Policy
- If you discover a new invariant, add it to `.claude/rules/immutable.md`.
