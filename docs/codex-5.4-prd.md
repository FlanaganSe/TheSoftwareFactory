# Codex 5.4 Initial PRD

**Document type:** Initial PRD  
**Date:** March 17, 2026  
**Status:** Draft 1  
**Primary basis:** [docs/research.md](/Users/seanflanagan/proj/software-factory/docs/research.md)  
**Purpose:** Convert the current research base into an initial product definition for a secure, flexible, user-governed software factory.

## 1. Basics

### 1.1 One-line product definition

Build a **secure software-factory control plane** for repository-centric engineering workflows that lets humans delegate meaningful work to AI while preserving **control, security, observability, portability, and trust**.

### 1.2 Short version

This product should not be a magic autonomous coding swarm. It should be an **AI-native engineering operating system** that manages:

- task intake
- context assembly
- agent execution
- validation
- evidence generation
- approval routing
- long-running checkpoints
- policy enforcement
- auditability
- handoff into and out of the factory

### 1.3 Product thesis

The strongest thesis from the research is:

> The winning product is not “an AI that can code anything.”  
> The winning product is “a legible, governable production system for engineering work.”

That means the product must optimize for:

- explicit artifacts over hidden chat state
- strong policy and approval boundaries over maximum autonomy
- replayable runs over opaque sessions
- thin orchestration over prompt-heavy framework complexity
- repo-native context packs over generic giant memory
- portability and extraction over lock-in

### 1.4 Why this matters now

As of **March 17, 2026**, the market is converging on a few uncomfortable truths:

- AI coding capability is improving quickly.
- Real-world production reliability is improving much more slowly.
- Review burden, security risk, hidden technical debt, and context failure are now the main bottlenecks.
- The systems that win are the ones that make AI work **inspectable, bounded, and recoverable**.

### 1.5 Product promise

The product promise for the initial version should be:

> Increase engineering throughput on real repository workflows with bounded risk and high operator trust.

### 1.6 Initial target outcome

The initial product should make it practical for a human sponsor to say:

> “Take this repo-bound task, operate within these limits, show me what you did, prove it passed the right checks, and let me intervene or redirect at any time.”

## 2. Problem Statement

### 2.1 Core problem

Current agentic coding systems are useful, but they break down in predictable ways when teams try to turn them into a repeatable software factory:

- they over-rely on hidden prompt logic
- they blur read/propose/mutate/release authority
- they accumulate unreliable context over long runs
- they make review harder instead of easier
- they do not onboard brownfield repositories cleanly
- they trap knowledge inside sessions instead of exporting durable artifacts
- they are hard to adapt as models, tools, protocols, and security constraints change

### 2.2 Builder-side problem

Someone building a factory today faces a systems problem, not just a prompting problem:

- how to coordinate tasks without building dead scaffolding
- how to preserve user control while still providing leverage
- how to isolate untrusted execution
- how to avoid context poisoning and project cross-contamination
- how to onboard existing repositories without hallucinated understanding
- how to support long-running work without silent drift
- how to qualify new models, workflows, and plugins before trusting them
- how to keep the system relevant as model capabilities and standards change

### 2.3 User-side problem

Someone using a factory today faces a trust problem:

- they do not know what the system actually did
- they do not know which actions were safe versus risky
- they do not know whether the AI understood the project
- they do not know whether the tests and checks are sufficient
- they do not know how to interrupt or redirect the system cleanly
- they fear being trapped in a system they cannot later remove

### 2.4 Product opportunity

The opportunity is to provide a product that sits between:

- artifact-heavy workflow methods such as BMAD
- runtime shells and gateways such as OpenClaw-class systems
- coding agents and IDE agents such as Claude Code, Codex, Cursor, and similar tools
- enterprise governance systems for approval, observability, and compliance

The product does not need to replace all of these. It needs to **connect the valuable parts while fixing the operational gaps**.

## 3. Research Synthesis

### 3.1 How current systems tend to work

The current ecosystem is best understood as three layers:

| Layer | What it does | Typical examples |
| --- | --- | --- |
| Workflow/context layer | defines phases, roles, artifacts, and project conventions | BMAD, repo instructions, ADR systems |
| Runtime/orchestration layer | manages sessions, routing, task dispatch, scheduling, channels | OpenClaw, LangGraph, Temporal-style orchestration |
| Execution/tool layer | edits code, runs commands, calls tools, inspects environments | terminal agents, IDE agents, sandboxes, MCP tools |

Most current products are strong in one or two layers, not all three.

### 3.2 High-level view of notable approaches

#### BMAD-style systems

These systems treat the workflow itself as the product:

- explicit phases
- role specialization
- artifact-first planning
- heavy use of documents such as PRDs, architecture docs, and context packs
- stronger traceability from requirements to implementation and testing

What they get right:

- artifacts survive sessions
- they force structure
- they work better than pure chat for non-trivial projects

Where they struggle:

- runtime is usually weak or externalized
- prompt/process churn can become maintenance debt
- import/export of real codebases is painful unless explicitly designed

#### OpenClaw-class runtime systems

These systems treat the runtime as the product:

- continuous coordination
- channels and scheduling
- subagents and tool routing
- long-running sessions
- tool ecosystems and hooks

What they get right:

- actual execution and coordination
- extensibility
- always-on automation patterns

Where they struggle:

- attack surface grows quickly
- native plugins and runtime trust boundaries are dangerous
- governance and evidence can lag behind raw capability

#### IDE and terminal coding agents

These systems treat local engineering throughput as the product:

- direct repo editing
- tool use
- code search
- test execution
- patch generation

What they get right:

- they solve real tasks today
- they often fit existing developer workflows
- they are fast to use on bounded tasks

Where they struggle:

- they are not, by themselves, a software factory
- cross-session state and governance are often limited
- they can increase review burden if not wrapped in stronger evidence and policy

#### Dark factory and autonomous loop approaches

These systems push toward minimal human involvement:

- persistent repair loops
- probabilistic validation
- self-repair
- holdout evaluation

What they get right:

- they take autonomy seriously
- they reveal why replayable state and external validators matter

Where they struggle:

- they are easy to oversell
- they require very strong validation environments
- they are unsafe as the default posture for most real organizations

### 3.3 Key conclusions from the research

The research base supports the following conclusions:

1. **Artifacts beat chat history.** Durable documents, projections, plans, and evidence packets are more reliable than conversational memory.
2. **Architecture-task fit beats agent count.** Multi-agent systems help only under specific workload shapes.
3. **Task scoping is now a bigger bottleneck than code generation.**
4. **Review cost is becoming the new bottleneck.**
5. **Security controls must live outside the agent.**
6. **Brownfield onboarding is a first-order requirement, not a nice-to-have.**
7. **Model churn is guaranteed, so core logic must not live in prompts.**
8. **Portability matters.** Teams need to insert projects into the factory and extract them out without losing comprehension.
9. **Long-running work requires compaction, checkpointing, and interruption.**
10. **Observability is not optional.** Without a narrative plus trace surface, trust does not accumulate.

### 3.4 What prevents current systems from being maximally useful

The biggest blockers are not only model quality. They are structural:

- unclear authority boundaries
- poor context discipline
- inadequate validation depth
- weak brownfield comprehension
- excessive framework complexity relative to model gains
- plugin and tool trust problems
- lack of good import/export flows
- hidden reasoning and poor replayability
- inability to qualify changes to models, prompts, workflows, or extensions

### 3.5 Likely direction through 2026 and 2027

The most defensible direction of travel is:

#### More capability, but not proportional trust

Models will continue getting better at longer chains of engineering work, but production trust will still lag. This means the product moat will increasingly shift away from raw model capability and toward:

- qualification
- observability
- policy
- evidence
- portability

#### Evaluation will keep moving from one-shot correctness to maintainability

The product should assume that benchmark culture will keep shifting toward:

- repository-level tasks
- CI-native evaluation
- long-horizon execution
- review cost
- change survivability
- technical debt surfacing over time

#### Interoperability will matter more, but should not anchor V1

MCP, MCP Apps, and A2A-class protocols point toward a world where:

- tools become more standardized
- interactive approval UIs become more normal
- external specialist agents may become callable

But the product should design **for** these without making V1 depend on unstable ecosystem assumptions.

#### Local specialization will become more attractive

The factory should expect increased use of:

- local or cheap specialist models for narrow tasks
- policy-aware middleware
- redaction and classification layers
- specialized validators

This supports the case for a plugin architecture that can host capability-specific subsystems without changing the kernel.

#### Thin orchestration becomes more valuable as models improve

As base models improve, heavy prompt scaffolding becomes less durable. The control plane should get stronger while the model-specific logic should get thinner.

#### Human oversight remains structurally necessary

Even if autonomy expands materially by late 2026 or 2027, the product should assume that high-consequence actions still require:

- human accountability
- external validation
- visible change history
- rollback planning

### 3.6 Biggest hurdles, separated clearly

| Category | Biggest hurdles when building a factory | Biggest hurdles when using a factory |
| --- | --- | --- |
| Context | turning messy repo reality into reliable machine-usable context | trusting that the system actually understood the repo |
| Security | isolating untrusted execution, tools, plugins, and memory | fearing silent misuse of permissions, secrets, or integrations |
| Governance | creating policy that is strong without making the system unusable | understanding what the system can do without approval and what it cannot |
| Review | generating enough evidence without drowning people in telemetry | reviewing AI changes quickly enough that the product still saves time |
| Long-running state | preventing context decay, loops, and silent drift over hours | knowing whether a long run is healthy, blocked, or going wrong |
| Flexibility | supporting multiple repos and workflows without becoming vague | adapting the system to local conventions without becoming a prompt jungle |
| Maintenance | surviving model churn, benchmark churn, and protocol churn | avoiding lock-in to a workflow or platform that ages badly |
| Handoff | importing and extracting projects cleanly | retaining understanding after leaving or partially bypassing the factory |

## 4. Assessment of the User’s Assumptions

### 4.1 Assumption: these systems are very complex

This is correct.

The complexity is not just model complexity. It is:

- human workflow complexity
- security boundary complexity
- environment and tool complexity
- approval and policy complexity
- state and memory complexity
- organizational trust complexity

### 4.2 Assumption: these systems are often targeted at specific use cases or stacks

This is mostly correct, but needs refinement.

The right design is **not** “make the whole factory vague and universal.”  
The right design is:

- keep the **core kernel generic**
- keep **workflow packs, context packs, policies, validators, and tool packs specific**

In other words:

- the core should be reusable
- the working context should be specialized

This is the most defensible answer to the “specific vs vague” question.

### 4.3 Assumption: they will be hard to maintain as models and research change

Correct.

This is one of the most important product constraints. The system must expect:

- model upgrades
- model regressions
- changing tool protocols
- changing security practices
- changing approval expectations
- changing benchmark relevance

The product should be designed so that:

- models are replaceable
- validators are composable
- workflows are versioned
- policy is explicit
- qualification is continuous

### 4.4 Assumption: handoffs in and out of the factory are hard

Correct, and this should be elevated to a top-level product requirement.

There are two distinct handoffs:

1. **Insertion:** onboarding an existing project into the factory without hallucinated understanding.
2. **Extraction:** handing a project back to humans or another system without leaving an opaque AI-shaped mess.

The factory should treat **import and export as first-class workflows**.

## 5. Product Vision

### 5.1 Vision

Create a self-hostable, user-governed software-factory platform that can manage real engineering workflows from idea or issue through implementation and review, while preserving human control and producing durable, portable knowledge artifacts.

### 5.2 Product shape

The product should feel like a combination of:

- engineering control plane
- repo-native workflow engine
- AI-governed execution runtime
- approval and evidence system
- long-running checkpointed automation layer
- extensible tool and policy platform

### 5.3 What the product is

The product is:

- a control plane for AI-assisted engineering execution
- a policy engine for agent permissions and autonomy
- a context and artifact manager for project knowledge
- a runtime for bounded and observable work
- a qualification layer for humans, models, workflows, and extensions

### 5.4 What the product is not

The product is not:

- a single super-agent
- a benchmark-chasing swarm demo
- a prompt library dressed up as a platform
- a fully autonomous deployment robot for all organizations
- a closed system that traps repos and operational knowledge

## 6. Product Principles

1. **User retains control over all automation.**
2. **Security-first design is non-negotiable.**
3. **Transparency over magic.**
4. **Artifacts over hidden memory.**
5. **Policy over implicit trust.**
6. **Portability over lock-in.**
7. **Qualified autonomy over unconditional autonomy.**
8. **Thin orchestration over brittle cleverness.**
9. **Model-agnostic interfaces over vendor dependence.**
10. **Specific context over generic giant prompts.**
11. **Ask over guess when uncertainty is material.**
12. **Evidence before approval.**

## 7. Users and Stakeholders

### 7.1 Primary users

#### Builder / factory owner

Needs:

- to define workflows
- to set policy
- to choose tools and models
- to understand failures
- to keep the system maintainable over time

#### Sponsor / tech lead

Needs:

- to delegate work safely
- to approve or reject with clear evidence
- to interrupt or redirect work
- to understand scope, risk, and confidence

#### Engineer

Needs:

- leverage on real tasks
- bounded automation
- repo-aware context
- low-friction steering
- clean handoff into manual work when needed

#### Reviewer / security / compliance owner

Needs:

- auditability
- proof of checks performed
- change rationale
- rollback readiness
- clear authority boundaries

#### Operator / platform owner

Needs:

- runtime health
- costs and quotas
- drift and failure visibility
- controls for isolation, scaling, and incident response

### 7.2 Initial ICP hypothesis

The initial product should target:

- solo technical builders with strong control requirements
- small teams or platform teams managing a small number of repositories
- organizations that care more about governance, self-hosting, and inspectability than about flashy autonomy claims

Large multi-tenant enterprise deployment should be a later expansion, not the initial center of gravity.

## 8. Jobs To Be Done

### 8.1 Primary jobs

1. Given an issue or feature request, generate a scoped plan, implement it in a bounded workspace, run validations, and produce an evidence-backed PR or patch for human review.
2. Given a brownfield repository, build a reliable project understanding package before the system writes code.
3. Given a long-running task, keep work resumable, compacted, observable, and interruptible over many hours.
4. Given recurring maintenance needs, run scheduled bounded tasks such as dependency updates, security scans, or test repairs with strict review and audit.
5. Given a repo that must leave the factory, export the operational context and decisions needed for humans or another system to continue safely.

### 8.2 Secondary jobs

1. Support human steering without destroying run continuity.
2. Support multiple tool classes without collapsing the trust model.
3. Support multiple project types without becoming a vague universal mess.
4. Support model replacement and qualification without rewriting the product.

## 9. Scope Definition

### 9.1 In-scope for the initial product

- repository-centric engineering workflows
- research -> plan -> implement -> validate -> evidence -> review loops
- bounded long-running execution with checkpoints
- CI-aware validation
- brownfield onboarding
- explicit approvals
- security and observability foundations
- extension model for tools, context, workflows, and validators

### 9.2 Explicitly out of scope for V1

- fully autonomous production deployment across high-risk environments
- default swarm orchestration with many specialized roles
- multi-tenant enterprise-scale SaaS as the first shipping posture
- generalized autonomous product management
- open-ended autonomous requirement generation as a core promise
- digital twin probabilistic validation as a required dependency
- replacing engineers, reviewers, or incident commanders

## 10. Product Strategy

### 10.1 Strategic position

The product should position itself as:

> the governance and execution layer that makes AI engineering workflows safe enough, clear enough, and portable enough to use on real software.

### 10.2 Strategic wedge

The wedge is not “more autonomy.” The wedge is:

- reliable artifact-first workflows
- better brownfield onboarding
- superior evidence packets
- stronger permissioning
- deeper observability
- better import/export and handoff

### 10.3 The core strategic bet

The product should bet on a **narrow, reliable core** plus a strong extension model.

The core should remain generic in:

- task packets
- context packets
- execution plans
- policies
- evidence bundles
- event logs
- approvals
- directives

The product should remain specific in:

- context packs
- validator bundles
- workflow packs
- tool integrations
- project conventions
- compliance overlays

## 11. Proposed Product Architecture

This section is not a final architecture spec. It is the product architecture hypothesis that the PRD assumes.

### 11.1 Seven-plane model

#### Experience plane

User-facing surfaces:

- CLI
- web dashboard
- PR comments
- issue tracker integration
- scheduled jobs
- notifications
- approval inbox

#### Control plane

The center of the product:

- task intake
- run creation
- checkpointing
- autonomy policy resolution
- approval routing
- budget control
- evidence capture
- audit and replay
- extension registration

#### Context and knowledge plane

Artifact-first project memory:

- PRDs
- research docs
- plans
- ADRs
- testing conventions
- repo map
- architecture graph
- incidents and postmortems
- prior run summaries

#### Orchestration plane

Routing and decomposition:

- classify task type and risk
- choose execution path
- assign worker roles
- enforce retry and escalation rules
- pause or stop on policy or anomaly

#### Execution plane

Bounded runtimes:

- ephemeral sandboxes
- repo workspaces
- browser and shell execution
- CI runners
- staging and validation environments

#### Validation plane

Quality and release readiness:

- tests
- lint
- type checks
- security checks
- dependency checks
- architecture conformance
- rollback readiness

#### Learning and qualification plane

Bounded improvement:

- track failures
- build evals
- compare candidates
- qualify model or workflow updates
- gate autonomy upgrades

### 11.2 Core product objects

The system should treat the following as first-class:

| Object | Description |
| --- | --- |
| `TaskPacket` | objective, scope, risk class, constraints, budget, deadline, sponsor |
| `ContextPack` | selected artifacts, provenance, freshness, trust level |
| `ExecutionPlan` | task breakdown, role assignment, parallelism, checkpoints, approval gates |
| `RunCheckpoint` | resumable state for long-running work |
| `EvidenceBundle` | test results, scans, diffs, rationale, screenshots, uncertainty notes |
| `ApprovalRecord` | who approved what, under which policy, at what time |
| `PolicyDecision` | allow/deny/elevate result with rule trace |
| `Directive` | explicit human steering override with scope and TTL |
| `MemoryItem` | validated long-lived claim with source and expiry |

### 11.3 Default role model

Start with four roles:

- **Coordinator:** planning, routing, checkpoints, escalation
- **Implementer:** code and artifact changes
- **Verifier:** tests, scans, validation runs
- **Reviewer:** architectural and evidence review

Do not add more roles until measured bottlenecks justify it.

### 11.4 Execution paths

The product should choose among three default paths:

#### Quick path

For:

- small changes
- low-risk tasks
- high confidence
- bounded diffs

Characteristics:

- single bounded implementation run
- small context pack
- validator bundle
- evidence output

#### Team path

For:

- decomposable tasks
- moderate complexity
- multiple validation concerns

Characteristics:

- coordinator plus bounded workers
- explicit subtask contracts
- merged evidence

#### Long-run path

For:

- migrations
- broad refactors
- multi-step debugging
- tasks expected to exceed several hours

Characteristics:

- checkpoints after durable outputs
- hourly compaction
- milestone review gates
- stronger anomaly detection

## 12. Functional Requirements

### 12.1 Intake and planning

- `INT-01` The system must accept task intake from CLI, web UI, and repository-linked channels.
- `INT-02` Every task must be normalized into a `TaskPacket`.
- `INT-03` Every task must be assigned a risk class before execution starts.
- `INT-04` Every task must declare a sponsor and default policy bundle.
- `INT-05` The system must generate or attach an `ExecutionPlan` before mutation begins.
- `INT-06` The system must identify missing information and ask rather than guess when uncertainty blocks safe execution.

### 12.2 Context and knowledge

- `CTX-01` The system must assemble task-specific `ContextPack`s instead of dumping whole repositories into prompts.
- `CTX-02` Every context item must record source, freshness, and trust level.
- `CTX-03` The system must support project-specific context packs that can vary by stack, repo, domain, and workflow.
- `CTX-04` The system must support artifact compaction for long-running tasks.
- `CTX-05` The system must distinguish durable artifacts from ephemeral summaries.
- `CTX-06` The system must support claim validation and expiry for reusable memory.

### 12.3 Execution and orchestration

- `EXE-01` All agent-proposed mutations must flow through orchestrator validation.
- `EXE-02` Agents must never directly mutate canonical product state.
- `EXE-03` The system must support bounded retries with reason-aware retry policy.
- `EXE-04` The system must detect repeated identical failure loops and pause automatically.
- `EXE-05` The system must support resumable execution from checkpoints.
- `EXE-06` The system must support budget limits on runtime, tool calls, and token usage.
- `EXE-07` The system must support long-running runs over 24 hours in architecture, but must not promise unattended autonomy without qualification.

### 12.4 Human control and directives

- `HITL-01` The user must be able to pause, stop, redirect, or re-scope active work.
- `HITL-02` The product must support first-class `Directive` interrupts with task, session, or global scope.
- `HITL-03` Directive injection must be logged as durable events.
- `HITL-04` The system must support batch approval of plans where appropriate.
- `HITL-05` The system must support asynchronous approvals with escalation paths.

### 12.5 Validation and evidence

- `VAL-01` Every mutable task must run a validator bundle before entering approval.
- `VAL-02` Validator bundles must be workflow-aware and project-aware.
- `VAL-03` The evidence packet must include diff rationale, validation results, uncertainty flags, and rollback readiness.
- `VAL-04` The system must support holdout or externalized validation for high-risk workflows over time.
- `VAL-05` The system must track pass/fail history by workflow, repo, model, and extension version.

### 12.6 CI/CD integration

- `CICD-01` The product must integrate with CI status and test execution.
- `CICD-02` The product must treat CI results as evidence, not just a side effect.
- `CICD-03` The product must support PR-native output as the default mutation surface.
- `CICD-04` Merge and deploy permissions must be separately governed from code mutation.
- `CICD-05` The product must support rollback planning even when deployment is not yet automated.

### 12.7 Scheduling and recurring automation

- `SCH-01` The product must support scheduled runs with strict envelopes.
- `SCH-02` Every scheduled run must identify creator, trigger source, scope, and policy.
- `SCH-03` Agent-created jobs must not be allowed to override or delete human-created jobs without approval.
- `SCH-04` Retry and backoff behavior must be explicit and observable.

## 13. Security, Compliance, and Governance Requirements

### 13.1 Authority model

The product must define and enforce five authority classes:

- `Read`
- `Propose`
- `Mutate`
- `Release`
- `Govern`

These must not collapse into a single “autonomous mode” switch.

### 13.2 Autonomy levels

The product should support named autonomy profiles:

- `supervised`
- `standard`
- `trusted`
- `expert`

Each profile must resolve to concrete rules across:

- file scope
- network scope
- allowed tools
- runtime limits
- approval requirements
- notification behavior
- escalation behavior

### 13.3 Required security controls

- `SEC-01` Append-only audit logging must be the system of record.
- `SEC-02` Untrusted execution must run in hardened isolation, not Docker-only trust assumptions.
- `SEC-03` The runtime should support a two-phase model where setup and agent execution have different network and secret exposure.
- `SEC-04` Egress must default to deny.
- `SEC-05` Tool invocation must be allowlisted and schema-validated.
- `SEC-06` Destructive actions must require stronger approval behavior.
- `SEC-07` Dependency installation must respect package allowlists to reduce slopsquatting and hallucinated dependency risk.
- `SEC-08` Security scanning must run on every mutable diff.
- `SEC-09` High-risk external content must be trust-scored before it can influence privileged action.
- `SEC-10` Plugin and extension privileges must be isolated proportional to capability.

### 13.4 PII and sensitive data

- `PII-01` Sensitive input channels must support pre-inference redaction or masking.
- `PII-02` The system must allow projects to define which channels require masking before model access.
- `PII-03` Audit and observability sinks must not receive raw sensitive payloads when policy forbids it.
- `PII-04` The product must support data retention policy by artifact class.

### 13.5 Compliance posture

The initial product should be designed so it can support:

- SOC 2 style access controls and change logs
- GDPR-style auditability and deletion handling where legally required
- policy-based human oversight for regulated or high-consequence actions

The initial version should not claim full compliance automation. It should provide the infrastructure that makes compliance achievable.

## 14. Brownfield Onboarding and Portability

### 14.1 Brownfield onboarding is mandatory

The product must not assume that giving an agent repo access is equivalent to understanding the project.

### 14.2 Required onboarding flow

The default onboarding workflow must be:

1. **Map** the repository structure, dependency graph, major services, and testing surfaces.
2. **Interview** the human sponsor to fill gaps and confirm non-obvious operational truths.
3. **Compile** durable context artifacts.
4. **Validate** those artifacts with human review before code mutation is enabled.

### 14.3 Required onboarding artifacts

At minimum:

- `project-context.md`
- `architecture-summary.md`
- `testing-conventions.md`
- `dependency-map.md`
- `risk-register.md`
- `operational-notes.md`

### 14.4 Extraction and handoff requirements

The product must support the inverse flow:

- export decision history
- export ADR summaries
- export workflow and validator history
- export known risks and unresolved assumptions
- export runbooks and rollback notes
- export project-specific context packs

The system should treat “ability to leave the factory” as a product quality metric.

## 15. Observability and Trust Requirements

### 15.1 Dual logging model

The product should expose two complementary surfaces:

#### Machine-readable trace surface

Includes:

- model calls
- tool invocations
- token usage
- latency
- state transitions
- checkpoints
- policy decisions
- error classes

#### Human-readable semantic timeline

Includes:

- what the system believes it is trying to do
- why it changed direction
- what failed
- what remains blocked
- what evidence it gathered
- where human input is needed

### 15.2 Trust requirements

- `OBS-01` Every state-changing action must be traceable to actor, sponsor, policy, time, and artifacts.
- `OBS-02` Every run must be replayable at the event level.
- `OBS-03` Every tool and model call must carry trace correlation IDs.
- `OBS-04` The UI must prioritize “why” and “what changed” over raw log volume.
- `OBS-05` The system must support drift views for quality, cost, autonomy, and review burden.

### 15.3 Review burden reduction

The evidence packet should be explicitly optimized to reduce review cost, not merely to prove that work happened.

Minimum evidence packet contents:

- original objective
- scope and constraints
- relevant context pack summary
- files changed
- rationale for the approach
- validator results
- security findings
- screenshots or UI evidence where relevant
- rollback notes
- uncertainty and known gaps

## 16. Extensibility Requirements

### 16.1 Extension model

The system should support five extension classes:

1. tool providers
2. context providers
3. workflow packs
4. validator packs
5. nano-model or specialist-model providers

### 16.2 What extensions may do

Extensions may:

- add tools
- add context sources
- add validators
- add workflow definitions
- add stack-specific knowledge packs
- add small local models for narrow purposes such as PII masking or style enforcement

### 16.3 What extensions may not do

Extensions must not be allowed to bypass:

- audit logging
- policy evaluation
- approval requirements
- sponsor attribution
- isolation requirements
- event capture

Human steering and safety-critical enforcement should stay in the trusted core.

### 16.4 External tool support

The long-term product should be able to work with:

- MCP tools and resources
- shell and browser tools
- CI systems
- design generation and validation tools
- deployment and monitoring tools
- local nano-models
- multimodal tools such as audio or vision utilities

However, these should be added through bounded extension contracts, not by letting the factory become an unrestricted shell around the world.

## 17. Long-Running Autonomy Requirements

### 17.1 Product stance

The product should be built to support **24+ hour execution** as an architectural capability, but this should be a **qualified mode**, not the default promise.

### 17.2 Required capabilities for long runs

- checkpoint after durable outputs
- hourly compaction
- milestone review gates
- budget caps
- retry limits
- no-progress detection
- recurring-error detection
- circuit breakers
- dead-letter queue
- external kill switch
- sponsor notifications for blocked or risky states

### 17.3 What long-running autonomy means here

It means:

- the system can continue structured work over long horizons
- it can stop safely
- it can resume coherently
- it can explain itself
- it can ask for help when needed

It does **not** mean:

- unsupervised open-world operation
- unlimited self-direction
- unbounded tool access
- permanent self-modifying autonomy

## 18. Qualification Requirements

### 18.1 Human qualification

The product should support:

- named sponsors
- role-based approval rights
- explicit ownership of repos or environments
- review checklists by workflow/risk class

### 18.2 AI qualification

The product must support qualification of:

- model versions
- workflow versions
- validator packs
- tool packs
- autonomy profile upgrades

### 18.3 Qualification loop

The qualification loop should be:

1. capture failures and outcomes
2. convert recurring failures into evals
3. test candidate changes
4. compare against baseline
5. promote only on improvement within policy
6. downgrade or canary on regression

### 18.4 Product implication

The factory must be able to say:

> “This workflow at this autonomy level is trusted because it passed these evaluations under these conditions.”

That becomes part of the trust model.

## 19. V1 Product Definition

### 19.1 V1 objective

Ship a self-hostable single-control-domain product that can safely execute bounded repo workflows from task intake to evidence-backed PR output.

### 19.2 V1 must-have capabilities

- centralized coordinator
- four-role execution model
- task packet and execution plan schema
- context pack generation
- append-only event log
- replayable run timeline
- policy engine with authority classes
- approval gates for mutate, release, and govern actions
- sandboxed execution
- validator bundle for tests, lint/type, secret scan, dependency/security scan
- brownfield onboarding workflow
- evidence packet generation
- web dashboard or equivalent operator surface
- scheduled bounded jobs
- directive interrupts

### 19.3 V1 recommended target workflows

#### Workflow A: issue to plan to PR

Input:

- issue, bug, or bounded feature request

Output:

- plan
- implementation branch or patch
- validator results
- evidence packet
- PR or review-ready diff

#### Workflow B: brownfield onboarding

Input:

- existing repository

Output:

- validated onboarding artifacts
- project context pack
- permission to begin bounded work

#### Workflow C: recurring maintenance

Input:

- scheduled policy-approved task

Output:

- bounded maintenance run
- evidence
- PR or review request

### 19.4 V1 non-goals

- autonomous production deploys by default
- cross-org multi-tenancy
- remote A2A-native delegation
- broad multimodal content generation as core value
- self-rewriting workflow logic
- ambitious dark-factory claims

### 19.5 V1 success criteria

- 100% of state-changing actions appear in the immutable event log
- 100% of mutable tasks generate evidence packets before approval
- 100% of release and governance actions require explicit human approval
- long-running tasks checkpoint after durable outputs and at least hourly
- directive interrupts pause active work quickly enough to feel operationally useful
- no confirmed cross-project context leakage in isolation tests
- reviewers report that evidence packets reduce approval effort versus raw AI diffs

### 19.6 V1 acceptance gates

The first version should not be considered successful unless it can demonstrate the following in practice:

- `AC-01` Every state-changing action records actor, sponsor, policy decision, timestamp, and artifact reference in the event log.
- `AC-02` Every `Release` and `Govern` action requires explicit human approval and rejected attempts are logged.
- `AC-03` Every mutable task reaches approval only after validator evidence is attached.
- `AC-04` Every long-running task can be resumed from checkpoints without reconstructing intent from raw chat history.
- `AC-05` Every active run can be paused or redirected by human directive without losing audit continuity.
- `AC-06` Brownfield onboarding prevents write access until generated project context artifacts are human-validated.
- `AC-07` Agent-created scheduled jobs are attributable and cannot silently modify human-owned automation.
- `AC-08` High-risk content channels can be configured so sensitive text is masked before model access and logging.
- `AC-09` Reviewers can answer “what changed, why, what passed, and what remains uncertain?” from the evidence packet alone.
- `AC-10` The system can survive at least one model upgrade or downgrade without rewriting the control-plane logic.

## 20. For Later

This section is intentionally separated so complex but non-immediate work does not distort the first build.

### 20.1 Later but likely important

- richer approval UIs through MCP Apps or equivalent embedded UI
- multi-project isolation and policy federation
- adaptive autonomy promotion based on qualification metrics
- design generation and design validation packs
- deployment validation packs for staging and smoke tests
- stronger holdout validation for high-risk workflows
- deeper cost governance and quota marketplaces

### 20.2 Later and speculative

- remote agent hiring through A2A or equivalent protocols
- digital-twin probabilistic validation for certain domains
- autonomous requirement discovery loops
- AI-oversees-AI review for low-risk repetitive work
- local specialist model fleets for niche tasks
- richer multimodal flows including audio-heavy workflows

### 20.3 Not a planning center for the first version

- full dark factory operation
- zero-human production incident management
- regulated-industry fully autonomous deployment
- generalized autonomous product strategy

## 21. Success Metrics

### 21.1 Product metrics

- task completion rate by workflow and risk class
- first-attempt success rate
- average human review time per evidence-backed run
- approval acceptance rate without major rework
- mean time to interrupt or redirect a run
- mean time to recover from failed long-running runs
- percentage of runs with complete evidence
- number of manual overrides per workflow version
- cost per successful task
- regression and incident rate on factory-generated changes

### 21.2 Trust metrics

- reviewer confidence score
- sponsor willingness to re-delegate similar tasks
- percent of tasks moved from supervised to standard or trusted profiles
- percent of runs where humans say the system “understood the project”

### 21.3 Portability metrics

- time to onboard a brownfield repo
- time to extract a project with complete context pack
- percent of repos with current ADR and runbook coverage

## 22. Risks

### 22.1 Product risks

1. The product becomes a framework museum instead of a reliable core.
2. The review surface becomes so noisy that humans reject the system.
3. The brownfield onboarding flow is too heavy and is skipped in practice.
4. The extension model becomes a security hole.
5. The system overfits to today’s models and underfits the next 18 months.
6. The cost model becomes unattractive for real workflows.
7. The product tries to support too many workflow types before any are truly excellent.

### 22.2 Technical risks

1. Context compaction may lose critical intent.
2. Long-running runs may degrade despite checkpointing.
3. New model versions may regress on important internal tasks.
4. Plugin or tool outputs may poison context or influence privileged actions.
5. Cross-project memory or telemetry leakage may occur if isolation is sloppy.
6. Event and trace volume may become expensive or hard to manage.

### 22.3 Organizational risks

1. Humans may under-review because the UI looks authoritative.
2. Humans may over-review because the system fails to build trust.
3. Teams may confuse autonomy with accountability transfer.
4. The product may move the bottleneck from implementation to approval and review.

## 23. Unknown Unknowns and Strategic Advice

### 23.1 Unknown unknowns that should be expected

- novel security failure modes created by tool combinations
- new model-specific reasoning failures that benchmarks do not predict
- emergent review fatigue caused by volume rather than correctness alone
- protocol churn across MCP, A2A, identity, or observability ecosystems
- hidden organizational resistance when AI changes collaboration patterns
- latent technical debt that only surfaces 30 to 90 days after generation

### 23.2 Advice for building this product

1. Build the kernel first: task packet, event log, policy engine, evidence bundle, directive support.
2. Do not confuse flexibility with vagueness. Generic kernel, specific packs.
3. Make import and export top-level features from day one.
4. Treat observability as part of product value, not internal tooling.
5. Assume model regressions and protocol changes will happen.
6. Make every critical control external to the agent.
7. Measure review cost, not just generation speed.
8. Optimize for comprehensibility under failure, not just success demos.
9. Prefer one excellent workflow over five shallow ones.
10. If a human cannot understand why a run did what it did in under a few minutes, the product will not earn trust.

## 24. Open Questions

1. What is the exact first must-win workflow?
2. What is the minimum evidence packet that reviewers actually trust?
3. What is the right default policy bundle for new users?
4. Which validator bundles should be first-class versus extension-provided?
5. How should the product represent uncertainty in a way humans actually act on?
6. What is the right storage and replay model for long-lived event histories?
7. Which compliance posture should be the first explicit go-to-market anchor?
8. How much of the product should be available through CLI versus dashboard initially?
9. What is the acceptable cost per successful task for the initial ICP?
10. What exact metrics qualify a model or workflow for autonomy promotion?

## 25. Recommended Initial Roadmap

### 25.1 Phase 1: kernel

Build:

- task packets
- execution plans
- evidence bundles
- policy engine
- event ledger
- directive interrupts
- basic CLI and operator surface

### 25.2 Phase 2: bounded execution

Build:

- coordinator plus implementer/verifier/reviewer loop
- sandboxed execution
- validator bundles
- brownfield onboarding flow
- PR-native workflow

### 25.3 Phase 3: governance hardening

Build:

- richer approvals
- scheduled jobs
- stronger notifications
- quotas and runtime budgets
- isolation improvements
- PII masking path

### 25.4 Phase 4: qualification and scale-up

Build:

- eval flywheel
- model and workflow canaries
- autonomy promotion/demotion logic
- richer dashboards
- deeper extension support

## 26. External Validation Snapshot

This PRD is primarily based on the repo’s research synthesis, but several current external signals reinforce the product shape.

### 26.1 What the external validation supports

- **Thin, governed orchestration beats gratuitous agent count.**
- **Long-horizon maintainability is now a better evaluation target than one-shot benchmark success.**
- **Interoperable tool and agent protocols are real, but still early enough that the factory should design for them without depending on them.**
- **Sandboxing, approvals, and runtime isolation are product fundamentals, not implementation details.**
- **Interactive approval and operator UX will matter more over time, but should not delay the trusted core.**

### 26.2 Selected current references

- Google-scale multi-agent study, *Towards a Science of Scaling Agent Systems* (arXiv, December 17, 2025): https://arxiv.org/abs/2512.08296
- *SWE-CI: Evaluating Agent Capabilities in Maintaining Codebases via Continuous Integration* (arXiv, revised March 17, 2026): https://arxiv.org/abs/2603.03823
- Anthropic research, *How AI is transforming work at Anthropic* (December 2, 2025): https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic
- MITRE ATLAS, *OpenClaw Investigation* (February 9, 2026): https://www.mitre.org/sites/default/files/2026-02/PR-26-00176-1-MITRE-ATLAS-OpenClaw-Investigation.pdf
- MCP Registry documentation: https://modelcontextprotocol.io/registry/about
- MCP Apps announcement (January 26, 2026): https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- A2A Protocol documentation (Linux Foundation, accessed March 17, 2026): https://a2a-protocol.org/dev/
- OpenAI Codex security and approvals documentation: https://developers.openai.com/codex/agent-approvals-security/

## 27. Final Product Recommendation

The recommended product is:

> A self-hostable software-factory control plane for engineering workflows, designed around explicit task packets, context packs, policy-bounded execution, replayable state, strong human steering, and portable evidence-backed outcomes.

If the product stays disciplined, it can become:

- effective on real engineering tasks
- flexible without becoming vague
- secure enough for serious usage
- observable enough to build trust
- adaptable enough to survive model and workflow churn

If it loses discipline, it will likely become:

- overbuilt
- hard to trust
- expensive to maintain
- brittle under model changes
- difficult to review
- difficult to extract from

The first version should therefore optimize for:

- a narrow trusted core
- one or two must-win workflows
- explicit governance
- brownfield onboarding
- strong evidence packets
- portable state

Everything else should be earned through qualification.
