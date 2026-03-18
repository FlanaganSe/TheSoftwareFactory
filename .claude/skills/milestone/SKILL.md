---
name: milestone
description: Details and executes the next milestone from the plan. Run once per milestone.
disable-model-invocation: true
---
Read `.claude/plans/plan.md`. Find the next incomplete milestone (first unchecked `- [ ]` in the outline).

If all milestones are checked: "All milestones complete. Run `/complete` to close out."

Otherwise:

## 1. Detail the milestone

Read the source files relevant to this milestone to understand **current** code state.
Read any `.claude/plans/research*.md` files relevant to this milestone's domain.
If uncertain about the approach, use the researcher subagent to investigate before coding.

Add detailed steps under this milestone in the outline:

```
- [ ] M2: Build API endpoints — expose data layer via REST
  - [ ] Step 1 — [desc] → verify: [command]
  - [ ] Step 2 — [desc] → verify: [command]
  Commit: "[type]: [description]"
```

1-5 steps. Ground them in the actual code, not assumptions from planning time.

## 2. Implement

Execute each step. Run its verify command after each step. Check off completed steps.

**If any verification fails: stop, report the failure, and wait for human direction.**
Do not silently retry more than once.

## 3. Verify the milestone

Use the verifier subagent to confirm all checks pass.
**If the verifier reports failures: stop and report. Do not proceed.**

## 4. Commit

Commit with the message specified in the milestone.

## 5. Review

Use the reviewer subagent to review the milestone's changes.
If reviewer finds 🔴 issues: fix them, re-verify, and amend the commit.

## 6. Update and stop

Check off this milestone in the outline (`- [x]`).

Report:
- What was completed
- What's next
- Any **manual tasks** the user needs to do before the next milestone (e.g., "Set up Clerk project and add keys to .env", "Deploy database migration"). Check the plan's manual setup tasks section.

**Stop. The user decides when to run `/milestone` again.**

$ARGUMENTS
