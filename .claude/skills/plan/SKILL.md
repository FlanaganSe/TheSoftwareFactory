---
name: plan
description: Generates an implementation plan from PRD and research. Use after research is complete.
disable-model-invocation: true
---
Read:
- `.claude/plans/prd.md` (requirements, may be optional)
- All `.claude/plans/research*.md` files (investigation findings)

Then read the relevant source files to understand current state.

Write to `.claude/plans/plan.md`:

1. **Summary** — One paragraph on the approach
2. **Files to change** — Each file with what changes and why
3. **Files to create** — Each new file with its purpose
4. **Milestone outline** — Ordered list of milestones. Each milestone:
   - `- [ ] M[N]: [name] — [one-line goal]`
   - Must be independently verifiable and committable
   - Should take 1-5 implementation steps
   If more than ~6 milestones, group into named phases (e.g., `## Phase 1: Foundation`).
   Do NOT detail the steps — `/milestone` will do that against actual code state.
5. **Manual setup tasks** — External actions the user must handle that are NOT code (e.g., "Create Clerk project", "Provision Railway services", "Add API keys to .env"). Tag each with which milestone depends on it.
6. **Risks** — What could go wrong
7. **Open questions** — Anything needing human input

Do NOT implement. Write the plan and stop. Wait for human review.

$ARGUMENTS
