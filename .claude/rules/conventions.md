---
description: Code style and established patterns.
---
# Conventions

## Code Style
- Immutable patterns, functional style, pure function composition
- Explicit return types on public functions
- Formatter (Biome) handles formatting — don't bikeshed
- `Result<T, E>` (neverthrow) for fallible operations — no thrown exceptions at domain boundaries
- Zod schemas are the **single source of truth** for types — derive via `z.infer<>`, don't hand-write parallel types
- `.strict()` on all Zod object schemas to catch extra fields early

## Testing
- Co-located tests in `__tests__/` directories
- Test file naming: `{module}.test.ts`
- Real databases via Testcontainers (not mocks) for integration tests
- `@temporalio/testing` with time-skipping for workflow tests
- Replay testing (`Worker.runReplayHistory`) for determinism verification

## Data Integrity
- State change + audit entry in a **single database transaction** — never separate operations
- Idempotency keys on all external side effects (GitHub mutations)
- Webhook dedup via `X-GitHub-Delivery` persisted before processing

## Security Boundaries
- `PolicyDecisionService` (in `packages/core`) for ALL read/write/search/command governance decisions
- `TrustedBaseContext` captured at intake — behavioral control files from pinned base SHA only
- Per-phase GitHub token scoping (minimum permissions per phase)
- `run_command` gets post-execution diff validation against policy

## Package Rules
- `packages/core` — pure TypeScript only, NO Node.js APIs, NO config loading
- `packages/temporal-workflows` — V8 isolate, NO Node.js imports, type-only activity imports
- Config loading lives in `packages/api`, `packages/worker`, `packages/cli` — not in core

## Established Patterns
<!-- Add as discovered: **Name**: Description. See `path/to/example`. -->
