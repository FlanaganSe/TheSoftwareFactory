---
name: verify
description: Triggers verifier subagent to run verification checks. Use after completing a milestone.
disable-model-invocation: true
---
Use the verifier subagent to run verification checks.

Context: $ARGUMENTS

If no arguments, verify the current milestone's checks from `.claude/plans/plan.md`.
