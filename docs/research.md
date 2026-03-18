# Software Factory — Consolidated Research

**Date:** 2026-03-17 / 2026-03-18
**Status:** Complete — ready for PRD
**Sources:** 25+ research documents, 200+ primary sources, 4 parallel researcher tracks, 2 supplementary analyses

---

## 1. Executive Summary

The strongest March 2026 evidence converges on a single thesis: **the best software factory is a legible production system for engineering work, not an autonomous swarm**. This finding is consistent across OpenAI's harness engineering, Anthropic's long-running agent guidance, Google's 180-configuration scaling study, BMAD's artifact-driven methodology, OpenClaw's runtime primitives, and the 2026 benchmark wave (SWE-CI, LongCLI-Bench, ContextBench, ESAA).

A critical design tension emerges: **model capabilities are improving fast enough (autonomous task duration doubling every ~123 days) that elaborate scaffolding today becomes dead weight in 12-18 months**. The winning strategy is a thin, model-agnostic orchestration layer with strong observability, security, and human control — not maximum framework complexity.

The product should be built as a **software-factory control plane** with pluggable runtimes, not as a single monolithic "super agent." Or put differently: **don't build an AI that can code anything — build an AI-native CI/CD pipeline** that structures human-AI collaboration, safely scopes execution, intelligently manages working state, and cleanly logs evidence.

---

## 2. What Exists Today: System Landscape

### 2.1 The Three-Layer Pattern

Every successful system in 2026 follows a three-layer pattern. No single system covers all three well:

| Layer | Purpose | Best Examples |
|-------|---------|---------------|
| **Workflow/Context** | Artifacts, phases, conventions, project knowledge | BMAD Method, Claude Code CLAUDE.md |
| **Runtime/Gateway** | Sessions, scheduling, routing, channels, model dispatch | OpenClaw, LangGraph, Temporal |
| **Execution/Tools** | Sandboxed code execution, tool calls, LLM interaction | Claude Code, OpenHands, SWE-agent, E2B |

The opportunity is to build the integration layer.

### 2.2 Architectural Archetypes

Four distinct archetypes have emerged. The most effective factories combine elements of multiple archetypes:

| Archetype | Primary Focus | Core Mechanisms | Representative Systems |
|-----------|---------------|-----------------|----------------------|
| **Control Plane** | Continuous runtime, routing, environment bridging | Event listeners, sandboxed execution, shared memory state | OpenClaw |
| **Artifact-Driven** | Fidelity to NFRs and context management | Codebase flattening, story files, strict agile roles | BMAD Method |
| **Dark Factory** | Zero-human intervention, probabilistic verification | Digital Twin Universes, iterative loops, holdout sets | StrongDM, Ralph |
| **Organizational Swarm** | Multi-agent collaboration and resource optimization | Isolated sandboxes, explicit code review, role-specialized models | Agyn, Ruflo |

### 2.3 Key Systems Evaluated

**BMAD Method** — Workflow/context layer. Four-phase pipeline (Discovery → Planning → Solutioning → Implementation) with explicit artifacts (`PRD.md`, `architecture.md`, `project-context.md`) and phase gates. Quick Flow skips phases 1+3 for small changes. TEA (Test Engineering Architect) provides 9 enterprise testing workflows with evidence-based release gates (PASS/CONCERNS/FAIL/WAIVED). Uses tournament-selection ML and heuristic algorithms to evaluate developer agent outputs against organizational standards. Generates traceability matrices mapping code back to verified business requirements. Strengths: artifacts survive sessions, role specialization, complete enterprise testing. Weaknesses: no runtime layer, prompt-heavy architecture susceptible to model churn, manual brownfield import. Latest release: v6.2.0 (2026-03-15).

**OpenClaw** — Runtime/gateway layer. Self-hosted WebSocket server coordinating sessions, agents, channels (Slack/Telegram/Discord/etc), typed tools with allow/deny lists, subagent isolation, and cron scheduling (at/every/cron expressions with isolated sessions, JSONL run logs, exponential backoff). March 2026 additions: scheduler-to-session binding, spawned-session resume, turn-yield control, sandbox boundary hardening. PRISM (arXiv:2603.11853) adds 10-hook defense-in-depth. Weaknesses: native plugins unsandboxed, security needs explicit PRISM config, single-process model, file-based JSONL storage. CVE-2026-25253: WebSocket RCE affecting 30,000+ instances.

**Devin (Cognition)** — Full SWE agent. ~67% PR merge rate (Nov 2025), dropped from $500/mo to $20/mo. ~15% complex task completion without human help. No cross-session memory (mid-2025). Key lesson: the bottleneck shifted from code writing to task scoping and delegation judgment. Defect rate ~1.5-2x higher than senior developer.

**Open-Source Agents** — SWE-agent's ACI (Agent-Computer Interface) is the key insight: LLMs need purpose-built interfaces. AutoCodeRover achieves 46.2% SWE-bench Verified at <$0.70/task via AST-level code search. Aider's architect/coder split (stronger model reasons, cheaper model edits) is cost-efficient and validated. OpenHands V1 SDK uses event-sourcing at core with Docker isolation and LLM-powered action-level security. Live-SWE-agent achieves 79.2% SWE-bench Verified via runtime self-evolution.

**IDE Agents** — Cursor ($2.3B raised, $29.3B valuation): VS Code fork with repo-wide RAG, sub-agents, and rules system (`.cursor/rules/*.mdc`). Windsurf/Cascade: model-harness co-optimization via RL produces better results but creates lock-in. Claude Code: CLI-first, CLAUDE.md as project OS, hooks system, MCP with lazy loading (95% context reduction), skills as markdown.

**Multi-Agent Frameworks** — LangGraph: graph-based with checkpoint-at-every-super-step and human interrupt; strongest programmatic HITL. CrewAI: role-based teams with sequential/hierarchical processes and event-driven flows. Microsoft Agent Framework: merged AutoGen + Semantic Kernel (GA Q1 2026) with both LLM-driven and deterministic workflow orchestration.

**Enterprise Platforms** — GitHub Copilot coding agent: PR-native with sandbox, read-only base, workflow-run approval gates, Agent HQ for mission control. Amazon Q: deepest AWS integration, bounded autonomous capabilities. Google Jules: async repo agent cloned to GCP VM, shows plan before acting, now Gemini 3 Pro powered. Microsoft Agent 365 (GA May 2026): enterprise control plane for observing, governing, managing, and securing agents.

**Dark Factory Pattern (StrongDM, Ralph)** — The extreme autonomy archetype. Code must neither be written nor reviewed by humans. Relies on Digital Twin Universes — highly accurate behavioral clones of third-party services and APIs — to evaluate code based on probabilistic "satisfaction metrics" (fraction of observed trajectories satisfying original intent) rather than binary pass/fail testing. The Ralph methodology implements a persistent loop: agent executes → commits → writes status to progress file → stop hook checks CI green + completion promises → if unmet, agent reviews modified files + git history, learns from localized failure, and iterates. Key lesson: holdout validation is critical — agents rewrite tests to match buggy code, so behavioral specs must be outside agent's write scope.

**Agyn Framework** — Organizational swarm archetype. Explicitly replicates engineering team dynamics: Manager agent oversees workflow, coordinating Researcher, Engineer, and Reviewer. Each agent operates in strictly isolated sandbox with deterministic package managers. Heavy reasoning → large frontier models; implementation → smaller specialized coding models. The Engineer submits a PR; the Reviewer must provide explicit inline approval before the Manager considers the task complete. Achieves competitive SWE-bench resolution rates by emphasizing organizational design over raw model capability.

### 2.4 Cross-Cutting Lessons

1. **Artifacts beat chat history** — BMAD, OpenHands, LangGraph, Anthropic progress files all converge on explicit artifact-based state
2. **Architecture-task fit beats agent count** — Google's 180-config study: centralized +80.9% on structured tasks; adding agents when single-agent baseline >45% produces negative returns
3. **Task scoping is harder than code generation** — Devin's experience confirms this
4. **The architect/coder split works** — Aider's pattern is validated and cost-efficient
5. **Holdout validation is critical** — agents rewrite tests to match buggy code; behavioral specs must be outside agent's write scope (StrongDM)
6. **IDE agents and terminal agents are complementary** — most common 2026 production setup uses both
7. **Context engineering matters more than prompt engineering** — orchestration design, evaluation, tool safety specification are the new core skills
8. **Epistemic humility is a missing capability** — agents fail because they guess instead of asking; uncertainty estimation and escalation-on-low-confidence are underinvested
9. **Prompts rot; factory logic must be in code** — if factory logic is encoded in system prompts, it dies within 6 months; treat LLMs as replaceable text-transformation nodes within deterministic DAGs

### 2.5 Production Readiness

**Production-ready (build on today):** MCP for tool integration (10,000+ servers, Linux Foundation standard); ESAA event sourcing pattern; centralized coordinator + worker topology; profile-based progressive autonomy; OpenTelemetry GenAI Semantic Conventions; Cedar/OPA for policy-as-code.

**Experimental (design for, don't depend on):** MCP stateless sessions and resumption (June 2026 spec target); MCP Apps for interactive UI; A2A protocol for cross-vendor agent delegation; week-scale autonomous agent tasks; self-improving agent architectures.

---

## 3. Recommended Architecture

### 3.1 Seven-Plane Model

#### A. Experience Plane
Chat/command input, web UI, PR comments, issue tracker events, schedules, webhooks, notifications (Slack/email/webhook), approval inbox, operations dashboard.

#### B. Control Plane (the core product)
Identity and tenancy; autonomy policy selection; task intake and normalization; workflow selection; run creation and checkpointing; evidence capture; approval routing; budgets and quotas; audit and replay; extension registration; observability.

#### C. Context & Knowledge Plane
Artifacts, not hidden memory: PRDs, research docs, plans, ADRs, repo map, architecture graph, conventions, prior runs, test/deploy topology, incidents, postmortems. Supports retrieval by task, freshness tracking, provenance, and compaction into task packets. Implements **Context Packs** — hyper-specific, repo-scoped knowledge bundles (e.g., "Python FastAPI Security Pack" for Repo A, "React/Next.js Pack" for Repo B) loaded dynamically based on task context.

#### D. Orchestration Plane
Task classification, decomposition, architecture selection, worker assignment, retry policies, parallelism control, escalation triggers, stop conditions. Selects between:
- **Quick path** — single bounded agent, small change, strong acceptance criteria
- **Team path** — coordinator + workers + verifier, decomposable task, explicit subtask contracts
- **Long-run path** — resumable execution, stronger validators, mandatory checkpoints, higher review burden

#### E. Execution Plane
Ephemeral sandbox runners, sandboxed shells, browser runtimes, CI runners, staging environments. Workers never own long-term truth — they act on task packets and emit evidence.

#### F. Validation Plane
Unit/integration/e2e tests, browser/UX checks, lint/type checks, dependency/secret scanning, policy checks, architecture conformance, release-readiness scoring, rollback readiness. Includes traceability matrices mapping code to verified business requirements.

#### G. Learning & Qualification Plane
Bounded self-improvement: capture failures/drift → generate hypotheses → test prompt/skill/workflow variants → run evals → qualify changes → promote only if metrics improve within policy.

### 3.2 Core Data Model

| Entity | Purpose |
|--------|---------|
| `TaskPacket` | Objective, scope, risk class, constraints, budget, deadline |
| `ContextPack` | Selected artifacts + freshness + provenance |
| `ExecutionPlan` | Decomposition, role assignment, approval points |
| `RunCheckpoint` | Resumable runtime state |
| `EvidenceBundle` | Tests, diffs, tool logs, policy decisions, uncertainties |
| `ApprovalRecord` | Who/what/when/why/scope/TTL |
| `PolicyDecision` | Allow/deny with rule trace |
| `MemoryItem` | Claim, citations, validation status, expiry |
| `Directive` | Priority override with steering instruction (see §5.7) |

### 3.3 Agent Roles (Start with 4)

| Role | Responsibility | Model Class |
|------|---------------|-------------|
| **Coordinator** | Task decomposition, routing, checkpoint management | Strong (Opus-class) |
| **Implementer** | Code writing, file editing, tool execution | Strong or mid-tier |
| **Verifier** | Test execution, security scan, lint, type-check | Mid-tier (Sonnet-class) |
| **Reviewer** | Code review, architectural assessment, evidence packet assembly | Strong (Opus-class) |

Add more roles only when evals prove a stable bottleneck.

### 3.4 Architecture Diagram

```
User (Human-in-the-Loop)
  │
  ├── Dashboard (SvelteKit) ←── SSE/WebSocket ←── NATS Events
  │
  ├── Notification Service (Slack/Email/Webhook)
  │
  └── API Gateway
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │           COORDINATOR AGENT                  │
  │  Task decomposition, routing, checkpoints    │
  │  ESAA event log (append-only)               │
  │  Policy enforcement (Cedar/OPA)             │
  └──────┬──────────┬──────────┬────────────────┘
         │          │          │
    ┌────▼────┐ ┌───▼───┐ ┌───▼────┐
    │IMPLEMENT│ │VERIFY │ │REVIEW  │
    │  Agent  │ │ Agent │ │ Agent  │
    └────┬────┘ └───┬───┘ └───┬────┘
         │          │          │
    ┌────▼──────────▼──────────▼────┐
    │     SANDBOXED EXECUTION       │
    │  (Firecracker/gVisor/Docker)  │
    │  Per-task ephemeral workspace │
    └───────────────┬───────────────┘
                    │
    ┌───────────────▼───────────────┐
    │        MCP TOOL LAYER         │
    │  GitHub, Linear, Slack, CLI,  │
    │  Security scanners, etc.      │
    └───────────────────────────────┘
```

### 3.5 Why Centralized Coordinator

**Empirical basis (Google's scaling study, 180 configurations):**
- Error amplification: centralized contains at 4.4x (vs 17.2x for independent agents)
- Centralized +80.9% on structured/parallelizable tasks (the factory's primary workload)
- Tool-coordination trade-off: systems with 16+ tools see coordination efficiency collapse from 0.466 to 0.074 with multi-agent
- Capability saturation: when single-agent baseline >45%, adding agents produces negative returns
- Predictive model correctly identifies optimal architecture for 87% of unseen tasks

### 3.6 ESAA Event Sourcing Pattern

From arXiv:2602.23193. Applies event sourcing to LLM-based software engineering agents:

- **Source of truth:** append-only immutable log (`activity.jsonl`), not current snapshot
- **State as projection:** `roadmap.json` derived deterministically from events via pure projection function
- **Intention-mutation separation:** agents emit structured JSON intentions; deterministic orchestrator validates, persists, applies. Agents never mutate state directly
- **SHA-256 divergence detection** between expected and actual state
- **Completed tasks cannot regress** — defects create new correction paths via `issue.report` events
- **CQRS alignment:** write (event append) decoupled from read (projection query)

Aligns perfectly with immutable rules: transparency (full audit trail), user control (inspect every event), security (agents propose, orchestrator applies).

**Key advantage for long-running autonomy:** Instead of forcing the agent to remember entire project history, the orchestrator generates a "purified view" from the event log, injecting only the specific facts required for the immediate task — maintaining cognitive coherence over 24+ hour execution horizons.

---

## 4. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Language** | TypeScript (Node.js 22+) | MCP SDK advantage (TS-specific helpers), shared types with frontend |
| **Job queue (phase 1)** | pg-boss (Postgres-backed) | Windmill proved this pattern; minimal ops |
| **Orchestration (phase 2)** | Temporal | Durable execution for hour+ agent workflows; survives process crashes |
| **Event bus** | NATS JetStream | 20MB binary, microsecond latency, exactly-once delivery, no partition tuning |
| **Primary DB** | PostgreSQL 16 | State, audit log, artifact metadata, event store |
| **Vector search** | pgvector + pgvectorscale | 471 QPS at 99% recall on 50M vectors; no separate service needed |
| **Cache / PubSub** | Redis 7 | Session state, real-time pub/sub to dashboard |
| **Object store** | MinIO (self-hosted) / R2 (cloud) | Artifacts, run logs, evidence packs |
| **Dashboard** | SvelteKit | 65% smaller bundle than Next.js, native WebSocket, TypeScript-first |
| **Observability** | OpenTelemetry + Arize Phoenix | OTel-native, single Docker container, open-source |
| **Auth/Policy** | OPA + Cedar policies | Policy-as-code for tool authorization |
| **Deployment (phase 1)** | Docker Compose | Minimal ops, fast iteration |
| **Deployment (phase 2)** | Kubernetes + Helm | Production scale, worker pod autoscaling |

**Key decisions:**
- **TypeScript-only to start.** Python deferred until ML workloads require it.
- **Modular monolith, not microservices.** Extract services only when measurable bottleneck requires it. Nanosecond function calls vs millisecond service calls = 1,000,000x difference.
- **Single-tenant first.** Multi-tenancy deferred per immutable rule on user control.
- **Self-hostable required.** Managed-only services (Inngest cloud, Pinecone) disqualified as required dependencies.
- **Factory logic in code, not prompts.** LLMs are replaceable text-transformation nodes within deterministic TypeScript DAGs. When GPT-6 or Claude 5 releases, swap the brain; the tools and orchestration remain untouched.

**Event model (minimum viable):**
```
task.created           — new task from user
task.spec.generated    — tech spec artifact produced
task.assigned          — task routed to agent role
agent.started          — agent session began
agent.llm.called       — LLM API call (with token counts)
agent.tool.invoked     — tool action executed (args, result summary)
agent.artifact.written — artifact produced (type, path, hash)
agent.checkpoint       — agent saved resumable state
agent.completed        — agent session ended (success/failure)
task.review.requested  — human review gate triggered
task.review.approved   — human approved
task.review.rejected   — human rejected (with reason)
task.directive.issued  — human steering override injected
task.failed            — task ended in failure
task.completed         — task fully done, artifacts emitted
```

**Phased deployment:**
- Weeks 1-4: Docker Compose with PostgreSQL + Redis + TypeScript monolith (pg-boss for jobs). Get event model and first agent loop working.
- Weeks 4-8: Add NATS JetStream. Migrate to NATS topics. Add SvelteKit dashboard consuming real-time events via SSE.
- Weeks 8-12: Add Temporal for workflows that require durable execution. Simple short tasks stay on pg-boss.

---

## 5. Human-in-the-Loop & Autonomy Design

### 5.1 Industry Consensus

Three independent frameworks (ASDLC, Knight Columbia, James Read/Stride) converge on L1-L5 autonomy taxonomy adapted from SAE automotive levels. **L3 (Conditional) is the production default**, not L5 (Full Autonomy).

**Anthropic empirical data:**
- Developers use AI in ~60% of work but fully delegate only 0-20% of tasks
- Average: 4.1 human turns per agentic session
- New users (<50 sessions): ~20% auto-approve
- Experienced users (~750 sessions): >40% auto-approve, but interrupt *more* (5% → 9% of turns) — just more strategically
- Trust grows gradually through demonstrated competence

### 5.2 Autonomy Levels

| Level | Name | Human Role | Default For |
|-------|------|-----------|-------------|
| **0** | Observe | Read-only; summarize and recommend; no write actions | Monitoring, analysis |
| **1** | Propose | Produce drafts (PRDs, specs, patches); human approval before any mutation | New repos, cautious orgs |
| **2** | Constrained Execute | Create branches, edit code, run tests, open PRs; human approval before merge/deploy | Most production work |
| **3** | Delegated Maintenance | Autonomous low-blast-radius maintenance; mandatory rollback + monitoring | Proven agents on known tasks |
| **4** | Exception-Driven | Background operation within policy; humans on exceptions only | After strong qualification data |

### 5.3 Profile-Based Architecture with Override Layer

**Four named profiles** (supervised/standard/trusted/expert) that encode sensible defaults. Per-capability overrides on top of profiles. New users start supervised. System suggests profile upgrades based on objective track record metrics.

**Policy dimensions** (multi-axis, not single slider): repo/service, environment, tool class, data sensitivity, risk class, time window, budget, initiator, user role, change type.

**Each profile resolves to a concrete policy bundle:** filesystem scope, network/egress scope, allowed tools, destructive-command behavior, max runtime, max tool calls, max agent depth, approval requirements, notification requirements.

### 5.4 Permission Model

**Authority classes (escalating approval required):**

| Class | Scope | Examples |
|-------|-------|---------|
| **Read** | Repo, docs, issues, observability | Code analysis, documentation lookup |
| **Propose** | Draft artifacts, comments, suggested diffs | Plan updates, spec generation |
| **Mutate** | Git branch/file changes, PR creation, ticket updates | Code generation, test writing |
| **Release** | Merge, deploy, rollback, feature flags | Production changes |
| **Govern** | Policy changes, permission changes, secrets, plugin installation | System configuration |

**Identity model:** Every agent linked to a named human sponsor at creation. OAuth 2.0 Token Exchange (RFC 8693) with DPoP (RFC 9449) for delegation chains. JIT elevation for above-standing permissions (time-boxed, auto-revoke).

**Model upgrade protocol:** When underlying model changes, agent's profile temporarily downgrades one level until re-validation (default: 25 tasks at reduced autonomy).

### 5.5 Approval Patterns

- **Propose-then-Execute** — default for destructive/external actions
- **Confidence-Based Routing** — auto-approve safe actions; propose-then-execute for risky ones
- **Risk-Based Sampling** — 100% approval for high-risk; sampled for low-risk to catch drift
- **Batch/Plan-Level Approval** — approve the plan; agent executes without per-step interruptions
- **Async gate with escalation** — 4-hour timeout → named deputy → team channel → auto-reject with incident notification
- **Evidence packets before human review** — tests + security scan + lint/type-check must pass before entering approval queue

### 5.6 Notification Design (Preventing Alert Fatigue)

- **Real-time:** only blocked approvals and circuit breaker trips
- **Digests:** completed-work summaries (hourly or per-task)
- **Passive:** audit logs for everything else
- **Never notify** on actions verified by automated checks
- **Cap interrupt rate:** >N approval requests/hour → pause and request plan-level approval
- **Slack Block Kit** with one-click approve/reject buttons; decision writes back automatically

### 5.7 Directives: Human Steering Mechanism

When the AI goes down the wrong path, a human can inject a **Directive** — a priority override that forcefully interrupts the active loop, clears the active memory buffer, and re-initializes with the new instruction. Schema:

```
{
  "priority_override": true,
  "directive": "Stop optimizing the DB query, just implement a basic index and move to UI",
  "scope": "task|session|global",
  "ttl": "until_task_complete"
}
```

The orchestrator intercepts, logs the directive as an event (`task.directive.issued`), and re-routes the active agent. Directives are first-class citizens in the event log — auditable and replayable.

---

## 6. Security Architecture

### 6.1 Threat Landscape

**OWASP Agentic AI Top 10 (December 2025):**
1. Agent Goal Hijack (prompt injection → goal redirection)
2. Tool Misuse (agents using tools outside intended scope)
3. Identity & Privilege Abuse (confused deputy, lateral movement)
4. Agentic Supply Chain (compromised MCP servers, poisoned skills)
5. Unexpected Code Execution (RCE via hooks/config)
6. Memory & Context Poisoning (persistent injection across sessions)
7. Insecure Inter-Agent Communication
8. Cascading Failures (one agent poisons 87% of downstream decisions in 4 hours — Galileo AI)
9. Human-Agent Trust Exploitation
10. Rogue Agents

**Authority leaks** — a critical failure mode where a compromised or hallucinating agent uses its elevated permissions for unauthorized state mutations or data exfiltration. Because native plugins in frameworks like OpenClaw run within the process space, a sophisticated prompt injection hidden in an external dependency or issue tracker can hijack the agent's control flow, effectively granting RCE. Requires architectural shift from monolithic permissions to strict least-privilege with per-invocation audit.

**Real CVEs in this project's tooling:**
- Claude Code CVE-2025-59536: Arbitrary shell via hooks in untrusted repos
- Claude Code CVE-2026-21852: Silent API key exfiltration before trust prompt
- OpenClaw CVE-2026-25253: WebSocket origin bypass → full RCE (30,000+ exposed instances)

**Fundamental limit:** Prompt injection cannot be fully solved within current architectures — only mitigated through defense-in-depth.

### 6.2 10-Layer Defense-in-Depth (Priority Order)

| Priority | Layer | Description |
|----------|-------|-------------|
| 1 | **Audit logging** | Append-only, tamper-evident, full provenance — implement first |
| 2 | **Sandbox isolation** | Firecracker/gVisor; treat all agent code as hostile |
| 3 | **Human gates** | Required approval at authority class boundaries |
| 4 | **Input sanitization** | Trust-level scoring on all external content |
| 5 | **Security scanning** | Semgrep + TruffleHog + Snyk on every diff |
| 6 | **Network isolation** | Default-deny egress; allowlist only |
| 7 | **Tool validation** | Semantic validation of args before execution |
| 8 | **Identity** | RFC 8693 + DPoP; Vault for dynamic secrets |
| 9 | **Output verification** | Validate before any external action |
| 10 | **Behavioral monitoring** | Anomaly detection (needs baseline data) |

### 6.3 Sandboxing

**Consensus (February 2026):** Shared-kernel Docker containers are insufficient for untrusted AI agent code. Treat LLM-generated code as hostile.

| Technology | Isolation | Overhead | Boot Time | Escape Risk |
|---|---|---|---|---|
| Docker/runc | Namespace + cgroup | Low | Fast | High |
| gVisor | User-space kernel | 10-30% I/O | Fast | Medium |
| Firecracker microVM | Full guest kernel | ~5 MiB | ~125ms | Very Low |
| E2B (Firecracker) | Cloud sandbox | Minimal | <200ms | Very Low |

**OpenAI Codex pattern:** Two-phase runtime — setup phase (network allowed, deps installed), then agent phase (network disabled, secrets removed).

### 6.4 Identity & Secrets

**Delegation chain:** Human → Orchestrator Agent (scoped token) → Worker Agent (narrowly scoped per-task token) → Tool calls (validated against per-tool policy). Each hop gets minimum needed scope.

**Known vulnerability:** RFC 8693 delegation chain splicing — compromised intermediary can combine tokens from different contexts. Mitigate by binding subject_token and actor_token to same session context.

**Secrets:** HashiCorp Vault with zero standing privilege. Dynamic short-lived credentials per task. Auto-revoke on completion.

### 6.5 Supply Chain

**Slopsquatting:** LLMs hallucinate package names at ~5% rate; 58% repeatable across runs = viable squatting targets. Codex CLI was directly affected. **Mitigation:** approved package allowlist; agents cannot install outside it.

**Secret detection gap:** Regex tools (Gitleaks 37.5%, TruffleHog 0.0% on obfuscated secrets) are insufficient. LLM-based detection (GPT-5-mini 84.4%) needed alongside traditional scanners.

### 6.6 PII & Data Masking Architecture

Autonomous agents process datasets, logs, and support tickets containing PII. Manual redaction is economically unfeasible at factory speed.

**Architecture:** Deploy dedicated, separate masking models (e.g., DeBERTa-v3 or specialized NLP) that sit entirely outside the main engineering swarm. These pre-inference redaction layers intercept all unstructured text, audio, and log data before it enters the cognitive context window of engineering agents. Sensitive identifiers are replaced with hash substitutions or entity tags (e.g., `<ADDRESS_1>`).

**Implementation:** Route traffic to MCP servers through a middleware proxy. This proxy uses a fast local model (or classical regex heuristics) to scrub PII before the prompt hits an external API and before it logs to the observability platform.

**Compliance by design:** PII never enters the agent's context window, ensuring GDPR/HIPAA compliance without relying on the agent's behavior.

### 6.7 Compliance Constraints

- **Anthropic ToS:** Must use API keys from Claude Console for agent systems. Consumer OAuth tokens prohibited.
- **GDPR:** Audit logs immutable, retained 12+ months. PII detection in agent outputs. Right to erasure for memory stores.
- **SOC 2:** Documented access controls, approval workflows, change management logs.
- **EU AI Act:** Likely high-risk classification if deployed in regulated sectors. Mandatory human oversight at high-consequence decisions.

---

## 7. Orchestration & State Management

### 7.1 Canonical Orchestration Patterns

| Pattern | Best For | Factory Fit |
|---------|----------|-------------|
| **Hierarchical (centralized)** | Structured reasoning, enterprise scale | Primary pattern for the factory |
| **Pipeline/Sequential** | Deterministic known-step workflows | PRD → spec → code → test → review |
| **Event-driven/Reactive** | Decoupled, high-resilience | Notifications, DLQ, monitoring |
| **Swarm/Peer-to-peer** | Uncertain solution paths | Not default; available for exploration |

**Recommended hybrid:** Centralized coordinator for structured task dispatch + event bus for async side channels (status updates, heartbeats, DLQ, notifications, observability).

### 7.2 Communication Protocols

| Protocol | Model | Best For | Factory Use |
|----------|-------|----------|-------------|
| **MCP** | Client-server, JSON-RPC | Tool access, typed data | Tool integrations (primary) |
| **A2A** | Peer task delegation | Cross-vendor agents | Future agent delegation |
| **ACP** | REST, multimodal async | Multimodal responses | Later if needed |

**MCP current state:** Linux Foundation standard, 10,000+ public servers, Python/TypeScript SDKs (97M+ monthly downloads). Two transports: stdio (local), Streamable HTTP (remote). Session resumption targeting June 2026 spec. Build session state at application layer until then.

**MCP Apps (Jan 2026):** Tools return interactive UI in sandboxed iframes — approval UIs, config wizards, dashboards without leaving the agentic conversation.

**MCP Elicitation (Jun 2025):** Server requests structured user input mid-workflow — human-in-the-loop without breaking agentic flow.

### 7.3 Task Decomposition & Routing

Use a dependency DAG for task structure (honoring ordering constraints) but route dynamically within the DAG, allowing reallocation on failure.

**Routing heuristic (from Google's predictive model):**
1. Is the task sequential/monolithic? → Single agent
2. Is the task parallelizable with low tool count? → Centralized coordinator + workers
3. Is the task dynamic/exploratory with uncertain path? → Decentralized/swarm
4. Is single-agent baseline >45%? → Don't add agents

### 7.4 Context Packs & Memory Tiers

**Context Packs:** The factory does not load the entire repository into every agent. Instead, it assembles task-specific context packs — a "vague core with hyper-specific context." The system loads the appropriate pack based on repo, task type, and domain. This solves the "one factory, many repos" problem without building separate factories.

**Memory tiers:**

| Type | Mechanism | Scope |
|------|-----------|-------|
| Working/in-context | LLM context window | Single agent turn |
| Session | Conversations API, compaction | One continuous run |
| Cross-session artifacts | Git commits, progress files, JSON feature lists | Across sessions |
| Semantic/episodic | pgvector (Postgres) | Long-horizon retrieval |
| Event log/audit | Append-only JSONL (ESAA) | Permanent, deterministic replay |

**Critical finding:** ContextBench shows sophisticated scaffolding gives only marginal gains if context retrieval is weak. Structured artifacts (JSON, markdown, git) outperform raw chat history injection. **Build a repo-native context graph, not a giant instruction file.**

### 7.5 Context Sharding (Multi-Project Isolation)

When the factory scales to handle multiple concurrent projects, it must prevent **context contamination** — the memory/logic of one project silently leaking into another. Derived from distributed database sharding:

- Each new project gets dynamically provisioned isolated environments: unique managed identities, segregated storage, dedicated capability hosts
- Strict role-based access controls at the infrastructure level
- A classified project's context, telemetry, and integrations must be unreachable by swarms on other projects
- Critical for compliance (SOC 2, GDPR) and correctness

### 7.6 Hierarchical Compaction for Long-Running Autonomy

To prevent context decay over 24+ hour runs, implement three-tier compaction:

| Tier | Frequency | Action |
|------|-----------|--------|
| **Fast Loop** | Minutes | Agent executes code, reads tool outputs |
| **Checkpoint** | Hourly | Independent summarizer model analyzes recent steps, updates `.progress.md`, flushes chat history context completely |
| **Review Gate** | Daily or per-milestone | Agent pauses, compiles human-readable diff + evidence packet (logs, test passes, UI screenshots), pushes to approval dashboard |

This ensures the agent never operates on stale or degraded context. The checkpoint tier is the critical innovation — it separates "what happened" (event log) from "what matters now" (compacted working context).

### 7.7 Error Handling & Recovery

**Checkpoint rule:** Checkpoint after every tool call that produces durable output. ESAA event log IS the checkpoint — state is always a projection replayable from any point.

**Rollback:** Agent state cannot be rolled back like a database transaction (understanding is incremental). ESAA's answer: "defects create new correction paths, preserving the decision trail." Rollback is additive, not destructive.

**Circuit breaker states:** Closed (normal) → Open (blocking, queueing) → Half-open (probe) → Closed or back to Open.

**Dead letter queue:** Tasks exceeding retry budget are quarantined. DLQ entries: original task, error details, agent ID, attempt count, context snapshot at failure.

**Retry strategies:**
- Transient failures: exponential backoff with jitter, max 3 attempts
- Model errors: retry with different model (fallback chain)
- Logical failures: do NOT retry same prompt — reformulate or escalate

**Loop of Doom detection:** When an agent accumulates garbage data (sprawling error logs from failed commands), crucial instructions get pushed out of effective attention, causing repeated identical failure attempts. The orchestrator must detect this pattern: **4+ consecutive failing tool calls with identical errors → anomaly alert → pause session → notify human sponsor.**

**Production reality:** 40% of multi-agent pilots fail within 6 months of production deployment. The difference is edge case handling at scale.

### 7.8 Brownfield Integration (Onboarding Engine)

Inserting an existing project into the factory is a major failure point. Agents hallucinate dependencies, break existing logic, or aggressively refactor systems they don't comprehend. **Do not just give the factory access to the codebase.** Build a structured ingestion pipeline:

1. **Map** — Explorer agent maps the repository AST and file structure, generating an architecture graph
2. **Interview** — Agent explicitly questions the human: "I see Redis is used here, but no caching policy is documented. What is our eviction policy?" Epistemic humility by design.
3. **Compile** — Generate `project-context.md`, `ADRs.md`, `testing-conventions.md`, and dependency maps
4. **Validate** — Human reviews generated context artifacts before factory begins work

The compiled artifacts become the factory's ground truth for that project, bridging the gap between brownfield code and AI comprehension. This also applies to "extracting" a project — the factory must continuously generate ADRs, runbooks, and risk reports so humans never inherit an opaque codebase.

---

## 8. Observability, Self-Healing, & Scheduled Automation

### 8.1 Dual-Logging Taxonomy

Two complementary logging surfaces:

**Trace Level (machine-readable):** OpenTelemetry tracking exact token counts, LLM API responses, latency, tool inputs/outputs. From AgentTrace (arXiv 2602.10133), three sub-surfaces:
- **Cognitive:** reasoning steps, decision choices, tool selection rationale
- **Operational:** tool calls, commands, results, errors, token usage, latency
- **Contextual:** session state, memory state, environment at time of action

Plus: inter-agent communication maps, state transition histories, root trace propagation across multi-agent workflows.

**Semantic Level (human-readable):** A real-time timeline UI where the AI narrates its inner monologue (e.g., "Attempting to resolve Git conflict... Failed. Analyzing codebase to understand merge issue..."). This is the critical trust-building surface — humans can see *why* the factory made decisions without reading raw traces.

### 8.2 Observability Stack

**OpenTelemetry GenAI Semantic Conventions v1.37** — industry-converging standard. Defines `create_agent` and `invoke_agent` spans with attributes: agent ID/name/version, model, token usage, tool definitions, error type.

**Arize Phoenix** — recommended self-hosted backend. OTel-native, single Docker container, open-source, no vendor lock-in.

**AgentSight** (arXiv 2508.02736) — eBPF-based zero-instrumentation observability. Intercepts TLS-encrypted LLM traffic, correlates intent with system calls, detects "agent said X but did Y." <3% overhead.

### 8.3 Metrics That Matter

**Performance:** task success rate (goal achieved, not just completed), first-attempt success vs retry rate, time-to-complete per task type.

**Quality:** code quality score trends, PR acceptance rate without revision, regression introduction rate, security finding rate.

**Cost:** token usage per task type, cost per successful task, budget overruns.

**Reliability:** agent availability, cron success/failure/skip rate, circuit breaker trip frequency.

**Drift detection:** rolling 7-day and 30-day averages; alert on statistically significant deviations from 90-day baseline.

### 8.4 Self-Healing Loop

**Pattern:** Detect → Diagnose → Fix → Verify → Learn

**Required guardrails (all needed, not pick-one):**

| Guardrail | Threshold |
|-----------|-----------|
| Max iteration limit | 10 repair attempts |
| No-progress detector | 3 loops without state change |
| Recurring error detector | 5 identical errors |
| Time budget | 30 minutes max per repair |
| Cost budget | 50K tokens per repair |
| Circuit breaker | Per-tool, configurable |
| Kill switch | Global external flag (Redis/feature flag) |

**Critical principle:** Safety controls must operate outside the agent. External enforcement only.

### 8.5 Self-Learning

**Strategy:** RAG for codebase-specific knowledge (conventions, anti-patterns, past decisions) + prompt engineering for behavioral updates. Fine-tuning only for deep specialization (10-50x higher TCO than RAG).

- 60% of production GenAI apps use RAG over fine-tuning
- AGENTS.md / CLAUDE.md as hot-memory convention store (immediate, transparent)
- **Eval flywheel:** analyze failures → build evals → fix → validate → new failures feed back

### 8.6 Scheduled Automation (Cron Model)

Based on OpenClaw's proven model: isolated sessions, JSONL run logs, exponential backoff (30s → 1m → 5m → 15m → 60m), configurable retention, deterministic stagger for load distribution.

| Frequency | Tasks |
|-----------|-------|
| Every 5 min | Agent health check, cron job monitor |
| Daily | Dependency CVE scan, lint/format, secrets scan, coverage delta, cost report |
| Weekly | Dependency update PRs, tech debt trendline, agent performance review, outdated docs scan |
| Monthly | Full security audit, convention consistency, drift assessment, dead code detection |

**On-demand (event-triggered):** post-merge security scan, post-deploy health check, new CVE for current dependencies.

**Attribution:** Jobs created by agents record `created_by: agent/<agent_id>` with trigger context. Agents cannot modify/delete human-created jobs without explicit approval.

---

## 9. Plugin & Extension Architecture

### 9.1 Hybrid Design: MCP + Internal Hooks

**The decisive factor:** Security and approval hooks cannot be overridable by user plugins without breaking the factory's safety model.

| Surface | Mechanism | Rationale |
|---------|-----------|-----------|
| External tool integrations | MCP servers (10k+ ecosystem) | Standard protocol, maximum compatibility |
| Context injection | MCP resources | Composable with any host |
| Human-in-the-loop | MCP elicitation + MCP Apps | Purpose-built for agentic approval flows |
| Approval UIs | MCP Apps (sandboxed iframes) | Interactive UI in conversation |
| Workflow definitions | YAML (GitHub Actions-style) | Declarative, reviewable, no arbitrary code |
| Internal lifecycle correctness | tapable-style hooks (NOT user-extensible) | Security/audit cannot be overridden |
| Configuration | JSONC + Zod validation, layered hierarchy | Typed, validated, progressive disclosure |

### 9.2 Plugin Design Principles

From synthesizing VS Code, OpenClaw, Webpack, Terraform, and Backstage patterns:

1. **Stable, small core API** — versioned, no internal API dependence
2. **Declarative manifests over code execution** for discovery — validate before running
3. **Isolation proportional to privilege** — read-only in-process; write-access sandboxed
4. **Typed I/O** — all inputs/outputs schema-validated
5. **Activation events / lazy loading** — don't pay for unused plugins
6. **Hook/tap lifecycle model** — extension points around lifecycle stages (before/after/bail)
7. **SemVer compatibility ranges** — host refuses incompatible plugins at load time

### 9.3 Configuration Hierarchy

```
Global defaults → Project config → User config → Environment → Run config → CLI flags
```

- JSONC with JSON Schema / Zod validation at load time
- Secret references only (never store secrets in config)
- Feature flags for capability exposure (release/permission/experiment toggles)
- Progressive disclosure: defaults work out of the box
- Runtime hot-reload for: feature flags, agent prompts, tool permissions. Restart required for: plugin list, transport config.

### 9.4 Extension Classes

1. **Tool providers** — shell, browser, code search, CI, deployment, design, observability
2. **Context providers** — docs, repo analyzers, architecture graph, incidents, tickets
3. **Workflow packs** — domain-specific process templates (PRD flow, research flow, release flow, etc.)
4. **Validation packs** — quality/security/compliance checks
5. **Nano-model providers** — small specialized models (3B param) running locally for PII scrubbing, style enforcement, security vulnerability detection at near-zero cost

---

## 10. Future Trajectory (2026-2027)

### 10.1 The Key Metric

**Autonomous task duration is doubling every ~123 days:**
- Feb 2026: 14.5 hours continuous (Claude Opus 4.6)
- Late 2026 projection: week-scale
- Mid-2027 projection: month-scale

### 10.2 Current Frontier (March 2026)

**Benchmarks:**
- SWE-Bench Verified: saturated (~80%+ for all frontier models), contaminated — OpenAI stopped reporting
- SWE-Bench Pro (harder, 1,865 problems): GPT-5.3-Codex leads at 56.8% public / much lower on private codebases
- LongCLI-Bench: sub-20% pass rates on realistic long-horizon tasks
- SWE-CI: shifts evaluation from one-shot fixes to long-term maintainability

**Real-world production (sobering vs benchmarks):**
- 57% of companies run AI agents in production; only 11% at meaningful scale
- Google DORA 2025: 90% AI adoption correlates with 9% more bugs, 91% more code review time
- Net cycle time improvement: realistic 8-13%, not 50% marketing claims
- But positive outliers exist: TELUS 30% faster, Augment Code 4-8 month projects in two weeks

### 10.3 Test-Time Scaling (Search > Prediction)

Research moving decisively toward "System 2 Test-Time Compute": giving models compute during generation (exploring thousands of possible code paths, compiling, testing, backpropagating failures internally) yields exponentially better results than zero-shot generation. 2027 factories will be deeply embedded with continuous compilation and rollback mechanisms. **Design implication:** the factory's execution plane must support high-volume ephemeral compilation and test runs, not just sequential code generation.

### 10.4 Protocol-Level Interoperability (A2A)

The Agent-to-Agent protocol (v1.0.0, March 2026) enables peer-to-peer discovery and task outsourcing through "Agent Cards" — capability manifests broadcasting APIs, auth methods, and skill sets. In 2027, software factories will not be monolithic applications; they will be ecosystems where a client agent can autonomously discover, authenticate, and hire specialized remote agents across enterprise networks, using SSE for async partial results. **Design implication:** build the agent interface contract now; A2A becomes the transport later.

### 10.5 Plausible by Late 2027

- Multi-agent systems: feature spec → production-ready PR (implementation, tests, docs, migrations) with human review but not human implementation
- Agents maintaining codebases indefinitely for routine work (deps, security, tests)
- Natural-language infrastructure management
- AI-oversees-AI models replacing human-in-the-loop for routine decisions

### 10.6 NOT Plausible by 2027

- Fully autonomous production deployments in regulated industries
- Agents resolving novel security vulnerabilities independently
- Agents understanding business strategy and prioritization
- Zero human involvement in novel production incidents

### 10.7 The Most Underestimated Risk: AI-Generated Technical Debt

- 42% faster generation → 23.5% more production incidents
- 322% more privilege escalation paths
- 153% more design flaws (often passing review because code *looks* correct)
- 8x more code duplication
- Debt surfaces 30-90 days after generation (invisible at review time)
- 40% of agentic AI projects expected cancelled by 2027 (Gartner)

### 10.8 The Adaptation Lag

As agentic swarms become proficient at code generation and system architecture, they approach the threshold of autonomously iterating on their own logic. The immediate danger is not an intelligence explosion but **adaptation lag** — the speed of algorithmic deployment outpacing the human organization's ability to comprehend, monitor, or regulate the resulting changes. **Design implication:** the factory must enforce human-comprehensible change velocity limits, not just correctness checks.

### 10.9 Design Implication

**Keep the orchestration layer thin and model-agnostic.** Karpathy's AutoResearch (630 lines, 700 experiments in 2 days) and Darwin Gödel Machine (20% → 50% SWE-bench through self-modification) both succeed with minimal scaffolding. Elaborate scaffolding compensates for model limitations that are rapidly disappearing.

### 10.10 Model Regression Is Real

GPT-5.4 regresses vs GPT-5.3 on specialized domains on OpenAI's own internal benchmark. Never hardcode to a specific model version. The factory must decouple model selection from system architecture.

---

## 11. Risks & Open Questions

### 11.1 Ranked Risks

**High Likelihood:**
1. Context coherence across long-running workflows — ContextBench confirms marginal gains from fancy scaffolding
2. Technical debt accumulation from AI-generated code — surfaces 30-90 days later
3. Model regression on upgrade — newer is not always better
4. Prompt injection via repository content — indirect injection through code comments, docstrings, tool results
5. Non-deterministic regressions — agent fixes checkout bug but silently deletes payment button CSS, lacking visual context a human relies on

**Medium Likelihood:**
6. MCP session/resumption spec delays — targeted June 2026
7. Anthropic ToS changes — Feb 2026 crackdown on unauthorized harness usage
8. Reviewer fatigue — bottleneck moves from "writing code" to "inspecting what happened"; if factory outputs 3,000-line PR spanning 15 files with zero explanatory trace, humans reject it (takes more time to review untrusted AI code than to write it)
9. Alert fatigue from observability — orgs that automated before documenting saw +5% operational toil
10. Eval drift — what works on open-source benchmarks (SWE-Bench) fails on proprietary, highly-coupled enterprise codebases; building automated evaluations for your agents is incredibly hard

**Lower Likelihood, High Impact:**
11. Delegation chain splicing — RFC 8693 vulnerability, unaddressed in the RFC itself
12. Cascading agent failures — single compromised agent can poison 87% of downstream decisions in 4 hours
13. Vendor lock-in — Builder.ai ($1.3B) collapse stranded customers with no migration path

### 11.2 Items Requiring Further Investigation

1. Temporal vs pg-boss performance at this factory's specific workload profile
2. NATS JetStream durability guarantees under crash scenarios with agent event patterns
3. pgvector performance at expected codebase size — benchmark against Qdrant if >100K files
4. MCP elicitation support across target host applications
5. Anthropic API commercial terms for multi-user, always-on, long-running usage
6. E2B vs gVisor vs Firecracker sandboxing — boot time, memory, security for short-lived coding tasks
7. Cedar vs OPA — authoring experience, audit trail quality, performance for the permission model
8. Nano-model selection for PII redaction and style enforcement — DeBERTa-v3 vs alternatives
9. Digital Twin Universe approach for probabilistic validation — feasibility for this factory's use cases

### 11.3 Open Product Questions

1. What exact task packet schema should anchor the factory kernel?
2. Which workflows should be first-class vs provided as extensions?
3. What is the minimum evidence packet humans will actually trust?
4. What metrics should decide whether a workflow may advance autonomy level?
5. Tenancy model: single-tenant first or multi-tenant from day one?
6. Where to place trust boundary for plugin execution?
7. Which compliance framework is first target market (SOC 2, HIPAA, etc.)?
8. How should the factory handle epistemic uncertainty — when should agents ask vs guess?
9. What is the right change velocity limit to prevent adaptation lag?

---

## 12. Decision Heuristics

Default heuristics for design decisions throughout this project:

1. Prefer legibility over hidden optimization
2. Prefer explicit artifacts over hidden memory
3. Prefer bounded autonomy over blanket autonomy
4. Prefer resumable jobs over perpetual sessions
5. Prefer policy scopes over global switches
6. Prefer evaluation-backed expansion over speculative expansion
7. Prefer a small stable core plus adapters
8. Prefer model-agnostic interfaces over vendor coupling
9. Prefer audit logging first, enforcement second
10. Prefer thin orchestration over elaborate scaffolding
11. Prefer asking over guessing (epistemic humility)
12. Prefer factory logic in code over factory logic in prompts

---

## 13. First Product Shape

**A secure software-factory control plane for repository-centric engineering workflows.**

### First supported workflow (scoreable loop):

1. Intake objective or issue
2. Produce research and plan artifacts
3. Execute bounded implementation workflow
4. Run validators
5. Generate evidence packet
6. Route to human approval or merge policy
7. Store run state and learn from outcome

### First-class artifacts:

PRD, research packet, plan, execution packet, evidence packet, decision record, incident/rollback record.

### Evidence Packet (minimum viable):

Humans should never have to read AI-generated code blindly. The system must output a structured evidence packet:
- Original goal and architectural constraints respected
- Non-functional requirements validated
- CI test suite results (with pass/fail counts)
- Security vulnerability scan results
- PII redaction policies enforced
- Code diff with explanatory annotations
- Rollback plan
- Confidence assessment and uncertainty flags

### 90-Day Build Path:

**Phase 1 (Weeks 1-3):** Factory kernel skeleton — TaskPacket + ExecutionPlan + EvidenceBundle schemas, single-repo PR-native loop (human merge required), basic policy engine (Tier 0/1), event ledger + notifications.

**Phase 2 (Weeks 4-6):** Controlled autonomy — multi-role execution (planner/implementer/verifier), checkpointed long-running jobs, cron framework with strict job envelopes, validator bundle (tests + lint + security scan).

**Phase 3 (Weeks 7-9):** Governance hardening — Tier 2/3 permissions + approval workflows, JIT credentials + identity tagging, policy simulation and dry-run mode, incident runbook automation hooks.

**Phase 4 (Weeks 10-12):** Qualification — eval harness for recurring task sets, drift detection + candidate promotion pipeline, canary rollout + rollback automation, dashboard for autonomy quality metrics.

---

## 14. Source Index

### Research Papers & Benchmarks
- Google Scaling Study (2512.08296) — 180 agent configurations, architecture-task fit
- ESAA (2602.23193) — Event sourcing for autonomous agents
- LongCLI-Bench (2602.14337) — Sub-20% pass rates on long-horizon tasks
- SWE-CI (2603.03823) — CI-era maintainability evaluation
- ContextBench (2602.05892) — Marginal gains from fancy scaffolding
- Agyn (2602.01465) — Team-based autonomous software engineering
- AMA-Bench (2602.22769) — Agent memory benchmarks
- SWE-bench Pro (2509.16941) — Harder benchmark, 1865 problems
- AgentTrace (2602.10133) — Three-surface observability taxonomy
- AgentSight (2508.02736) — eBPF zero-instrumentation observability
- Darwin Gödel Machine (2505.22954) — Self-improving agent scaffolding
- OpenClaw PRISM (2603.11853) — Zero-fork runtime security layer
- Trustworthy AI Software Engineers (2602.06310)
- MINJA (2601.05504) — Memory poisoning attacks (NeurIPS 2025)
- Protocol Survey (2505.02279) — MCP, ACP, A2A, ANP comparison
- Defensible Design for OpenClaw (2603.13151)

### Platform & Vendor Documentation
- OpenClaw docs, security, cron, plugins, changelog
- BMAD Method docs, workflow map, quick flow, project context, roadmap
- MCP specification (2025-11-25), roadmap, MCP Apps, elicitation, registry
- A2A protocol (v1.0.0, March 2026), roadmap
- OpenAI Codex harness, GPT-5.3-Codex, sandboxing, approvals
- Anthropic 2026 Agentic Coding Trends Report, Claude Code security, autonomy measurement
- GitHub Copilot coding agent docs, agentic workflows, Agent HQ, memory
- Microsoft Agent 365, Agent Framework
- Google Jules, Gemini Code Assist, ADK
- Temporal, NATS JetStream, Windmill, n8n, Backstage

### Security & Governance
- OWASP Agentic AI Top 10 (December 2025)
- OWASP LLM Top 10 (2025)
- MITRE ATLAS (October 2025)
- NIST CSF 2.0, SP 800-207 (Zero Trust), SP 800-61r3
- StrongDM agent identity, Leash policy enforcement
- HashiCorp Vault AI agent identity, MCP server
- CSA Agentic Trust Framework, MAESTRO, Red Teaming Guide
- IronCurtain policy-as-code
- RFC 8693 (Token Exchange), RFC 9449 (DPoP), RFC 9700 (OAuth BCP)
- SPIFFE/SPIRE, Sigstore, SLSA v1.2

### Industry Reports & Analysis
- Anthropic 2026 Agentic Coding Trends Report
- Google DORA 2025
- Karpathy AutoResearch (March 2026)
- AI 2027 scenario forecasting
- OpenAI GPT-5.3-Codex deployment safety report
- Cursor $2.3B raise, GitHub Copilot 4.7M subscribers
- Builder.ai collapse, Devin price drop $500→$20/mo
