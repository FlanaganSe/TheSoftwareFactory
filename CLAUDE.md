# Software Factory

An exploratory project to build a secure, modern software factory workflow — similar to BMAD/OpenClaw but with a high level of user control.

## Commands
```bash
# TBD — stack not yet chosen
# Commands will be defined once technology decisions are made
```

## Rules
<!-- Auto-discovered from .claude/rules/ — listed here for visibility -->
@.claude/rules/immutable.md
@.claude/rules/conventions.md
@.claude/rules/stack.md

## System
<!-- Uncomment when SYSTEM.md has real content: -->
<!-- @docs/SYSTEM.md -->

## Decisions
See `docs/decisions.md` — append-only ADR log. Read during planning, not loaded every session.

## Personal Overrides
Create `CLAUDE.local.md` (gitignored) for personal, project-specific preferences.

## Workflow
`/prd` → `/research` → `/plan` → `/milestone` (repeat) → `/complete`

## Escalation Policy
- If you discover a new invariant, add it to `.claude/rules/immutable.md`.
