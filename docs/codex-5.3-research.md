# Software Factory Deep Build Research (Codex 5.3)

**Date:** 2026-03-18  
**Input PRD:** `docs/prd.md`  
**Research Goal:** Define a technically defensible, low-risk, high-quality build strategy that can be executed with minimal ambiguity.

---

## 1. Executive Summary

The PRD is directionally strong and differentiated. The highest-value thesis is correct: keep code generation and evidence production internal, and create a strict boundary before external PR operations. The biggest execution risk is not idea quality, it is operational complexity drift in Phase 1.

Top recommendations:

1. Keep the dual-boundary model exactly as described in the PRD, but enforce it with a formal state machine and immutable evidence snapshots.
2. Lock an implementation stack now: `Node.js + TypeScript + Temporal + Postgres + Redis + MinIO + OpenTelemetry + Docker`, with `gVisor` as opt-in hardening only after compatibility gates pass.
3. Treat GitHub capability discovery as first-class: inherited rulesets, push restrictions, required workflows, and merge-queue behavior materially change factory behavior.
4. Use OpenAI Responses API as the primary model interface for stateful tool-oriented flows; keep provider abstraction but do not optimize for multi-provider parity in Phase 1.
5. Build robust failure semantics first: idempotency keys, branch leases, workflow resume/continue-as-new, and reproducible evidence before adding UX surface area.
6. Shift early roadmap weight from “more integrations” to “deterministic policy/evidence correctness.” This improves trust, quality, and enterprise viability.

---

## 2. Method And Scope

This document combines:

- Deep reading of local PRD and project rules.
- Official docs research for GitHub, Temporal, OpenAI/Codex, MCP, runtime/version policy, sandboxing constraints, and observability standards.
- Architecture inference for tradeoffs not fully specified in upstream docs.

This is a build-research deliverable, not a final implementation spec. It is intended to feed ADRs, milestone plans, and execution tickets.

---

## 3. PRD Strengths To Preserve

These are correct and should remain unchanged:

1. Candidate branch model as the core safety/control unit.
2. Internal evidence boundary before PR creation/updates.
3. Clear separation of internal readiness vs external merge readiness.
4. Behavioral-control trust boundary (base-ref-only loading).
5. Explicit setup contract and secret classes.
6. Governance-first posture and auditable operator controls.
7. Append-only audit posture (paired with relational state).

---

## 4. Critical Gaps And Recommended PRD Deltas

These are the highest-impact modifications to apply before buildout planning.

| ID | Proposed Delta | Why | Impact |
|---|---|---|---|
| D-01 | Add a formal state-machine contract file (versioned) for all run states/transitions. | Prevent implicit transition bugs and re-entry ambiguity. | High reliability, easier testing. |
| D-02 | Make branch lease semantics explicit (`lease_id`, `ttl`, `owner`, `renewal`, `steal_policy`). | Concurrency bugs will otherwise corrupt branch intent. | High correctness. |
| D-03 | Add idempotency keys to all externally visible side effects (PR creation, PR comment, status update). | Retries + workflow replay will duplicate without this. | High operational safety. |
| D-04 | Add a “capability snapshot” object persisted per run (effective rulesets, merge method, queue, checks, workflow behavior). | GitHub policy drift creates inconsistent behavior unless versioned per run. | High predictability. |
| D-05 | Explicitly define unsupported repository topologies in V1 error taxonomy (submodules, sparse checkout edge cases, huge LFS patterns, custom merge drivers). | “Unknown unsupported” creates hard-to-debug failures. | Medium reliability. |
| D-06 | Add model failure budget policy (token/time/cost ceilings per run and per phase). | Prevent unbounded autonomous loops. | High cost/risk control. |
| D-07 | Add evidence schema versioning and migration strategy now. | Evidence packet shape will evolve quickly. | Medium maintainability. |
| D-08 | Add “data retention matrix” by artifact type (audit, prompts, tool outputs, diffs, logs). | Compliance and storage cost need explicit defaults. | High enterprise readiness. |
| D-09 | Clarify multi-tenant boundaries in PRD (tenant keying, encryption domains, queue isolation). | Critical for future hosted/business model options. | High security/commercial flexibility. |
| D-10 | Move “integration expansion” behind quality gates (policy/evidence pass rate, false block rate, rollback success). | Prevent scope creep before trust foundation is stable. | High roadmap discipline. |

### Items To Defer Or Remove From Early Build

1. Broad plugin framework in V1.
2. Multi-provider model parity as a hard requirement in Phase 1.
3. Deep UI customization surface before core flow reliability targets are met.
4. Aggressive sandbox hardening rollout before compatibility telemetry is collected.

---

## 5. Recommended Target Architecture (V1)

### 5.1 Control Plane Services

1. `api-gateway`: AuthN/AuthZ, tenant routing, request validation, operator command intake.
2. `workflow-service`: Temporal workflow definitions and orchestrator clients.
3. `executor-manager`: Manages ephemeral execution workers and sandbox profiles.
4. `github-adapter`: GitHub App auth, capability scan, PR/status/ruleset interactions.
5. `policy-engine`: Evaluates path/file/action policies and trust boundaries.
6. `evidence-service`: Evidence artifact assembly, hashing, signing, publishing.
7. `index-service`: Repository indexing with path filters and ignore/trust contracts.
8. `secret-service`: Envelope encryption, policy-bound retrieval, lifecycle enforcement.
9. `event-bus`: Redis-backed notifications, leases, cancellation signals, UI updates.
10. `dashboard`: Operator UI for run visibility, approvals, diffs, controls.

### 5.2 Data Stores

1. PostgreSQL: canonical state, relational run model, append-only audit records.
2. Redis: transient coordination, leases, pub/sub, short-lived caches.
3. Object store (MinIO/R2): evidence packets, artifact bundles, export snapshots.

### 5.3 Isolation Domains

1. Tenant domain.
2. Repository domain.
3. Branch/run domain.
4. Execution sandbox domain.
5. Secret class domain (`setup-only`, `runtime`, `tool-specific`).

### 5.4 Why This Shape Works

- It keeps “decision logic” centralized and testable.
- It isolates external API coupling inside adapters.
- It maps directly to PRD principles without introducing event-sourcing complexity.

Inference: this decomposition is the minimum that still supports deterministic auditability and future scale.

---

## 6. Core Workflow Design (Deep)

### 6.1 End-to-End Flow

1. Ingest request and normalize intent.
2. Acquire capability snapshot from GitHub and persist it.
3. Validate repo class and policy profile.
4. Acquire branch lease and create/update candidate branch.
5. Run setup phase with declared setup contract.
6. Execute implement-validate-evidence loop with bounded retries.
7. Evaluate internal readiness boundary (policy + evidence checks).
8. If internal boundary passes, optionally create/update PR.
9. Track external readiness boundary (required checks/reviews/queue status).
10. On review feedback, re-enter loop on same PR branch.
11. Finalize run with immutable evidence snapshot and audit digest.

### 6.2 Dual Boundary Model (Must Be Explicit)

Internal boundary:

- All factory policies satisfied.
- Required evidence complete and consistent.
- Branch lease valid.
- Secrets lifecycle clean.

External boundary:

- All GitHub-required checks/reviews/rules/queue conditions satisfied.
- Merge conditions can evolve independently from internal checks.

### 6.3 Concurrency Model

Recommended:

- One active write lease per `{tenant, repo, branch_target}`.
- Additional intents queue behind lease holder unless explicitly marked “parallel-safe.”
- Read-only analytical operations do not require write lease.

Branch lease record minimum:

- `lease_id`
- `scope_key`
- `owner_run_id`
- `acquired_at`
- `expires_at`
- `heartbeat_interval`
- `steal_after`

### 6.4 Failure Semantics

Failure classes:

1. Policy violation (deterministic, no retry).
2. External transient (retry with backoff).
3. Sandbox/setup failure (bounded retry with environment reset).
4. Tool/model failure (bounded retry + model fallback policy).
5. Unknown terminal (requires operator acknowledgement).

Run must always end with one of:

- `completed`
- `blocked_policy`
- `blocked_external`
- `failed_transient_exhausted`
- `failed_terminal`
- `cancelled_operator`

---

## 7. Stack Decision Matrix

### 7.1 Runtime And Language

Recommendation: `Node.js + TypeScript`.

Rationale:

- Native fit for MCP ecosystem and GitHub/OpenAI SDK usage.
- Shared types across backend/dashboard.
- Strong ecosystem for worker orchestration and tooling.

Versioning recommendation:

- Target current LTS major, not a vague `22+`.
- Use explicit support policy tied to Node release cadence (new major every 6 months, LTS transition/release windows changed in 2025 schedule update).

### 7.2 Orchestration

Recommendation: `Temporal`.

Rationale:

- Durable workflows, retries, timers, visibility, replay safety.
- Explicit limits are known and manageable.
- Long-running runs can use Continue-As-New to avoid history bloat.

Important operational constraints:

- Workflow event history has hard limits.
- Continue-As-New should be designed in at phase/state boundaries.

### 7.3 Primary Database

Recommendation: `PostgreSQL 16+` now, plan upgrade discipline with upstream support window.

Rationale:

- Strong relational integrity for policy/evidence/audit data.
- Excellent transaction semantics for lease and state transitions.
- Mature JSONB + indexing for flexible metadata fields.

### 7.4 Cache/Coordination

Recommendation: `Redis 7`.

Use cases:

- Lease heartbeat cache.
- Pub/sub events to UI.
- Cancellation and kill-switch fanout.
- Rate-limit and throttling counters.

### 7.5 Object Storage

Recommendation:

- Self-hosted default: MinIO.
- Cloud option: R2/S3-compatible backend.

Use:

- Evidence packet blobs.
- Diff bundles.
- Large logs/artifact exports.

### 7.6 Sandbox Strategy

Recommendation:

1. Phase 1: rootless Docker + strict seccomp/AppArmor + network egress controls.
2. Phase 2: hardened profiles by repo class and action type.
3. Phase 3: gVisor opt-in profile where compatibility tests pass.

Why not gVisor-by-default now:

- gVisor explicitly does not guarantee full Linux syscall/kernel behavior compatibility and can incur performance overhead.
- Early reliability is better served by strict Docker hardening plus telemetry-driven rollout.

### 7.7 Dashboard

Recommendation: SvelteKit is acceptable for planned scope.

Requirements to enforce:

- Real-time run stream via SSE/WebSocket.
- Diff/evidence visualization with immutable snapshots.
- Explicit operator actions with signed audit events.

### 7.8 Observability

Recommendation: OpenTelemetry traces + metrics + structured logs.

Important note:

- GenAI semantic conventions are still evolving; pin your telemetry schema version and avoid hard-coding unstable fields without version tags.

---

## 8. GitHub Integration Deep Findings

These findings materially affect architecture and policy behavior.

### 8.1 Required Status Checks Recency

GitHub required checks must have a successful run in the recent validity window (7 days). Implication: factory readiness should include check freshness verification before marking external-ready.

### 8.2 Merge Queue Behavior

When merge queue is enabled, workflows must handle `merge_group` behavior/events in addition to standard PR triggers. Implication: CI/event strategy must explicitly include merge-queue paths.

### 8.3 Rulesets Caveat For Required Workflows

Rulesets “required workflows” can ignore certain branch/path/repo-type filters in that mode. Implication: capability scan cannot assume those filters are honored during required workflow enforcement.

### 8.4 Push Rulesets And Path Restrictions

Push rulesets can restrict file paths, extensions, path length, and file size. Implication: change planning must pre-check intended writes against effective push restrictions to avoid late failure.

### 8.5 Inherited Rulesets

REST API supports effective/inherited ruleset discovery (`includes_parents`). Implication: capability scan must compute effective policy including org/enterprise inheritance.

### 8.6 GitHub App Token Lifecycle

Installation tokens expire quickly (1 hour). Implication: adapter layer must auto-refresh and avoid long-lived token assumptions inside workflows.

### 8.7 Recommended Capability Snapshot Payload

Persist per run:

1. Merge strategy flags.
2. Merge queue enabled/required.
3. Effective ruleset IDs + hashes + inheritance markers.
4. Required workflows references.
5. Required status check list and freshness windows.
6. Branch protection and review requirements.
7. Push restrictions.
8. OIDC/policy warnings (if available).

---

## 9. OpenAI/Codex And Model Layer Findings

### 9.1 Security Model Parallels With Your Product

Codex security model distinguishes:

1. Technical sandbox boundaries.
2. Approval policy boundaries.

This maps directly to your governance-first product goals and should be mirrored in your own action authorization model.

### 9.2 Setup-Phase vs Agent-Phase Secret Handling

Codex cloud docs describe setup and agent phases with setup-time network/dependency behavior and secret removal before agent phase. This strongly validates your PRD secret phase separation.

### 9.3 Responses API Fit

For tool-driven, multi-step orchestration:

- Responses API supports state chaining through `previous_response_id`.
- `store` and retention behavior need explicit policy.
- Conversation state choices have billing and retention consequences.

Recommendation:

1. Build model adapter around Responses API semantics first.
2. Expose retention mode per tenant/project (`store` policy).
3. Always persist your own minimal deterministic transcript summary for audit reproducibility.

### 9.4 Rate Limiting Strategy

Use exponential backoff with jitter and capped retries. Tie retries to run budgets and side-effect idempotency.

### 9.5 Model Routing Strategy

Recommended policy:

1. Primary: OpenAI (Responses API) in Phase 1 for deterministic integration behavior.
2. Secondary: provider abstraction kept narrow (`generate`, `tool_call`, `structured_output`) to allow future expansion.
3. Optional gateway providers only after quality parity tests exist.

Inference: this avoids premature abstraction debt while preserving future optionality.

---

## 10. MCP Integration Strategy

### 10.1 Protocol Findings

MCP spec is versioned and currently publishes a latest revision (as of research date) with JSON-RPC 2.0 message semantics and transports including stdio and streamable HTTP.

### 10.2 Authorization Findings

MCP authorization spec describes OAuth-based expectations and security considerations for remote/HTTP usage. Local stdio integrations have a different trust model and should be treated as privileged local code execution.

### 10.3 Product Recommendation

Phase 1:

1. Support only allowlisted local stdio MCP servers.
2. Disable arbitrary remote MCP endpoints by default.
3. Require per-tool policy declaration and side-effect metadata.

Phase 2+:

1. Add remote MCP with OAuth and explicit tenant-scoped credential vaulting.
2. Add signed MCP server manifests and version pinning.

---

## 11. Security Architecture (Practical)

### 11.1 Threat Expansion Beyond PRD

Add explicit handling for:

1. Prompt-injection through repository content and docs.
2. Malicious build scripts in setup contracts.
3. Cross-tenant data leakage through logs/artifacts.
4. Replay/duplication attacks on side-effect endpoints.
5. Unauthorized policy downgrade attempts.
6. Orchestrator workflow desynchronization under retries.

### 11.2 Control Set

1. Signed policy snapshots per run.
2. Immutable evidence packet hash tree.
3. Idempotency key enforcement on external writes.
4. Strict egress allowlist by execution profile.
5. Command prefix allow/deny rules tied to autonomy level.
6. Secret class scoping enforced at runtime by phase.
7. Mandatory redaction pipeline before artifact persistence.
8. Audit records with tamper-evident chaining.

### 11.3 Secrets

Minimum model:

1. Envelope encryption with operator-managed KMS root.
2. Per-tenant data keys.
3. Secret access events always audited.
4. Setup-only secret wipe guarantee and verification event.
5. No secrets in evidence payloads, prompts, or UI logs.

### 11.4 Supply Chain Hardening

Recommended:

1. Signed container images.
2. SBOM generation per release.
3. Dependency vulnerability gating for control-plane services.
4. Reproducible build metadata for evidence exports.

Inference: these controls are essential for enterprise trust, even if formal compliance is “later.”

---

## 12. Testing And Robustness Framework

### 12.1 Test Layers

1. Unit tests for policy predicates and state transitions.
2. Property-based tests for policy edge cases and path matching.
3. Temporal workflow deterministic replay tests.
4. Adapter contract tests against mocked GitHub/OpenAI APIs.
5. Integration tests with ephemeral GitHub test repos.
6. E2E scenario tests for candidate branch lifecycle.
7. Chaos tests for token expiry, API failures, queue delays.
8. Performance tests for large monorepos and high run concurrency.

### 12.2 LLM Quality/Evals

Implement a regression suite with:

1. Golden task set by repo class.
2. Evidence completeness score.
3. Policy false-positive and false-negative rates.
4. Tool-call success ratio.
5. Run completion and rollback/revertability success.

### 12.3 Release Gates

Release should be blocked if any:

1. Policy determinism drift in replay tests.
2. Evidence schema incompatibility without migration.
3. Critical side-effect duplication bug.
4. Cross-tenant data exposure defect.
5. External integration contract break without fallback.

---

## 13. Deployment, Distribution, And Operations

### 13.1 Distribution Channels

Phase 1:

1. GitHub Releases with versioned binaries/compose manifests.
2. OCI images for each service.
3. Single-node Docker Compose reference deployment.

Phase 2:

1. Helm chart for Kubernetes.
2. Production hardening profiles and scaling docs.

### 13.2 Deployment Topologies

1. Local lab: single-node compose (dev/test).
2. Small team: 3-node k8s + managed Postgres + object storage.
3. Enterprise: HA k8s, isolated tenant domains, external KMS, centralized telemetry.

### 13.3 Upgrade Strategy

1. Semver for control plane and evidence schema.
2. One-step DB migrations with dry-run mode.
3. Roll-forward preferred; explicit rollback doc for minor releases.

### 13.4 SLO Baseline (Initial)

1. Control-plane API uptime: 99.9%.
2. Run orchestration success (excluding policy blocks): >= 99%.
3. Median run start latency: < 10s.
4. External side-effect duplication rate: 0%.

---

## 14. Documentation System Recommendation

### 14.1 Docs Structure

1. `docs/architecture/` for component-level design.
2. `docs/adr/` append-only architecture decisions.
3. `docs/runbooks/` operations and incident guides.
4. `docs/policies/` policy grammar and trust boundary docs.
5. `docs/evidence-schema/` versioned packet contract.

### 14.2 Required Runbooks (Early)

1. GitHub token expiry/refresh incidents.
2. Stuck workflow and lease recovery.
3. Secret leakage response.
4. Corrupted evidence object remediation.
5. Merge queue integration failure handling.

### 14.3 API And Contract Docs

1. OpenAPI for control-plane APIs.
2. JSON schema for evidence packet.
3. JSON schema for setup contract.
4. Capability snapshot contract and versioning.

---

## 15. Product Value Maximization (User-Centric)

### 15.1 High-Value User Outcomes

1. Predictable change behavior in governed repos.
2. Fast clarity on why something is blocked.
3. Trustworthy, auditable evidence that maps to repo policy reality.
4. Minimal “surprise writes” and easy operator overrides.

### 15.2 UX Priorities

1. Always show internal-vs-external readiness separately.
2. Show capability snapshot and policy decisions in plain language.
3. Make “why blocked” and “next action” first-class UI elements.
4. Surface blast radius and revertability before PR creation.

### 15.3 Feature Adds With Strong ROI

1. “Dry-run policy preview” before execution.
2. Policy simulation against planned diff.
3. Operator “approve once / approve session / deny forever” controls.
4. Evidence comparison view between run revisions.
5. Structured PR comment templates linked to evidence IDs.

---

## 16. Unknown-Unknowns You Should Investigate Early

This section is intentionally aggressive. These are common failure sources in products like this.

1. Corporate network/proxy constraints breaking setup dependencies.
2. Monorepo size and indexing performance cliffs.
3. Custom Git hooks and merge drivers causing non-standard behavior.
4. LFS edge cases in partial clone workflows.
5. Ruleset inheritance changes mid-run.
6. Required workflow behavior changes across GitHub plan tiers.
7. Human-review cadence mismatch causing stale evidence.
8. Prompt-injection through repository docs and generated files.
9. Non-determinism in tool outputs causing noisy evidence diffs.
10. Drift between local policy interpretation and GitHub’s effective enforcement.
11. Dependency mirror outages in locked-down environments.
12. Long-running workflow history growth without continue-as-new boundaries.
13. Object-store consistency assumptions during evidence publish/verify.
14. Redis eviction policies invalidating lease assumptions.
15. Multi-tenant noisy-neighbor effects in executor pools.
16. Unexpected model behavior changes across version updates.
17. Billing spikes from retry storms during external outages.
18. Secret redaction misses in stack traces/tool logs.
19. Operator misuse of high-autonomy mode.
20. Incomplete incident forensics due missing trace correlation IDs.

---

## 17. Suggested 14-Week Build Blueprint (Concrete)

This aligns to PRD phases but tightens quality gates.

### Weeks 1-2

1. Finalize ADRs for stack, state machine, leases, evidence schema v1.
2. Implement control-plane skeleton and local dev deployment.
3. Implement GitHub auth adapter with token rotation.
4. Implement workflow skeleton with deterministic replay tests.

Exit criteria:

- End-to-end no-op run with audit events.

### Weeks 3-4

1. Implement setup contract parser and secret class enforcement.
2. Implement policy engine MVP with protected file/path checks.
3. Implement candidate branch create/update flow.
4. Implement capability snapshot persistence.

Exit criteria:

- Policy-driven block/pass behavior reproducible in tests.

### Weeks 5-6

1. Implement implement-validate-evidence loop.
2. Add evidence packet v1 schema + object-store persistence.
3. Add internal readiness boundary gate.
4. Add run cancellation/timeout/retry policies.

Exit criteria:

- Evidence packet produced for successful run and hashed in audit.

### Weeks 7-8

1. Add PR creation/update flow with idempotency keys.
2. Add external readiness tracking for checks/reviews/merge queue.
3. Add review-feedback re-entry workflow.
4. Add operator command controls (pause/resume/cancel).

Exit criteria:

- Full candidate-to-PR loop validated in integration suite.

### Weeks 9-10

1. Add dashboard for run timeline, readiness boundaries, and evidence.
2. Add policy/execution explanation surfaces.
3. Add initial SLO dashboards and alerting.
4. Run chaos suite against transient integration failures.

Exit criteria:

- Operator can diagnose and recover top failure classes from UI + runbooks.

### Weeks 11-12

1. Harden sandbox profiles and egress policy.
2. Add advanced capability scan checks for push restrictions and inherited rules.
3. Add retention controls and export functionality.
4. Expand eval suite and regression automation.

Exit criteria:

- Security and reliability gate pass for beta cohort.

### Weeks 13-14

1. Performance tuning for large repos and concurrent runs.
2. Documentation freeze for beta launch.
3. Release process with signed artifacts and rollback drills.
4. Beta deployment readiness review.

Exit criteria:

- Beta release candidate with auditable quality baseline.

---

## 18. Governance, Project Management, And Clean Build Discipline

### 18.1 Work Management Model

1. Every feature starts as a short RFC mapped to PRD requirements IDs.
2. Every accepted RFC creates or updates ADRs where architecture changes.
3. Every implementation task references acceptance criteria tied to state/evidence/policy behavior.
4. Every release has a quality gate checklist with explicit pass/fail evidence.

### 18.2 Feature Flagging

Use mandatory feature flags for:

1. New integrations.
2. New policy rules.
3. Autonomy-level behavior changes.
4. Experimental model routing behavior.

### 18.3 Code Quality Bar

1. Strict TypeScript and schema-validated boundaries.
2. Domain-driven modules around policies, workflows, adapters.
3. Explicit error taxonomy.
4. Mandatory idempotency in side-effect services.

---

## 19. Feasibility Assessment

### 19.1 Feasible In V1

1. Candidate branch + evidence boundary.
2. GitHub-native PR integration with robust capability scan.
3. Setup/secret phase separation.
4. Governance/autonomy levels with approvals.
5. Deterministic orchestration using Temporal.

### 19.2 Feasible But Risky In V1 (Control Closely)

1. Broad repo compatibility claims.
2. Early gVisor enforcement.
3. Multi-provider model strategy with parity guarantees.
4. High autonomy defaults.

### 19.3 Not Worth V1 Complexity

1. General plugin framework.
2. Full enterprise policy projection into native rulesets.
3. Advanced cross-repo orchestration without strict isolation model.

---

## 20. Final Recommendations Snapshot

If only a small set of decisions are taken now, take these:

1. Confirm stack: `TS/Node + Temporal + Postgres + Redis + MinIO + Docker + OTel`.
2. Add formal workflow state machine and lease protocol ADRs immediately.
3. Implement capability snapshot with inherited rules and push restrictions before broad execution features.
4. Build evidence schema/versioning and idempotent side-effect framework before UX expansion.
5. Keep OpenAI Responses-first for Phase 1; defer broad model-provider abstraction complexity.
6. Treat gVisor as gated hardening, not default runtime.

---

## 21. Detailed Data Model Blueprint (V1)

This section is a concrete starting point for schema design.

### 21.1 Core Tables

`tenants`

1. `id` (pk, uuid)
2. `slug` (unique)
3. `name`
4. `status` (`active|suspended`)
5. `kms_key_ref`
6. `created_at`
7. `updated_at`

`repositories`

1. `id` (pk, uuid)
2. `tenant_id` (fk tenants.id)
3. `provider` (`github`)
4. `provider_repo_id`
5. `full_name`
6. `default_branch`
7. `repo_class` (`A|B|C`)
8. `status`
9. `created_at`
10. `updated_at`

`github_installations`

1. `id` (pk, uuid)
2. `tenant_id` (fk)
3. `installation_id`
4. `app_id`
5. `account_login`
6. `permissions_json`
7. `created_at`
8. `updated_at`

`capability_snapshots`

1. `id` (pk, uuid)
2. `repository_id` (fk)
3. `captured_at`
4. `source_revision` (`ruleset_etag`/hash)
5. `merge_queue_enabled`
6. `required_checks_json`
7. `required_workflows_json`
8. `effective_rulesets_json`
9. `push_restrictions_json`
10. `warnings_json`

`runs`

1. `id` (pk, uuid)
2. `tenant_id` (fk)
3. `repository_id` (fk)
4. `capability_snapshot_id` (fk)
5. `request_id` (idempotency / correlation)
6. `state` (state machine enum)
7. `autonomy_level` (`0|1|2|3`)
8. `target_branch`
9. `candidate_branch`
10. `started_at`
11. `ended_at`
12. `failure_code`
13. `failure_reason`
14. `metadata_json`

`run_phases`

1. `id` (pk, uuid)
2. `run_id` (fk)
3. `phase` (`setup|implement|validate|evidence|external_sync`)
4. `attempt`
5. `status` (`pending|running|passed|failed|skipped`)
6. `started_at`
7. `ended_at`
8. `metrics_json`

`branch_leases`

1. `id` (pk, uuid)
2. `scope_key` (`tenant/repo/target_branch`)
3. `owner_run_id` (fk runs.id)
4. `lease_token` (opaque random)
5. `acquired_at`
6. `expires_at`
7. `last_heartbeat_at`
8. `released_at`
9. `status` (`active|expired|released|stolen`)

`policy_bundles`

1. `id` (pk, uuid)
2. `repository_id` (fk)
3. `base_ref`
4. `bundle_hash`
5. `schema_version`
6. `contents_json`
7. `created_at`

`policy_decisions`

1. `id` (pk, uuid)
2. `run_id` (fk)
3. `phase`
4. `decision_type` (`allow|deny|flag`)
5. `subject_type` (`file|command|tool|network`)
6. `subject_value`
7. `rule_id`
8. `explanation`
9. `created_at`

`evidence_packets`

1. `id` (pk, uuid)
2. `run_id` (fk)
3. `schema_version`
4. `packet_hash`
5. `storage_uri`
6. `status` (`draft|sealed|published`)
7. `created_at`
8. `published_at`

`side_effects`

1. `id` (pk, uuid)
2. `run_id` (fk)
3. `effect_type` (`create_pr|update_pr|post_comment|set_status`)
4. `idempotency_key`
5. `target_ref`
6. `request_payload_hash`
7. `response_payload_json`
8. `status`
9. `created_at`
10. `updated_at`

`audit_events`

1. `id` (pk, uuid)
2. `tenant_id` (fk)
3. `run_id` (nullable fk)
4. `event_type`
5. `actor_type` (`system|operator`)
6. `actor_id`
7. `payload_json`
8. `prev_event_hash`
9. `event_hash`
10. `created_at`

### 21.2 Indexing Strategy

Critical indexes:

1. `runs(tenant_id, repository_id, started_at desc)`
2. `runs(state, started_at desc)`
3. `branch_leases(scope_key, status)`
4. `side_effects(idempotency_key unique)`
5. `policy_decisions(run_id, decision_type)`
6. `audit_events(tenant_id, created_at desc)`
7. `capability_snapshots(repository_id, captured_at desc)`

### 21.3 Data Retention Defaults (Proposed)

1. Audit events: retained indefinitely (or policy-specific export/archive strategy).
2. Run metadata and decisions: 12 months online, then cold archive.
3. Raw tool logs: 30-90 days configurable.
4. Evidence packet metadata: long-lived; packet blobs configurable by tenant policy.
5. Prompt/response raw content: opt-in and tenant-policy-controlled.

---

## 22. Workflow State Machine Specification (V1)

### 22.1 Canonical States

1. `queued`
2. `capability_scanning`
3. `awaiting_lease`
4. `setup_running`
5. `implementing`
6. `validating`
7. `building_evidence`
8. `internal_ready`
9. `external_syncing`
10. `addressing_review_feedback`
11. `blocked_policy`
12. `blocked_external`
13. `failed_transient`
14. `failed_terminal`
15. `completed`
16. `cancelled`

### 22.2 Allowed Transitions

| From | To | Condition |
|---|---|---|
| queued | capability_scanning | Run accepted |
| capability_scanning | awaiting_lease | Snapshot persisted |
| awaiting_lease | setup_running | Lease acquired |
| setup_running | implementing | Setup pass |
| setup_running | failed_transient | Retryable setup failure |
| setup_running | failed_terminal | Non-retryable setup failure |
| implementing | validating | Proposed changes created |
| implementing | failed_transient | Retryable execution failure |
| validating | building_evidence | Validation pass |
| validating | implementing | Validation fail with retry budget |
| validating | blocked_policy | Policy hard block |
| building_evidence | internal_ready | Evidence complete and sealed |
| building_evidence | failed_terminal | Evidence build invariant fail |
| internal_ready | external_syncing | PR mode enabled |
| internal_ready | completed | PR mode disabled / internal-only run |
| external_syncing | completed | External readiness satisfied |
| external_syncing | blocked_external | Waiting for checks/reviews/queue |
| blocked_external | external_syncing | External signal changed |
| completed | addressing_review_feedback | Review-triggered re-entry |
| addressing_review_feedback | implementing | Re-entry lease + context set |
| * | cancelled | Operator/system cancellation |

### 22.3 Transition Invariants

1. `internal_ready` requires sealed evidence packet hash.
2. `external_syncing` requires persisted side-effect idempotency key set.
3. Any transition to terminal state requires final audit summary event.
4. State updates are single-row optimistic-lock transactions.

---

## 23. Policy Semantics And Approval Model

### 23.1 Policy Precedence

Policy evaluation order:

1. Hard deny rules.
2. Protected/trusted-boundary constraints.
3. Flagged-but-allowed rules.
4. Explicit allow rules.
5. Default deny for unknown high-risk categories.

### 23.2 Rule Domains

1. File write policies (path, extension, ownership).
2. Command execution policies (prefix allow/deny).
3. Network egress policies (domain/protocol allowlist).
4. Tool invocation policies (MCP/tool classes).
5. Secret access policies by phase.

### 23.3 Autonomy Level Matrix

| Action | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Read repo files | allow | allow | allow | allow |
| Edit non-protected files | approve | allow | allow | allow |
| Edit protected files | deny | approve | approve | approve |
| Run setup commands | deny | approve | allow | allow |
| Run non-setup shell commands | approve | allow | allow | allow |
| Network access in execution phase | deny | approve | approve | allow (policy-bound) |
| Create/update PR | deny | approve | approve | allow |
| Use remote MCP tools | deny | deny | approve | approve |
| Change autonomy level | operator-only | operator-only | operator-only | operator-only |

### 23.4 Approval Event Contract

Approval payload minimum:

1. `approval_id`
2. `run_id`
3. `requested_action`
4. `requested_scope`
5. `risk_label`
6. `expires_at`
7. `operator_id`
8. `decision` (`approve_once|approve_session|deny`)

---

## 24. Error Taxonomy And Retry Strategy

### 24.1 Error Classes

| Class | Example | Retry | Escalation |
|---|---|---|---|
| `policy_denied` | Protected path write | No | Show blocking rule |
| `github_transient` | 502, secondary rate limit | Yes (jitter backoff) | After budget exhausted |
| `github_auth_expired` | Installation token expired | Yes (refresh first) | If refresh fails |
| `workflow_timeout` | Activity exceeded SLA | Yes (bounded) | Operator after N retries |
| `sandbox_failure` | Container start fail | Yes (recreate sandbox) | If repeated profile fail |
| `model_rate_limited` | 429 from model API | Yes (budgeted) | Degrade/fallback profile |
| `model_validation_fail` | Structured output mismatch | Yes (prompt repair once) | Then block/manual |
| `evidence_invariant_fail` | Missing required section | No | Terminal fail |
| `storage_unavailable` | Object store outage | Yes (long backoff) | Enter degraded mode |
| `unknown_internal` | Unexpected exception | No immediate loop | Terminal + incident |

### 24.2 Retry Budgets (Proposed Defaults)

1. GitHub transient: max 8 attempts over 15 min.
2. Model transient: max 6 attempts over 10 min.
3. Sandbox startup: max 3 attempts over 5 min.
4. Validation rerun loop: max 2 loops before block.
5. External readiness polling: capped watch window, then park state.

### 24.3 Idempotency Policy

1. Every side-effect operation uses deterministic key:
`hash(run_id + effect_type + target + canonical_payload)`.
2. Persist key and response payload.
3. On retry, query existing key first and treat match as success.

---

## 25. Capacity, Cost, And Performance Baselines

### 25.1 Capacity Planning Inputs

Track these from day 1:

1. Runs/day by repo class.
2. Median and P95 run duration by phase.
3. Token usage per run by model and task type.
4. Sandbox start latency and failure rate.
5. External API call counts per run.

### 25.2 Initial Throughput Model (Planning)

Assume pilot:

1. 50 repos.
2. 200 runs/day.
3. P95 run duration target 25 minutes.
4. Max concurrency target 25 active runs.

Infrastructure planning:

1. Temporal workers sized for peak parallel activities plus 30% headroom.
2. Redis memory sized for lease/pubsub burst events with eviction disabled for critical keys.
3. Postgres IOPS budget includes audit append spikes and run-state writes.

### 25.3 Cost Controls

1. Per-run token ceilings.
2. Per-tenant monthly budget guardrails.
3. Retry budgets linked to cost budgets.
4. Optional “fast/standard/thorough” run modes.

### 25.4 Performance Guardrails

1. Reject runs on repos above tested size thresholds unless explicitly approved.
2. Enforce max diff size per single run.
3. Rate-limit external side effects per repo and per tenant.
4. Auto-park runs when external dependencies are degraded.

---

## 26. Source-Backed Notes (Key Facts)

This section lists the key external facts used in recommendations.

1. GitHub required checks freshness, merge-queue workflow behavior, ruleset caveats, push restrictions, ruleset inheritance API, and app token expiry all affect capability scanning and run behavior.
2. Temporal has documented workflow event/history limits; continue-as-new is the intended pattern for long-lived workflows.
3. gVisor documents compatibility limitations and performance tradeoffs; this supports phased rollout rather than default usage.
4. PostgreSQL support model is long and predictable; good fit for durable control-plane state.
5. Node release cadence changed (2025 schedule update), so version policy should be explicit rather than “22+”.
6. MCP is versioned and transport/auth details matter for trust boundaries.
7. OpenAI Codex security docs reinforce two-layer sandbox/approval model and setup-vs-agent phase separation.
8. OpenAI Responses/conversation/rate-limit docs reinforce state, retention, and retry design requirements.

Inference labels:

- Architecture decomposition and phased rollout recommendations are reasoned inferences based on the above facts plus PRD goals.

---

## 27. References

### Local project sources

1. [PRD](./prd.md)
2. [Project README](../README.md)
3. [Rules: immutable](../.claude/rules/immutable.md)
4. [Rules: conventions](../.claude/rules/conventions.md)
5. [Rules: stack](../.claude/rules/stack.md)

### External primary sources

1. GitHub Docs, troubleshooting required status checks: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
2. GitHub Docs, managing merge queue: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
3. GitHub Docs, available rules for rulesets (Enterprise Cloud latest): https://docs.github.com/enterprise-cloud%40latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
4. GitHub REST API, repository rulesets: https://docs.github.com/en/rest/repos/rules
5. GitHub Docs, generating an installation access token for a GitHub App: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
6. Temporal Docs, workflow execution limits: https://docs.temporal.io/workflow-execution/limits
7. Temporal Docs, continue-as-new: https://docs.temporal.io/workflow-execution/continue-as-new
8. gVisor Docs, compatibility guide: https://gvisor.dev/docs/user_guide/compatibility/
9. PostgreSQL Versioning Policy: https://www.postgresql.org/support/versioning/
10. Node.js release schedule update: https://nodejs.org/blog/announcements/evolving-the-nodejs-release-schedule
11. MCP specification overview (latest version index): https://modelcontextprotocol.io/specification
12. MCP specification basic architecture: https://modelcontextprotocol.io/specification/2025-06-18/basic/index
13. MCP specification authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
14. OpenAI Codex agent approvals and security: https://developers.openai.com/codex/agent-approvals-security/
15. OpenAI Docs, conversation state: https://platform.openai.com/docs/guides/conversation-state
16. OpenAI Docs, migrate to responses: https://platform.openai.com/docs/guides/migrate-to-responses
17. OpenAI Docs, rate limits: https://platform.openai.com/docs/guides/rate-limits
18. OpenTelemetry semantic conventions (GenAI): https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/

---

## 28. Immediate Next Actions

1. Convert Sections 4, 5, 6, and 17 into ADRs + milestone plan.
2. Write evidence schema v1 and workflow state machine specs before coding the core loop.
3. Implement a capability-scan prototype against test repos to validate ruleset and merge-queue assumptions.
4. Stand up a proof-of-flow vertical slice: ingest -> candidate branch -> evidence -> PR update with idempotency.
