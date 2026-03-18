# Software Factory Control Plane — Product Requirements Document

**Version:** 1.0
**Date:** 2026-03-18
**Status:** Consolidated draft — iterating
**License:** Open source (with option to evolve later)
**Research basis:** `docs/research.md`

---

## 1. Context

### 1.1 The Three-Layer Problem

Every successful AI-assisted software engineering system in March 2026 follows a three-layer pattern, but no single system covers all three well:

| Layer | What It Does | Best Examples |
|-------|-------------|---------------|
| **Workflow/Context** | Artifacts, phases, conventions, project knowledge | BMAD Method, Claude Code CLAUDE.md |
| **Runtime/Gateway** | Sessions, scheduling, routing, model dispatch | OpenClaw, LangGraph, Temporal |
| **Execution/Tools** | Sandboxed code execution, tool calls, LLM interaction | Claude Code, OpenHands, SWE-agent, E2B |

The integration layer — the system that ties these together with safety, observability, and human control — does not exist as a product.

### 1.2 Why Now

Three converging forces:

1. **Autonomous task duration is doubling every ~123 days.** Claude Opus 4.6 sustains 14.5-hour continuous autonomous operation (METR, February 2026). Week-scale tasks are projected by late 2026. The infrastructure to manage this does not exist.

2. **The market is failing.** 80% of $684B invested in AI initiatives in 2025 failed to deliver value. 42% of companies abandoned AI initiatives (up from 17% in 2024). The problem is not model capability — it is orchestration, trust, and control.

3. **Regulatory pressure is real.** EU AI Act high-risk system requirements take effect August 2, 2026 (the Digital Omnibus proposal may push this to December 2027, but is not yet enacted). The factory's audit logging, human oversight, and evidence packets directly address these requirements.

### 1.3 Target Users

| User | Primary Need |
|------|-------------|
| **Builder / factory owner** | Define workflows, set policy, understand failures, keep system maintainable |
| **Tech lead / sponsor** | Delegate work safely, approve/reject with clear evidence, interrupt or redirect |
| **Engineer** | Leverage on real tasks, bounded automation, repo-aware context |
| **Reviewer / security** | Auditability, proof of checks, change rationale, rollback readiness |

**Initial target:** Solo technical builders and small teams with strong control requirements. Multi-tenant enterprise deployment is later.

### 1.4 What Success Looks Like

A system that accepts a GitHub issue at 9 AM, produces a validated PR with tests and security scans by noon, presents a structured evidence packet for human review, and on approval merges it — then repeats 24/7 with the human checking a dashboard rather than babysitting a terminal.

---

## 2. Problem

### 2.1 Core Problem

Current agentic coding systems break down when teams try to use them as a repeatable software factory:

- They over-rely on hidden prompt logic
- They blur read/propose/mutate/release authority
- They accumulate unreliable context over long runs
- They make review harder instead of easier
- They do not onboard brownfield repositories cleanly
- They trap knowledge inside sessions instead of exporting durable artifacts
- They are hard to adapt as models, tools, and security constraints change

The result: engineers spend more time managing agents than the agents save. Google DORA 2025 found 90% AI adoption correlates with 9% more bugs and 91% more code review time. What is missing is a control plane.

### 2.2 Builder-Side Problem

Someone building a factory faces a systems problem, not a prompting problem:

- How to coordinate tasks without building dead scaffolding
- How to preserve user control while providing leverage
- How to isolate untrusted execution
- How to onboard existing repos without hallucinated understanding
- How to support long-running work without silent drift
- How to qualify new models and plugins before trusting them

### 2.3 User-Side Problem

Someone using a factory faces a trust problem:

- They do not know what the system actually did
- They do not know which actions were safe versus risky
- They cannot interrupt or redirect cleanly
- They fear being trapped in a system they cannot later remove

### 2.4 Product Opportunity

The product sits between artifact-heavy workflow methods (BMAD), runtime gateways (OpenClaw), coding agents (Claude Code, Codex), and enterprise governance. It does not replace all of these — it connects the valuable parts while fixing the operational gaps.

---

## 3. Vision & Principles

### 3.1 Product Thesis

> The winning product is not "an AI that can code anything."
> The winning product is "a legible, governable production system for engineering work."

### 3.2 Vision

A self-hostable software-factory control plane that orchestrates humans and AI agents through real engineering workflows with bounded autonomy, strong policy enforcement, artifact-first state, and portable evidence-backed outcomes.

### 3.3 What the Product Is

- A control plane for AI-assisted engineering execution
- A policy engine for agent permissions and autonomy
- A context and artifact manager for project knowledge
- A runtime for bounded, observable work
- A qualification layer for models, workflows, and extensions

### 3.4 What the Product Is Not

- A single super-agent or code generation tool
- An IDE or code editor
- A CI/CD replacement (it orchestrates existing CI/CD)
- A general-purpose agent framework or SDK
- A closed system that traps repos and knowledge
- A hosted SaaS (self-hostable is required)

### 3.5 Design Principles

1. **User retains control over all automation** — no unapproved authority escalation
2. **Security-first design** — all components pass through policy and sandbox boundaries
3. **Transparency over magic** — deterministic state + explainable evidence
4. **Artifacts over hidden memory** — durable documents beat conversational state
5. **Policy over implicit trust** — explicit rules, not vibes
6. **Portability over lock-in** — import and export are first-class workflows
7. **Bounded autonomy over blanket autonomy** — qualified, not unconditional
8. **Thin orchestration over brittle cleverness** — factory logic in code, not prompts
9. **Model-agnostic interfaces** — swap models without code changes
10. **Ask over guess** — epistemic humility when uncertainty is material
11. **Evidence before approval** — humans never review without structured context
12. **Evaluation-backed expansion** — earn autonomy through demonstrated competence

---

## 4. Architecture

### 4.1 Seven-Plane Model

```
                    ┌─────────────────────────────────────┐
                    │       A. EXPERIENCE PLANE            │
                    │  Dashboard, CLI, Slack, Webhooks,    │
                    │  Approval Inbox, Notifications       │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │       B. CONTROL PLANE (core)        │
                    │  Identity, Autonomy Policy,          │
                    │  Task Intake, Workflow Selection,     │
                    │  Checkpointing, Approval Routing,    │
                    │  Budgets, Audit, Extension Registry  │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
   ┌──────────▼─────────┐ ┌──────▼──────┐ ┌───────────▼──────────┐
   │ C. CONTEXT &        │ │ D. ORCH     │ │ G. LEARNING &        │
   │    KNOWLEDGE PLANE  │ │    PLANE    │ │    QUALIFICATION     │
   │ Artifacts, Context  │ │ Decompose,  │ │ Eval harness,        │
   │ Packs, Memory Tiers │ │ Route,      │ │ Drift detection,     │
   │ Repo Maps, ADRs     │ │ Retry,      │ │ Qualification gates  │
   └─────────────────────┘ │ Escalate    │ └──────────────────────┘
                           └──────┬──────┘
                                  │
                    ┌─────────────▼───────────────────────┐
                    │       E. EXECUTION PLANE             │
                    │  Sandboxed runners, MCP tools,       │
                    │  CI runners, ephemeral workspaces    │
                    └─────────────┬───────────────────────┘
                                  │
                    ┌─────────────▼───────────────────────┐
                    │       F. VALIDATION PLANE            │
                    │  Tests, lint, type-check, security   │
                    │  scan, secret detection, policy      │
                    │  checks, release-readiness scoring   │
                    └─────────────────────────────────────┘
```

### 4.2 Core Data Model

| Entity | Purpose |
|--------|---------|
| `TaskPacket` | Objective, scope, risk class, constraints, budget, deadline |
| `ContextPack` | Selected artifacts + freshness + provenance for a specific repo/task |
| `ExecutionPlan` | Decomposition, role assignment, approval points, dependency DAG |
| `RunCheckpoint` | Resumable runtime state, persisted durably |
| `EvidenceBundle` | Tests, diffs, tool logs, policy decisions, uncertainties |
| `ApprovalRecord` | Who/what/when/why/scope/TTL |
| `PolicyDecision` | Allow/deny with rule trace |
| `Directive` | Priority override with steering instruction, scope, TTL |
| `AuditEntry` | Tamper-evident log entry with SHA-256 chain |
| `CostRecord` | Token usage, model, estimated cost, per-task aggregation |

### 4.3 Agent Topology

Start with 4 roles. Add more only when evals prove a stable bottleneck.

| Role | Responsibility | Model Tier |
|------|---------------|------------|
| **Coordinator** | Task decomposition, routing, checkpoint management | Premium (Opus-class) |
| **Implementer** | Code writing, file editing, tool execution | Mid-tier (Sonnet-class) |
| **Verifier** | Test execution, security scan, lint, type-check | Mid-tier |
| **Reviewer** | Code review, architectural assessment, evidence assembly | Premium (Opus-class) |

Mixing tiers reduces cost 40-60% vs running premium everywhere.

### 4.4 Authority Classes

Five authority classes define what actions require what level of control:

| Class | Description | Default Gate |
|-------|------------|-------------|
| `Read` | Query state, view artifacts | No approval needed |
| `Propose` | Generate plans, drafts, recommendations | No approval for drafts |
| `Mutate` | Create branches, edit code, run tests, open PRs | Approval at L0-L1; auto at L2+ within scope |
| `Release` | Merge, deploy, publish | Always requires human approval (initial product) |
| `Govern` | Change policy, modify autonomy, alter security config | Always requires human approval |

These do not collapse into a single "autonomous mode" switch.

---

## 5. Workflows

### 5.1 The Scoreable Loop (Atomic Unit)

```
1. INTAKE      → Accept objective (issue, directive, cron trigger)
2. PLAN        → Coordinator produces ExecutionPlan
3. IMPLEMENT   → Implementer executes plan in sandbox
4. VALIDATE    → Verifier runs test suite, lint, security scan
5. EVIDENCE    → Reviewer assembles EvidenceBundle
6. APPROVE     → Route to human with one-click approve/reject
7. MERGE       → On approval, merge PR (or defer to human)
8. LEARN       → Store outcome, update metrics, feed eval harness
```

Everything — multi-step features, long-running maintenance, cron jobs — composes from this loop.

### 5.2 Execution Paths

| Path | When | Characteristics |
|------|------|----------------|
| **Quick** | Small, low-risk, bounded changes | Single implementation run, small context pack, validator bundle, evidence output |
| **Team** | Decomposable, moderate complexity | Coordinator + bounded workers, explicit subtask contracts, merged evidence |
| **Long-run** | Migrations, broad refactors, multi-step debugging | Checkpoints after durable outputs, hourly compaction, milestone review gates, stronger anomaly detection |

### 5.3 V1 Workflows

1. **Issue → Plan → PR**: Accept issue, research, plan, implement, validate, evidence, review
2. **Brownfield Onboarding**: Map repo → interview human → compile context artifacts → validate before write access
3. **Recurring Maintenance**: Scheduled dependency updates, security scans, test repairs with strict review

---

## 6. Requirements

### P0 — Must Have (MVP)

> The minimum system that executes the scoreable loop end-to-end on a single repository with human approval gates and full audit trail.

**R-001: Event-Sourced State**
Append-only, immutable event log as single source of truth. Every state change recorded as structured JSON. Current state derived via deterministic projection. SHA-256 divergence detection.

*AC: Given system restart, state reconstructed from event log matches pre-restart state exactly (SHA-256 verification). Given 100 sequential events, projection produces the same state regardless of when it runs.*

**R-002: TaskPacket Lifecycle**
TaskPackets contain: objective, scope, risk class, constraints, budget, deadline. State transitions: `created → assigned → in_progress → review_requested → approved|rejected → completed|failed`. Invalid transitions rejected.

*AC: Given a TaskPacket in `completed` state, an `assign` request is rejected with `invalid_transition` error. Given budget omitted, system applies default ($10).*

**R-003: Single-Repo PR Workflow**
Execute the scoreable loop end-to-end. All validation passes before PR enters approval queue. Feature branch only; base branch is read-only to agents.

*AC: Given a valid objective, workflow produces a PR with code changes, passing tests, passing security scan, and evidence packet. Given validator failures, task does NOT enter approval queue automatically.*

**R-004: Sandboxed Execution**
All agent code executes in isolated sandbox (Docker + gVisor minimum). No host filesystem, network (except allowlist), or long-lived secrets during execution. Ephemeral — destroyed on completion. Two-phase runtime: setup phase (network for deps), execution phase (network disabled).

*AC: Given agent in execution phase, outbound HTTP to non-allowlisted endpoint is blocked. Given task completion, sandbox is destroyed.*

**R-005: Human Approval Gates**
Block mutations to protected branches and actions exceeding autonomy level until human approves. Approval requests include evidence packet. Configurable timeout (default 4h) → escalation → auto-reject with incident.

*AC: Given task at L1, code change blocks and sends approval request with evidence. Given 4h without response, escalation fires.*

**R-006: Evidence Packet Generation**
Configurable per-workflow and per-user. Default: objective, annotated diff, test results, security scan, lint/type-check, confidence with uncertainty flags, rollback plan. Compact summary view that expands on demand.

*AC: Given completed implementation, evidence contains all default sections. Given security scan with findings, they are listed with severity, location, and remediation.*

**R-007: Autonomy Levels 0-2**
L0 (Observe — read-only), L1 (Propose — drafts, human approval for all mutations), L2 (Constrained Execute — branches, code, tests, PRs; human approval before merge/deploy). Configurable per-repository and per-task-type. Default: L1.

*AC: Given L0 repo, agent file write blocked. Given L2, agent creates branch/PR but merge requires approval.*

**R-008: MCP Tool Integration**
External tools via MCP protocol. Tier 1 servers (filesystem, GitHub, git) pre-configured. New server requires config only. Tool calls logged as events.

*AC: Given new MCP server URL in config, tools available after reload without code changes.*

**R-009: Model-Agnostic Provider Interface**
OpenRouter as primary for multi-vendor flexibility. Direct vendor SDKs as fallback. Model selection configurable per role via 3-tier routing (cheap/mid/premium). Every LLM call logged with model ID, tokens, latency, cost. Model switching requires config change only.

*AC: Given model change from Sonnet to GPT for Implementer, next task uses new model with no code changes.*

**R-010: Audit Logging**
Every action produces audit entry: timestamp, actor, action type, target, result, provenance chain. Append-only, tamper-evident (SHA-256 hash chain). Queryable by actor, action, time, target.

*AC: Given 1000 entries, tampering with entry #500 detected via SHA-256 chain verification.*

**R-011: Cost Tracking**
Token usage and estimated cost tracked per task, agent, model, globally. Real-time on dashboard. Budget ceilings configurable per task (default: $10) and globally (default: $100/day). 80% → notify, 100% → pause.

*AC: Given task at 80% budget, notification sent. At 100%, task pauses awaiting approval.*

**R-012: Web Dashboard**
Active tasks, real-time event stream, approval inbox with one-click approve/reject, cost summary, agent health. Updates within 5 seconds via SSE/WebSocket.

*AC: Given new task event, appears in dashboard within 5 seconds. Given approval click, event emitted and workflow continues.*

### P1 — Should Have (V1)

> Multi-role execution, long-running operation, scheduled automation, and trust infrastructure.

**R-013: Multi-Role Agent Execution**
4 roles (Coordinator, Implementer, Verifier, Reviewer) with independent context, model config, and permissions. Roles communicate through event log, not direct messaging.

*AC: Given task requiring code changes, Coordinator decomposes and routes to appropriate roles. Given Verifier test failure, Implementer receives failure context for remediation.*

**R-014: Durable Long-Running Execution**
Tasks execute 4+ hours with checkpoint-based resume via Temporal. Survive process restarts. State reconstructable from checkpoints + event replay.

*AC: Given 2-hour task and process crash, task resumes from last checkpoint without data loss.*

**R-015: Hierarchical Compaction**
For tasks >1 hour: fast loop (minutes), checkpoint (hourly, independent summarizer model), review gate (daily/per-milestone). Summarizer is a separate model instance — not the active agent summarizing itself.

*AC: Given 3-hour task, hourly checkpoint produces progress file and refreshes active agent context.*

**R-016: Cron Scheduling**
Cron expressions, isolated sessions, JSONL run logs. Failed runs use exponential backoff (30s → 1m → 5m → 15m → 60m). System-created vs user-created job distinction. Agents cannot modify human jobs without Govern approval.

*AC: Given cron "0 9 * * MON", isolated session created Monday 9 AM. Given agent attempt to delete human job, blocked without Govern approval.*

**R-017: Notification System**
Slack webhook minimum, extensible. Categories: blocked approvals (real-time), digests (configurable), circuit breaker trips (real-time). Rate cap (default: 10/hour) → batch digest.

*AC: Given 15 notifications in one hour with cap of 10, notifications 11-15 batched into digest.*

**R-018: Context Pack System**
Per-repository context packs stored in repo (`.factory/context/`), human-editable, version-controlled. Loaded dynamically per task. Each pack includes provenance and freshness metadata.

*AC: Given repo with `.factory/context/conventions.md`, conventions loaded into agent context for that repo's tasks.*

**R-019: Validator Bundle**
Configurable: tests, linter, type-checker, security scanner, secret detector. Results included in evidence packet. Critical failures block auto-approval. Extensible.

*AC: Given validator bundle [tests, lint, security-scan], all three run and results appear in evidence packet.*

**R-020: Self-Healing with Guardrails**
External guardrails (outside agent process):

| Guardrail | Threshold |
|-----------|-----------|
| Max iteration limit | 10 repair attempts |
| No-progress detector | 3 loops without state change |
| Recurring error detector | 5 identical errors |
| Time budget | 30 minutes per repair |
| Cost budget | 50K tokens per repair |
| Loop-of-doom detector | 4+ consecutive identical failing calls |

Trips → pause, quarantine to DLQ, notify human.

**R-021: Circuit Breaker**
Per-tool and per-agent. States: Closed/Open/Half-open. Global kill switch (Redis key) checked at every tool invocation.

*AC: Given global kill switch set, all agent tool calls blocked and active tasks paused.*

**R-022: Directive System**
Human priority overrides that interrupt active execution, inject new instructions, re-route work. Scope: task/session/global. TTL. First-class events in audit log.

*AC: Given directive "Stop optimizing, add index and move to UI", agent execution interrupted, directive logged, agent resumes with new instruction.*

**R-023: Dead Letter Queue**
Tasks exceeding retry budget quarantined. Contains: TaskPacket, error chain, attempt count, context snapshot. Browsable in dashboard. Retryable or closeable.

*AC: Given task failed after 3 retries, DLQ shows original TaskPacket, error chain, and context snapshot.*

**R-024: Brownfield Onboarding**
1. **Map** — AST, file structure, dependency graph
2. **Interview** — clarifying questions for human sponsor
3. **Compile** — generate project-context, ADRs, testing-conventions, dependency maps
4. **Validate** — human reviews artifacts before factory begins work

*AC: Given existing repo, onboarding produces architecture map and context artifacts. Human can review/edit before write access granted.*

### P2 — Nice to Have (V1.x)

**R-025: Autonomy Levels 3-4**
L3 (Delegated Maintenance), L4 (Exception-Driven). Promotion requires qualification: 25+ tasks at current level, >90% success.

**R-026: Policy-as-Code**
Cedar or OPA for tool auth, filesystem scope, network egress, approvals, budgets. Auditable PolicyDecision records.

**R-027: Identity & Delegation Chain**
OAuth 2.0 Token Exchange with DPoP. Short-lived per-task credentials via Vault with auto-revoke.

**R-028: Eval Harness**
Regression + capability tests. Per-model baselines. Results drive qualification gates and drift detection.

**R-029: Drift Detection**
Rolling 7/30-day averages for success rate, cost, acceptance rate. Alert on significant deviation from 90-day baseline.

**R-030: Multi-Project Support**
Isolated execution, segregated storage, separate context packs, independent telemetry per project.

**R-031: Model Regression Detection**
Detect model change → temporary autonomy downgrade → 25 comparison tasks → promote or rollback.

**R-032: Plugin Manifest System**
JSONC manifests with JSON Schema validation. Version compatibility checks. Lazy loading.

### For Later (V2+)

| ID | Capability | Why Not Now |
|----|-----------|-------------|
| R-033 | Multi-Tenancy | Single-tenant covers initial target |
| R-034 | A2A Protocol Support | Protocol still maturing |
| R-035 | PII Redaction Pipeline | Valuable but not blocking core workflows |
| R-036 | Self-Learning Flywheel | Requires eval harness maturity first |
| R-037 | Digital Twin Validation | Speculative; needs strong validation environments |
| R-038 | Arena-Mode Model Evaluation | Optimization, not essential |
| R-039 | EU AI Act Conformity Assessment | Needed by Aug 2026; foundation built in R-010 |
| R-040 | Change Velocity Limits | Defer until throughput warrants it |
| R-041 | Nano-Model Providers | Cost optimization; unnecessary at initial scale |
| R-042 | Computer-Use Verification | Emerging capability; not core to engineering workflows |

---

## 7. Non-Functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-001 | Control plane API availability | 99.9% monthly |
| NFR-002 | Event durability | 0 data loss for committed events |
| NFR-003 | Resume reliability | >= 99% from latest checkpoint |
| NFR-004 | Approval action latency | p95 < 5s after state change |
| NFR-005 | Notification latency (critical) | p95 < 30s |
| NFR-006 | Security policy decision latency | p95 < 200ms |
| NFR-007 | End-to-end traceability | 100% run-to-evidence linkage |
| NFR-008 | Audit exportability | Full export of run history, policies, artifacts |
| NFR-009 | Cost governance | Hard budget enforcement per profile |
| NFR-010 | Long-run operation | 24h+ workflows with checkpointing |

---

## 8. Autonomy & Governance

### 8.1 Three Complementary Dimensions

| Concept | What It Defines | Example |
|---------|----------------|---------|
| **Authority Classes** (5) | What kind of action requires what gate | `Mutate` needs scope check; `Release` always needs human |
| **Autonomy Levels** (L0-L4) | How much independent action the system takes | L2 = create branches/PRs, not merge |
| **Policy Profiles** (4) | Bundled configuration presets | `standard` = L1 default, specific tool/scope/budget rules |

> Decision note: Authority classes and autonomy levels are complementary, not redundant. Authority classes describe the action type; autonomy levels describe the operational posture. Policy profiles bundle both into presets.

### 8.2 Autonomy Levels

| Level | Name | Description |
|-------|------|-------------|
| L0 | Observe | Read-only, summarize, recommend |
| L1 | Propose | Drafts, human approval for all mutations |
| L2 | Constrained Execute | Branches, code, tests, PRs; human approval before merge/deploy |
| L3 | Delegated Maintenance | Autonomous low-blast-radius work with mandatory rollback + monitoring |
| L4 | Exception-Driven | Background operation within policy; humans on exceptions only |

Initial default: **L1**. L3-L4 require qualification gates (P2).

### 8.3 Policy Profiles

| Profile | Default Level | Use Case |
|---------|--------------|----------|
| `supervised` | L0-L1 | New repos, unfamiliar domains, high-risk changes |
| `standard` | L1-L2 | Normal development work |
| `trusted` | L2-L3 | Proven workflows with qualification data |
| `expert` | L3-L4 | Well-understood maintenance tasks with strong evals |

Each profile resolves to explicit controls: tool classes, filesystem/network scope, max runtime, max agent depth, destructive command policy, required approvals, notification behavior.

### 8.4 Governance Rules

1. `Release` and `Govern` actions always require human approval in initial product
2. Model upgrade triggers temporary autonomy downgrade pending re-qualification
3. Kill switch is external to agent reasoning loop

---

## 9. Security & Compliance

### 9.1 Threat Model Priorities

1. Prompt injection and context poisoning
2. Tool misuse and privilege abuse
3. Plugin/supply-chain compromise
4. Unauthorized data egress / PII leakage
5. Cascading multi-agent failure

### 9.2 Required Controls (Day-1)

1. Append-only tamper-evident audit ledger
2. Ephemeral sandboxed execution with strict egress (default deny)
3. Two-phase runtime (setup with network, execution without)
4. Least-privilege credentials with JIT elevation and auto-revoke
5. Per-tool schema and policy checks (allowlisted, schema-validated)
6. Destructive actions require stronger approval
7. Security scanning on every mutating diff
8. PII scrubbing middleware for context/log pipelines
9. Mandatory human gates for Release and Govern classes
10. Dependency installation respects package allowlists (anti-slopsquatting)

### 9.3 Compliance-Ready Design

The initial product provides infrastructure that makes compliance achievable, not full automation:

- SOC 2-style access controls and change logs
- GDPR-style auditability and deletion handling
- Configurable data retention by artifact class
- Policy-based human oversight for regulated actions
- Full access/approval/change log export

---

## 10. Brownfield Onboarding & Portability

### 10.1 Onboarding Flow

The product must not assume that repo access = project understanding.

1. **Map** — AST, file structure, dependency graph, testing surfaces
2. **Interview** — Clarifying questions for human sponsor about undocumented decisions
3. **Compile** — Generate durable context artifacts:
   - `project-context.md`, `architecture-summary.md`, `testing-conventions.md`
   - `dependency-map.md`, `risk-register.md`, `operational-notes.md`
4. **Validate** — Human reviews artifacts before write access is enabled

### 10.2 Handoff Packets

Every human-AI handoff must include:

1. Goal and scope
2. Assumptions
3. Uncertainty flags
4. Completed evidence
5. Next action recommendation
6. Rollback path

### 10.3 Extraction (Exitability)

Export: decision history, ADR summaries, workflow history, known risks, runbooks, project context packs. "Ability to leave the factory" is a product quality metric.

---

## 11. Observability & Trust

### 11.1 Dual Logging Model

| Surface | Purpose | Contents |
|---------|---------|----------|
| **Machine trace** | Debugging, governance | Model calls, tool invocations, tokens, latency, state transitions, checkpoints, policy decisions |
| **Semantic timeline** | Human trust building | What the system is doing, why it changed direction, what failed, what's blocked, what evidence it gathered |

### 11.2 Key Metrics

1. Task success rate by workflow and risk class
2. First-pass acceptance rate
3. Human review time per evidence-backed PR
4. Regression/incident rate on factory-generated changes
5. Cost per successful task
6. Autonomy interruption and override frequency
7. Policy violation rate
8. Time-to-recover from run failure

### 11.3 Qualification Loops

1. Capture failures → build evals
2. Test candidate changes against baseline
3. Promote only on statistically meaningful improvement
4. Automatic rollback on drift

---

## 12. Extensibility

### 12.1 Extension Classes

1. Tool providers
2. Context providers
3. Workflow packs
4. Validator packs
5. Nano-model providers

### 12.2 Constraints

Extensions may add tools, context sources, validators, workflows, and stack-specific knowledge. Extensions must NOT bypass: audit logging, policy evaluation, approval requirements, sponsor attribution, isolation, or event capture.

### 12.3 Design Principle

Generic kernel, specific packs. The control plane stays general. Domain effectiveness comes through repo-specific context packs and workflow configurations, not monolithic prompt complexity.

---

## 13. Technical Constraints

### 13.1 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | TypeScript (Node.js 22+) | MCP SDK advantage, shared types with frontend |
| Durable Execution | Temporal | Phase 1 from day one. Battle-tested in production (OpenAI Codex). |
| Model Routing | OpenRouter (primary) + direct SDKs | Multi-vendor flexibility from day one. Direct SDK fallback required — OpenRouter had significant outages Feb 2026. |
| Event Bus | NATS JetStream | Small binary, fast, exactly-once delivery |
| Primary DB | PostgreSQL 16 | State, audit, artifacts, event store |
| Vector Search | pgvector + pgvectorscale | No separate service needed |
| Cache/PubSub | Redis 7 | Session state, pub/sub, kill switch |
| Object Store | MinIO (self-hosted) / R2 (cloud) | Artifacts, run logs, evidence packs |
| Dashboard | SvelteKit | Small bundle, native WebSocket, TypeScript-first |
| Observability | OpenTelemetry + Arize Phoenix | OTel-native, open-source |
| Sandboxing | Docker + gVisor (Phase 1), Firecracker (Phase 2) | Progressive isolation |
| Deployment | Docker Compose (Phase 1) → Kubernetes (Phase 2) | Minimal ops, then scale |

### 13.2 Architectural Constraints

1. **Modular monolith, not microservices.** Extract services only on measured bottleneck.
2. **Single-tenant first.** Multi-tenancy deferred.
3. **Self-hostable required.** No managed-only hard dependencies.
4. **Factory logic in code, not prompts.** LLMs are replaceable nodes within deterministic DAGs.
5. **Agents propose, orchestrator applies.** Intention-mutation separation. Agents emit structured JSON; orchestrator validates, persists, applies.
6. **Completed tasks cannot regress.** Defects create new correction paths. Rollback is additive.

### 13.3 Open Hard Problems

1. **Context coherence over 24+ hours** — structured artifacts outperform raw chat, but hierarchical compaction is unproven at scale
2. **Holdout validation** — agents rewrite tests to match buggy code if given write access to test files
3. **Prompt injection via repo content** — mitigated through defense-in-depth, not fully solvable
4. **AI-generated technical debt** — surfaces 30-90 days post-generation; detection is hard
5. **Epistemic uncertainty** — agents guess instead of asking; uncertainty estimation remains underinvested

---

## 14. Build Phases & Roadmap

### Phase 1: Factory Kernel (Weeks 1-4)

**Goal:** Execute the scoreable loop once, end-to-end, on a single repo.

- R-001 (Event log), R-002 (TaskPacket), R-003 (PR workflow), R-009 (OpenRouter), R-010 (Audit), R-011 (Cost tracking)
- Single agent (one agent does plan + implement + validate)
- Docker Compose: PostgreSQL + Redis + Temporal + TypeScript monolith
- CLI-only interface

### Phase 2: Control Surface (Weeks 5-8)

**Goal:** Humans can see, approve, and steer from a dashboard.

- R-004 (Sandbox), R-005 (Approval gates), R-006 (Evidence packets), R-007 (Autonomy levels), R-008 (MCP tools), R-012 (Dashboard)
- NATS JetStream for real-time events
- SvelteKit dashboard with SSE
- Slack notifications (partial)

### Phase 3: Multi-Role & Duration (Weeks 9-12)

**Goal:** Multi-agent execution with long-running capability.

- R-013 (Multi-role), R-014 (Durable execution), R-015 (Compaction), R-016 (Cron)
- Coordinator/Implementer/Verifier/Reviewer split

### Phase 4: Trust & Governance (Weeks 13-16)

**Goal:** System earns higher autonomy through demonstrated competence.

- R-018 (Context packs), R-019 (Validators), R-020-R-024 (Self-healing, circuit breakers, directives, DLQ, brownfield onboarding)
- Begin P2 requirements (R-025-R-032, partial)
- Eval harness for qualification gates

---

## 15. Success Metrics & Hypotheses

### 15.1 Product KPIs

| Metric | Target (3 months) | Measurement |
|--------|-------------------|-------------|
| Time: issue to mergeable PR | <4h for bounded tasks | `task.created` to `task.review.requested` |
| Human review efficiency | <10 min/PR with evidence | Evidence delivery to decision |
| Task completion rate | >80% within trained scope | `completed / created` (excl. cancelled) |
| 24h autonomous operation | <5 human interventions for maintenance | `review.requested` per 24h at L2+ |
| Cost per completed PR | <$25 avg for bounded tasks | Sum of CostRecord per task |
| Incident rate | <5% regression within 30 days | Post-merge incidents linked to factory tasks |
| Checkpoint resume success | >= 99% | Successful / total resume attempts |
| Evidence completeness | >= 90% with full packets | Complete evidence / total tasks |

### 15.2 Trust KPIs

1. Approval acceptance trend rises with stable or lower rollback rate
2. Human override/directive rate declines for stable workflows
3. Reduction in unknown-assumption failures due to ask-before-act
4. Reviewer confidence score trends upward

### 15.3 Falsifiable Hypotheses (First Year)

1. Centralized coordinator improves completion rate by >=15% vs single-agent baseline on structured tasks
2. Mandatory evidence bundles reduce median review time by >=20%
3. Profile-based autonomy keeps low-risk autonomous rollback rate below 2%
4. ContextPack retrieval reduces repeated clarification turns by >=30%
5. Model canary + eval gating prevents net regression >2pp after upgrades
6. Fallback chains reduce hard task failure rate by >=25% vs single-model
7. Loop-of-doom detection reduces wasted token spend by >=40%
8. Security/policy checks before approval reduce post-merge findings/KLOC by >=30%
9. Brownfield onboarding artifacts reduce first-30-day incident rate by >=25%
10. Change velocity caps reduce adaptation-lag incidents by >=35% with throughput loss <10%

---

## 16. Risk Register

| ID | Risk | Severity | Early Warning Signal | Mitigation |
|----|------|----------|---------------------|------------|
| RISK-01 | Context coherence fails over long runs | Critical | Repeated identical failures, rising manual resets | Event-sourced state + hourly compaction + uncertainty escalation |
| RISK-02 | Security/authority leak via tools or prompts | Critical | Unexpected egress attempts, policy denial spikes | Least privilege + deny-by-default + sandbox hardening |
| RISK-03 | Reviewer fatigue and trust collapse | Critical | Rising reject/rework rates, increasing review time | Minimum evidence packet + PR size policy + annotated diffs |
| RISK-04 | Model upgrade regression | High | Post-upgrade acceptance drop, 7/30-day canary drift | Qualification gates + staged rollout + auto-downgrade |
| RISK-05 | AI-generated technical debt | High | Incidents 30-90 days post-generation | Validator bundle + drift detection + periodic scans |
| RISK-06 | Brownfield ingestion failure | High | Regressions in legacy zones, slow time-to-first-safe-task | Structured onboarding with human signoff |
| RISK-07 | Misconfigured autonomy | High | Approval spam or unsafe actions | Profile defaults + risk-based gates + simulation mode |
| RISK-08 | Overuse of multi-agent topology | High | Latency up, quality flat, cost rising | Route by task structure; default centralized |
| RISK-09 | Handoff ambiguity | High | Reopen loops, contradictory changes | Standard handoff packet + directive override |
| RISK-10 | Alert fatigue | Medium | Slow ack latency, muted channels | Real-time for blockers only, digest for rest |
| RISK-11 | Lock-in / extraction failure | Medium | Incomplete offboarding data | Continuous docs-as-artifacts + export completeness score |
| RISK-12 | Product becomes framework museum | Medium | Much config, few successful workflows | One excellent workflow before adding more |
| RISK-13 | Cascading multi-agent failure | Low (Critical impact) | Sudden multi-task failures | Circuit breakers, kill switch, context sharding |

---

## 17. Competitive Positioning

| System | Strength | Gap This Factory Fills |
|--------|----------|----------------------|
| **BMAD Method** | Best artifact-driven workflow/context | No runtime, no execution, no observability |
| **OpenClaw** | Best open-source runtime/gateway | 512 security vulnerabilities, no structured workflow |
| **Devin** | Full SaaS agent, improving rapidly | 85% failure rate, no configurable autonomy, opaque |
| **GitHub Copilot Agent** | Deepest GitHub integration | Single-PR scope, no multi-step orchestration |
| **Claude Code** | Best CLI agent | No persistent orchestration, no multi-agent coordination |
| **LangGraph** | Best durable execution framework | Framework, not product |
| **Microsoft Agent 365** | Best enterprise governance | Azure-locked, not self-hostable |

**Position:** The integration layer — combining BMAD-quality workflow with OpenClaw-class runtime, Claude Code-class execution, and LangGraph-class durability, with configurable autonomy and evidence-based trust.

---

## 18. Non-Goals

1. Not an IDE or code editor — engineers use their preferred tools
2. Not a code generation model — models are replaceable workers
3. Not a CI/CD replacement — orchestrates existing CI/CD
4. Not a general-purpose agent framework or SDK
5. Not targeting L4+ autonomy in V1 — L2 is the production default
6. Not multi-tenant from day 1
7. Not for non-engineering workflows
8. Not a hosted SaaS — self-hostable required
9. Not competing with BMAD or OpenClaw — can integrate with both

---

## 19. Open Questions

### Decided

| # | Question | Decision |
|---|----------|----------|
| 1 | License model | Open source, option to evolve later |
| 2 | First target repos | Greenfield + new services. Self-running agent deferred. |
| 3 | Temporal timing | Phase 1, from day one |
| 4 | Model routing | OpenRouter primary, direct SDKs as fallback |
| 5 | Evidence packet scope | Configurable per-workflow/per-user with sensible defaults |

### Open

1. **Cedar vs OPA for policy-as-code?** Cedar has better authoring UX; OPA has broader ecosystem.
2. **Sandbox progression?** gVisor → Firecracker timeline and triggers.
3. **Event store: PostgreSQL JSONB vs dedicated EventStoreDB?** Simpler vs better tooling.
4. **First compliance target?** SOC 2, HIPAA, or EU AI Act (August 2026 deadline)?
5. **Dashboard primary view?** Task list, event stream, or approval inbox?
6. **Epistemic uncertainty UX?** How to surface agent uncertainty to humans?
7. **Autonomy promotion metrics?** Success rate alone insufficient — need quality trends, regression rates.
8. **Change velocity limits?** How many PRs/day before requiring pace check?
9. **Model vendor outage handling?** Auto-failover or pause-and-wait?
10. **Inter-project knowledge transfer?** Context sharding prevents it; is there a safe middle ground?

---

## 20. Gaps and Unresolved Items

### Missing Detail

1. **Risk taxonomy for task → autonomy mapping** — all sources flag as needed; none define it
2. **PR size policy** — referenced as review fatigue mitigation, no concrete limits
3. **Hard budget defaults by profile** — tokens, time, tool calls per profile not specified
4. **Notification channel extensibility** — Slack is minimum, extension interface not designed
5. **Extraction workflow detail** — described as requirement, less detailed than onboarding

### Editorial Decisions Made

1. **Timeline: 16 weeks** over 12. The 12-week version was tighter but assumed Phase 1 kernel in 3 weeks, which is aggressive with Temporal + PostgreSQL + NATS + OpenRouter setup.
2. **Phase 1 approach: CLI-only single agent** over schemas-first. Most concrete path to a working loop. Kernel-first emphasis reflected in Phase 1 priorities.
3. **Autonomy model: three complementary dimensions** (authority classes + levels + profiles). They serve different purposes and are not redundant.

### Genuine Unknowns (All Sources Vague)

1. **Context compaction at scale** — all flag as hard, none claim proven solution
2. **Holdout validation tension** — agents need to write tests, but test write access enables cheating
3. **Factory self-maintenance** — recursive trust problem, no concrete model proposed
4. **Long-term model cost trajectory** — if costs drop 10x, some decisions (model tiering, nano-models) become unnecessary complexity

### Dependency Notes

1. Phase 2 dashboard depends on Phase 1 event infrastructure being stable
2. Phase 3 multi-role depends on Phase 2 sandbox being reliable
3. Phase 4 qualification depends on Phase 3 producing enough data for evals
4. Brownfield onboarding is Phase 4 but may need to move earlier if "new services in existing systems" is a priority target

---

## Appendix: Reference Sources

Full source index in `docs/research.md`. Key references:

- Google Scaling Study (arXiv:2512.08296) — architecture-task fit
- ESAA (arXiv:2602.23193) — event sourcing pattern for agents
- METR Time Horizons (metr.org) — autonomous task duration data
- Google DORA 2025 — AI adoption impact on engineering metrics
- OWASP Agentic AI Top 10 — threat landscape
- OpenClaw PRISM (arXiv:2603.11853) — defense-in-depth security
- ContextBench (arXiv:2602.05892) — context engineering effectiveness
- Anthropic 2026 Agentic Coding Trends — autonomy measurement
- SWE-CI (arXiv:2603.03823) — CI-native evaluation
- MCP Spec releases — tool interoperability
- A2A Protocol (Linux Foundation) — agent interoperability
