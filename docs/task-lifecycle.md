# Task Lifecycle

A task moves through 11 phases, orchestrated by a parent Temporal workflow that spawns each phase as a child workflow. Human approval gates and feedback loops ensure the user stays in control at every critical step.

## State Machine

```
                          ┌──────────────────┐
                          │     created      │
                          └────────┬─────────┘
                                   │
                     ┌─────────────┼─────────────┐
                     ▼                           ▼
            ┌──────────────────┐        ┌──────────────┐
            │needs_clarification│───────→│   assigned   │
            └──────────────────┘        └──────┬───────┘
                                               │
                                               ▼
                             ┌─────────────────────────────────┐
                             │          in_progress            │◄─┐
                             └───┬──────────┬──────────────────┘  │
                                 │          │                     │
                          ┌──────┘          ▼                     │
                          ▼          ┌──────────────┐             │
                   ┌──────────┐      │   paused     │             │
                   │  failed  │      └──────────────┘             │
                   └──────────┘                                   │
                                                                  │
                             ┌────────────────────────────────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  evidence_ready  │
                    └───┬─────────┬────┘
                        │         │
                        ▼         ▼
           ┌───────────────┐  ┌──────────┐
           │changes_requested│  │ approved │
           └───────┬───────┘  └────┬─────┘
                   │               │
                   │ (back to      ▼
                   │ in_progress) ┌──────────────┐
                   └──────────►   │  pr_created  │
                                  └──────┬───────┘
                                         │
                                         ▼
                              ┌─────────────────────────┐
                              │external_checks_pending   │◄──┐
                              └──┬─────────┬─────────┬──┘   │
                                 │         │         │       │
                                 ▼         ▼         ▼       │
                          ┌──────────┐ ┌────────┐ ┌────────────────────────┐
                          │merge_ready│ │external│ │addressing_review_      │
                          └──┬───┬───┘ │_blocked│ │feedback                │
                             │   │     └───┬────┘ └────────────────────────┘
                             │   │         │              │
                             ▼   ▼         └──────────────┘
                     ┌────────┐ ┌──────┐
                     │ merged │ │failed│
                     └────────┘ └──────┘

            ──── Any non-terminal state can transition to → cancelled ────
```

**16 states · 21 explicit transitions · 1 wildcard (→ cancelled) · 3 terminal states**

## Phase Details

### 1. Intake

**State:** `created` → `assigned`

Validates the task input and establishes the security boundary:
- Loads the **Trusted Base Context** — pins behavioral control files (CLAUDE.md, AGENTS.md, `.factory/` configs) to the base branch SHA
- Downstream phases use this frozen snapshot; the agent cannot tamper with its own instructions
- Records the task assignment in the audit log

### 2. Understand

**State:** `assigned` → `in_progress`

Builds deep understanding of the target repository:
- **tree-sitter indexing** — parses source files in 6 languages (TypeScript, JavaScript, Python, Go, Rust, Java), extracts symbols and dependencies
- **Repo map generation** — PageRank-weighted symbol graph for LLM context selection
- **Capability scanning** — GitHub rulesets, branch protections, CODEOWNERS, required checks, merge queue config
- **Code index versioning** — stored in Postgres for incremental updates

### 3. Plan

**State:** `in_progress` (phase: plan)

Generates an implementation plan:
- LLM receives the objective, repo map, relevant code context, and policy constraints
- Produces a structured plan with file changes, rationale, and risk assessment
- Plan is persisted for evidence and review

### 4. Setup

**State:** `in_progress` (phase: setup)

Prepares the execution environment:
- Reads the `.factory/setup.yml` contract (explicit — no silent inference)
- Provisions a Docker container with the repo cloned
- Installs dependencies per the setup contract
- Injects phase-appropriate secrets (install-time credentials are removed before agent execution)
- Network isolation enforced — the sandbox has no internet access during execution

### 5. Implement

**State:** `in_progress` (phase: implement)

The LLM agent writes code inside the sandbox:
- **7 governance-enforced tools**: read file, write file, edit file, search codebase, run command, list files, search text
- Every file write is checked against the policy engine — denied writes are blocked, protected writes are flagged
- **5 guardrails**: max step limit, no-progress detection, loop-of-doom detection, wall-clock timeout, cost budget check
- All commands and file mutations are recorded for the evidence packet
- The kill switch is checked at every activity entry point

### 6. Validate

**State:** `in_progress` (phase: validate)

Runs validation using configs from the **base branch** (not the agent's working branch):
- **Test runner** — executes the project's test suite
- **Lint runner** — runs linter with base-branch config
- **Security scanner** — checks for common vulnerabilities
- **Validator boundary** — ensures validation configs haven't been tampered with

If validation fails, the task loops back to implement (bounded by `maxImplementationAttempts`).

### 7. Evidence

**State:** `in_progress` → `evidence_ready`

Assembles a structured evidence packet with **13 mandatory fields**:

| Field | Description |
|-------|-------------|
| Objective | The original task objective |
| Annotated diff | Every change with rationale |
| Blast radius | Files and systems affected |
| Owners impacted | CODEOWNERS who need to review |
| Test results | Pass/fail with output |
| Security scan results | Vulnerability scan output |
| Lint results | Clean/violations |
| Protected surface edits | Any edits to governed files |
| Migration impact | Database/schema changes |
| Revertability class | How easily changes can be rolled back |
| Unresolved assumptions | Things the agent wasn't sure about |
| Commands run | Full command log from sandbox |
| Pending external checks | Outstanding checks not yet run |

### 8. Review

**State:** `evidence_ready` → `approved` or `changes_requested`

**This is the primary human gate.** The workflow pauses and waits for a signal:

- **`approve`** — evidence is accepted, proceed to PR creation
- **`reject`** — task fails (terminal)
- **`changes_requested`** — loops back to implement with feedback message
- **`cost_override`** — adjust the budget if needed

The review has a configurable timeout. Separation of duties prevents the task submitter from being the sole approver.

### 9. PR Creation

**State:** `approved` → `pr_created`

Creates the GitHub pull request:
- Pushes the working branch
- Creates PR with structured description (objective, evidence summary, change list)
- Only happens after explicit human approval — never automatically

### 10. PR Tracking

**State:** `pr_created` → `external_checks_pending` → `merge_ready`

Monitors the PR through GitHub's merge requirements:
- **Required checks** — waits for CI to pass (via `check_complete` signals from webhooks)
- **Required reviews** — tracks review approvals and change requests
- **Merge queue** — monitors merge queue status

If a reviewer requests changes, the workflow loops back to implement to address feedback (sets `addressingFeedback = true` to skip re-creating the PR).

### 11. Learn (Post-Merge)

**State:** `merge_ready` → `merged`

After successful merge:
- Records outcome metrics
- Updates code index with the merged changes
- Captures learnings for future tasks

## Signals & Queries

### Signals (External → Workflow)

| Signal | Purpose | Typical Source |
|--------|---------|---------------|
| `kill` | Cancel immediately | User, kill switch |
| `approve` | Accept evidence | Human reviewer |
| `reject` | Reject with reason | Human reviewer |
| `changes_requested` | Request rework | Human reviewer |
| `resume` | Unpause | User |
| `clarify_response` | Answer clarification | User |
| `cost_override` | Adjust budget | User |
| `pr_review` | PR review event | GitHub webhook |
| `check_complete` | CI check finished | GitHub webhook |
| `merge_queue_update` | Queue status change | GitHub webhook |
| `pr_closed` | PR closed/merged | GitHub webhook |

### Queries (External → Workflow, Read-Only)

| Query | Returns |
|-------|---------|
| `getState` | Current `TaskState` |
| `getProgress` | Full progress (phase, attempt, cost, timestamps) |
| `getPhase` | Current phase name |

## Feedback Loops

The system has two bounded feedback loops:

**Internal loop (validation failure):**
```
implement → validate → [fail] → implement (retry)
```

**External loop (PR review feedback):**
```
pr_tracking → [changes_requested] → implement → validate → evidence → review → pr_creation → pr_tracking
```

Both loops are bounded by `maxImplementationAttempts` to prevent infinite cycling.

## Safety Controls

Active throughout the lifecycle:

- **Kill switch** — Redis-backed, checked at every activity entry. Immediately cancels the workflow
- **Cost budgets** — per-task limits tracked in Redis. Overridable via signal
- **Circuit breakers** — automatic halt after repeated failures (e.g., GitHub API errors)
- **Branch leases** — prevent concurrent work on the same branch by multiple tasks
- **Credential rotation** — tokens scoped per phase with 50-minute rotation
