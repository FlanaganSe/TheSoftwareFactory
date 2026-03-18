# Software Factory Control Plane — Product Requirements Document

**Version:** 5.1
**Date:** 2026-03-18
**Status:** Revised draft — incorporating platform mechanics review and architectural criticism
**License:** Open source (with option to evolve later)

---

## 1. Context

### 1.1 The Opportunity

By March 2026, AI-assisted software engineering is converging on a recognizable pattern: sandboxed execution, PR creation, GitHub-native review, and recurring automation. GitHub Copilot coding agent, OpenAI Codex, and Devin already cover significant ground:

- **GitHub Copilot coding agent** runs on self-hosted ARC runners, has enterprise AI Controls with agent-session visibility and agentic audit events (GA Feb 2026), maintains automatic repository indexing and persistent Memory, and blocks the task assigner from approving the resulting PR.
- **OpenAI Codex** supports local, cloud, or hybrid modes with graduated approval policies, role-based access, and compliance exports including prompt text and responses. Phase-separated secrets (available during setup, removed before agent execution).
- **Devin** separates repository indexing from repo setup, has an 8-step environment configuration flow, and powers code understanding through indexing rather than stateless prompting.

The opportunity is **not** "no one else does this." It is narrower and more durable:

> **A self-hosted, governance-first control plane** where the customer owns the control-plane state, audit trail, and policy configuration — with model/backend portability, path-level data governance, and brownfield execution quality that platform vendors do not prioritize.

The durable whitespace:

| Gap | Why It Persists |
|-----|-----------------|
| **Customer-owned control-plane state** | GitHub/Codex keep orchestration state in their cloud. Policy, audit, and workflow state are not portable. |
| **Model/backend portability** | Competitors optimize for their own models. Open-source coding models now reach 70%+ SWE-bench on single GPUs. Self-hosted inference is viable. |
| **Path-level data governance** | GitHub's coding agent does not honor Copilot content exclusions. No competitor offers end-to-end path-based read/write/edit policies — including at index time. |
| **Portable, structured audit** | Codex compliance exports exist but are vendor-locked. No exportable, customer-owned audit trail. |
| **Brownfield execution quality** | All competitors struggle with repos requiring complex setup. |
| **Evaluator integrity** | No competitor has first-class protections against agents tampering with tests/CI to pass validation. |

**Strategic note:** By 2027, runner control, basic audit surfaces, and repo understanding will become table stakes. If we build around "we orchestrate models," the wedge compresses. If we build around **customer-owned policy/audit state + path-level data governance (including index-time) + brownfield execution correctness + evaluator integrity**, the wedge is durable.

**On commoditization:** GitHub enterprise admins can now see agent sessions and agentic audit-log activity. "We have visibility and logs" is no longer a sufficient moat by itself. The durable moat is customer-owned state, policy portability, and governance depth that platform vendors will not prioritize because it conflicts with their lock-in incentives.

### 1.2 Why Now

1. **Autonomous task capability is growing rapidly.** METR's time-horizon metric shows AI systems matching human performance on increasingly complex tasks. The infrastructure to manage even current-capability autonomous work does not exist as a self-hosted product.

2. **The trust and orchestration gap is real.** Faros AI's 2025 telemetry report (10,000+ developers, 1,255 teams) found teams with high AI adoption experienced 91% more code review time, 9% more bugs, and 154% PR size growth. DORA 2025 separately characterized AI as an "amplifier of organizational strengths and weaknesses." METR's March 2026 maintainer study found maintainer merge decisions run approximately 24 percentage points lower than automated SWE-bench scores. The problem is not model capability — it is orchestration, evidence, and human-AI coordination.

**On regulation:** An internal engineering control plane is not automatically a high-risk AI system under the EU AI Act. This product provides **compliance-ready evidence and oversight infrastructure** that positions teams well if their deployment context falls under regulation, or if they simply want governance-grade auditability.

### 1.3 Target Users

| User | Primary Need |
|------|-------------|
| **Builder / factory owner** | Define workflows, set policy, understand failures, keep system maintainable |
| **Tech lead / sponsor** | Delegate work safely, approve/reject/redirect with clear evidence |
| **Engineer** | Leverage on real tasks, bounded automation, repo-aware context |
| **Reviewer / security** | Auditability, proof of checks, change rationale |

**Initial target:** Solo technical builders and small teams with strong control requirements, working in existing GitHub repositories. Multi-tenant enterprise deployment is later.

### 1.4 What Success Looks Like

A system that accepts a GitHub issue, understands the repo's codebase and execution environment, produces validated code on a candidate branch with tests and security scans, presents a structured evidence packet for human review, and on approval creates a PR — then tracks the PR through GitHub's native review mechanics (required checks, CODEOWNERS, merge queue) to merge, distinguishing clearly between internal validation and external merge readiness — then repeats with the human checking a review inbox rather than babysitting a terminal.

---

## 2. Problem

### 2.1 Core Problem

Current agentic coding systems break down when teams try to use them as a repeatable software factory:

- They produce PRs but don't model the full lifecycle — internal validation vs. GitHub merge readiness are conflated
- They treat "open draft PR" as a safe staging point, but in many repos draft PRs trigger CI workflows, secrets access, and compliance checks
- They blur read/propose/mutate/release authority into coarse categories
- They don't deeply understand the codebase (no persistent indexing)
- They don't understand the repo's execution contract — and rely on fragile inference rather than explicit setup contracts
- They treat instruction files (AGENTS.md, CLAUDE.md, MCP config) as trusted context, not as behavior-shaping policy surfaces that can be weaponized
- They make review harder instead of easier — no structured evidence, no uncertainty flags
- They have no protections against agents tampering with tests/CI to pass validation
- They are hosted SaaS with no customer-owned control-plane state
- Their data governance is runtime-only — excluded content still leaks into indexes and summaries
- They have no secret lifecycle management — no distinction between setup-phase and runtime secrets

### 2.2 Builder-Side Problem

Someone building a factory faces a systems problem, not a prompting problem:

- How to coordinate tasks without building dead scaffolding
- How to preserve user control while providing leverage
- How to isolate untrusted execution with proper credential rotation and secret lifecycle
- How to onboard existing repos through explicit setup contracts, not fragile inference
- How to model the actual GitHub review lifecycle and ruleset mechanics, not a simplified version
- How to prevent agents from gaming their own evaluations
- How to enforce data governance end-to-end — not just at runtime, but at index time
- How to treat instruction and configuration files as the policy surfaces they are

### 2.3 User-Side Problem

Someone using a factory faces a trust problem:

- They do not know what the system actually did
- They cannot give nuanced feedback (request-changes, inline comments) — only approve/reject
- They cannot interrupt or redirect cleanly
- They cannot control which files/paths the agent can read or modify
- They fear being trapped in a system they cannot later remove

---

## 3. Vision & Principles

### 3.1 Product Thesis

> The winning product is not "an AI that can code anything."
> The winning product is "a legible, governable production system for engineering work" that is visibly safer and more legible than existing agents — with customer-owned state and durable portability.

### 3.2 Vision

A self-hostable software-factory control plane that orchestrates humans and AI agents through real engineering workflows — deeply understanding codebases, reliably setting up execution environments, providing structured evidence for review, enforcing graduated authority boundaries with path-level precision, and producing portable, auditable outcomes.

### 3.3 What the Product Is

- A control plane for AI-assisted engineering execution
- A policy engine for agent permissions with path-level granularity
- A code understanding layer (indexing, symbol search, repo maps) with governance-aware filtering
- A GitHub-native workflow integration (not a GitHub replacement)
- A credential broker and execution environment manager with secret lifecycle
- A runtime for bounded, observable work with structured evidence

### 3.4 What the Product Is Not

- A single super-agent or code generation tool
- An IDE or code editor
- A CI/CD replacement (it orchestrates existing CI/CD)
- A general-purpose agent framework or plugin platform
- A closed system that traps repos and knowledge
- A hosted SaaS (self-hostable is required)
- A full compliance solution (it provides compliance-ready infrastructure)
- A competitor to GitHub/Codex on their home turf (it is a governance/portability layer)

### 3.5 Design Principles

1. **User retains control over all automation** — no unapproved authority escalation
2. **Security-first design** — credential isolation, sandbox boundaries, least-privilege tokens
3. **Transparency over magic** — explicit state + explainable evidence
4. **Policy over implicit trust** — explicit rules with path-level precision
5. **Portability over lock-in** — consume standard files, export everything, customer-owned state
6. **Bounded autonomy** — qualified, not unconditional
7. **Thin orchestration** — factory logic in code, not prompts
8. **Evidence before approval** — humans never review without structured context
9. **Evaluator integrity** — the agent must not be able to tamper with its own evaluation criteria
10. **GitHub-native by default** — model actual repo mechanics, don't abstract them away
11. **Start minimal, earn complexity** — single agent before multi-agent, narrow repo class before broad support
12. **Explicit over inferred** — explicit setup contracts over inference from arbitrary config files

---

## 4. Repo Support Classes

A critical lesson from analyzing real brownfield repos: not all repositories are equally supportable. Rather than implying universal support and discovering blockers at runtime, we define explicit support classes and scope V1 to what we can do well.

### 4.1 Class Definitions

| Class | Characteristics | Support Level |
|-------|----------------|---------------|
| **Class A** | Single repo, no submodules, no cross-repo dependencies, simple LFS (if any), standard devcontainer or Dockerfile or explicit setup contract, no nested Docker builds, no signed-commit requirement without bypass actor, public or private registry with standard auth | **V1 — full support** |
| **Class B** | Git submodules, private registries with custom auth, complex devcontainer configs (compose, multiple services, lifecycle scripts), signed commits with bypass actor, sparse/partial clones | **V1.x — partial support, explicit gaps documented** |
| **Class C** | Monorepo with workspace isolation, cross-repo permissions, nested Docker builds, air-gapped environments, multi-stage devcontainer with host-side scripts | **V2+ — requires topology subsystem** |

### 4.2 How Classes Are Used

The **repo capability scan** determines which class a repository falls into during onboarding. If a repo falls outside class A, the system clearly reports what is unsupported and why, rather than silently failing later.

This is not a permanent limitation — it is a scoping tool. Each phase expands what classes are supported.

### 4.3 What Class A Includes (Change from v4)

- **Simple LFS**: Repos using Git LFS with standard hosting. `actions/checkout` supports `lfs: true` natively. Simple LFS is a Git mechanic, not a topology problem.

### 4.4 What Class A Excludes (Explicit)

- Git submodules (embedded repos with their own URLs and histories — topology and auth complexity)
- Sparse/partial clones (lazy blob fetching during checkout/merge)
- Cross-repo dependencies via devcontainer `repositories` field
- Host-side `initializeCommand` (runs on host, not in container)
- Nested Docker-in-Docker (requires tmpfs, disabled iptables, host networking, broad capabilities under gVisor)
- Signed-commit repos without a validated bypass path for the factory's GitHub App
- Private registries with non-standard auth (OAuth, custom tokens, internal PKI)

---

## 5. Architecture

### 5.1 System Overview

```
┌─────────────────────────────────────────────────────┐
│  INTERFACE: CLI (V1), Dashboard (V1.x)              │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│  CONTROL PLANE                                       │
│  Orchestrator (Temporal) · Policy Engine ·            │
│  Credential Broker · GitHub Integration ·             │
│  Audit Writer · Cost Tracker                         │
└──────┬───────────────┬──────────────────┬───────────┘
       │               │                  │
┌──────▼──────┐ ┌──────▼──────┐ ┌────────▼──────────┐
│ CODE INDEX  │ │ EXECUTION   │ │ VALIDATION        │
│ Symbols,    │ │ Sandbox,    │ │ Tests, lint,       │
│ repo map,   │ │ env setup,  │ │ security scan,     │
│ governance- │ │ agent       │ │ protected-file     │
│ filtered    │ │ runtime     │ │ enforcement,       │
│             │ │             │ │ evidence assembly  │
└─────────────┘ └─────────────┘ └────────────────────┘
```

### 5.2 Data Infrastructure

**Postgres is the source of truth for application state. Temporal is the orchestration engine.**

The data architecture has three distinct concerns:

| Concern | Where It Lives | Why |
|---------|---------------|-----|
| **Application state** | Postgres relational tables | Tasks, reviews, policies, environments, code index metadata. Queryable, joinable, dashboardable. |
| **Audit trail** | Postgres append-only tables + periodic export to object storage | Immutable record of who/what/when/why. Content hashes for tamper detection. Long retention. |
| **Orchestration history** | Temporal | Workflow execution events, activity scheduling, retry state, signals. Temporal handles durability, replay, and debugging for workflow state. |
| **Artifacts** | Object storage (MinIO/R2) | Evidence bundles, diffs, scan results, audit exports. |

**What this is NOT:** A full event-sourced system. Event sourcing (deriving current state from replayed events) adds correctness burden, replay burden, and migration burden before it pays for itself. Temporal already provides durable workflow history and deterministic replay for orchestration. Postgres provides queryable relational state for everything else. The append-only audit log provides the compliance and forensic surface. These three together cover the same ground without the complexity of a custom event-sourcing layer.

Redis provides real-time pub/sub for the dashboard and kill switch.

Temporal workflow design constraint: **51,200 events or 50 MB per workflow execution** (non-configurable on Temporal Cloud). Workflows must be designed per-phase (intake, implement, validate, review) with Continue-As-New handoff semantics from day one.

### 5.3 Core Data Model

| Entity | Purpose |
|--------|---------|
| `Task` | Objective, scope, constraints, budget, lifecycle state |
| `EvidenceBundle` | Tests, diffs, scan results, unresolved assumptions, protected-file edits, blast radius, revertability class |
| `ReviewState` | Dual-boundary lifecycle: internal evidence readiness (factory) + external merge readiness (GitHub). Tracks factory validation, GitHub-required checks, CODEOWNERS satisfaction, stale reviews, unresolved threads, merge queue status. |
| `AuditEntry` | Structured metadata in append-only store. Who/what/when/why. |
| `CredentialLease` | GitHub App token with scope, expiry, rotation schedule |
| `SecretBinding` | Secret class (setup-only, runtime, per-tool), lifecycle, source |
| `EnvironmentState` | Repo execution environment: image refs, setup contract, health, cache validity |
| `CodeIndex` | Symbol table, repo map, dependency graph — governance-filtered |
| `PolicyConfig` | Path policies, protected file classes, behavioral control file protections, autonomy level per repo |

### 5.4 Agent Topology

**Default: single worker + deterministic validator bundle.** Multi-agent decomposition introduced only when evals show a stable bottleneck.

Rationale: Agentless demonstrated that a simple two-phase approach outperformed contemporary multi-agent systems on SWE-bench Lite at far lower cost. The Google DeepMind scaling study found a ~45% accuracy threshold — once a single agent exceeds ~45%, adding more agents yields diminishing or negative returns.

| Role | When Introduced |
|------|-----------------|
| **Worker** | Phase 1 (always present) |
| **Validator bundle** | Phase 1 (deterministic: tests, lint, type-check, security scan) |
| **Coordinator** | Phase 4 (only if evals justify) |

---

## 6. Core Workflow

### 6.1 The Candidate Branch Model

**The safe boundary is "candidate branch + internal validation + evidence," not "draft PR."**

In many GitHub repos, opening even a draft PR triggers `pull_request` workflows on `opened`/`synchronize`/`reopened` by default. Organization/enterprise ruleset workflows can ignore `branches`, `paths`, and `types` filters entirely. Opening a draft PR therefore starts CI spend, secrets access, and compliance checks — before the factory has finished validating its own work.

The factory's workflow:

```
1. INTAKE       → Accept objective (issue, directive)
2. CLARIFY      → If ambiguous: ask human, block until answered
3. UNDERSTAND   → Query code index, build relevant context
4. PLAN         → Worker produces execution plan
5. SETUP        → Verify/restore execution environment via setup contract
6. IMPLEMENT    → Worker executes plan in sandbox, commits to candidate branch
7. VALIDATE     → Deterministic validator bundle runs (tests, lint, security scan)
8. EVIDENCE     → Assemble EvidenceBundle
9. PRESENT      → Present evidence to human via CLI/dashboard
                   ─── INTERNAL EVIDENCE BOUNDARY ───
                   (factory says: "this is worth opening as a PR")
10. CREATE PR   → On human approval, create PR (draft or ready, configurable)
                   ─── EXTERNAL MERGE READINESS BOUNDARY ───
                   (GitHub decides: required checks, reviews, merge queue)
11. TRACK PR    → Monitor GitHub-required checks, CODEOWNERS reviews,
                   review threads, stale approvals, merge queue status
11a. PR FEEDBACK → On submitted review (request-changes or comment) or explicit
                   operator command: re-enter IMPLEMENT → VALIDATE → EVIDENCE
                   on the same PR branch. Do NOT react to individual inline
                   comments as they appear — wait for a submitted review batch.
12. MERGE       → Via repo's configured merge path (queue, auto-merge, manual)
13. LEARN       → Store outcome, update metrics, update code index
```

Steps 1–9 happen entirely within the factory's control plane. No GitHub side effects until the human approves. This is the core safety boundary.

**Post-PR review feedback (step 11a):** After PR creation, GitHub reviewers may request changes via `pull_request_review` (submitted review) or an operator may explicitly trigger "address review feedback" via CLI/dashboard. The factory re-enters the implement → validate → evidence loop on the same PR branch, producing an updated evidence bundle. The factory does NOT react to every individual `pull_request_review_comment` as it appears — it waits for a submitted review or explicit command. This gives batching, clearer audit, and lower cost. Only authorized human reviewers (CODEOWNERS, operators) can trigger a feedback iteration.

**The two-boundary model:** Internal evidence readiness (step 9) and external merge readiness (step 11–12) are explicitly separate product concepts. Internal evidence is great for deciding "is this worth opening as a PR?" It is not the same as "this is ready to merge." The reviewer sees a delta view: factory validations passed, GitHub-required checks still pending, merge queue result pending, stale reviews detected, etc.

**Configurable override:** For repos where draft PRs are known-safe (no expensive workflows on `opened`), the factory can be configured to create the draft PR at step 7 instead. But the default is the safer path.

### 6.2 The Review Loop

The review loop is the primary human-agent coordination surface. Binary approve/reject is insufficient.

```
          ┌──────────────┐
          │  Evidence     │
          │  presented    │
          └──────┬───────┘
                 │
          ┌──────▼───────┐
          │  Human        │◄────────────────┐
          │  decides      │                  │
          └──────┬───────┘                  │
                 │                          │
    ┌────────────┼────────────┐             │
    │            │            │             │
┌───▼────┐ ┌────▼─────┐ ┌───▼─────┐       │
│Approve │ │ Request  │ │ Reject  │       │
│→ PR    │ │ changes  │ │         │       │
└───┬────┘ └────┬─────┘ └─────────┘       │
    │           │                          │
    │    ┌──────▼───────┐                  │
    │    │ Agent        │                  │
    │    │ addresses    ├──────────────────┘
    │    │ feedback     │  (re-validate, update evidence)
    │    └──────────────┘
    │
┌───▼──────────┐
│ GitHub PR    │
│ (CODEOWNERS, │
│  Actions)    │
└──────┬───────┘
       │
┌──────▼───────────┐
│ PR Tracking      │
│ (checks, reviews,│
│  merge queue)    │
└──────┬───────────┘
       │
┌──────▼───────┐
│ Merge path   │
└──────────────┘
```

### 6.3 GitHub-Native Integration

The product must model actual GitHub mechanics accurately. The current platform surface is significantly more complex than branch protection + required checks.

**Repo Capability Scan (Onboarding):**

The scan determines repo support class and detects:

| Mechanic | What We Detect |
|----------|---------------|
| Branch rulesets | Full ruleset surface including required workflows, deployments, code scanning, reviewer team requirements, file-pattern reviewers |
| Push rulesets | File-path restrictions, path length limits, file size limits, extension restrictions. Factory must respect these before attempting pushes. |
| Bypass actors | Whether the factory's GitHub App can be configured as a bypass actor |
| Required status checks | Check sources, required app bindings, recent completion history (checks must have completed successfully in the last 7 days to be selectable) |
| Commit message patterns | Required commit message format rules from rulesets. Agent commits must comply. |
| CODEOWNERS | Path → owner mappings, required reviewer classes |
| Merge queue | Configuration, `merge_group` trigger requirements |
| Signed commits | Whether required, available bypass paths. **V1: repos requiring signed commits without bypass actor are marked unsupported.** |
| OIDC trust policies | Whether deployment environments use OIDC claims tied to specific workflow refs (factory-initiated runs will not carry these claims — surfaced as a warning) |
| Org/enterprise rulesets | Query with `includes_parents=true` to see inherited rulesets, not just repo-level |
| Repo class blockers | Submodules, complex LFS configs, sparse clone config, cross-repo devcontainer repos |

**Required-Check Bootstrap:** When the factory is first installed on a repo, its GitHub App must submit a check run before that check can be selected as required. The scan guides users through this bootstrap.

**GitHub Reconciliation:**

Reviewability can change after the factory's internal state was last updated:
- Approvals go stale when the merge base changes
- A repo may require approval from someone other than the last pusher
- Another PR pointing at the same head commit may have pending/rejected reviews
- Review dismissal rules may invalidate approvals

The factory uses webhook ingestion plus periodic reconciliation reads to keep `ReviewState` accurate. It does **not** rely solely on locally projected state.

**PR Lifecycle (with dual-boundary tracking):**

| Mechanic | How the Factory Handles It |
|----------|---------------------------|
| **Candidate branch** | Default: all work happens on a candidate branch. No PR until human approves evidence. |
| **PR creation** | On approval, create PR. Draft or ready-for-review is configurable. |
| **Internal → external delta** | After PR creation, track which GitHub-required checks are pending vs. the factory's internal validations that already passed. Surface this delta to the reviewer. |
| **CODEOWNERS** | Factory knows which paths trigger which owners. Not requested until PR is created. |
| **Required checks** | Factory's GitHub App is bound as expected source for status checks. Guides bootstrap if needed. |
| **Merge queue** | Factory hands off to merge queue after approval. Monitors `merge_group` events. Handles rejection/re-queue (max 3 attempts). |
| **Stale reviews** | Factory detects when merge base changes invalidate reviews. Re-requests review when needed. |
| **Review threads** | Factory tracks unresolved conversation count. All threads must be resolved before merge. |
| **Review dismissal** | Factory detects dismissed reviews and re-routes as needed. |

### 6.4 Concurrency Model

| Rule | Enforcement |
|------|-------------|
| **One active mutator per branch** | Branch lease with TTL. Second task targets a new branch. |
| **Freshness check before PR** | Before creating PR, verify candidate branch is up-to-date with base. Rebase if needed, re-validate. |
| **Human push detection** | If a human pushes to an agent's branch, factory pauses and notifies. |
| **Post-rebase revalidation** | After any rebase, full validator bundle re-runs. |

---

## 7. Setup & Environment

### 7.1 The Setup Contract

The market has converged on explicit setup contracts. No major AI coding platform (GitHub Copilot, OpenAI Codex, Devin, Claude Code) parses devcontainer.json as its primary environment setup mechanism. All have invented explicit, imperative setup contracts.

The factory follows this pattern:

**Canonical path:** An explicit factory setup file (`.factory/setup.yml`) that declares how to prepare the execution environment. This file is version-controlled, auditable, and portable.

```yaml
# .factory/setup.yml
image: node:22-slim            # or a prebuilt image ref
setup:                          # runs once when building environment
  - npm ci
  - npx playwright install
maintenance:                    # runs when resuming from cache
  - npm ci                      # fast with warm cache
secrets:
  setup_only:                   # available during setup, removed before agent
    - NPM_TOKEN
  runtime:                      # available during agent execution
    - DATABASE_URL
  per_tool:                     # scoped to specific MCP tools
    - name: GITHUB_TOKEN
      tools: [gh]
health_check:                   # must pass before agent starts
  - npm run typecheck
  - npm test -- --bail
```

**Import sources:** When no `.factory/setup.yml` exists, the factory can generate one from:
- `devcontainer.json` (single-container only, no compose)
- `Dockerfile`
- GitHub Actions workflow files
- Repo documentation

The generated contract is presented to the human for review and approval before being used. The factory never silently infers and executes an environment setup.

**Preferred path:** Prebuilt images remain the fastest and most reliable path. A prebuilt image + explicit setup script is the golden path for speed and reliability.

### 7.2 Secret Lifecycle

Secrets have distinct lifecycle classes. This is a first-class product feature, not an implementation detail.

| Class | Available During | Removed Before | Example |
|-------|-----------------|----------------|---------|
| **Setup-only** | Environment setup (dependency installation, build steps) | Agent execution phase | `NPM_TOKEN`, registry credentials |
| **Runtime** | Agent execution phase | Sandbox teardown | `DATABASE_URL`, `API_KEY` |
| **Per-tool** | Only when specific tool is invoked | Between tool invocations | `GITHUB_TOKEN` for gh CLI |

**Secret storage (V1):** Pluggable secret-provider interface with one default provider: envelope-encrypted secrets stored in Postgres, using an operator-managed master key or external KMS (e.g., AWS KMS, GCP KMS). External secret managers (Vault, AWS Secrets Manager) are a later provider, not a redesign. For the target user (solo builders / small teams), Vault is not a hard dependency.

**Secret hygiene:** Secret values are never written to audit content, model-visible transcripts, evidence bundles, or logs. Setup-only secrets are injected as environment variables during the setup phase and removed from the container environment before the agent execution phase begins (following the Codex pattern). Per-tool secrets are injected only into the specific tool process's environment.

**Cache invalidation:** Environment cache is automatically invalidated when setup contract, maintenance script, secret bindings, or behavioral control files change.

### 7.3 What V1 Does NOT Support

- Multi-container compose configurations
- DevContainer Features from private registries
- Host-side `initializeCommand`
- Complex lifecycle script ordering (beyond `postCreateCommand`)
- Nested Docker builds inside the container
- Private network connectors (VPN, VPC peering)
- OIDC-based cloud role assumption by the agent (surfaced as unsupported during capability scan)

---

## 8. Requirements

### P0 — Must Have (MVP)

> The minimum system that executes the core loop end-to-end on a single class-A GitHub repository with human review gates, evidence packets, credential isolation, evaluator integrity, and audit trail.

**R-001: Application State**
Relational state in PostgreSQL for tasks, reviews, policies, environments, and code index metadata. Separate append-only audit tables for compliance and forensics (see R-012). Temporal owns orchestration history and replay — application state is not event-sourced.

*AC: Task state queryable via SQL. Dashboard can join tasks, reviews, and policies without replaying events. State survives Temporal workflow completion and retention expiry.*

**R-002: Task Lifecycle**
Tasks contain: objective, scope, constraints, budget. State machine with explicit dual-boundary separation:

```
created → [needs_clarification →] assigned → in_progress →
  evidence_ready → [changes_requested → in_progress →] approved →
  pr_created → external_checks_pending →
    [addressing_review_feedback → external_checks_pending →]
    [external_blocked → external_checks_pending →]
  merge_ready → merged | failed
```

The transition from `approved` to `pr_created` is the internal evidence boundary. The transition from `external_checks_pending` to `merge_ready` is the external merge readiness boundary. Invalid transitions rejected.

**`addressing_review_feedback`**: Entered when a GitHub reviewer submits a review (request-changes/comment) or an operator explicitly triggers feedback iteration. The agent re-enters the implement → validate → evidence loop on the PR branch. Returns to `external_checks_pending` when done.

**`external_blocked`**: Entered when a GitHub-native gate fails (required check failure, deployment gate, code scanning block, merge queue rejection, mergeability drift). This is distinct from `failed` — external blocks are often transient or require specific remediation. Default behavior: pause and notify with a structured external-failure bundle. Allowed automatic actions: rebase/update branch, rerun idempotent checks, requeue merge queue (when policy allows). The agent does NOT automatically rewrite code in response to external failures unless the repo has an explicit remediation policy.

| External Failure Class | Example | Default Action |
|----------------------|---------|---------------|
| Transient infra/check failure | Flaky CI, runner timeout | Rerun check (max 2 retries) |
| Mergeability drift | Base branch moved, branch not up-to-date | Rebase + revalidate |
| Code/policy failure | CodeQL finding, push ruleset violation | Pause + notify |
| Manual gate failure | Deployment approval pending, review blocked | Pause + notify |

*AC: Ambiguous objective enters `needs_clarification` and blocks until human responds. Task in `pr_created` state reports which GitHub-required checks are still pending. Given GitHub reviewer requests changes on PR, task enters `addressing_review_feedback`. Given required check fails, task enters `external_blocked` and human is notified. Task in `merged` state rejects further transitions.*

**R-003: Candidate Branch Workflow**
Execute the core loop end-to-end per §6.1. All implementation, validation, and evidence assembly happen on a candidate branch before any PR exists. PR created only after human approves evidence. After PR creation, factory tracks external merge readiness separately from internal validation. Support configurable early-draft-PR mode for repos where it's safe.

*AC: Given a valid objective, workflow produces a candidate branch with passing validations and evidence packet. Human reviews evidence. On approval, PR is created. Factory reports delta between internal validation and GitHub-required checks. On rejection, candidate branch is cleaned up.*

**R-004: GitHub Integration**
Full repo capability scan per §6.3 — including push rulesets, org/enterprise inherited rulesets, commit message patterns, and OIDC trust policy detection. Required-check bootstrap flow. Webhook-driven state sync with periodic reconciliation. PR lifecycle management with dual-boundary tracking: internal evidence readiness and external merge readiness (required checks, CODEOWNERS, merge queue, stale reviews, thread resolution). Repo support class determination.

*AC: Given a repo with merge queue, approved PR enters merge queue and factory tracks merge_group events. Given a repo with push rulesets restricting file paths, capability scan warns before first push. Given a repo with OIDC-dependent deployment environments, scan surfaces this as a limitation.*

**R-005: Credential Broker**
GitHub App that mints per-run, minimal-scope installation tokens. Tokens expire after 1 hour — broker rotates at ~50-minute intervals for long-running tasks. Permissions restricted to minimum needed per task phase.

*AC: Given task running >1 hour, tokens have been rotated. Given new repo onboarded, credential broker provisions minimal-scope token for scan.*

**R-006: Sandboxed Execution**
All agent code executes in isolated Docker containers. Ephemeral — destroyed on completion. Network policy: setup phase (network enabled for dependency installation), execution phase (network disabled by default, configurable allowlist).

gVisor integration is Phase 2 — Docker container isolation is sufficient for V1 class-A repos. gVisor has known gaps (no nested Docker, partial iptables, no block-device mounts) that will be addressed when class-B support lands.

*AC: Given execution phase, outbound HTTP to non-allowlisted endpoint is blocked. Given task completion, sandbox is destroyed.*

**R-007: Human Review Gates**
Block PR creation and merge until human reviews evidence. Review requests include evidence packet. Configurable timeout (default 4h) → escalation. Support **request-changes** as a first-class response — agent receives structured feedback and iterates. Enforce separation of duties: task submitter cannot be sole approver (relaxable for solo developers via explicit config).

*AC: Given evidence ready, human receives structured review request. Given request-changes with inline feedback, agent addresses feedback and re-presents evidence. Given 4h without response, escalation fires.*

**R-008: Evidence Packet**
Evidence-derived fields only — no model self-assessed confidence scores. Fields:

| Field | Purpose |
|-------|---------|
| Objective | What was attempted |
| Annotated diff | What changed, with inline annotations |
| Blast radius | Number of files, packages, and downstream consumers affected |
| Owners impacted | CODEOWNERS paths touched |
| Test results | Suite results, new/modified/deleted tests highlighted |
| Security scan results | Vulnerability findings |
| Lint/type-check results | Static analysis findings |
| Protected-surface edits | Any behavioral control file or protected file edits, highlighted with justification |
| Migration/schema impact | Database or data model changes detected |
| Revertability class | Clean revert, revert-with-migration, or non-revertable (schema changes, external side effects) |
| Unresolved assumptions | What the agent was uncertain about |
| Commands and checks run | Exact validation commands executed |
| Pending external checks | What GitHub-required checks are not yet run (visible after PR creation) |

*AC: Given edits to test files, evidence highlights these separately. Given a schema migration, revertability class is "revert-with-migration." Evidence does NOT include a scalar confidence score or generic rollback prose.*

**R-009: Autonomy Levels**

| Level | Name | What the Agent Can Do | What Requires Human Approval |
|-------|------|----------------------|------------------------------|
| L0 | Observe | Read code, summarize, recommend | Everything else |
| L1 | Propose | All of L0 + generate plans, produce diffs | Creating branches, writing files, creating PRs |
| L2 | Constrained Execute | All of L1 + create branches, edit code, run tests, push to candidate branch | Creating PRs, merging, editing hard-protected files |

Default: L1. L2 requires eval baseline evidence before activation.

**R-010: Path/File Policy (End-to-End)**
Path-level governance enforced at two layers:

1. **Index-time filtering**: When building the code index, excluded paths are filtered before any content is indexed, summarized, or included in repo maps. If the index contains excluded content, governance is already broken.
2. **Runtime enforcement**: When the agent reads or edits files, path policies are enforced. Agent cannot read excluded paths or edit denied paths regardless of autonomy level.

| Policy Type | Example | Default |
|------------|---------|---------|
| Read exclusion | `secrets/**`, `.env*`, `*.pem` | Deny read AND index |
| Edit deny | `.github/workflows/**`, `CODEOWNERS` | Deny without admin approval |
| Edit protected | See protected file classes below | Require separate approval |
| Edit allowed | `src/**` | Allow within autonomy level |

*AC: Given read exclusion on `secrets/**`, code index does not contain content from those paths. Agent context retrieval skips them. Given agent attempting to edit a workflow file at L2, edit blocked.*

**R-011: Protected File Classes & Behavioral Control File Trust**
Certain file categories require elevated approval. The agent must not be able to modify its own evaluation criteria or behavioral control surfaces.

| Class | Examples | Default Policy |
|-------|---------|----------------|
| **Hard-protected** | `.github/workflows/**`, `CODEOWNERS`, `.factory/**`, holdout eval fixtures, behavioral control files (see below) | Deny by default. Requires admin approval. |
| **Flagged** | `**/*.test.*`, `**/*.spec.*`, `**/test/**` (product test files) | Allowed but highlighted in evidence with strong justification. Configurable to require approval. |
| **Light-protected** | `**/__snapshots__/**`, `**/*.snap`, `**/fixtures/**`, `**/testdata/**` | Flagged in evidence. Auto-allowed at L2. |

The key integrity boundary: **block files that let the agent redefine success** (CI, graders, holdouts, behavioral control files). For ordinary product tests, the better design is "force unusually good evidence when the agent touches tests" rather than "block all test edits." Many real fixes should update tests — making the product too suspicious of normal test maintenance pushes engineers to work around it.

**Behavioral control files (P0 trust boundary):**

Instruction files, setup contracts, and MCP configuration are behavior-shaping policy surfaces. The factory loads them only from the task's **trusted base ref**, pinned at task creation (typically the default branch HEAD). Candidate-branch or PR-branch edits to these files do not alter agent behavior — they are treated as diff content and highlighted in evidence.

Behavioral control file class:
- `.github/copilot-instructions.md`
- `.github/instructions/**/*.instructions.md`
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
- MCP configuration files
- `.factory/setup.yml` and related setup contracts
- Any factory-owned policy files (`.factory/**`)

This is a P0 rule because behavioral control file poisoning is a top-tier threat (§10.1). GitHub already treats adjacent control surfaces this way: Copilot setup steps only activate from the default branch, and custom agent profiles only become active after merge to the default branch.

*AC: Given agent editing a CI workflow, edit blocked. Given agent updating a snapshot file at L2, edit allowed but flagged in evidence. Given agent editing a test file, edit allowed but evidence includes justification and highlights the change prominently. Given AGENTS.md modified on candidate branch, agent behavior uses the default-branch version, and the diff is highlighted in evidence.*

**R-012: Audit Trail**
Every action produces an audit entry. Append-only in Postgres with periodic export to object storage.

| Field | Contents |
|-------|----------|
| Metadata | Timestamp, actor, action type, target, result, cost |
| Content hash | SHA-256 of full content (prompts, outputs) for verification |
| Full content | Stored alongside, shorter retention (default: 90 days). Metadata and hashes retained longer (default: 2 years). |

*AC: Given audit entry tampering, detectable via content hash mismatch. Given GDPR erasure request, full content can be purged while metadata hashes remain.*

**R-013: Cost Tracking**
Track LLM spend (tokens × pricing) per task and globally. Budget ceiling per task (default: $10) and globally (default: $100/day). 80% → notify, 100% → pause.

CI/runtime cost tracking is Phase 2 — V1 tracks what we can measure directly (LLM API spend).

*AC: Given task at 80% budget, notification sent. At 100%, task pauses.*

**R-014: Code Understanding**
Persistent code index per repo, updated incrementally:

| Capability | Phase |
|-----------|-------|
| File structure + dependency graph | Phase 1 |
| Symbol table (functions, classes, exports) | Phase 1 |
| Repo map (entry points, module boundaries) | Phase 1 |
| Branch-aware freshness (index versioned by commit SHA) | Phase 1 |
| Governance-aware filtering (excluded paths never indexed) | Phase 1 |
| Semantic search (embeddings) | Phase 3+ |

*AC: Given a task, code index retrieves relevant files without grepping the entire repo. Given path exclusion on `secrets/**`, index does not contain those files. Given new commit, index updates incrementally.*

**R-015: Repo Setup**
For class-A repos: explicit setup contract per §7.1.

**Setup paths (in priority order):**
1. Explicit `.factory/setup.yml` — canonical, version-controlled
2. Prebuilt image reference — fastest, most reliable
3. Generated from `devcontainer.json` or `Dockerfile` — human-approved before use

**What V1 supports:**
- Single-container environments
- Standard Dockerfile
- Prebuilt images (pull and run)
- Phase-separated secrets (setup-only removed before agent execution)
- Environment health check before work begins
- Snapshot caching with automatic invalidation
- Simple LFS checkout (`lfs: true`)

**What V1 does NOT support:**
- Multi-container compose configurations
- DevContainer Features from private registries
- Host-side `initializeCommand`
- Complex lifecycle script ordering (beyond `postCreateCommand`)
- Nested Docker builds inside the container

*AC: Given repo with `.factory/setup.yml`, factory uses it directly. Given repo without setup contract, factory generates one from devcontainer.json and presents to human for approval. Given subsequent task, factory restores from cache. Given repo requiring compose, capability scan reports this as class B.*

**R-016: CLI Interface**
Command-line interface for task submission, status monitoring, evidence review, approval, and configuration. Dashboard deferred.

*AC: `factory submit --issue 42` creates task. `factory evidence --task T-001` displays evidence including pending external checks. `factory approve --task T-001` triggers PR creation.*

**R-017: Provider Routing**
Model routing via OpenRouter (primary). Every LLM call logged with model ID, tokens, latency, cost. Architecture must not preclude self-hosted inference (OpenAI-compatible API) or air-gapped operation.

Vendor outage handling: **pause and notify by default.** Silent auto-failover changes behavior and weakens auditability. Failover to a pre-qualified alternate provider is configurable but opt-in.

*AC: Given OpenRouter outage, task pauses and human is notified. Given explicit failover config, fallback to pre-qualified alternate. Given model change, capability validated before applying.*

**R-018: Basic Auth**
API key authentication with roles:

| Role | Permissions |
|------|------------|
| **Admin** | Full access: configure repos, set policies, manage roles |
| **Operator** | Submit tasks, approve actions, view audit |
| **Viewer** | Read-only |

Separation of duties: task submitter cannot be sole approver (configurable for solo developers).

*AC: Given Operator submits and tries to approve same task, approval blocked unless solo-dev override enabled.*

### P1 — Should Have (V1.x)

> Dashboard, notifications, eval foundation, brownfield onboarding polish, policy attestation.

**R-019: Web Dashboard**
Active tasks, approval/review inbox (primary view), cost summary, agent health, environment state. Real-time updates via SSE/WebSocket. The review inbox is the product's primary human surface — it should show the dual-boundary status: internal evidence vs. external merge readiness.

**R-020: Brownfield Onboarding (Full Flow)**
Structured onboarding that builds on R-014 and R-015:
1. Scan — file structure, dependencies, testing surfaces
2. Index — build code index (governance-filtered)
3. Ingest environment — setup contract, CI workflows, secrets, rulesets, CODEOWNERS, merge queue
4. Generate or validate setup contract
5. Build and cache execution snapshot
6. Interview — clarifying questions for human about undocumented decisions
7. Human reviews and approves before write access

**R-021: Minimal Eval Layer**
Before L2 autonomy is enabled: historical issue replay, diff-size tracking, rework-rate tracking, protected-file edit tracking. L2 qualification: minimum 10 replays with >60% first-pass acceptance, rework rate below 50%, zero unauthorized hard-protected-file edits.

**R-022: Notification System**
Slack webhook minimum, extensible. Categories: blocked reviews (real-time), digests (configurable), circuit breaker trips (real-time).

**R-023: Context System & Trust Classification**
The P0 trust boundary for behavioral control files is defined in R-011 (load only from trusted base ref, treat as hard-protected). This requirement extends that foundation with richer context handling:

**Context consumption:** The factory consumes standard repo instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, path-specific `.instructions.md`) from the trusted base ref only. These are used as planning context — not as trusted commands. Research shows repository context files can reduce agent success rates and increase inference cost when over-applied; the factory should extract minimal, actionable requirements rather than passing entire instruction files as system prompts.

**Trust classification UI:** All context sources are tagged with their trust class in the dashboard and evidence:
- **Factory config** — factory-owned policy, highest trust
- **Base-ref behavioral control** — instruction/setup files from trusted base ref, used for planning
- **Human-authored task input** — issue text, operator directives
- **Untrusted external** — PR comments, code comments, external content; HTML/hidden-comment stripping applied, cannot parameterize destructive tools

**Behavioral control file diff detection:** When a candidate branch modifies a behavioral control file, the evidence packet highlights this prominently and explains what behavior would change if the file were merged. This gives reviewers visibility into proposed behavioral changes without letting those changes take effect pre-merge.

**R-024: Self-Healing Guardrails**
External guardrails (outside agent process): max iteration limit (10), no-progress detector (3 loops without state change), time budget (30 min per repair), cost budget, loop-of-doom detector (4+ identical failing calls). Trips → pause, notify human.

**R-025: Circuit Breaker**
Per-tool and per-agent. Global kill switch (Redis key) checked at every tool invocation.

**R-026: Policy Attestation & Drift Visibility**
The dashboard surfaces where path policies are enforced:

| View | What It Shows |
|------|--------------|
| Factory-only protection | Paths protected only in the factory's policy config |
| GitHub-native protection | Paths also protected by GitHub push rulesets |
| Policy drift | Where factory policy and GitHub rulesets disagree |
| Bypass actor status | Whether the factory's GitHub App is a bypass actor (and for which rulesets) |

This is a **visibility** feature, not an enforcement feature. The factory does not attempt to project its policies into GitHub rulesets in V1.x (that has fork-network implications). But drift visibility is critical for a governance-first product — users need to know where their policies are actually enforced vs. where they exist only in the factory.

*AC: Given factory policy denies `infra/**` edits but no GitHub push ruleset protects that path, dashboard shows "factory-only protection." Given GitHub push ruleset restricts `*.sql` files, dashboard shows "GitHub-native protection."*

### P2 — Nice to Have (V1.x+)

**R-027: Long-Running Execution**
Tasks executing 4+ hours with checkpoint-based resume via Temporal. Per-phase workflow design with Continue-As-New.

**R-028: Directive System**
Human priority overrides that interrupt active execution, inject new instructions, re-route work.

**R-029: Dead Letter Queue**
Tasks exceeding retry budget quarantined with error chain and context snapshot. Browsable, retryable.

**R-030: CI/Runtime Cost Tracking**
Expand cost tracking to include CI minutes, sandbox compute, indexing cost, retry overhead.

**R-031: Cron Scheduling**
Scheduled automation (dependency updates, security scans). Isolated sessions, JSONL logs, exponential backoff on failure. Scoped to environment-heavy repos where GitHub-native Dependabot/CodeQL don't operate cleanly — not vanilla dependency PRs.

**R-032: MCP Tool Integration**
External tools via MCP protocol (pinned to spec version 2025-11-25). Local stdio servers first. Remote HTTP (OIDC + PKCE) later. Per-tool qualification required before production use.

**R-033: gVisor Sandbox Hardening**
Add gVisor as a hardened sandbox layer for repos where Docker-only isolation is insufficient. gVisor has known gaps (no nested Docker, partial iptables, no block-device mounts) — repos requiring these stay on Docker-only isolation.

### For Later (V2+)

| Capability | Why Not Now |
|-----------|-------------|
| Multi-role agent execution (coordinator + workers) | Only when evals show stable single-worker bottleneck |
| Autonomy L3-L4 (delegated, exception-driven) | Requires qualification gate maturity |
| Full eval harness with externalized evaluation | Requires minimal eval maturity first |
| Drift detection (rolling averages, regression alerts) | Optimization |
| Model regression detection | Optimization |
| Multi-project support | Single-project covers initial target |
| Multi-tenancy | Single-tenant covers initial target |
| Enterprise SSO/OIDC | API keys sufficient for initial target |
| Native GitHub ruleset projection | Projecting factory policies into GitHub rulesets — useful but has fork-network implications |
| RepoTopology/AccessGraph subsystem | Required for class B/C repos |
| A2A protocol support | Protocol still maturing |
| Policy-as-code engine (Cedar/OPA) | Code-level policies sufficient initially |
| OIDC-based cloud role assumption | Complex claim mapping; surfaced as unsupported in V1 |
| Private network connectors | VPN/VPC peering for private service access |
| Plugin/extension framework | Focus on golden path before extensibility; narrow repo-local tools (MCP) before platform framework |

---

## 9. Governance & Autonomy

### 9.1 Authority Rules

Regardless of autonomy level:
- **PR creation and merge always require human approval** in initial product
- **Hard-protected file edits always require admin approval** at all levels
- **Behavioral control file changes on feature branches do not alter agent behavior** — they are treated as diff content
- **Policy/config changes always require admin role**
- **Audit trail is append-only for all roles**
- **Task submitter cannot be sole approver** (configurable for solo devs)

### 9.2 Autonomy Levels

| Level | Name | Scope | Available |
|-------|------|-------|-----------|
| L0 | Observe | Read-only, summarize, recommend | V1 |
| L1 | Propose | Produce diffs and plans; human approval for all mutations | V1 (default) |
| L2 | Constrained Execute | Create branches, edit code, run tests, push to candidate branch; human approval for PR/merge/hard-protected edits | V1 (requires eval baseline) |
| L3 | Delegated Maintenance | Autonomous low-blast-radius work with mandatory rollback + monitoring | V2+ |
| L4 | Exception-Driven | Background operation within policy; humans on exceptions | V2+ |

L2 requires: minimum 10 historical issue replays with >60% first-pass acceptance, rework rate below 50%, zero unauthorized hard-protected-file edits.

---

## 10. Security

### 10.1 Threat Model Priorities

1. **Evaluator tampering** — agents modifying tests/CI/behavioral control files to pass validation (defense: protected file classes, R-011)
2. **Behavioral control file poisoning** — modifying instruction/config files on feature branches to steer agent behavior (defense: base-ref-only loading, R-011 P0 trust boundary)
3. **Prompt injection and context poisoning** — via issues, PR comments, code comments (defense: trust classification, content stripping)
4. **Credential exposure or scope escalation** (defense: credential broker, phase-separated secrets, minimal scope, rotation)
5. **Data governance bypass** — excluded content leaking via index or summaries (defense: index-time filtering)
6. **Unauthorized data egress** (defense: network policy, sandbox)

### 10.2 Day-1 Controls

1. Protected file classes with finer-grained categories (hard-protected, flagged, light-protected)
2. Path-level read/edit policies enforced at index-time AND runtime
3. Credential broker with automatic rotation (50-min intervals)
4. Phase-separated secrets (setup-only secrets removed before agent execution)
5. Append-only audit with content hashes
6. Ephemeral sandboxed execution with network policy
7. Trust-classified context (untrusted content stripped and restricted)
8. Behavioral control files loaded from trusted base ref only (P0, R-011)
9. Repo capability scan before first task
10. Security scanning on every mutating diff
11. Mandatory human gates for PR creation and merge
12. Separation of duties
13. Concurrency control — one active mutator per branch

### 10.3 Compliance-Ready Design

The product provides infrastructure that makes compliance achievable. It does **not** claim to be a compliance solution.

What it provides:
- SOC 2-style access controls and change logs
- GDPR-compatible audit (metadata retained, raw content purgeable)
- Append-only audit suitable for regulatory evidence
- Policy-based human oversight for all mutating actions
- Full audit export
- Role-based access with separation of duties

---

## 11. Build Phases

### Phase 1: Core Loop (Weeks 1-6)

**Goal:** Execute the core loop end-to-end on a single class-A GitHub repo. Issue → understand → plan → setup → implement → validate → evidence → human review → PR → track external checks → merge.

**Requirements:**
- R-001 (Application state — relational, not event-sourced)
- R-002 (Task lifecycle — dual-boundary state machine)
- R-003 (Candidate branch workflow — with post-PR tracking)
- R-004 (GitHub integration — capability scan, reconciliation, dual-boundary PR lifecycle)
- R-005 (Credential broker)
- R-006 (Sandbox — Docker-only for V1)
- R-007 (Human review gates)
- R-008 (Evidence packets — merge-relevant fields)
- R-009 (Autonomy L0-L1 default, L2 available with eval baseline)
- R-010 (Path/file policy — index-time + runtime)
- R-011 (Protected file classes — hard-protected, flagged, light-protected — including P0 behavioral control file trust boundary)
- R-012 (Audit trail)
- R-013 (Cost tracking — LLM spend)
- R-014 (Code index — governance-filtered)
- R-015 (Repo setup — explicit setup contract, prebuilt images, devcontainer import)
- R-016 (CLI)
- R-017 (Provider routing — single provider with pause-on-failure)
- R-018 (Basic auth)

**Infrastructure:** Docker Compose: PostgreSQL + Redis + Temporal + object storage + TypeScript monolith
**Interface:** CLI-only
**Scope:** Class-A repos only

**What changed vs. v4:** Removed event sourcing (relational state + audit instead). Simplified sandbox to Docker-only. Simplified provider routing to single-provider with pause. Added explicit setup contract as primary path. Added dual-boundary PR tracking with `addressing_review_feedback` and `external_blocked` states. Softened test-file protection from "approval-required" to "flagged." Added P0 behavioral control file trust boundary (base-ref-only loading). Added secret storage specification (envelope-encrypted Postgres). These changes reduce Phase 1 complexity without sacrificing the core thesis.

### Phase 2: Control Surface + Brownfield (Weeks 7-10)

**Goal:** Humans can see and steer from a dashboard. Factory can onboard existing repos with full brownfield flow. System earns trust through eval. Policy drift is visible.

- R-019 (Dashboard — review inbox as primary view)
- R-020 (Brownfield onboarding — full flow with setup contract generation)
- R-021 (Eval layer for L2 qualification)
- R-022 (Notifications)
- R-023 (Behavioral control files — trust model, hard-protected class)
- R-024 (Self-healing guardrails)
- R-025 (Circuit breaker)
- R-026 (Policy attestation & drift visibility)

### Phase 3: Duration & Expansion (Weeks 11-14)

**Goal:** Long-running operation, tool integration, hardened sandbox, class-B repo support.

- R-027 (Long-running execution with Temporal Continue-As-New)
- R-028 (Directives)
- R-029 (DLQ)
- R-030 (CI/runtime cost tracking)
- R-031 (Cron — scoped to non-Dependabot cases)
- R-032 (MCP tool integration — local stdio)
- R-033 (gVisor sandbox hardening)
- Class-B repo support (submodules, complex devcontainer, private registry auth)

### Phase 4: Trust & Scale (Weeks 15+)

**Goal:** System earns higher autonomy. Multi-agent if justified.

- Multi-role agent execution (only if evals justify)
- Autonomy L3-L4 with qualification gates
- Full eval harness with externalized evaluation
- Drift detection
- Multi-project support
- Native GitHub ruleset projection (if drift visibility shows demand)

---

## 12. Success Metrics

| Metric | Target (3 months) |
|--------|-------------------|
| Time: issue to mergeable PR | <4h for bounded tasks |
| First-pass acceptance rate | >60% approved without request-changes |
| Human review time per evidence-backed PR | <10 min |
| Task completion rate | >80% within trained scope |
| Cost per completed PR | <$25 avg for bounded tasks |
| Incident rate | <5% regression within 30 days |
| Credential rotation success | 100% |
| Protected-file violation rate | 0% unauthorized |

**Falsifiable Hypotheses (First Year):**

1. Evidence bundles reduce median review time by >=20% vs raw PRs
2. Request-changes loop reduces rework-to-merge cycles by >=30% vs single-pass
3. Candidate-branch model reduces wasted CI spend by >=50% vs draft-PR-first
4. Index-time path filtering eliminates data governance leaks (target: zero)
5. Protected file classes reduce evaluator tampering to zero unauthorized incidents
6. Historical issue replay predicts first-pass acceptance rate within 15pp
7. Code index reduces irrelevant-file inclusion in agent context by >=50%
8. Explicit setup contracts reduce environment setup failures by >=40% vs devcontainer inference
9. Phase-separated secrets eliminate credential exposure during agent execution (target: zero)

---

## 13. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Credential exposure | Critical | Broker + phase-separated secrets + minimal scope + rotation + audit |
| Prompt injection via external content | Critical | Trust classification + content stripping + tool restrictions |
| Evaluator tampering | Critical | Hard-protected file classes + behavioral control file trust model |
| Behavioral control file poisoning | Critical | Untrusted on non-default branches + hard-protected class + evidence highlighting |
| Reviewer fatigue | Critical | Evidence packets + diff size policy + request-changes loop |
| GitHub mechanics mismatch | High | Full capability scan (including push rulesets, org-level) + reconciliation + merge queue awareness |
| Brownfield setup failure | High | Explicit setup contract + class-A scoping + prebuilt images + human approval before use |
| Phase 1 scope overrun | High | Simplified data architecture, Docker-only sandbox, single provider — thesis preserved |
| Model upgrade regression | High | Qualification gates + staged rollout + auto-downgrade |
| Temporal event-history limits | Medium | Per-phase workflow design + Continue-As-New from day 1 |
| Product becomes framework museum | Medium | One excellent core loop before expanding |

---

## 14. Competitive Positioning

| System | What They Do Well | Our Differentiation |
|--------|-------------------|---------------------|
| **GitHub Copilot Agent** | Self-hosted runners, enterprise AI Controls, repo indexing, deep GitHub integration | Customer-owned state, end-to-end path governance (including index-time), evaluator integrity, evidence packets, model portability, behavioral control file trust model |
| **OpenAI Codex** | Local/cloud/hybrid, graduated approval, compliance exports, phase-separated secrets | Customer-owned orchestration and audit, GitHub-native review fidelity with dual-boundary tracking, protected file classes, brownfield setup quality |
| **Devin** | Repo indexing + setup separation, autonomous execution | Self-hosted, customer-owned state, graduated authority with path precision, transparent evidence, exitability |
| **Claude Code** | Best CLI agent experience | Persistent orchestration, credential isolation, evidence packets, concurrency control |

**Position:** Not "we do what they do but self-hosted." Instead: **a self-hosted control plane where the customer owns the policy, audit, and orchestration state** — with end-to-end path governance, evaluator integrity, behavioral control file trust model, and the dual-boundary candidate-branch safety model that platform vendors don't offer.

---

## 15. Non-Goals

1. Not an IDE or code editor
2. Not a code generation model — models are replaceable workers
3. Not a CI/CD replacement — orchestrates existing CI/CD
4. Not a general-purpose agent framework or plugin platform
5. Not multi-tenant from day 1
6. Not for non-engineering workflows
7. Not a hosted SaaS — self-hostable required
8. Not a compliance certification tool — provides compliance-ready infrastructure
9. Not attempting air-gapped inference in V1
10. Not a competitor to Dependabot for vanilla dependency updates
11. Not a reviewer agent — AI review on GitHub is comment-only and doesn't count toward required approvals. Our leverage is the evidence packet and policy wiring.
12. Not a devcontainer runtime — devcontainer.json is an import source for the explicit setup contract, not the authoritative control surface

---

## 16. Open Questions

### Decided

| # | Question | Decision |
|---|----------|----------|
| 1 | License | Open source, option to evolve later |
| 2 | First target repos | Class-A GitHub repos for solo builders/small teams |
| 3 | Temporal timing | Phase 1, from day one. Per-phase workflows with Continue-As-New. |
| 4 | Model routing | OpenRouter primary, pause-and-notify on outage (failover opt-in) |
| 5 | Evidence scope | Evidence-derived only. No self-assessed confidence scores. Merge-relevant fields. |
| 6 | PR creation boundary | Candidate branch + evidence first. PR after human approval. Configurable early-draft-PR for safe repos. |
| 7 | Signed commits in V1 | Repos requiring signed commits without bypass actor are marked unsupported. |
| 8 | Test file policy | Hard-protected (CI/eval/behavioral control), flagged (product tests), light-protected (snapshots/fixtures). |
| 9 | Index-time governance | Excluded paths filtered before indexing. Non-negotiable. |
| 10 | Recurring maintenance | Demoted. Focus on core loop first. Cron scoped to non-Dependabot cases when added. |
| 11 | Event store vs relational | Relational state + append-only audit. Not event-sourced. Temporal owns orchestration history. |
| 12 | Dashboard primary view | Review inbox. |
| 13 | Vendor outage handling | Pause and notify by default. Failover within pre-qualified pool is opt-in. |
| 14 | Snapshot cache invalidation | Automatic on setup contract, maintenance script, secret binding, or behavioral control file changes. |
| 15 | Internal vs external readiness | Explicitly separated. Factory tracks both boundaries. |
| 16 | Instruction/config file trust | Behavioral control files loaded from trusted base ref only (pinned at task creation). P0 trust boundary in R-011. |
| 17 | Setup contract | Explicit `.factory/setup.yml` is canonical. Devcontainer is import source. |
| 18 | Simple LFS | Class A. Trivial Git mechanic, not a topology problem. |
| 19 | Secret storage | Envelope-encrypted in Postgres (operator-managed master key or external KMS). External secret managers as later provider. |
| 20 | Post-PR review feedback | Re-enters implement → validate → evidence on submitted review or explicit command. No reaction to individual inline comments. |
| 21 | External check failure | Dedicated `external_blocked` state. Pause + notify by default. Safe automatic actions only (rebase, rerun, requeue). |

### Open

1. **Class-B repo timeline?** When does submodule/complex-devcontainer/private-registry support ship? Unknown
2. **Setup contract format details?** YAML as shown, or align with an existing standard? Whatever is simplest, and best
3. **Evidence packet extensibility?** Should repos be able to declare custom evidence fields? In the future; definitely. Not in MVP

---

## 17. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | TypeScript (Node.js 22+) | MCP SDK advantage, shared types with frontend |
| Durable Execution | Temporal | Battle-tested. Per-phase workflows with Continue-As-New. |
| Model Routing | OpenRouter + OpenAI-compatible local | Multi-vendor flexibility. Direct SDK fallback opt-in. |
| Primary DB | PostgreSQL 16 | Relational state, append-only audit, code index metadata |
| Cache/PubSub | Redis 7 | Session state, pub/sub, kill switch, branch leases |
| Object Store | MinIO (self-hosted) / R2 (cloud) | Artifacts, evidence packs, audit export |
| Dashboard | SvelteKit (Phase 2) | Small bundle, WebSocket, TypeScript-first |
| Observability | OpenTelemetry | OTel-native |
| Sandboxing | Docker (Phase 1), Docker + gVisor (Phase 3) | Progressive isolation |
| Deployment | Docker Compose (Phase 1) → Kubernetes (later) | Minimal ops |

---

## Appendix A: Criticism Disposition (v4 → v5)

This PRD was revised based on detailed architectural criticism. Key dispositions:

| Criticism | Disposition |
|-----------|-------------|
| Split internal evidence from merge readiness | **Accepted.** Dual-boundary model added: internal evidence readiness (factory) vs. external merge readiness (GitHub). State machine, workflow, and PR lifecycle all updated. (§6.1, R-002, R-003, R-004) |
| Instruction/MCP files are policy surfaces, not trusted context | **Accepted.** Behavioral control files added as a new protected class, untrusted by default on non-default branches. (R-023, R-011, §10.1) |
| Replace devcontainer parsing with explicit setup contract | **Accepted.** `.factory/setup.yml` is canonical. Devcontainer/Dockerfile are import sources. No silent inference. (§7.1, R-015) |
| Add secret classes and phase separation | **Accepted.** Setup-only, runtime, and per-tool secret classes. Setup-only secrets removed before agent execution. (§7.2, R-015) |
| Move policy attestation/drift earlier | **Partially accepted.** Drift visibility is P1 (R-026). Native ruleset projection stays V2+. |
| Data architecture over-engineered (event sourcing) | **Accepted.** Relational state + append-only audit replaces event sourcing. Temporal owns orchestration history. (§5.2, R-001) |
| Test-file policy too blunt | **Accepted.** "Approval-required" tier renamed to "flagged" — allowed but highlighted in evidence. Hard-protected stays for CI/eval/behavioral control. (R-011) |
| Evidence packet too performative | **Accepted.** Rollback plan replaced with revertability class. Added blast radius, migration impact, pending external checks, exact commands run. (R-008) |
| Simple LFS misclassified | **Accepted.** Moved to Class A. Simple LFS is a trivial Git mechanic. (§4.1, §4.3) |
| Don't build plugin framework | **Already done.** Reinforced in non-goals. MCP tool integration (narrow, local stdio) deferred to Phase 3. |
| Phase 1 too broad | **Accepted.** Simplified: no event sourcing, Docker-only sandbox, single provider with pause-on-failure, test files flagged not blocked. Core thesis preserved. |
| Push rulesets and org-level rulesets in capability scan | **Accepted.** Scan expanded to include push rulesets (file-path restrictions), org/enterprise inherited rulesets, commit message patterns, OIDC trust policy warnings. (§6.3, R-004) |
| Package allowlists wrong abstraction | **Accepted.** Removed "dependency installation respects package allowlists" from day-1 controls. Replaced with phase-separated secrets and approved registry configuration in setup contract. |
| "Secret-name detection" low value | **Accepted.** Removed. Explicit secret declaration in setup contract replaces inference. |
| Behavioral control trust boundary should be P0 | **Accepted (v5.1).** Trust boundary (base-ref-only loading) moved into R-011 as P0. Rich classification UI remains in R-023 as P1. |
| Secret storage unspecified | **Accepted (v5.1).** Envelope-encrypted Postgres with operator KMS. Secret hygiene rules added. External vault as later provider. (§7.2) |
| Post-PR feedback loop unclear | **Accepted (v5.1).** Explicit re-entry rule: submitted review or operator command triggers implement → validate → evidence on PR branch. `addressing_review_feedback` state added. (§6.1, R-002) |
| External check failure handling unspecified | **Accepted (v5.1).** `external_blocked` state with failure taxonomy. Pause + notify default. Safe automatic actions only. (R-002) |

## Appendix B: Criticism Rejected or Deferred

| Criticism | Disposition | Rationale |
|-----------|-------------|-----------|
| Full OIDC/short-lived credential assumption by agent | **Deferred to V2+.** OIDC claim mapping is complex and repo-specific. V1 surfaces OIDC trust policy conflicts during capability scan. |
| Full private network connectors in V1 | **Deferred.** VPN/VPC peering is infrastructure-heavy. Private registry with standard auth is in Class A. |
| Native GitHub ruleset projection | **Deferred to V2+.** Fork-network implications. Drift visibility (R-026) covers the governance need for now. |
| 7-state post-PR merge pipeline | **Simplified.** The concept of separating internal/external boundaries is accepted. The specific 7-state breakdown (`pr_opened → external_checks_pending → reviewable → merge_queue_pending → merge_group_validating → merge_ready`) is over-specified — the state machine captures the key transitions without modeling every intermediate GitHub API state. |
