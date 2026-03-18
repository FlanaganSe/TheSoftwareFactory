# Software Factory Deep Research Memo

Date: March 18, 2026

Scope: This memo is a technical and product research synthesis for building the system described in `docs/prd.md`. It is intentionally opinionated. It keeps the parts of the PRD that are structurally correct, challenges the parts that would create avoidable risk, and adds missing constraints that matter for execution quality.

This document is not an ADR log. After alignment, the major choices here should be converted into append-only ADRs in `docs/decisions.md`.

## Executive Summary

The PRD's core thesis is strong: governance-first, GitHub-native, customer-controlled, evidence-rich software automation is a real product, and the proposed candidate-branch plus approval model is materially better than "agent pushes straight to main" systems.

The main changes I recommend are:

1. Keep the product shape, but tighten the platform shape.
   - Keep: GitHub App model, candidate branches, approvals, evidence packets, index-time filtering, customer-owned state, CLI-first rollout, Temporal-style durable workflows.
   - Change: Node 24 instead of Node 22, Valkey instead of Redis by default, direct provider adapters instead of making an aggregator the core abstraction, explicit webhook replay/reconciliation from day 1, and a stricter versioned setup contract.

2. Treat this as a control plane, not an "AI app."
   - The primary value is policy enforcement, recovery, reviewability, auditability, and brownfield repo readiness.
   - Model quality matters, but workflow integrity matters more. Most product failures here will come from integration drift, repo policy collisions, replay/idempotency bugs, and opaque UX, not from pure model capability.

3. Optimize MVP for trust creation, not breadth.
   - Observer mode, brownfield readiness checks, clear evidence packets, branch/ruleset reconciliation, and GitHub-native status signaling will create more value than broad agent autonomy or an early plugin marketplace.
   - A smaller but reliable Class A system will be more strategically valuable than prematurely broad repo support.

4. Build the internals so the system can survive real-world GitHub behavior.
   - Rulesets inherit from org/enterprise level.
   - Merge queue changes event handling.
   - Webhooks fail and are not auto-redelivered by GitHub.
   - Required checks can be bound to a specific GitHub App.
   - Branch protection, CODEOWNERS, signed commits, stale approvals, and conversation resolution rules all affect the approval loop.

## What To Keep From The PRD

These are not just acceptable. They are strategically correct:

- Governance-first positioning.
- Customer-owned control-plane state and audit history.
- Candidate branch model rather than direct agent merge behavior.
- Evidence before PR and evidence before merge.
- Hard index-time filtering, not just runtime "please avoid this path" prompting.
- GitHub-native posture instead of inventing a parallel review world.
- Brownfield repo setup quality as a core requirement rather than a support detail.
- CLI-first initial control surface.
- Class A first, with Class B deferred.
- Explicit secret lifecycle classes.
- Phase-gated sandbox hardening rather than pretending strong isolation is free on day 1.

The product thesis is strongest when framed as:

> A governed software automation control plane that can safely operate in real repositories with explicit authority, evidence, replayability, and human override.

That framing should anchor future plans.

## What To Change In The PRD

### 1. Runtime baseline

The PRD currently targets Node 22+. As of March 18, 2026, Node 24 ("Krypton") is Active LTS and Node 22 is Maintenance LTS. For a new system with long runway, the default should be Node 24.

Recommendation:

- Standardize on Node 24 for all TypeScript/Node services.
- Allow Node 22 only as a temporary compatibility floor for local developer environments if necessary.

Why:

- New project, no legacy lock-in.
- Better runway for LTS support.
- Avoid starting the platform on a maintenance branch.

### 2. Redis default

The PRD assumes Redis 7. For this project, prefer Valkey as the default runtime-compatible choice.

Recommendation:

- Use Valkey as the default cache/pub-sub store.
- Keep the code compatible with Redis protocol clients where practical.

Why:

- Open governance matters for a self-hosted control-plane product.
- This system should not make a strategically unnecessary infrastructure choice where a close-compatible alternative exists.

### 3. Provider center of gravity

The PRD names OpenRouter as primary. That is too strong a dependency for a product whose value depends on governance and reliability.

Recommendation:

- Make direct provider adapters the core architecture.
- First-class adapters:
  - OpenAI Responses API
  - Anthropic
  - OpenAI-compatible local/self-hosted backends
- Optional adapter:
  - OpenRouter as a routing/aggregation layer, not the architectural center

Why:

- Direct provider integration preserves feature access, audit semantics, and vendor-specific capabilities.
- Aggregator-first creates feature lag, policy ambiguity, and data-path ambiguity.
- OpenAI's current platform direction is clearly centered on the Responses API, richer tool use, stateful chaining, and GPT-5.4 family support.

### 4. UI stack

The PRD suggests SvelteKit for a later dashboard. I do not think SvelteKit is the best default choice here.

Recommendation:

- Use a separate dashboard SPA over an explicit API.
- Prefer:
  - React 19
  - Vite
  - TanStack Router
  - TanStack Query
  - TanStack Table
  - headless UI primitives
- Use Monaco for structured editors and diff-heavy review surfaces.

Why:

- This is an authenticated operator/control-plane UI, not a content site.
- The strongest ecosystem for internal dashboards, tables, code/diff tooling, auth integrations, and stateful admin surfaces remains React.
- Keeping the UI separate from the API improves boundary clarity and reduces accidental coupling.
- SvelteKit is viable if the team is already strongly Svelte-native, but it is not a strategic advantage for this product.

### 5. Setup contract maturity

`.factory/setup.yml` must not remain "just a YAML file."

Recommendation:

- Make the setup contract a versioned product API from day 1.
- Ship:
  - JSON Schema
  - generated TypeScript types
  - validation library
  - upgrade/migration helpers
  - compatibility tests
  - canonical examples
  - semver-like contract evolution rules

Why:

- This file becomes the control plane's authority boundary.
- Loose schema evolution here will create drift, support pain, and breaking behavior in brownfield repos.

## Product Strategy Refinements

### The actual wedge

The first wedge is not "write code with AI."

The first wedge is:

- attach to a repo,
- understand what governance already exists,
- explain what the system can and cannot safely do,
- propose a safe automation envelope,
- then execute inside that envelope with strong evidence and rollback clarity.

That suggests the most valuable early product modes are:

1. Observer mode
   - No code writing required.
   - Scans the repo, branch protections, rulesets, workflows, test surface, setup quality, policy collisions, and merge constraints.
   - Produces a readiness report and recommended setup contract.

2. Guided execution mode
   - Candidate branch only.
   - Human review before PR.
   - Strong evidence packet.

3. Controlled autonomy mode
   - Only after repo-specific policy, setup quality, and approval defaults are stable.

Observer mode is not a nice-to-have. It is one of the highest-value features you can add because it lowers adoption risk and creates immediate product value without asking customers to trust code changes on day 1.

### UX thesis

The UX should answer these questions faster than anything else on the market:

- What changed?
- Why did the system decide this?
- What evidence supports the change?
- What policy limited or blocked the action?
- What remains uncertain?
- What exact human decision is needed next?

If the UI and CLI cannot answer those cleanly, the product will feel magical in the bad way.

### Review packet design

The review packet should be treated as a product surface, not just a blob of logs.

Recommended packet structure:

1. Objective
2. Authority scope used
3. Files touched
4. Files intentionally excluded
5. Validation steps run
6. Test outcomes
7. Risk summary
8. Known uncertainties
9. Why the system believes the change is safe enough for the next state transition
10. Raw artifacts and reproducibility links

The most important distinction in the UI is not pass/fail. It is:

- hard blocker
- soft concern
- human judgment required
- informational only

## Recommended Architecture

### System Shape

Use a modular monorepo, but do not over-split into many deployables too early. The product should start as a small number of well-bounded services with strong internal module boundaries.

Recommended service decomposition:

1. `api`
   - external API for dashboard and CLI
   - authn/authz
   - run management
   - repo management
   - approval endpoints
   - evidence retrieval

2. `github-app`
   - webhook ingestion
   - installation token management
   - REST/GraphQL access
   - checks/status updates
   - PR operations
   - reconciliation loops

3. `orchestrator`
   - Temporal workflows
   - candidate branch lifecycle
   - approval wait states
   - retries/timeouts/backoff
   - reconciliation and repair workflows

4. `sandbox-supervisor`
   - execution environment control
   - secret injection
   - filesystem mount policy
   - network policy
   - artifact capture

5. `indexer`
   - repo snapshot ingestion
   - allow/deny path filtering
   - file metadata
   - symbol extraction
   - dependency graphing
   - search materialization

6. `evaluator`
   - internal validation harness
   - prompt/task evaluation runs
   - evidence scoring
   - run-quality metrics

7. `dashboard`
   - operator UX
   - reviewer UX
   - run inspection
   - policy editing
   - repo health

8. `cli`
   - repo onboarding
   - setup generation
   - local inspect/debug
   - operator actions for approvals, reruns, and diagnostics

### Service Boundaries

Authority should not be implicit. Put it in code boundaries:

- GitHub writes happen only through the GitHub integration layer.
- workflow state transitions happen only through the orchestrator.
- sandbox secret materialization happens only through the sandbox supervisor.
- setup contract parsing and policy evaluation happen only through a versioned policy/config package.

This product will become difficult to reason about if every service can casually talk to GitHub and mutate run state.

### Recommended Technology Stack

| Area | Recommendation | Why |
| --- | --- | --- |
| Monorepo | `pnpm` workspaces + Turborepo | Strong TS monorepo ergonomics, deterministic workspace handling, task graphing, cache support |
| Runtime | Node 24 | Current Active LTS |
| Language | TypeScript | Fits product surface and integration ecosystem |
| HTTP API | Fastify | Low overhead, explicit, mature, good typing story |
| Validation | Zod or Valibot, generated from canonical schemas where possible | Contract-heavy system needs runtime validation everywhere |
| Workflow engine | Temporal | Long-running approvals, timers, retries, replay, recovery |
| Database | PostgreSQL 17, SQL-first access | Best balance of maturity, power, and operational simplicity |
| Query layer | `postgres.js` + Kysely or Drizzle-style SQL-first layer | Explicit SQL, typed access, fewer ORM escape-hatch problems |
| Cache/pub-sub | Valkey | Good default for ephemeral coordination/caching |
| Blob store | S3-compatible API | MinIO for self-host/dev, S3 or R2 in managed environments |
| Search | Postgres FTS + trigram + optional `pgvector` | Avoid early search-engine sprawl |
| UI | React + Vite + TanStack Router/Query/Table | Best fit for an authenticated control-plane app |
| Component editor | Monaco | YAML, JSON, diff, policy editing, rich inspection |
| Testing | Vitest + Playwright | Fast unit tests plus strong browser/e2e coverage |
| Observability | OpenTelemetry + structured logs | Needed for multi-service event tracing |
| Packaging | OCI images via GHCR | Natural distribution path for a GitHub-centric product |
| Docs site | Astro Starlight | Excellent repo-native docs experience |

### Why Temporal Is Still The Right Choice

Temporal remains a strong fit for this product.

Why it matches the domain:

- approval waits can be hours or days,
- GitHub state is eventually consistent,
- retries and repair loops are unavoidable,
- workflows need durable state and resumability,
- operator intervention must be possible without losing execution history,
- auditability matters.

Alternatives and why they are weaker here:

- plain Postgres job queue:
  - lower infra cost
  - but you end up rebuilding durable wait states, replay, repair, and time-based recovery logic
- BullMQ / Redis queues:
  - fine for shorter async work
  - weak fit for multi-day stateful control flows
- cloud workflow SaaS:
  - reduces ops
  - often weakens self-hosted posture, portability, or customer-control claims

Important implementation rule:

- Temporal is the workflow engine, not the source of business truth.
- Postgres remains the product system of record.
- Workflow executions should reference versioned domain records in Postgres rather than become the only readable source of state.

### Database And Data Model

Postgres should be the authoritative store for:

- accounts and installations
- repositories
- setup contracts and versions
- policy sets
- repo class and readiness assessments
- runs
- tasks
- approvals
- GitHub entities mirrored for control-plane needs
- webhook delivery records
- reconciliation cursors
- cost ledger
- audit entries
- evidence metadata
- index metadata

Object storage should hold:

- raw logs
- prompt/input artifacts
- tool call transcripts
- diff bundles
- screenshots
- trace files
- evidence bundles
- index snapshots
- replay fixtures

Valkey should hold only ephemeral state:

- short-lived coordination keys
- distributed locks where justified
- rate-limiting counters
- cache materializations
- websocket/session fanout

Do not let Valkey become hidden business state.

### Table design guidance

Plan for high-volume tables early:

- `audit_entries`
- `webhook_deliveries`
- `tool_calls`
- `events`
- `run_artifacts`

Recommendations:

- time partition the high-volume event tables
- store large payloads in object storage and hash-link them from Postgres
- keep immutable append-only audit/event records
- use explicit idempotency keys on all externally triggered mutations

### GitHub Integration Design

This is one of the most important parts of the product.

### Core principles

1. Build as a GitHub App, not as a PAT-based integration.
2. Treat webhook ingestion and reconciliation as equally important.
3. Use REST and GraphQL together.
   - REST for writes and ruleset/webhook/check specifics.
   - GraphQL for denormalized UI reads where useful.
4. Assume repo configuration changes out from under you.

### Webhook handling requirements

GitHub's own guidance makes several things non-optional:

- verify signatures with a webhook secret
- respond within 10 seconds
- process asynchronously
- dedupe using `X-GitHub-Delivery`
- subscribe only to needed events
- build redelivery handling because GitHub does not automatically redeliver failed webhook deliveries

Design implication:

- the webhook endpoint should do almost no business logic
- it should authenticate, persist, enqueue, acknowledge, and return

### Event coverage

At minimum, MVP should understand:

- installation and repository installation changes
- repository metadata changes
- push
- pull request events
- pull request review events
- issue_comment if GitHub-native conversation flows matter
- check suite/check run/status changes
- branch protection rule changes where available
- merge queue related events

GitHub Actions and merge queue behavior create a critical subtlety:

- if repos use merge queue and required checks are driven by GitHub Actions, workflows need `merge_group` as a trigger or required checks may not report correctly for queued merges

That means the product has to:

- detect merge queue usage,
- surface whether current CI is compatible,
- and avoid promising readiness if required checks will not fire in queue context.

### Rulesets and branch protection

Do not model repo policy only from branch protection.

GitHub rulesets matter, and inheritance matters.

Key implications:

- rulesets can be inherited from higher levels
- `includes_parents=true` is necessary when inspecting repository rulesets if you want the effective picture
- push rulesets can constrain file paths, file sizes, and extensions
- multiple rulesets can apply simultaneously
- the most restrictive effective rule is what matters operationally

Product implication:

- the repo health model must show both declared repo-local config and effective inherited config
- readiness checks should warn when inherited rulesets could block the product even if the repository-local config looks permissive

### Required checks and app identity

If the product emits required checks, the repo may restrict a status check to a specific GitHub App as the expected source.

Implication:

- the product's check emission path must be stable and attributable
- you should not casually change app identity or split status responsibilities across multiple apps without an explicit migration story

### Signed commits and protected flows

The system must explicitly detect and model:

- signed commit requirements
- linear history requirements
- conversation resolution requirements
- stale review dismissal
- CODEOWNERS requirements
- last-pusher review restrictions

These are not edge cases. They shape whether the candidate-branch-to-PR flow can complete.

## Model And Provider Strategy

### Core position

The product should present a provider-neutral control plane while still giving first-class treatment to the provider features that matter operationally.

Recommendation:

- Canonical internal abstraction should model:
  - messages/input
  - tools
  - tool calls/results
  - structured output
  - token/cost accounting
  - attachments/files
  - reasoning controls
  - store/replay settings
- Do not normalize away provider-specific capabilities that materially affect quality or safety.

### OpenAI should be a first-class integration

As of March 2026, OpenAI's guidance is very clearly moving advanced agent systems toward:

- GPT-5.4 as the default general/coding frontier model
- Responses API over Chat Completions
- richer tool calling
- stateful chaining
- MCP integration
- explicit sandbox/approval concepts in Codex

For this product, that means:

- OpenAI Responses API should be a first-class adapter
- Chat Completions should not be the reference model for new agent features
- internal agent abstractions should assume multi-tool, multi-turn, structured outputs

### Model routing recommendations

Recommended model policy:

- Default heavy reasoning/coding:
  - `gpt-5.4`
- Harder tasks / escalations / complex synthesis:
  - `gpt-5.4-pro`
- Fast lower-cost routing/classification/subtasks:
  - `gpt-5-mini`
- Self-hosted or air-gapped tier:
  - OpenAI-compatible local provider, ideally fronted by vLLM

Do not treat one model as the universal answer. This system has distinct subproblems:

- classification
- policy interpretation
- planning
- code editing
- evidence summarization
- reviewer explanation

These should be routeable separately.

### OpenRouter's role

OpenRouter can still be useful:

- model access breadth
- fallback routing
- customer choice
- experimental comparisons

But it should be optional, not architectural bedrock.

The core risk with aggregator-first design is not only feature lag. It is ambiguity:

- whose retention policy applies,
- which tool semantics are preserved,
- how retries behave,
- how structured outputs differ,
- what exact telemetry is exposed,
- how provider-specific controls are surfaced.

For a governance product, that ambiguity is expensive.

### Self-hosted inference

Support an OpenAI-compatible local adapter from day 1, even if it is not the default path.

vLLM is the practical anchor here because it already exposes OpenAI-compatible APIs, including a Responses-compatible surface in current documentation. That makes it the best obvious self-hosted bridge for customers who require:

- data locality,
- open weights,
- air-gapped operation,
- or cost control for lower-sensitivity tasks.

### MCP policy

MCP support should be deliberately conservative.

Recommendations:

- allowlist servers
- per-server trust levels
- explicit approval policy on remote MCP calls
- record all MCP tool invocations in audit/evidence
- separate public-web research from sensitive-data MCP access when both are present

This matches current OpenAI guidance around MCP risk: even read-only servers can carry prompt injection or unintended data egress risk.

## Sandboxing And Execution Isolation

The PRD is directionally right here. The main thing to add is operational discipline.

### Recommended phased model

Phase 1:

- rootless Docker containers
- non-root runtime user
- read-only base image
- ephemeral writable workspace
- seccomp/apparmor defaults
- CPU/memory/time limits
- outbound network allowlist or egress proxy
- explicit secret injection policy
- artifact capture and redaction

Phase 2:

- gVisor-backed execution option for stronger syscall isolation
- use selectively for higher-risk repos and commands

Phase 3:

- Firecracker or similar microVM mode only if customer requirements justify the complexity

Why not jump straight to microVMs:

- MVP complexity goes up sharply
- DX and compatibility issues get worse
- you will still need all the same workflow, policy, and GitHub correctness work

### Approval policy versus sandbox policy

OpenAI Codex's documented split between sandbox permissions and approval policy is a useful design pattern.

Apply that same separation internally:

- sandbox policy:
  - what the environment technically allows
- approval policy:
  - what the system is allowed to attempt without a human

These should not be conflated.

### Secret lifecycle

The PRD already distinguishes setup-only, runtime, and per-tool secrets. Keep that, but make enforcement concrete:

- setup-only secrets are mounted only in setup phase and scrubbed before agent execution
- runtime secrets are scoped to the minimum workflow phase that actually needs them
- per-tool secrets are mounted only for the specific tool invocation path
- no secret should enter prompt text unless the tool absolutely requires plaintext inline and the event is explicitly audited

Recommended implementation:

- secret envelopes resolved just in time
- secret provenance recorded
- secret mounts time-bounded
- post-run scrub verification

## Indexing, Code Understanding, And Search

This is a product-critical subsystem because governance quality depends on what the system can and cannot see.

### Core rule

Path-level exclusion must happen before indexing and before retrieval.

Do not compromise this.

### Recommended indexing layers

1. File inventory layer
   - path
   - size
   - language
   - content hash
   - policy flags
   - generated/binary/vendor classifications

2. Structural extraction layer
   - symbols
   - imports/dependencies
   - references
   - test associations where feasible
   - ownership metadata

3. Search layer
   - lexical search
   - trigram/fuzzy search
   - symbol lookup
   - optional embedding retrieval for selected corpora

4. Policy layer
   - hard excludes
   - soft warnings
   - sensitive path tags
   - repo-specific allowlists/denylists

### Recommended implementation shape

For MVP:

- `ripgrep` for fast lexical fallback
- Tree-sitter or language-aware parsers for structure where available
- Postgres FTS + trigram for basic search
- optional `pgvector` for embeddings, but not as the primary retrieval mechanism

Why:

- embeddings-only retrieval is weak for policy-critical repo understanding
- a governance product needs determinism and debuggability
- lexical + structural retrieval is easier to explain to users and easier to validate

### What to defer

Do not build a giant general semantic knowledge graph in v1.

Focus on:

- files
- symbols
- edges that directly affect safe change planning
- policy visibility

That is enough to create value without turning indexing into its own research project.

## API And Contract Design

This product should be contract-heavy and codegen-light in the right places.

Recommendations:

- canonical schemas for:
  - setup contract
  - policy documents
  - evidence packets
  - approval actions
  - run summaries
  - audit events
- generate TS types from canonical schemas
- validate on ingress and egress
- version externally meaningful payloads explicitly

Do not let "internal only for now" become an excuse to avoid versioning. This system's own internal integrations will behave like external APIs very quickly.

### Evidence packet contract

Evidence packets should have a schema and golden tests.

Why:

- they are a user-facing trust surface
- they will be used in PRs, dashboards, CLI, exports, and potentially compliance reviews
- once they become valuable, changing them casually becomes expensive

## Frontend And UX Recommendations

### Control surface priorities

The dashboard should optimize for:

- repo readiness
- current runs
- pending approvals
- blocked state explanations
- drift visibility
- evidence inspection
- rerun and repair actions

The dashboard should not try to be a full IDE.

### High-value screens

1. Repo readiness screen
   - effective rulesets
   - branch protection
   - setup quality
   - test surface detection
   - blocked requirements
   - confidence level for automation

2. Run inspection screen
   - workflow timeline
   - artifacts
   - tool calls
   - validation matrix
   - policy notes

3. Approval screen
   - exact action requested
   - diff summary
   - evidence summary
   - hard blockers versus soft concerns

4. Drift screen
   - what changed externally
   - whether it changes authority or readiness
   - what needs revalidation

5. Policy/setup editor
   - schema-aware editing
   - preview of behavioral changes
   - migration warnings

### UX additions that would materially improve value

- readiness score with explicit reasons
- "simulate this policy change" view
- "why was this file excluded?" explanation
- branch/ruleset drift alerts
- rerun from last safe checkpoint
- raw artifact access everywhere
- GitHub-first sharing model for evidence links and comments

## Testing Strategy

This product needs more than normal unit and e2e coverage. It needs behavior integrity coverage.

### Recommended test layers

1. Unit tests
   - policy evaluation
   - schema validation
   - diff classification
   - cost accounting
   - redaction

2. Workflow tests
   - Temporal deterministic/replay tests
   - state transition tests
   - timeout and retry behavior
   - approval wait/resume behavior

3. Integration tests
   - GitHub webhook ingestion
   - GitHub API contract tests
   - setup contract migration tests
   - sandbox launch and artifact capture

4. Golden artifact tests
   - evidence packet snapshots
   - audit event shapes
   - PR comment rendering
   - readiness reports

5. Browser and e2e tests
   - Playwright for full flows
   - trace capture enabled on retries/failures

6. Shadow-mode product tests
   - run against controlled public repos
   - compare system conclusions to expected governance outcomes

### Tooling recommendations

- Vitest for unit/integration tests
- Playwright for browser/e2e
- use Playwright trace artifacts in CI
- use Vitest browser traces where component/browser interaction debugging adds value

### What to test that teams often forget

- duplicate webhook deliveries
- redelivered webhook deliveries with same `X-GitHub-Delivery`
- installation token expiration mid-run
- repo ruleset changes during a run
- required-check source identity mismatches
- stale approval invalidation after rebases
- merge queue enqueue/dequeue transitions
- secret scrubbing verification
- path-policy exclusion correctness
- large repo index refresh after partial change

## Evaluation Strategy

Do not reduce evaluation to "did the model write good code."

The product needs at least five evaluation dimensions:

1. Governance correctness
   - did the system respect path, authority, approval, and secret constraints

2. Operational correctness
   - did the workflow survive retries, drift, and external changes

3. Code change quality
   - test outcomes
   - reviewer acceptance
   - rollback rates

4. Evidence quality
   - completeness
   - correctness
   - reviewer usefulness

5. User value
   - time saved
   - false blocks
   - trust gained
   - onboarding friction

### Internal eval harness

Build your own authoritative eval framework around:

- replayable fixtures
- benchmark repos
- labeled tasks
- expected policy outcomes
- expected evidence outputs

OpenAI Evals can still be useful for model-side experiments, grader research, or prompt comparisons, but your product cannot outsource its main notion of correctness to a third-party eval API.

### Key metrics

Recommended core metrics:

- PR acceptance rate
- reviewer time-to-decision
- false block rate
- policy escape rate
- rerun rate
- rollback rate
- run completion time
- cost per successful change
- readiness-to-first-success time

## Observability, Audit, And Data Hygiene

This product should be observable enough to debug hard failures without becoming a data-leak machine.

### Required observability

- structured logs with correlation IDs
- distributed traces across webhook -> workflow -> sandbox -> GitHub calls
- metrics on queueing, retries, failures, tool usage, cost, and latency
- explicit run timeline views

### Redaction requirements

Before shipping data to any external observability system, redact:

- secrets
- sensitive prompt fragments where needed
- file contents from protected paths
- raw auth headers
- tokens and installation secrets

### Audit model

Audit entries should be:

- append-only
- immutable
- actor-attributed
- phase-attributed
- hash-linkable to stored artifacts

Audit should capture:

- authority used
- approvals requested/granted/denied
- GitHub writes
- model/provider used
- tool invocations
- secret scopes mounted
- policy evaluations
- reruns and repair actions

## Deployment And Distribution

### What to ship first

Recommended release surfaces:

1. GitHub Releases
   - versioned release notes
   - checksums
   - upgrade notes

2. GHCR OCI images
   - multi-arch images
   - immutable digests
   - OCI metadata labels linking source repo and license

3. Docker Compose reference deployment
   - single-tenant
   - minimal dependencies
   - best for evaluation and small teams

4. Helm chart
   - after the core operational shape stabilizes

5. CLI package
   - npm package first
   - Homebrew distribution later if adoption warrants it

### Deployment targets

Short answer:

- download/evaluate: Docker Compose
- production self-host: Kubernetes via Helm
- future hosted edition: managed Kubernetes, probably AWS first if you choose a hosted path later

Why:

- Compose is the fastest path for developers and small teams
- Kubernetes is the realistic long-term production target for the type of buyers who will care about governance and self-hosting
- do not invent a bespoke installer before product-market clarity

### Supply chain recommendations

Ship with:

- pinned base images
- signed images
- SBOM generation
- provenance metadata
- reproducible build guidance where practical

This aligns with the product's trust posture.

## Documentation Strategy

The documentation set should be larger and more structured than typical OSS docs because the product is partly a governance system.

### Recommended docs map

1. Product docs
   - what the product is
   - repo classes
   - operator concepts
   - reviewer concepts

2. Setup contract spec
   - schema reference
   - versioning rules
   - migration guides
   - examples by repo class

3. Policy docs
   - authority model
   - path filtering
   - secret scopes
   - approval semantics
   - merge/PR semantics

4. Deployment docs
   - Compose
   - Kubernetes
   - storage/backups
   - upgrades
   - rollback

5. Security docs
   - threat model
   - sandboxing model
   - secret handling
   - logging/redaction
   - provider/MCP data flow

6. GitHub integration docs
   - app permissions
   - required events
   - rulesets
   - merge queue
   - checks integration

7. Runbooks
   - webhook failures
   - stuck workflows
   - repo drift
   - secret rotation
   - index corruption/rebuild

8. API and CLI reference
   - generated where possible

9. ADRs
   - append-only in `docs/decisions.md`

### Docs tooling

Use Astro Starlight for the docs site.

Why:

- repo-native markdown workflow
- strong defaults
- search/navigation/i18n/accessibility out of the box
- good fit for a docs-heavy product that is not itself a marketing website

## Project Management And Build Discipline

This project will only stay clean if feature work is attached to contracts and invariants.

### Recommended repo structure

```text
apps/
  api/
  dashboard/
  cli/

services/
  github-app/
  orchestrator/
  sandbox-supervisor/
  indexer/
  evaluator/

packages/
  contracts/
  policy-engine/
  github-client/
  provider-gateway/
  db/
  observability/
  config/
  evidence/
  test-fixtures/

docs/
  prd.md
  decisions.md
  codex-5.4-resaerch.md

.plans/
  ...
```

### Definition of done for major features

Every non-trivial feature should include:

- schema/contract updates
- docs update
- audit coverage
- metrics/observability coverage
- tests
- upgrade/migration notes if behavior changes

### Feature flags

Use feature flags for:

- model/provider adapters
- sandbox modes
- new approval behaviors
- new evidence packet sections
- beta repo-class support

Do not use feature flags to avoid versioning important contracts.

### ADR candidates to record early

1. Node 24 baseline
2. Temporal as workflow engine
3. Postgres as source of truth
4. Valkey as ephemeral store
5. React dashboard choice
6. setup contract versioning policy
7. direct provider adapters with optional aggregators
8. observer mode as official product mode

## Security And Compliance Posture

The PRD's threat model is good. These extra constraints should be added:

### Data-path explicitness

For every provider and tool integration, the product should be able to answer:

- what data can leave the control plane
- under what policy
- to which third party
- under which retention assumptions

This especially matters for:

- OpenAI/store behavior
- Zero Data Retention customers
- MCP servers
- observability vendors
- object storage

### Zero Data Retention and store semantics

Current OpenAI platform docs matter operationally:

- `/v1/responses` stores application state for about 30 days by default when storage is enabled
- Zero Data Retention changes the meaning of `store`
- remote MCP servers are third-party data paths

Product implication:

- provider policy must be configurable per customer/org/repo
- evidence and audit need to record provider path and storage mode
- the UI should surface when a configured workflow is incompatible with the customer's retention requirements

### Compliance-ready by design means exportable evidence

If you want the product to become compliance-friendly later, capture now:

- immutable audit timeline
- versioned policy state
- approval history
- artifact hashes
- provider/model identity
- exact authority used

## Unknown Unknowns That Should Be Treated As Known Risks

These are the issues most likely to create hidden complexity if ignored:

### 1. GitHub drift is constant

Repo state will change between indexing, candidate branch work, validation, PR creation, and merge. Reconciliation is not a background nice-to-have. It is part of the core loop.

### 2. Workflow code changes can break long-running runs

Temporal helps here, but only if workflow versioning discipline exists from day 1. Treat workflow evolution as a versioned contract problem.

### 3. Remote cache and telemetry can leak sensitive data

Turborepo remote cache, CI logs, tracing vendors, and prompt logs can exfiltrate private code and secret-adjacent context if enabled casually. Default to local/self-hostable telemetry posture first.

### 4. Merge queue is not just "a different merge button"

It changes event flow and CI expectations. If you ignore it, the system will look fine in simple repos and fail in mature ones.

### 5. Setup contract migration is a product problem

If you do not build migration and preview tooling, every future change to `.factory/setup.yml` becomes a support and trust problem.

### 6. Signed-commit repos may force architectural choices

If customers require signed commits, the product must have an explicit answer for how commits are created and trusted. Do not postpone this to the last minute if enterprise use is a target.

### 7. Brownfield repos have social constraints, not just technical constraints

The most valuable product behavior may be recommendation and explanation, not action. This further supports observer mode and readiness reporting.

### 8. Test files are not simple

The PRD's choice to flag but not hard-block tests is directionally good, but the implementation needs nuance:

- generated tests
- snapshot files
- golden files
- contract tests
- infra smoke tests

These are not equivalent. The product should classify them, not lump them together.

## Features To Defer Or Remove

These would add complexity faster than they add value in the first major versions:

- broad generalized plugin marketplace
- premature multi-VCS support
- Class B repo support before Class A is truly strong
- too many autonomy modes
- heavy semantic graph ambitions beyond safe retrieval needs
- early microVM-by-default isolation
- dashboard bloat that competes with IDEs

## Recommended Build Sequence

I would adjust the PRD's build sequence slightly.

### Stage 0: Foundation

- monorepo setup
- contracts package
- audit/event model
- Postgres schema baseline
- GitHub App shell
- Temporal baseline
- container execution shell
- docs skeleton

### Stage 1: Observer Mode

- repo connect
- effective ruleset/branch protection inspection
- setup contract draft generation
- readiness report
- drift detection baseline

This creates immediate value and de-risks the rest of the build.

### Stage 2: Guided Candidate Branch Execution

- run creation
- candidate branch creation
- path-aware indexing
- sandbox execution
- evidence artifact capture
- approval wait state

### Stage 3: PR And Merge Readiness

- GitHub checks integration
- PR creation
- merge readiness modeling
- branch/ruleset revalidation
- merge queue awareness

### Stage 4: Dashboard And Operator Experience

- run inspection UI
- approval UI
- repo health UI
- drift UI

### Stage 5: Hardening And Expansion

- stronger sandboxing
- provider breadth
- self-hosted inference adapter polish
- repo-class expansion
- enterprise deployment tooling

## Specific PRD Deltas I Recommend

These are the most actionable edits to make later:

1. Change Node baseline from 22+ to 24.
2. Change Redis default wording to Valkey/Redis-compatible ephemeral store.
3. Reframe OpenRouter from primary to optional routing adapter.
4. Add observer mode as an official product mode.
5. Upgrade `.factory/setup.yml` from config file concept to versioned contract concept.
6. Add GitHub ruleset inheritance and merge queue handling as first-order design constraints.
7. Add explicit webhook replay/redelivery and reconciliation as MVP requirements.
8. Make direct provider retention/data-path visibility part of the security model.
9. Change dashboard recommendation from SvelteKit to a separate React SPA unless team-specific constraints override it.
10. Add workflow versioning discipline to the architecture and risk sections.

## Source Appendix

Primary sources used for this memo, current as of March 18, 2026:

### OpenAI

- OpenAI Codex sandbox and approvals:
  - https://developers.openai.com/codex/agent-approvals-security/#sandbox-and-approvals
- OpenAI Codex sandboxing concepts:
  - https://developers.openai.com/codex/concepts/sandboxing/
- OpenAI Codex local vs cloud deployment concepts:
  - https://developers.openai.com/codex/enterprise/admin-setup/#pre-requisites-determine-owners-and-rollout-strategy
- OpenAI GPT-5.4 guidance:
  - https://developers.openai.com/api/docs/guides/latest-model/
- OpenAI GPT-5.4 prompt guidance:
  - https://developers.openai.com/api/docs/guides/prompt-guidance/
- OpenAI Responses migration guidance:
  - https://developers.openai.com/api/docs/guides/migrate-to-responses/
- OpenAI data controls:
  - https://developers.openai.com/api/docs/guides/your-data/
- OpenAI deep research risk guidance, especially MCP risk:
  - https://developers.openai.com/api/docs/guides/deep-research/
- OpenAI API references/spec surfaces consulted:
  - https://api.openai.com/v1/responses
  - https://api.openai.com/v1/evals
  - https://api.openai.com/v1/organization/audit_logs

### GitHub

- About rulesets:
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- REST API for repository rulesets:
  - https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28
- About protected branches:
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Events that trigger workflows, including `merge_group`:
  - https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Webhook best practices:
  - https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
- Handling failed webhook deliveries:
  - https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
- GitHub Container Registry:
  - https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry

### Runtime, infra, and platform

- Node.js previous releases:
  - https://nodejs.org/en/about/previous-releases
- Temporal workflows:
  - https://docs.temporal.io/workflows
- Valkey:
  - https://valkey.io/
- pnpm workspaces:
  - https://pnpm.io/workspaces
- Turborepo caching:
  - https://turborepo.com/docs/crafting-your-repository/caching
- Biome getting started:
  - https://biomejs.dev/guides/getting-started/
- vLLM OpenAI-compatible server:
  - https://docs.vllm.ai/en/latest/serving/openai_compatible_server/
- gVisor compatibility:
  - https://gvisor.dev/docs/user_guide/compatibility/
- Firecracker:
  - https://firecracker-microvm.github.io/
- Model Context Protocol latest spec:
  - https://modelcontextprotocol.io/specification/latest

### Docs and testing

- Astro Starlight:
  - https://starlight.astro.build/
- Playwright docs:
  - https://playwright.dev/docs/trace-viewer
- Vitest browser trace view:
  - https://vitest.dev/guide/browser/trace-view

## Final Recommendation

The highest-quality build path is:

- TypeScript control plane on Node 24
- Temporal for long-running workflows
- Postgres as the product source of truth
- Valkey for ephemeral coordination
- S3-compatible blobs
- GitHub App integration with replay-safe webhooks and first-class reconciliation
- OpenAI Responses API as the first-class frontier provider path
- optional direct adapters for Anthropic, OpenRouter, and OpenAI-compatible local providers
- React dashboard over a clear API
- observer mode before broad autonomy
- setup contract as a versioned product API

If you do that, the system has a credible path to being trustworthy, flexible, testable, and materially better than "AI agent in a repo" products. If you skip the workflow integrity, GitHub fidelity, contract versioning, and operator UX work, the product may still demo well, but it will be fragile in the exact environments where it needs to win.
