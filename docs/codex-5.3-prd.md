# Software Factory Control Plane PRD (Initial)

**Doc ID:** `codex-5.3-prd-v0.1`  
**Date:** March 18, 2026  
**Status:** Initial draft for iterative refinement  
**Primary input:** `docs/research.md` (consolidated, dated 2026-03-17/18)  
**Authoring intent:** Define an implementable product shape that is useful now, resilient to model churn, and extensible through 2027.

---

## 1. Basics

### 1.1 Product Name (working)
**Software Factory Control Plane**

### 1.2 One-line Product Definition
A secure, observable control plane that orchestrates humans and AI agents through real engineering workflows with bounded autonomy, strong policy enforcement, and artifact-first state.

### 1.3 Problem Statement
Teams can now generate code quickly, but they still struggle to safely operate long-running AI-assisted engineering workflows. The bottlenecks are not raw generation speed. The bottlenecks are:
- task scoping,
- context quality,
- review trust,
- policy/security enforcement,
- handoffs,
- and reliable operation over multi-hour or multi-day runs.

Existing systems are fragmented across workflow frameworks, agent runtimes, and tool adapters. Teams need a unifying product that makes AI work legible, governable, and production-usable.

### 1.4 Target Users
1. Engineering leaders who need faster delivery without loss of control.
2. Tech leads/staff engineers who need trustworthy implementation + evidence.
3. Platform/DevOps engineers who run long-lived automation and CI/CD.
4. Security/compliance teams who require least privilege + auditability.
5. Senior ICs who want to delegate routine engineering work safely.

### 1.5 Core User Outcomes
1. Complete more engineering tasks per week with no increase in critical incidents.
2. Review AI output faster because runs are explainable and evidenced.
3. Keep full human control at key authority boundaries (merge/deploy/governance).
4. Run autonomous workflows for 24+ hours with checkpoints, intervention, and resume.

---

## 2. Why Now (March 2026 Context)

Research and production data converge on a practical conclusion:
- Model capability is improving rapidly on coding tasks.
- Long-horizon reliability still breaks often in real workflows.
- Security risks are active and non-theoretical.
- Review and governance now dominate total workflow cost.

This creates a clear product window: build the control plane that turns model capability into trustworthy engineering throughput.

---

## 3. Your Stated Assumptions: Assessment

### 3.1 Assumption 1: "These systems are complex and require deep new expertise"
**Assessment:** Correct.  
**Design response:** Hide complexity behind policy profiles, workflow templates, and opinionated defaults. Expose advanced controls progressively.

### 3.2 Assumption 2: "Factories are often targeted to narrow use cases/tech stacks"
**Assessment:** Partly correct.  
**Design response:** Keep a broad, stable core (control plane + contracts) while using project-specific `ContextPack`s and plugin adapters for specialization. This gives cross-project applicability without pretending one prompt can solve every repo.

### 3.3 Assumption 3: "Maintenance burden will be high as models/research evolve"
**Assessment:** Correct.  
**Design response:** Decouple model choice from orchestration logic, require qualification gates for model upgrades, and version workflows/policies independently.

### 3.4 Assumption 4: "Handoffs in/out of a factory are hard"
**Assessment:** Correct and frequently underestimated.  
**Design response:** Make onboarding and extraction first-class workflows with required artifacts, explicit ownership transfer, and exportable audit history.

---

## 4. Product Principles and Invariants

This PRD adopts project immutable rules as product invariants:
1. **User control over automation:** no unapproved authority escalation.
2. **Security-first:** all components pass through policy and sandbox boundaries.
3. **Transparency over magic:** deterministic state + explainable evidence.

Additional design principles from research synthesis:
1. Artifact-first over chat-history-first.
2. Thin orchestration over brittle prompt scaffolding.
3. Bounded autonomy over blanket autonomy.
4. Model-agnostic interfaces over vendor coupling.
5. Ask-over-guess behavior in uncertainty.

---

## 5. Product Vision and Scope

### 5.1 Vision
Become the default operating system for human+AI software delivery: secure, observable, and adaptable.

### 5.2 In-Scope for Initial Product (0-12 months)
1. Repo-centric engineering workflows (issue/goal to PR + evidence).
2. Central coordinator + bounded worker roles.
3. Long-running resumable runs with human steering.
4. Security/policy gates and approval workflows.
5. Evidence packets and audit replay.
6. Plugin-based external tool integrations via governed interfaces.

### 5.3 Out-of-Scope for Initial Product
1. Full no-human autonomous production release in regulated environments.
2. Day-1 multi-tenant SaaS complexity.
3. Unrestricted third-party plugins in privileged runtime process.
4. Autonomous product strategy replacement of human PM/leadership.

---

## 6. What the System Is (and Is Not)

### 6.1 It Is
A **control plane** that coordinates:
1. task intake and planning,
2. context assembly,
3. orchestrated execution,
4. validation,
5. approval routing,
6. governance and learning.

### 6.2 It Is Not
1. A single omniscient agent.
2. A pure chatbot wrapper.
3. A CI tool replacement.
4. A security compliance silver bullet.

---

## 7. User Jobs-to-be-Done (Priority)

### JTBD-1: Deliver Bounded Code Changes Safely
"When I provide an issue/goal, I want a tested PR and evidence packet so I can approve quickly with confidence."

### JTBD-2: Operate Long-Running Automation with Control
"When a workflow runs overnight, I want checkpoints, alerts, and intervention controls so I never lose the thread."

### JTBD-3: Enforce Policy and Compliance
"When AI proposes actions, I want policy evaluation and auditable decisions so authority and data boundaries are never ambiguous."

### JTBD-4: Onboard Existing Repos Without Breaking Them
"When introducing a brownfield project, I want structured ingestion and clarification so the system does not hallucinate architecture intent."

### JTBD-5: Exitability
"If I stop using this factory, I want clean artifacts, runbooks, and traceability so humans can continue without hidden AI dependencies."

---

## 8. High-Level System Shape

### 8.1 Seven Product Planes
1. Experience plane: UI/CLI/chat/PR comments/notifications.
2. Control plane: intake, policy, approvals, checkpoints, budgets, replay.
3. Context plane: artifact graph, context packs, provenance/freshness.
4. Orchestration plane: decomposition, role routing, stop/escalation logic.
5. Execution plane: sandboxed runners and tools.
6. Validation plane: test/security/quality/compliance checks.
7. Learning plane: eval flywheel and promotion gates.

### 8.2 Core Roles (Initial)
1. `Coordinator`
2. `Implementer`
3. `Verifier`
4. `Reviewer`

### 8.3 Canonical Workflow Modes
1. **Quick path:** small bounded change.
2. **Team path:** coordinator + workers + verifier.
3. **Long-run path:** resumable, higher validation burden, scheduled checkpoints.

---

## 9. Core Requirements (Must-Have)

### 9.1 Functional Requirements

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-001 | Normalize all intake to `TaskPacket` | Task has objective, scope, constraints, risk class, budget, deadline, repo context |
| FR-002 | Require pre-mutation `ExecutionPlan` | No mutate action can execute before plan exists |
| FR-003 | Centralized coordinator ownership per run | Exactly one coordinator emits routing/checkpoint events |
| FR-004 | Support core roles (4) | Run can assign any subset and log role actions |
| FR-005 | Append-only event ledger as source of truth | Replay reconstructs run state deterministically |
| FR-006 | Checkpoint and resume | Crash/restart resumes from last durable checkpoint |
| FR-007 | Task-scoped `ContextPack` assembly | Each pack includes provenance + freshness metadata |
| FR-008 | Profile-based autonomy + overrides | Effective permissions resolved and persisted per run |
| FR-009 | Authority class gates (`Read`, `Propose`, `Mutate`, `Release`, `Govern`) | Out-of-scope actions fail closed and request approval |
| FR-010 | Sandbox all execution environments | Ephemeral workspace teardown guaranteed |
| FR-011 | Tool invocation policy and schema validation | Invalid args and policy violations block before execution |
| FR-012 | Mandatory validator bundle before approval queue | Tests/lint/type/security status attached |
| FR-013 | Minimum `EvidenceBundle` per task | Goal mapping, diff rationale, checks, rollback plan, uncertainty flags |
| FR-014 | Real-time exception notifications | Approval blocks and circuit-breakers notify within SLA |
| FR-015 | Human `Directive` override | Active run interruption, directive logging, controlled resume |
| FR-016 | Brownfield onboarding workflow | Read-only mapping and artifact signoff before write privileges |
| FR-017 | Extraction workflow | Export complete artifacts/policies/run logs for offboarding |
| FR-018 | CI/CD integration envelope | Support PR, CI trigger, status gate, deploy request path |
| FR-019 | External tool/plugin integration | Governed adapters with explicit capability and permission metadata |
| FR-020 | Scheduled jobs | Cron/scheduled tasks with ownership, retries, and retention |

### 9.2 Non-Functional Requirements

| ID | Requirement | Initial Target |
|---|---|---|
| NFR-001 | Availability for control plane APIs | 99.9% monthly |
| NFR-002 | Event durability | 0 data loss for committed events |
| NFR-003 | Resume reliability | >= 99% successful resume from latest checkpoint |
| NFR-004 | Approval action latency | p95 < 5 seconds after state change reaches gateway |
| NFR-005 | Notification latency (critical events) | p95 < 30 seconds |
| NFR-006 | Security policy decision latency | p95 < 200 ms per decision |
| NFR-007 | End-to-end traceability | 100% run-to-evidence linkage |
| NFR-008 | Audit exportability | Full export of run history, policies, and artifacts |
| NFR-009 | Cost governance | Hard token/runtime budget enforcement per profile |
| NFR-010 | Long-run operation | Support continuous 24h+ workflows with checkpointing |

---

## 10. Autonomy and Governance Model

### 10.1 Autonomy Levels (Productized)
1. **L0 Observe**
2. **L1 Propose**
3. **L2 Constrained Execute**
4. **L3 Delegated Maintenance**
5. **L4 Exception-Driven**

Initial default for new repos: **L1**.

### 10.2 Policy Profiles
1. `supervised`
2. `standard`
3. `trusted`
4. `expert`

Each profile resolves to explicit controls:
- tool classes,
- filesystem/network scope,
- max runtime,
- max agent depth,
- destructive command policy,
- required approvals,
- notification behavior.

### 10.3 Governance Rules
1. `Release` and `Govern` actions always require human approval in initial product.
2. Model upgrade triggers temporary autonomy downgrade pending re-qualification.
3. Kill switch must be external to agent reasoning loop.

---

## 11. Security and Compliance Requirements

### 11.1 Threat Model Priorities
1. Prompt injection and memory/context poisoning.
2. Tool misuse and privilege abuse.
3. Plugin/supply-chain compromise.
4. Unauthorized data egress/PII leakage.
5. Cascading multi-agent failure.

### 11.2 Required Controls (Day-1)
1. Append-only tamper-evident audit ledger.
2. Ephemeral sandboxed execution and strict egress controls.
3. Least-privilege delegated credentials with JIT elevation.
4. Per-tool schema and policy checks.
5. Automated scanning pipeline on every mutating change.
6. PII scrubbing middleware for context/log pipelines.
7. Mandatory human gates for high-authority classes.

### 11.3 Compliance-Ready Design Constraints
1. Data retention policies with explicit configuration.
2. Support right-to-erasure for non-immutable memory tiers.
3. Full access/approval/change logs for SOC2-style evidence.
4. Configurable controls for GDPR/HIPAA environments.

---

## 12. Handoff and Lifecycle Design

### 12.1 Brownfield Insertion (Onboarding Engine)
1. Repository map/architecture extraction.
2. Human interview for undocumented invariants.
3. Artifact compilation (`project-context`, ADR map, test conventions).
4. Human signoff before enabling mutation privileges.

### 12.2 In-Process Human-AI Handoffs
Every handoff packet must include:
1. goal and scope,
2. assumptions,
3. uncertainty flags,
4. completed evidence,
5. next action recommendation,
6. rollback path.

### 12.3 Factory Exit (Project Extraction)
1. Export artifacts, policies, automation inventory, and runbooks.
2. Decommission credentials and scheduled jobs.
3. Generate final risk and continuity report.

---

## 13. Observability and Trust System

### 13.1 Dual Logging Surface
1. **Trace layer:** machine-readable spans/events for debugging/governance.
2. **Semantic layer:** human timeline of intent, actions, outcomes, and uncertainty.

### 13.2 Metrics That Drive Decisions
1. Task success rate by task class.
2. First-pass acceptance rate.
3. Review time per accepted AI PR.
4. Regression/incident rate of AI-authored changes.
5. Cost per successful task.
6. Autonomy interruption and override frequency.
7. Policy violation rate.
8. Time-to-recover from run failure.

### 13.3 Qualification Loops
1. Eval suites per workflow.
2. Canary rollout for model/prompt/policy updates.
3. Promotion only on statistically meaningful improvement.
4. Automatic rollback on drift.

---

## 14. Flexibility and Extensibility Strategy

### 14.1 Core Strategy
Build a narrow, stable kernel and push variance into versioned adapters:
1. Tool providers.
2. Context providers.
3. Workflow packs.
4. Validation packs.
5. Nano-model providers (PII, style, specialized checks).

### 14.2 Plugin Guardrails
1. Declarative manifests and signed packages.
2. Capability-scoped permissions.
3. Non-overridable core safety hooks.
4. Compatibility and policy checks at load time.

### 14.3 "Vague Core, Specific Context" Principle
The product remains general-purpose at control-plane level and becomes domain-effective through repo-specific context packs, not through monolithic prompt complexity.

---

## 15. Real Workflow Coverage (Initial)

### 15.1 First-Class Workflow Set
1. Goal/issue -> research packet -> plan -> implementation -> validation -> review.
2. Dependency and security maintenance loop.
3. Incident follow-up: patch proposal + evidence + rollback readiness.
4. Documentation synchronization and architecture drift checks.

### 15.2 CI/CD Coverage
1. Branch/PR creation and update.
2. CI status ingestion and policy-gated progression.
3. Deploy request and rollback request handoff to approved deployment surfaces.
4. Post-deploy checks and incident signal capture.

---

## 16. Biggest Hurdles and Mitigations

### 16.1 Builder-Side Hurdles
1. Long-run context coherence decay.
2. Security/authority leakage risk.
3. Over-engineered multi-agent topologies.
4. Model churn and regression.
5. Latent AI technical debt.
6. Brownfield ingestion fragility.

### 16.2 User-Side Hurdles
1. Reviewer fatigue from opaque AI outputs.
2. Misconfigured autonomy causing unsafe or slow behavior.
3. Handoff ambiguity and confidence miscalibration.
4. Alert fatigue and operational noise.
5. Uncertain ROI after governance overhead.

### 16.3 What Prevents Maximum Value Today
1. Reliability gap on long-horizon, real-world tasks.
2. Incomplete defenses against injection-style attacks.
3. Weak organizational readiness (evals, policy ownership, review capacity).
4. Lock-in risk and poor extraction pathways.
5. Lack of trusted evidence standards across teams.

---

## 17. Future Directions (H2 2026 to 2027)

### 17.1 Likely by H2 2026
1. Better capabilities with uneven domain regressions.
2. More protocol maturity, but app-layer state handling still required.
3. Continued shift of bottleneck toward validation/review quality.

### 17.2 Likely by 2027
1. Routine low-risk maintenance largely automatable with exceptions.
2. Better cross-agent interoperability through explicit capability contracts.
3. Higher test-time compute/search integration in engineering agents.

### 17.3 Unlikely by 2027
1. Fully autonomous regulated production operations without human oversight.
2. Reliable autonomous handling of novel security/business-priority conflicts.
3. Single static model choice remaining optimal long-term.

### 17.4 Product Implication
Design for adaptation speed and governance resilience, not for a single "perfect" autonomy architecture.

---

## 18. Prioritization and Roadmap

### 18.1 MoSCoW Prioritization

#### Must (Immediate Value)
1. TaskPacket/ExecutionPlan/EvidenceBundle schemas.
2. Event-sourced ledger + replay.
3. Central coordinator and 4 core roles.
4. Policy profiles and authority gates.
5. Sandboxed execution and validator bundle.
6. Approval inbox and directive override.
7. Brownfield onboarding baseline.

#### Should
1. Context graph visualization.
2. Policy dry-run simulator.
3. Model fallback chains + automated qualification dashboards.
4. Scheduled maintenance packs and drift reporting.

#### Could
1. Rich in-conversation UI components for approvals.
2. A2A transport adapters.
3. Advanced nano-model packs.
4. Expanded multimodal workflows (including audio generation/validation where relevant).

#### Won't (Initial)
1. No-human high-authority deployments.
2. Full multi-tenant platform complexity.
3. Plugin ability to bypass core security/governance logic.

### 18.2 Phased Delivery (90 Days)

| Phase | Weeks | Delivery |
|---|---|---|
| Phase 1 | 1-3 | Kernel schemas, intake, event ledger, single workflow loop, human merge gate |
| Phase 2 | 4-6 | Multi-role execution, checkpoint/resume, validator bundle, baseline policies |
| Phase 3 | 7-9 | Approval UX, directive steering, JIT credential hooks, risk-based notifications |
| Phase 4 | 10-12 | Qualification harness, drift detection, canary promotion/rollback, autonomy scorecard |

---

## 19. "For Later" Section (Complex, Not Immediate Value)

These are strategically important but should not block v1 usefulness.

### 19.1 Advanced Autonomy
1. Exception-driven L4 operation for selected low-blast-radius classes.
2. Autonomous cross-repo coordination with strict blast-radius policy envelopes.

### 19.2 Multi-Agent Expansion
1. Additional specialized roles beyond the core four.
2. Swarm-style exploratory search for open-ended solution spaces.

### 19.3 Interoperability at Scale
1. A2A-native external agent delegation.
2. Marketplace-grade plugin federation and trust attestation.

### 19.4 Self-Improvement Systems
1. Controlled workflow self-optimization pipelines.
2. Automated policy recommendation generation with human approval.

### 19.5 Enterprise Platform Features
1. True multi-tenant control plane.
2. Fine-grained per-tenant policy and cost accounting.
3. Expanded regulatory packs by domain.

---

## 20. Success Metrics and Exit Criteria

### 20.1 Product KPIs
1. >= 20% reduction in median review time for accepted AI-assisted PRs.
2. >= 15% increase in successful task completion per engineer-week.
3. No increase in Sev1/Sev2 incident rate attributable to AI-generated changes.
4. >= 99% checkpoint resume success for interrupted runs.
5. >= 90% of AI-assisted changes delivered with complete evidence packets.

### 20.2 Trust KPIs
1. Approval acceptance trend rises with stable or lower rollback rate.
2. Human override/directive rate declines over time for stable workflows.
3. Reduction in unknown-assumption failures due to ask-before-act policy.

---

## 21. Open Questions for Next PRD Iteration

1. What exact risk taxonomy should map tasks to autonomy levels?
2. What are minimum and maximum acceptable PR sizes for trustworthy review?
3. What hard budget defaults should apply by profile (tokens, time, tool calls)?
4. Which compliance pack is first commercial target (SOC2-first vs HIPAA-first)?
5. What threshold should trigger migration from simple queueing to durable workflow runtime?
6. Which plugin trust model is acceptable for third-party ecosystem growth?
7. What change velocity caps should prevent adaptation lag?

---

## 22. High-Level Guidance for Builders (Unknown-Unknowns Mindset)

1. Expect failure modes to shift from coding errors to coordination/governance errors.
2. Design to detect silent debt, not just immediate test failures.
3. Assume model regressions happen; make rollback first-class.
4. Require artifacts at every boundary where humans must trust machine output.
5. Keep everything exportable to avoid operational lock-in.
6. Treat confidence as a measurable output, not a narrative claim.
7. Build interruption and steering as normal, not exceptional behavior.

---

## 23. Initial Reference Signals (Used for this PRD)

Primary basis remains internal synthesis at `docs/research.md`. Additional March 2026 signal checks used during drafting:
1. METR time horizons update and supporting paper revisions: `https://metr.org/time-horizons/`, `https://arxiv.org/abs/2503.14499`.
2. DORA generative AI impact report findings on process vs delivery outcomes: `https://dora.dev/ai/gen-ai-report/dora-impact-of-generative-ai-in-software-development.pdf`.
3. MCP spec release cadence and revision tags: `https://github.com/modelcontextprotocol/specification/releases`.
4. A2A protocol repository and capability framing: `https://google.github.io/A2A/`, `https://github.com/a2aproject/A2A/releases`.
5. OpenTelemetry GenAI semantic conventions for agent spans: `https://github.com/open-telemetry/semantic-conventions/releases`.

This PRD intentionally treats uncertain or rapidly changing claims as **assumptions to validate**, not immutable truths.

---

## 24. 2026 Methodology Synthesis (How Current Systems Work)

### 24.1 Shared Layering Pattern Across 2026 Systems
Most effective systems split into three concerns:
1. **Workflow/context layer** (artifacts, conventions, phase discipline).
2. **Runtime/orchestration layer** (session control, routing, retry, scheduling).
3. **Execution/tool layer** (sandboxed commands, repository mutation, external integrations).

### 24.2 Archetypes to Reuse (Without Blindly Copying)
1. **Artifact-driven method**: strong phase artifacts and gates.
2. **Control-plane runtime**: persistent session orchestration and policy enforcement.
3. **Dark-factory experiments**: useful for validation ideas, not day-1 operating model.
4. **Org-swarm models**: useful when decomposition is proven and measurable.

### 24.3 Product Interpretation
1. Implement artifact rigor from methodology systems.
2. Implement runtime control and security from agent-runtime systems.
3. Keep autonomy bounded and evidence-heavy for production engineering.
4. Treat swarm complexity as optional optimization, not default architecture.

---

## 25. Risk Register (Builder + User Hurdles with Signals)

| Risk ID | Risk | Audience | Severity | Early Warning Signal | Measurable Indicator | Primary Mitigation |
|---|---|---|---|---|---|---|
| RISK-01 | Long-run context coherence failure | Builder | Critical | Repeated identical failures | `% runs >2h needing manual reset` | Event-sourced state + hourly compaction + uncertainty escalation |
| RISK-02 | Security/authority leak via tools or prompts | Builder | Critical | Unexpected tool/egress attempts | `policy denials per 100 runs` | Least privilege + egress deny-by-default + sandbox hardening |
| RISK-03 | Overuse of multi-agent topology | Builder | High | Latency up, quality flat/down | `success-per-cost vs single-agent baseline` | Route by task structure; default centralized coordinator |
| RISK-04 | Model upgrade regression | Builder | High | Post-upgrade acceptance drop | `7/30-day canary drift` | Qualification gates + staged rollout + auto-downgrade |
| RISK-05 | Latent AI technical debt | Builder/User | High | Incidents 30-90 days later | `AI-authored change incident density` | Holdout validation + scheduled debt scans + stricter NFR checks |
| RISK-06 | Brownfield ingestion failure | Builder/User | High | Early regressions in legacy zones | `time-to-first-safe-task` | Structured onboarding workflow with required human signoff |
| RISK-07 | Reviewer fatigue and trust collapse | User | Critical | High reject/rework rates | `median review time`, `reject:approve ratio` | Minimum evidence packet + annotated diffs + PR size policy |
| RISK-08 | Misconfigured autonomy | User | High | Approval spam or unsafe actions | `interrupts per hour`, `incident rate by autonomy level` | Profile defaults + risk-based gates + policy simulation mode |
| RISK-09 | Handoff ambiguity (human-AI-human) | User | High | Reopen loops, contradictory changes | `handoff reopen rate` | Standard handoff packet + directive override + ask-before-act |
| RISK-10 | Alert fatigue | User | Medium | Slow acknowledgement, muted channels | `ack latency`, `actionable alert precision` | Notify only blockers in real-time, digest non-critical events |
| RISK-11 | Lock-in and extraction failure | User/Business | Medium | Incomplete offboarding data | `export completeness score` | Continuous docs-as-artifacts + automation inventory export |
| RISK-12 | Adaptation lag | Org | High | Governance overwhelmed by change velocity | `override/revert events per autonomous merge` | Velocity caps and blast-radius budgets by repo/profile |

---

## 26. First-Year Falsifiable Hypotheses

1. Centralized coordinator topology improves successful completion rate by at least 15% on structured tasks vs single-agent baseline.
2. Mandatory evidence bundles reduce median review time for accepted AI-assisted PRs by at least 20%.
3. Profile-based autonomy keeps low-risk autonomous rollback rate below 2%.
4. ContextPack-based retrieval reduces repeated clarification turns by at least 30%.
5. Model canary + eval gating prevents net regression over 2 percentage points after upgrades.
6. Fallback chains reduce hard task failure rate by at least 25% vs single-model routing.
7. Loop-of-doom detection reduces wasted token spend on failed runs by at least 40%.
8. Mandatory security/policy checks before approval reduce post-merge security findings per KLOC by at least 30%.
9. Brownfield onboarding artifacts reduce first-30-day AI-authored incident rate by at least 25%.
10. Change velocity caps reduce adaptation-lag incidents by at least 35% with throughput loss under 10%.

---

## 27. Decision

Proceed with this PRD as **v0.1 baseline**, then run a focused validation cycle on:
1. autonomy profile defaults,
2. evidence packet trust thresholds,
3. brownfield onboarding depth,
4. model upgrade qualification policy,
5. and cost-to-value breakpoints.
