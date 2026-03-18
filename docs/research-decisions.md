# Research Decisions: Consolidated Strategic Reference

**Date:** 2026-03-18
**Sources:** Three independent research analyses of PRD v5.1
- Codex 5.3 (1156 lines) -- most detailed data model and state machine
- Codex 5.4 (1443 lines) -- strongest on product strategy and GitHub mechanics
- Gemini (808 lines) -- most opinionated on stack choices and concrete tooling

Plus: `research-full-extraction.md` (implementation-level extraction from 8 detailed research files, ~7,930 lines total)

---

## 1. Three-Model Consensus (High-Confidence Decisions)

These items appear in all three sources with consistent recommendations. They represent the strongest consensus and should be treated as near-settled.

### 1.1 Core Product Thesis

- The PRD's governance-first, candidate-branch-first model is correct and strategically sound.
- The durable moat is customer-owned orchestration state, policy/audit state, path-level governance including index time, evaluator integrity, and brownfield setup correctness -- NOT "we orchestrate AI models."
- Draft PRs are NOT a safety boundary. `pull_request` workflows fire on creation/update, required-workflow rulesets can ignore branch/path/type filters. Candidate branch + internal validation + evidence is the correct model.
- Frame the product as: "a governance product that orchestrates coding agents" rather than "a coding agent with governance features."

### 1.2 Stack Consensus

- **Language/Runtime:** TypeScript on Node.js (all three agree on TS/Node)
- **Orchestration:** Temporal (all three agree; Postgres is system of record, Temporal only for workflow durability)
- **Primary Database:** PostgreSQL (all three agree; SQL-first, strong relational integrity)
- **Object Storage:** S3-compatible interface (all three agree on the interface; diverge on default, see section 2)
- **Observability:** OpenTelemetry (traces + metrics + structured logs)
- **Sandbox Phase 1:** Rootless Docker + seccomp/AppArmor + network egress controls
- **Sandbox Phase 2+:** gVisor as opt-in hardening, not default (all three agree gVisor has compatibility gaps and performance costs)
- **MCP Phase 1:** Stdio-only, allowlisted local servers only. No remote MCP endpoints by default.
- **Dashboard:** SPA over explicit API (all three agree on API separation; diverge on framework, see section 2)

### 1.3 Architecture Consensus

- **Modular monolith/monorepo** preferred over microservices (Codex 5.4 and Gemini explicit; Codex 5.3's 10-service decomposition is the outlier but notes it's "minimum")
- **Temporal is workflow engine, NOT source of business truth.** Postgres is the system of record. Workflow executions reference versioned domain records in Postgres.
- **Continue-As-New is normal, not exceptional.** Temporal history limits: 51,200 events or 50 MB. Phase boundaries and attempt rollovers must be first-class.
- **GitHub writes happen ONLY through the GitHub integration layer.** Workflow state transitions ONLY through orchestrator. Secret materialization ONLY through sandbox supervisor. Policy evaluation ONLY through versioned policy package.
- **Webhook handling:** Verify signatures, respond within 10 seconds, process async, dedupe via `X-GitHub-Delivery`, build redelivery handling (GitHub does NOT auto-redeliver failed webhooks).
- **Idempotency keys on ALL externally visible side effects** (PR creation, comments, status updates). Key formula: `hash(run_id + effect_type + target + canonical_payload)`.

### 1.4 GitHub Integration Consensus

- **GitHub App model**, not PAT-based.
- **Installation tokens expire in 1 hour.** Adapter must auto-refresh; never assume long-lived tokens inside workflows.
- **Capability scan must include:** inherited rulesets (`includes_parents`), push rulesets (file paths, extensions, file size, path length), merge queue presence, `merge_group` event handling, required workflows, required status checks + owning App, CODEOWNERS, bypass actors, signed commit requirements, conversation resolution requirements, stale review dismissal.
- **Required status checks:** Must have a successful run in the last 7 days to be eligible. Factory evidence check should exist early.
- **Required-workflow rulesets can ignore `branches`, `paths`, and `types` filters.** This is not an edge case.
- **Merge queue** changes event flow and CI expectations. Product must detect merge queue usage and surface whether CI is compatible.
- **REST for writes and ruleset/webhook/check specifics. GraphQL for denormalized UI reads.** GraphQL required for: review thread tracking (isResolved), merge queue enqueue/dequeue, auto-merge, stale review detection (reviewDecision).

### 1.5 Security Consensus

- **Envelope encryption** with operator-managed KMS root, per-tenant data keys.
- **Secret access events always audited.** Setup-only secret wipe guarantee with verification event.
- **No secrets in evidence payloads, prompts, or UI logs.**
- **Mandatory redaction pipeline** before artifact persistence.
- **Audit records: append-only, immutable, actor-attributed, hash-linkable.**
- **Supply chain:** Signed container images, SBOM generation, dependency vulnerability gating.
- **Prompt injection through repository content** is a real threat requiring explicit handling.
- **Separate validator from agent environment.** Agent edits to test harness config, CI definitions, behavior files, `.factory/**`, holdout fixtures, evaluator scripts must NOT become live inputs to the same attempt's validator.

### 1.6 Setup Contract Consensus

- `.factory/setup.yml` must be a **versioned product API**, not just a YAML config file.
- Ship: JSON Schema, generated TS types, validation library, upgrade/migration helpers, compatibility tests, canonical examples.
- No stable industry standard exists (Codex, Copilot, Devin converge on explicit setup surfaces but not one shared format).

### 1.7 Code Understanding / Indexing Consensus

- Do NOT start with embeddings.
- V1: deterministic hybrid -- git tree walk from pinned commit SHA, repo map, ripgrep for text search, Tree-sitter/ast-grep for structural search, symbol/reference graph.
- **Path-level exclusion must happen BEFORE indexing and BEFORE retrieval.** Never embed, summarize, or include excluded content in repo maps.
- Resolve symlinks before runtime reads.
- GitHub's Copilot coding agent does NOT honor content exclusions -- this is the competitive differentiator.
- Optional pgvector for embeddings later, keeping vectors in Postgres rather than adding another database.

### 1.8 Testing Consensus

All three specify similar layered testing:

1. **Unit tests:** policy predicates, state transitions, schema validation, redaction
2. **Workflow replay tests:** Temporal deterministic replay, retries, signals, cancellation, continue-as-new
3. **Adapter contract tests:** GitHub API, model API, object store
4. **Integration tests:** ephemeral GitHub test repos, webhook ingestion, sandbox launch
5. **E2E / adversarial:** prompt injection, token expiry, webhook loss, merge queue rejection, stale reviews

### 1.9 Evidence Packet Consensus

- Versioned schema from day 1 with migration strategy.
- Include: base SHA, head SHA, merge base SHA, attempt number, validator image digest, setup contract hash, policy version hash, diff patch, test outcomes, risk summary.
- Hash tree for tamper evidence.
- Evidence freshness matters -- stale after rebase/base move.

### 1.10 Deployment Consensus

- **Phase 1:** Docker Compose reference deployment (single-tenant, minimal dependencies).
- **Phase 2:** Helm chart for Kubernetes.
- **Distribution:** GitHub Releases + OCI images (GHCR).
- **Supply chain:** Pinned base images, signed images, SBOM, provenance metadata, reproducible build guidance.

---

## 2. Disagreements Requiring Decisions

### 2.1 Node.js Version

- **Codex 5.3:** "Current LTS major" (does not name a version, warns against vague "22+")
- **Codex 5.4:** Node 24 (Active LTS as of March 2026; Node 22 is Maintenance LTS)
- **Gemini:** Node 24 (same rationale as Codex 5.4)
- **Resolution recommendation:** Node 24 is the 2-to-1 recommendation and has strongest rationale (new project, no legacy).

### 2.2 PostgreSQL Version

- **Codex 5.3:** PostgreSQL 16+
- **Codex 5.4:** PostgreSQL 17
- **Gemini:** PostgreSQL 17 default, keep 16 compatible, move to 18 once extensions/tooling stable
- **Resolution recommendation:** Gemini's position (17 default, 16 compat) is the most nuanced. Codex 5.3 may be slightly outdated.

### 2.3 Cache/Pub-Sub Store

- **Codex 5.3:** Redis 7
- **Codex 5.4:** Valkey (Linux Foundation-backed, BSD-licensed, cleaner OSS default)
- **Gemini:** Valkey (same rationale)
- **Resolution recommendation:** Valkey is the 2-to-1 recommendation. Keep Redis protocol compatibility. Rationale: open governance matters for an OSS governance product.

### 2.4 Object Storage Default

- **Codex 5.3:** MinIO (self-hosted default), R2/S3 (cloud option)
- **Codex 5.4:** S3-compatible API, MinIO for self-host/dev, S3/R2 for managed
- **Gemini:** Do NOT make MinIO the blessed OSS default. MinIO licensing/commercial posture is a strategic risk. Ship local-filesystem adapter for dev/test, let production users choose any S3-compatible backend.
- **Resolution recommendation:** Gemini's concern about MinIO licensing is specific and well-sourced. Define generic S3-compatible interface; ship filesystem adapter for dev.

### 2.5 Dashboard Framework

- **Codex 5.3:** SvelteKit (acceptable for planned scope)
- **Codex 5.4:** React 19 + Vite + TanStack Router/Query/Table + Monaco (strongest ecosystem for internal dashboards, tables, code/diff tooling)
- **Gemini:** SvelteKit is still a good choice but warns about early-2026 security fixes affecting remote functions. Keep server/API boundaries explicit.
- **Resolution recommendation:** Codex 5.4 makes the strongest case for React (authenticated control-plane app, diff tooling ecosystem, Monaco integration). Gemini's SvelteKit security concern is notable. This is a team-preference decision with React having the stronger technical argument for this use case.

### 2.6 Provider/Model Strategy

- **Codex 5.3:** OpenAI Responses API first-class in Phase 1; keep provider abstraction narrow (`generate`, `tool_call`, `structured_output`); defer broad multi-provider parity.
- **Codex 5.4:** Direct provider adapters (OpenAI Responses, Anthropic, OpenAI-compatible local). OpenRouter optional, not architectural. Model routing by task type: `gpt-5.4` (default), `gpt-5.4-pro` (escalation), `gpt-5-mini` (fast/cheap), vLLM (self-hosted).
- **Gemini:** Build a `ModelGateway` with canonical request/response model supporting content parts, tool calls, JSON-schema outputs, streamed partials, provider metadata, caching metadata, reasoning controls. Adapters for: OpenAI Responses, Anthropic, Gemini, OpenRouter, local OpenAI-compatible. Use model classes: Router/summarizer, Planner, Implementer, Explainer, Validator. Log cache hits. Self-hosted inference first-class from day 1.
- **Codex 5.3 differs:** It explicitly recommends NOT optimizing for multi-provider parity in Phase 1 (OpenAI Responses-first). The other two push for broader adapter support earlier.
- **Resolution recommendation:** Codex 5.4 and Gemini both warn that OpenRouter/aggregator-first creates feature lag and policy ambiguity. The consensus is: build direct provider adapters with a canonical internal abstraction. Gemini's model-class routing (different models for different subtasks) is a unique and strong recommendation.

### 2.7 Architecture Granularity

- **Codex 5.3:** 10 explicit services (api-gateway, workflow-service, executor-manager, github-adapter, policy-engine, evidence-service, index-service, secret-service, event-bus, dashboard)
- **Codex 5.4:** 8 deployables/services (api, github-app, orchestrator, sandbox-supervisor, indexer, evaluator, dashboard, cli) with strict internal packages (contracts, policy-engine, github-client, provider-gateway, db, observability, config, evidence, test-fixtures)
- **Gemini:** 4 deployables (api, worker, web, cli) with strict internal packages (domain, orchestration, github, policy, model-gateway, executor, validator, indexer, evidence, audit, telemetry). Explicitly argues against microservices.
- **Resolution recommendation:** All three agree on strong internal boundaries. Gemini's 4-deployable model has the lowest operational overhead. Codex 5.4's 8-service split is a middle ground. For Phase 1, fewer deployables with strong internal package boundaries (Gemini's approach) minimizes distributed-systems tax while preserving future splitability.

### 2.8 Build Timeline

- **Codex 5.3:** 14 weeks (2-week sprints, 7 phases)
- **Codex 5.4:** 5 stages (Foundation -> Observer Mode -> Guided Execution -> PR/Merge -> Dashboard/Hardening), no explicit timeline
- **Gemini:** 90 days in 5 phases (Days 1-14, 15-35, 36-55, 56-75, 76-90)
- **Key difference:** Codex 5.4 uniquely inserts "Observer Mode" as Stage 1 before any code execution. Gemini's Day 1-14 phase includes execution-plane split and BuildKit-based env build. Codex 5.3's Weeks 1-2 targets an end-to-end no-op run.

### 2.9 HTTP Framework

- **Codex 5.3:** Not specified
- **Codex 5.4:** Fastify
- **Gemini:** Fastify
- **Resolution:** Fastify (2-to-1, strong typing story, low overhead, mature).

### 2.10 Monorepo Tooling

- **Codex 5.3:** Not specified
- **Codex 5.4:** pnpm workspaces + Turborepo
- **Gemini:** Not specified
- **Note:** Codex 5.4 is the only one to specify; its recommendation is standard and well-reasoned. Gemini warns that Turborepo remote cache can leak sensitive data -- default to local cache.

### 2.11 Docs Framework

- **Codex 5.3:** Not specified
- **Codex 5.4:** Astro Starlight
- **Gemini:** Not specified

### 2.12 Testing Framework

- **Codex 5.3:** Not specified
- **Codex 5.4:** Vitest + Playwright (explicit)
- **Gemini:** Not specified

### 2.13 Validation Library

- **Codex 5.3:** Not specified
- **Codex 5.4:** Zod or Valibot
- **Gemini:** Zod
- **Resolution:** Zod (explicit in both that mention it).

### 2.14 DB Query Layer

- **Codex 5.3:** Not specified
- **Codex 5.4:** `postgres.js` + Kysely or Drizzle-style SQL-first layer
- **Gemini:** Kysely or plain SQL
- **Resolution:** SQL-first approach (both agree). Kysely appears in both. Avoid heavy ORMs.

---

## 3. Unique Insights: Codex 5.3

### 3.1 Complete Data Model (Section 21)

The only source providing a complete table-by-table schema blueprint with column definitions.

**`tenants`**
1. `id` (pk, uuid)
2. `slug` (unique)
3. `name`
4. `status` (`active|suspended`)
5. `kms_key_ref`
6. `created_at`
7. `updated_at`

**`repositories`**
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

**`github_installations`**
1. `id` (pk, uuid)
2. `tenant_id` (fk)
3. `installation_id`
4. `app_id`
5. `account_login`
6. `permissions_json`
7. `created_at`
8. `updated_at`

**`capability_snapshots`**
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

**`runs`**
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

**`run_phases`**
1. `id` (pk, uuid)
2. `run_id` (fk)
3. `phase` (`setup|implement|validate|evidence|external_sync`)
4. `attempt`
5. `status` (`pending|running|passed|failed|skipped`)
6. `started_at`
7. `ended_at`
8. `metrics_json`

**`branch_leases`**
1. `id` (pk, uuid)
2. `scope_key` (`tenant/repo/target_branch`)
3. `owner_run_id` (fk runs.id)
4. `lease_token` (opaque random)
5. `acquired_at`
6. `expires_at`
7. `last_heartbeat_at`
8. `released_at`
9. `status` (`active|expired|released|stolen`)

**`policy_bundles`**
1. `id` (pk, uuid)
2. `repository_id` (fk)
3. `base_ref`
4. `bundle_hash`
5. `schema_version`
6. `contents_json`
7. `created_at`

**`policy_decisions`**
1. `id` (pk, uuid)
2. `run_id` (fk)
3. `phase`
4. `decision_type` (`allow|deny|flag`)
5. `subject_type` (`file|command|tool|network`)
6. `subject_value`
7. `rule_id`
8. `explanation`
9. `created_at`

**`evidence_packets`**
1. `id` (pk, uuid)
2. `run_id` (fk)
3. `schema_version`
4. `packet_hash`
5. `storage_uri`
6. `status` (`draft|sealed|published`)
7. `created_at`
8. `published_at`

**`side_effects`**
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

**`audit_events`**
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

### 3.2 Critical Indexes

1. `runs(tenant_id, repository_id, started_at desc)`
2. `runs(state, started_at desc)`
3. `branch_leases(scope_key, status)`
4. `side_effects(idempotency_key unique)`
5. `policy_decisions(run_id, decision_type)`
6. `audit_events(tenant_id, created_at desc)`
7. `capability_snapshots(repository_id, captured_at desc)`

### 3.3 Complete Workflow State Machine (Section 22)

16 canonical states:

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

**Full transition table:**

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

### 3.4 Transition Invariants

- `internal_ready` requires sealed evidence packet hash
- `external_syncing` requires persisted side-effect idempotency key set
- Terminal state requires final audit summary event
- State updates are single-row optimistic-lock transactions

### 3.5 Autonomy Level Matrix (L0-L3)

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

### 3.6 Error Taxonomy (10 Error Classes)

| Class | Example | Retry | Escalation |
|---|---|---|---|
| `policy_denied` | Protected path write | No | Show blocking rule |
| `github_transient` | 502, secondary rate limit | Yes (jitter backoff) | After budget exhausted |
| `github_auth_expired` | Installation token expired | Yes (refresh first) | If refresh fails |
| `workflow_timeout` | Activity exceeded SLA | Yes (bounded) | Operator after N retries |
| `sandbox_failure` | Container start fail | Yes (recreate sandbox) | If repeated profile fail |
| `model_rate_limited` | 429 from model API | Yes (budgeted) | Degrade/fallback profile |
| `model_validation_fail` | Structured output mismatch | Yes once (prompt repair) | Then block/manual |
| `evidence_invariant_fail` | Missing required section | No | Terminal fail |
| `storage_unavailable` | Object store outage | Yes (long backoff) | Enter degraded mode |
| `unknown_internal` | Unexpected exception | No immediate loop | Terminal + incident |

### 3.7 Retry Budgets

1. GitHub transient: max 8 attempts over 15 min
2. Model transient: max 6 attempts over 10 min
3. Sandbox startup: max 3 attempts over 5 min
4. Validation rerun: max 2 loops before block
5. External readiness polling: capped watch window, then park

### 3.8 Capacity Planning (Pilot Assumptions)

- 50 repos
- 200 runs/day
- P95 run duration target: 25 minutes
- Max concurrency target: 25 active runs
- Temporal workers sized for peak parallel activities + 30% headroom
- Redis: eviction disabled for critical keys
- Postgres IOPS budget includes audit append spikes and run-state writes

### 3.9 Data Retention Defaults

- Audit events: retained indefinitely (or policy-specific export/archive strategy)
- Run metadata/decisions: 12 months online, then cold archive
- Raw tool logs: 30-90 days configurable
- Evidence packet metadata: long-lived; blobs configurable by tenant
- Prompt/response raw content: opt-in, tenant-policy-controlled

### 3.10 SLO Baseline

- Control-plane API uptime: 99.9%
- Run orchestration success (excluding policy blocks): >= 99%
- Median run start latency: < 10s
- External side-effect duplication rate: 0%

### 3.11 Policy Precedence Order

1. Hard deny rules
2. Protected/trusted-boundary constraints
3. Flagged-but-allowed rules
4. Explicit allow rules
5. Default deny for unknown high-risk categories

### 3.12 Approval Event Payload

- `approval_id`
- `run_id`
- `requested_action`
- `requested_scope`
- `risk_label`
- `expires_at`
- `operator_id`
- `decision` (`approve_once|approve_session|deny`)

### 3.13 Branch Lease Concurrency Model

- One active write lease per `{tenant, repo, branch_target}`
- Additional intents queue behind lease holder unless marked "parallel-safe"
- Read-only operations do not require write lease

### 3.14 20 Unknown-Unknowns

1. Corporate network/proxy constraints breaking setup dependencies
2. Monorepo size and indexing performance cliffs
3. Custom Git hooks and merge drivers causing non-standard behavior
4. LFS edge cases in partial clone workflows
5. Ruleset inheritance changes mid-run
6. Required workflow behavior changes across GitHub plan tiers
7. Human-review cadence mismatch causing stale evidence
8. Prompt injection through repository docs and generated files
9. Non-determinism in tool outputs causing noisy evidence diffs
10. Drift between local policy interpretation and GitHub's effective enforcement
11. Dependency mirror outages in locked-down environments
12. Long-running workflow history growth without continue-as-new boundaries
13. Object-store consistency assumptions during evidence publish/verify
14. Redis eviction policies invalidating lease assumptions
15. Multi-tenant noisy-neighbor effects in executor pools
16. Unexpected model behavior changes across version updates
17. Billing spikes from retry storms during external outages
18. Secret redaction misses in stack traces/tool logs
19. Operator misuse of high-autonomy mode
20. Incomplete incident forensics due to missing trace correlation IDs

### 3.15 Documentation Structure

- `docs/architecture/` -- component-level design
- `docs/adr/` -- append-only decisions
- `docs/runbooks/` -- operations guides
- `docs/policies/` -- policy grammar and trust boundaries
- `docs/evidence-schema/` -- versioned packet contract

### 3.16 Required Runbooks (Early)

1. GitHub token expiry/refresh incidents
2. Stuck workflow and lease recovery
3. Secret leakage response
4. Corrupted evidence object remediation
5. Merge queue integration failure handling

---

## 4. Unique Insights: Codex 5.4

### 4.1 Observer Mode as Stage 1

The strongest recommendation across all three that the FIRST product mode should be read-only repo observation, not code execution:

- Scans repo, branch protections, rulesets, workflows, test surface, setup quality, policy collisions, merge constraints
- Produces readiness report and recommended setup contract
- Creates immediate value without asking customers to trust code changes on day 1
- De-risks the entire build sequence

### 4.2 Product Modes (Progressive)

1. **Observer mode** (no writes) -- scan, report, recommend setup contract
2. **Guided execution** (candidate branch, human review before PR)
3. **Controlled autonomy** (only after repo-specific policy/setup/approval stable)

### 4.3 Dashboard as React SPA

Specific libraries recommended:
- React 19 + Vite + TanStack Router + TanStack Query + TanStack Table
- Monaco editor for structured editors and diff-heavy review surfaces
- NOT a full IDE -- optimize for repo readiness, runs, approvals, blocked state, drift, evidence, rerun/repair

### 4.4 High-Value Screens

1. **Repo readiness screen:** effective rulesets, branch protection, setup quality, test surface, confidence level
2. **Run inspection screen:** timeline, artifacts, tool calls, validation matrix, policy notes
3. **Approval screen:** exact action, diff summary, evidence summary, hard blockers vs soft concerns
4. **Drift screen:** what changed externally, authority/readiness impact, revalidation needs
5. **Policy/setup editor:** schema-aware, preview behavioral changes, migration warnings

### 4.5 Review Packet as Product Surface (10 Sections)

1. Objective
2. Authority scope used
3. Files touched
4. Files intentionally excluded
5. Validation steps run
6. Test outcomes
7. Risk summary
8. Known uncertainties
9. Why the system believes the change is safe enough
10. Raw artifacts and reproducibility links

**Review packet distinction categories:** Hard blocker / Soft concern / Human judgment required / Informational only

### 4.6 Evaluation Strategy (5 Dimensions)

1. **Governance correctness:** respected path, authority, approval, secret constraints
2. **Operational correctness:** survived retries, drift, external changes
3. **Code change quality:** test outcomes, reviewer acceptance, rollback rates
4. **Evidence quality:** completeness, correctness, reviewer usefulness
5. **User value:** time saved, false blocks, trust gained, onboarding friction

### 4.7 Key Metrics

- PR acceptance rate
- Reviewer time-to-decision
- False block rate
- Policy escape rate
- Rerun rate
- Rollback rate
- Run completion time
- Cost per successful change
- Readiness-to-first-success time

### 4.8 Webhook Handling Detail

- GitHub does NOT automatically redeliver failed webhook deliveries
- Endpoint should: authenticate, persist, enqueue, acknowledge, return (almost no business logic)
- Reconciliation is part of the core loop, not a background nice-to-have

### 4.9 GitHub Entity Coverage for MVP Webhooks

- installation/repository installation changes
- repository metadata changes
- push
- pull request events
- pull request review events
- issue_comment
- check suite/check run/status changes
- branch protection rule changes
- merge queue events

### 4.10 Required-Check App Identity

If the product emits required checks, the repo may restrict a check to a specific GitHub App. Do not casually change app identity or split status responsibilities without migration.

### 4.11 Signed Commits Detection

Explicit detection and modeling of: signed commit requirements, linear history requirements, conversation resolution requirements, stale review dismissal, CODEOWNERS requirements, last-pusher review restrictions.

### 4.12 OpenAI Zero Data Retention Implications

- `/v1/responses` stores state for ~30 days by default when storage enabled
- ZDR changes the meaning of `store`
- Provider policy must be configurable per customer/org/repo
- Evidence must record provider path and storage mode
- UI should surface incompatibility with retention requirements

### 4.13 Workflow Versioning Discipline

Temporal helps with long-running runs, but only if workflow versioning discipline exists from day 1. Treat workflow evolution as a versioned contract problem.

### 4.14 Turborepo Remote Cache Warning

Can leak sensitive data. Default to local/self-hostable telemetry posture.

### 4.15 Feature Management by Invariants

Every major feature should say which invariants it touches:

- Excluded paths never enter index
- Candidate-branch behavior files never change live behavior
- Validator never reads candidate-branch policy
- PR not created before human approval
- No hidden provider failover unless policy says so
- Every mutating step is auditable
- Every attempt produces portable evidence

### 4.16 ADR Candidates to Record Early

1. Node 24 baseline
2. Temporal as workflow engine
3. Postgres as source of truth
4. Valkey as ephemeral store
5. Dashboard framework choice
6. Setup contract versioning policy
7. Direct provider adapters with optional aggregators
8. Observer mode as official product mode

### 4.17 Specific PRD Deltas

1. Node 22+ -> 24
2. Redis -> Valkey/Redis-compatible
3. OpenRouter from primary -> optional routing adapter
4. Add observer mode as official product mode
5. Setup.yml from config file -> versioned contract
6. GitHub ruleset inheritance + merge queue as first-order design constraints
7. Webhook replay/redelivery and reconciliation as MVP requirements
8. Direct provider retention/data-path visibility in security model
9. SvelteKit -> separate React SPA (unless team overrides)
10. Workflow versioning discipline in architecture

### 4.18 Repo Structure

```
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
```

### 4.19 Table Design Guidance

- Time-partition high-volume tables: `audit_entries`, `webhook_deliveries`, `tool_calls`, `events`, `run_artifacts`
- Store large payloads in object storage, hash-link from Postgres
- Keep immutable append-only audit/event records

### 4.20 Shadow-Mode Product Tests

Run against controlled public repos, compare system conclusions to expected governance outcomes.

---

## 5. Unique Insights: Gemini

### 5.1 MinIO Licensing Warning

MinIO's current licensing/commercial posture is a strategic risk for an OSS-first control plane. Define generic S3-compatible artifact interface, ship local-filesystem adapter for dev/test. Do not make MinIO the default production dependency.

### 5.2 BuildKit as Environment Primitive

Use BuildKit to produce immutable OCI images rather than preparing mutable cached containers.

Key image components:
- Base image digest
- Setup contract hash
- Lockfile hashes
- Secret binding names/classes
- Behavior-control-file hash
- Architecture
- Executor version

Build features:
- Build secrets for setup-only credentials (removed before agent execution)
- Cache mounts for package-manager caches
- External cache export/import for faster rebuilds

This makes environment provenance much easier to explain and enforces the secret-lifecycle model.

### 5.3 Setup Contract YAML Schema (Complete)

```yaml
version: 1
base_image: node:24-bookworm-slim
build:
  steps: []
resume:
  steps: []
exec:
  default_workdir: /workspace
  network: off
  mounts: []
healthcheck:
  steps: []
secrets:
  build: []
  runtime: []
  per_tool: []
caches:
  - key: npm-cache
    path: /root/.npm
artifacts:
  preserve:
    - junit.xml
    - coverage/**
```

Important additions beyond the PRD: `version`, explicit `build` vs `resume` vs `exec`, `network`, `mounts`, `caches`, `artifacts`.

### 5.4 Execution-Plane Separation

Running untrusted repo code on the same host as Postgres/Temporal destroys the trust story of a governance product. Even with rootless/userns/seccomp hardening, separate the control plane from the execution plane.

- **Control-plane host:** API, Temporal worker, web, Valkey client, webhook ingest
- **External Postgres**
- **External object storage**
- **Separate execution host(s)** for untrusted work

### 5.5 Docker Hardening Specifics for V1

- Rootless mode where feasible
- User namespace remapping
- Default seccomp profile
- No privileged containers
- No Docker socket inside executor
- Read-only mounts by default
- Tmp dirs and writable scratch mounted explicitly
- Network off by default in exec and validation
- Host-level egress filtering for worker hosts
- Separate validator container/process from agent container
- Resolved-realpath path enforcement to block symlink escapes

### 5.6 `pull_request_target` Detection

Add to capability scan and treat as high-risk. GitHub explicitly warns running untrusted code under `pull_request_target` can expose secrets or write privileges. One of the highest-value "unknown unknown" checks.

### 5.7 Secret Lifecycle Refinement (4 Classes, Not 3)

- `build_secret`
- `runtime_secret`
- `tool_secret`
- `review_only_secret` (for human-only integrations later)

Always record secret class + binding name + injection phase in audit (never value). Prefer BuildKit secret mounts over env vars.

### 5.8 Security Scanner Bundle

- **Semgrep CE** for SAST
- **Syft** for SBOM generation
- **Grype** for vulnerability scan of image/fs/SBOM
- **Optional SARIF formatter**

This produces serious evidence without CodeQL complexity.

### 5.9 Evidence Output Artifacts

- `evidence.json`
- `manifest.json` with SHA-256 digests
- `diff.patch`
- Scanner results in **SARIF** (GitHub code scanning compatible, SARIF 2.1.0)
- SBOM in **SPDX** format
- Artifact list with image digests and command lines

### 5.10 Additional Evidence Fields

- Changed test assertion count / snapshot count
- "Review focus" checklist generated from blast radius
- Previous-attempt delta summary
- Evidence freshness status (stale after rebase/base move)

### 5.11 Repo Onboarding Dossier (Unique Product Concept)

After scan/onboarding, generate persistent dossier:

- Support class
- Language class
- Ruleset map
- CODEOWNERS map
- Setup contract
- Risky workflows
- Merge queue state
- Secret classes
- Path policy summary
- Unsupported blockers
- Recommended autonomy ceiling

This becomes the canonical artifact a tech lead can review before granting write authority.

### 5.12 Policy Preview Before Task Submission

Before `submit`, show:

- Readable paths
- Writable paths
- Hard-protected paths
- Flagged paths
- External side effects if PR opened
- Workflows that would fire
- Whether merge queue is involved
- Whether signed-commit bypass is present

Makes governance feel concrete instead of bureaucratic.

### 5.13 Evidence Diffs Across Iterations

After "request changes," reviewers should not reread the whole evidence packet. Show delta:

- What changed in code
- What changed in tests
- What changed in findings
- What changed in assumptions
- What changed in blast radius

### 5.14 Language Support Matrix

- **V1 first-class:** TypeScript/JavaScript, Python, Go
- **V1 experimental:** everything else
- **V1 excluded:** anything needing unusual toolchains or multi-OS validation

Publish explicit matrices for: repo class, language class, OS/arch, GitHub feature compatibility, model profile compatibility.

### 5.15 V1 Platform Constraint

Linux x86_64 execution only.

### 5.16 Self-Hosted Inference

vLLM, Hugging Face TGI, llama.cpp, llama-cpp-python all expose OpenAI-compatible interfaces. Control plane should think in terms of a **model capability registry**, not a vendor list.

### 5.17 Model Classes (Task-Based Routing)

- **Router/summarizer:** cheapest reliable model
- **Planner:** mid/high reasoning model
- **Implementer:** strongest qualified coding model
- **Explainer:** cheaper model for human-facing summaries if needed
- **Validator:** deterministic tools only, no LLM needed for pass/fail

### 5.18 Model Selection Should Be Repo-Profile Aware

Factors: language, framework, typical task size, historical acceptance rate, cost ceiling, provider availability.

### 5.19 Anthropic Caching

Log cache hits and cached-token savings. Anthropic now exposes automatic caching (early 2026).

### 5.20 OTel Metric Cardinality Warning

Prometheus guidance warns about label cardinality exploding. Do NOT label metrics with raw task IDs, repo paths, branch names, or commit SHAs.

### 5.21 Behavioral-Control-File Precedent

GitHub's own behavior is inconsistent -- some features use trusted base/default branch, others use branch/commit-based. The product should enforce stricter: behavior-shaping files come ONLY from the task's trusted base ref pinned at task creation.

### 5.22 Browser Evidence View in Phase 1

Move a lightweight browser evidence page earlier (before full dashboard). Human trust is won in review. Generate static HTML evidence page per attempt and serve from API/object store.

### 5.23 Specific Model Versions (as of March 2026)

- **OpenAI:** `gpt-5.4` (recommended for most Codex tasks), `gpt-5.4-mini` (lighter work), GPT-5-Codex (Responses-only, 400k context)
- **Anthropic:** Sonnet 4.6, Opus 4.6 (1M context, automatic caching, early 2026)
- **Google Gemini:** tool/function behavior shifted again on March 18, 2026

### 5.24 Deferred Items (Strongest List)

- Remote HTTP MCP
- Embeddings/semantic retrieval in V1
- Kubernetes as primary deployment target
- Multi-agent anything
- Generalized plugin platform
- Cron maintenance except very specific repos
- Class-B promises without fixture coverage
- Windows/macOS execution
- Native GitHub ruleset projection
- Any "auto-remediate external block" behavior beyond rebase/rerun/requeue

---

## 6. Critical PRD Deltas (Merged Priority List)

Synthesized across all three sources. Ordered by impact.

### Must-Do (All Three Agree or 2/3 with Strong Rationale)

1. **Add formal workflow state machine contract** (Codex 5.3 provides the full spec; all three emphasize)
2. **Add branch lease protocol** with `lease_id`, `scope_key`, `owner_run_id`, `ttl`, `heartbeat`, `steal_after` (Codex 5.3 detailed; others agree on concept)
3. **Add idempotency keys to ALL external side effects** (all three)
4. **Add capability snapshot persisted per run** with inherited rulesets, push restrictions, merge queue, required workflows (all three)
5. **Add model failure budget / cost ceilings per run and per phase** (all three)
6. **Add evidence schema versioning and migration strategy** (all three)
7. **Upgrade Node baseline from 22 to 24** (Codex 5.4 + Gemini)
8. **Change Redis default to Valkey** (Codex 5.4 + Gemini)
9. **Reframe OpenRouter from primary to optional adapter** (Codex 5.4 + Gemini)
10. **Add webhook replay/reconciliation as MVP requirement** (Codex 5.4 + Gemini)
11. **Make setup contract a versioned product API with JSON Schema** (all three)
12. **Add execution-plane separation from control-plane host** (Gemini strongest; Codex 5.4 agrees)
13. **Add `pull_request_target` detection to capability scan** (Gemini; Codex 5.4 adds to scan list)
14. **Add Observer Mode as official Stage 1 product mode** (Codex 5.4 strongest; Gemini supportive)

### Should-Do (Strong Single-Source or 2/3)

15. **Use BuildKit to produce immutable OCI environment images** (Gemini unique, strong rationale)
16. **Add data retention matrix by artifact type** (Codex 5.3)
17. **Clarify multi-tenant boundaries** (Codex 5.3)
18. **Define unsupported repo topologies in V1 error taxonomy** (Codex 5.3)
19. **Add language support matrix** (Gemini)
20. **Add Zero Data Retention / provider data-path visibility** (Codex 5.4)
21. **Add workflow versioning discipline** (Codex 5.4)

---

## 7. Recommended Consolidated Stack

Based on 2/3 or 3/3 consensus with noted alternatives:

| Area | Recommendation | Notes |
|------|---------------|-------|
| Runtime | Node 24 (Active LTS) | 2/3 agree; Codex 5.3 says "current LTS" |
| Language | TypeScript (strict mode) | 3/3 |
| Package Manager | pnpm 10+ | strict deps, workspace-native |
| Monorepo | pnpm workspaces + Turborepo | Codex 5.4 only, but uncontested; local cache default |
| HTTP API | Fastify | 2/3 (Codex 5.4, Gemini) |
| Validation | Zod | 2/3 (Codex 5.4, Gemini); `safeParse` at boundaries |
| DB | PostgreSQL 17 (16 compat) | 2/3 favor 17; Codex 5.3 says 16+ |
| DB Access | Kysely (SQL-first) or Drizzle | 2/3 agree SQL-first; avoid heavy ORMs |
| DB Driver | `pg` (node-postgres) | `pg.Pool` with `max: 20` starting point |
| Cache/Pub-Sub | Valkey (Redis-protocol compatible) | 2/3; keep Redis compat |
| Redis Client | `ioredis` | Full TS support, Pub/Sub needs separate connection, Lua scripting |
| Orchestration | Temporal | 3/3 |
| Object Storage | S3-compatible interface; filesystem adapter for dev | Gemini warns against MinIO as blessed default |
| LLM SDK | Vercel AI SDK + `@openrouter/ai-sdk-provider` | Unified interface, OTel telemetry built in |
| GitHub Client | `@octokit/rest` + `@octokit/auth-app` + `@octokit/webhooks` + `@octokit/graphql` | REST for CRUD, GraphQL for merge queue/review threads |
| Docker Client | `dockerode` + `@types/dockerode` | Promise API, stream demux |
| Code Parser | `tree-sitter` (native N-API) | ~280K weekly downloads; WASM fallback |
| Glob Matching | `picomatch` | 0 deps, ReDoS-safe; `minimatch` has CVE-2022-3517 |
| Error Handling | `neverthrow` | ~2KB, `Result<T, E>`; monitor maintenance status |
| CLI | Commander.js + Ink + ink-ui | Commander 25ms startup vs oclif 135ms |
| Testing | Vitest + `@temporalio/testing` + `@testcontainers/postgresql` | ESM-native, time-skipping, real Postgres in tests |
| Linter/Formatter | Biome | Single tool, 10-25x faster than ESLint+Prettier |
| Build (dev) | `tsx` | esbuild-based, zero config |
| Build (prod) | `tsup` + `build-temporal-workflow` | esbuild-based Temporal workflow bundling, 9-11x faster than Webpack |
| Logging | Pino | Fast structured JSON, OTel trace correlation via `mixin()` |
| Observability | `@opentelemetry/sdk-node` + auto-instrumentations + `@temporalio/interceptors-opentelemetry` | Tiered: built-in default, optional OTel export, optional full Grafana stack |
| Token Counting | `js-tiktoken` | Offline pre-flight only; use API response for billing |
| Dashboard (Phase 2) | React 19 + Vite + TanStack + Monaco OR SvelteKit | Team preference; Codex 5.4 argues React strongest |
| Security Scanners | Semgrep CE + Syft + Grype | Gemini unique but well-reasoned |
| Docs Site (Phase 2) | Astro Starlight or VitePress | Plain Markdown for Phase 1 |
| Container Registry | GHCR | Codex 5.4 |
| CLI Distribution | npm first, Homebrew later | Codex 5.4 |
| Config Format | TOML | Precedence: flags > env > project > user > defaults |

---

## 8. Open Questions for Planning (Consolidated)

### Temporal / Orchestration

1. **Temporal DB:** Separate Postgres instance or same instance as application DB?
2. **Workflow granularity:** 13 distinct workflow types or grouped by phase?
3. **Namespace:** Single Temporal namespace or multi-namespace per tenant?
4. **Payload encryption:** Phase 2 or address in Phase 1?
5. **Partitions:** Create audit table partitions via Temporal workflow, startup hook, or cron?

### Architecture / Implementation

6. **CLI auth:** config file, OS keychain, env var, or all three?
7. **Repo map:** Custom implementation or adapt Aider's (Apache 2.0)?
8. **Edit format:** Per-model edit format or standardize across models?
9. **Evidence model evaluation:** Same model as implementer or separate evaluator model?
10. **CODEOWNERS parsing:** Build custom or use existing library?
11. **tree-sitter grammars:** Language-pack or individual grammar packages?
12. **Upgrade strategy:** Auto-migrate on startup or require explicit CLI command?

### Docker / Sandbox

13. **Docker socket:** Host-level worker process or mounted socket approach?
14. **Executor isolation:** How to implement execution-plane separation in Phase 1 Compose?
15. **Container lifecycle:** BuildKit immutable images (Gemini) vs docker-commit cached containers (extraction)?
16. **Network policy:** Per-container iptables or Docker network driver?
17. **gVisor compatibility:** Which languages/toolchains to test first for Phase 3?

### GitHub

18. **Check run identity migration:** What happens when app identity changes?
19. **Merge queue CI compatibility:** How to validate before onboarding a repo?
20. **CODEOWNERS scale:** Client-side matching performance at 3 MB limit?

### Product / Business

21. **Dashboard timing:** Phase 1 browser evidence view vs Phase 2 full dashboard -- where is the line?
22. **Observer mode scope:** What exactly does the readiness report contain?
23. **Tenant isolation:** Queue isolation, encryption domains, resource quotas -- what is Phase 1 vs Phase 2?
24. **Model provider data retention:** How to surface incompatibility with customer retention requirements?
25. **L2 autonomy evaluation:** Defer to Phase 2 or include quality gates in Phase 1?

### Postgres

26. **Connection pooling:** PgBouncer needed for Phase 1 or `pg.Pool` sufficient?
27. **Audit partition rotation:** Monthly partitions with 2-year metadata retention and 90-day content purge -- automated or manual?
28. **pgvector installation:** Install extension early for Phase 3 or defer entirely?

---

## 9. Critical Risks and Gotchas (Consolidated)

### High Severity

1. **Docker socket access.** Docker daemon remains a privileged surface. Even with rootless/userns/seccomp hardening, running untrusted repo code on the same host as Postgres/Temporal destroys the trust story of a governance product. Mitigation: execution-plane separation, rootless mode, strict seccomp, no Docker socket inside executor.

2. **Temporal determinism violations.** Any non-deterministic code in workflow functions causes replay failures. `Math.random()`, `Date.now()`, `setTimeout` are replaced but imports of Node.js APIs are not caught at compile time. Mitigation: `verbatimModuleSyntax: true`, separate `temporal-workflows` package, `Worker.runReplayHistory` tests, `build-temporal-workflow` bundle validation.

3. **GitHub drift is constant.** Repo state changes between indexing, candidate branch work, validation, PR creation, and merge. Reconciliation is core loop, not background. Mitigation: capability snapshot per run, webhook reconciliation as MVP, ETags for free polling.

4. **Workflow code changes break long-running runs.** Temporal versioning discipline from day 1 or face silent corruption. Mitigation: `patched()` / `deprecatePatch()`, replay test suite, versioned contract approach.

5. **Required-workflow rulesets ignore filters.** Teams assume branch/path filters protect them; in ruleset-required workflows, that assumption is false. Mitigation: explicit detection in capability scan, surface in onboarding dossier.

6. **Push rulesets are more than branch protection.** Path length, file size, extension restrictions can break agent workflows in ways that look like random Git failures. Mitigation: pre-check intended writes against effective push restrictions before execution.

7. **LLM cost runaway.** Unbounded autonomous loops can burn budget quickly. Mitigation: per-run and per-phase token/time/cost ceilings, 80% notify / 100% pause, Redis INCR for counters, retry budgets linked to cost budgets.

### Medium Severity

8. **GraphQL dependency for critical GitHub features.** Merge queue enqueue/dequeue, auto-merge, review thread resolution, stale review detection all require GraphQL. REST alone is insufficient. Mitigation: include `@octokit/graphql` from day 1.

9. **tree-sitter native compilation.** N-API bindings may fail on some platforms. Mitigation: WASM fallback via `web-tree-sitter`, test on all target platforms.

10. **MinIO Docker Hub deprecated.** MinIO stopped updating Docker Hub images (Oct 2025). Mitigation: use `quay.io/minio/minio` or Chainguard image. Consider not blessing MinIO as default at all.

11. **Event history overflow.** Without Continue-As-New at phase boundaries, long-running workflows hit 51,200 event limit. Mitigation: trigger CAN at `continueAsNewSuggested` OR `historyLength > 10_000`, design CAN as normal not exceptional.

12. **State consistency between Postgres and Temporal.** Dual-write risk. Mitigation: Postgres is source of truth, Temporal only for durability, idempotent writes with `ON CONFLICT DO NOTHING`.

13. **Effect-TS incompatibility.** GitHub issue #5986 indicates Temporal SDK incompatibility with Effect-TS patterns. Mitigation: avoid Effect-TS in workflow code.

14. **`pull_request_target` is a hidden footgun.** Running untrusted code under `pull_request_target` can expose secrets or write privileges. Mitigation: detect in capability scan, treat as high-risk condition, flag loudly in onboarding.

15. **Setup contract migration is a product problem.** Without migration/preview tooling, every change to `.factory/setup.yml` becomes support pain. Mitigation: versioned schema, JSON Schema validation, migration helpers from day 1.

16. **Compose secrets unencrypted at rest.** Docker Compose file-based secrets are NOT encrypted at rest (Swarm-only feature). Mitigation: host filesystem security + application-level envelope encryption.

### Lower Severity

17. **macOS execution differences.** Docker on macOS behaves differently than Linux (no native rootless, different filesystem performance). Mitigation: Linux x86_64 execution only for V1.

18. **Signed-commit repos may force architectural choices.** Must have explicit answer for how commits are created and trusted. Git Database API auto-signs as App identity.

19. **Test files are not simple.** Generated tests, snapshot files, golden files, contract tests, infra smoke tests -- classify, don't lump.

20. **Redis/Valkey eviction policies can invalidate lease assumptions.** Mitigation: disable eviction for critical keys.

21. **Object-store consistency during evidence publish/verify.** Plan for eventual consistency.

22. **Billing spikes from retry storms during external outages.** Link retry budgets to cost budgets.

23. **GenAI semantic conventions for OTel are still evolving.** Pin telemetry schema version.

24. **Metric cardinality explosion.** Never label with task IDs, repo paths, branch names, commit SHAs.

25. **Turborepo remote cache can leak sensitive data.** Default to local cache.

26. **SvelteKit had security fixes in early 2026 affecting remote functions.** Keep server/API boundaries explicit.

27. **`temporalio/auto-setup` is NOT for production.** Use for schema init only, then switch to `temporalio/server`.

28. **Slack notification rate limit: 1/sec.** Batch non-urgent, dedup within 60s, dead-letter after 3 retries.

29. **SSE browser limit: 6 connections per domain.** Multiplex all events through single endpoint.

30. **`POSTGRES_PASSWORD_FILE` reads from file path, not env var content.** Common misconfiguration.

31. **PostgreSQL `--data-checksums` only settable at init time.** Must configure before first data write.

---

## 10. Resolved Conflicts

These conflicts between research sources have been resolved through analysis:

1. **CLI Framework:** Commander.js + Ink over oclif. Commander has 25ms startup vs oclif's 135ms. Ink provides TUI evidence review capability.

2. **Config Format:** TOML over YAML/JSON. Better human readability for configuration files, distinct from data formats.

3. **Audit Hash Strategy:** Per-entry SHA-256 over hash chain. Simpler to implement, avoids chain-recomputation on corruption. Full chain integrity available via ordered query.

4. **Export Format:** JSONL over Parquet for V1. Lower complexity, sufficient for initial scale. Parquet deferred to Phase 2+ if analytics demand it.

5. **Monorepo Package Layout:** 6-package layout (core, db, temporal-workflows, temporal-activities, worker, cli) over the 8+ or 10+ service decompositions. Minimizes distributed-systems tax while preserving strong internal boundaries.

6. **Dashboard Framework:** Both React and SvelteKit remain viable. React has stronger technical argument for this use case (diff tooling, Monaco, table ecosystem). SvelteKit is acceptable if team prefers. Resolution: team-preference decision, documented as ADR.

7. **Temporal Workflow Bundling:** `build-temporal-workflow` (esbuild-based) over default Webpack. 9-11x faster bundling confirmed across sources.

8. **DB Query Layer:** Drizzle ORM selected in extraction (SQL-first, TypeScript schemas, ~5KB bundle, ~12% overhead) while Kysely also appears as viable. Both are SQL-first. Resolution: either acceptable, Drizzle has stronger TypeScript schema story.

---

## Appendix A: Consolidated Technology Stack (Exact Versions and Packages)

From `research-full-extraction.md` -- precise package names and versions for implementation:

| Layer | Package(s) | Version | Notes |
|-------|-----------|---------|-------|
| Runtime | Node.js | 24+ | Node 22 Maintenance LTS only as compat floor |
| Language | TypeScript | strict mode | `@tsconfig/node22` base (update to node24 when available) |
| Package Manager | pnpm | 10+ | strict deps, workspace-native |
| Monorepo | pnpm workspaces | -- | No Turborepo initially; 6 packages sufficient for Phase 1 |
| Orchestration | `@temporalio/workflow`, `@temporalio/activity`, `@temporalio/client`, `@temporalio/worker`, `@temporalio/testing` | 1.14.x-1.15.x | **All `@temporalio/*` packages MUST have the same version number** |
| Primary DB | PostgreSQL | 17 | with `pgcrypto` extension; `pgvector` installed early for Phase 3 |
| ORM | `drizzle-orm` + `drizzle-orm/node-postgres` | latest | SQL-first, TypeScript schemas |
| DB Driver | `pg` (node-postgres) | latest | `pg.Pool` with `max: 20` as starting point |
| Cache/PubSub | Valkey (Redis 7 protocol) | 7 | `redis:7-alpine` or Valkey equivalent image |
| Redis Client | `ioredis` | latest | Pub/Sub requires separate connection, Lua scripting |
| Object Store | S3-compatible | latest | Filesystem adapter for dev; MinIO/R2/S3 for production |
| LLM SDK | `ai` (Vercel AI SDK) + `@openrouter/ai-sdk-provider` | latest | Unified interface, OTel telemetry built in |
| GitHub Client | `@octokit/rest` + `@octokit/auth-app` + `@octokit/webhooks` + `@octokit/graphql` | latest | REST for CRUD, GraphQL required for merge queue + review threads |
| Docker Client | `dockerode` + `@types/dockerode` | 4.x | Promise API, stream demux |
| Code Parser | `tree-sitter` (native N-API) | latest | WASM fallback via `web-tree-sitter` |
| Phase 1 Grammars | `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java` | latest | Official, mature |
| Glob Matching | `picomatch` | latest | 0 deps, ReDoS-safe |
| Validation | `zod` | latest | `safeParse` at boundaries, derive types via `z.infer` |
| Error Handling | `neverthrow` | latest | ~2KB, `Result<T, E>` |
| CLI | `commander` + `ink` + `ink-ui` | latest | Commander 25ms startup |
| Testing | `vitest` + `@temporalio/testing` + `@testcontainers/postgresql` | latest | ESM-native, time-skipping |
| Linter/Formatter | `biome` | latest | 10-25x faster than ESLint+Prettier |
| Build (dev) | `tsx` | latest | esbuild-based, zero config |
| Build (prod) | `tsup` (or `tsdown`) + `build-temporal-workflow` | latest | esbuild-based Temporal workflow bundling |
| Logging | `pino` | latest | Fast structured JSON, OTel trace correlation |
| Observability | `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@temporalio/interceptors-opentelemetry` | latest | Tiered deployment |
| Token Counting | `js-tiktoken` | latest | Offline pre-flight only |
| Dashboard (Phase 2) | React 19 + Vite OR SvelteKit | latest | SSE for real-time, REST API for commands |
| Documentation (Phase 2) | Astro Starlight or VitePress | latest | Plain Markdown for Phase 1 |

## Appendix B: Monorepo Architecture

### Package Layout (6 packages)

```
software-factory/
  packages/
    core/                  -- Domain types, Zod schemas, errors, config
    db/                    -- Drizzle schema, repositories, migrations
    temporal-workflows/    -- Workflow definitions (bundled into V8 isolate)
    temporal-activities/   -- Activity implementations (normal Node.js)
    worker/                -- Temporal worker process setup
    cli/                   -- CLI interface (Commander.js + Ink)
  pnpm-workspace.yaml
  tsconfig.base.json       -- strict, NodeNext, composite
  biome.json
  vitest.workspace.ts
  docker-compose.yml
  .factory/setup.yml       -- Dogfooding
```

### Package Dependency Graph

```
core
  |-- db (core)
  |-- temporal-workflows (core -- types/schemas only, NO Node.js)
  |-- temporal-activities (core, db)
  |-- worker (temporal-workflows, temporal-activities, core, db)
  |-- cli (core, db)
```

### Critical Structural Constraint: Temporal Workflows

- Workflow code runs in a V8 isolate sandbox
- CANNOT import Node.js APIs (`fs`, `http`, `crypto`, etc.)
- CANNOT import activity code directly -- use `proxyActivities<T>()` with type-only imports
- `Math.random()`, `Date`, `setTimeout()` replaced with deterministic versions
- `FinalizationRegistry` and `WeakRef` are removed
- CAN import pure TypeScript packages (e.g., `core`) as long as nothing in the import chain references Node.js
- Bundled with Webpack by default; use `build-temporal-workflow` (esbuild) for 9-11x faster bundling

### TypeScript Configuration

Key settings: `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `lib: [ES2024]`, all strict flags enabled, `verbatimModuleSyntax: true` (enforces `import type` -- CRITICAL for Temporal), `composite: true` for incremental builds.

### "Live Types" Pattern

Internal packages export TypeScript source directly during dev. Point `exports` in package.json at `.ts` files. Only `temporal-workflows` and `cli` need production builds.

### Dependency Injection

Closure-based factory functions (Temporal's official pattern). No DI container. Activities created via `createXActivities(deps)`, spread into Worker's activities config.

## Appendix C: Temporal Orchestration Detail

### Workflow Architecture: Parent Orchestrator + Child Phases

Parent spawns child workflows per phase. ~104 events for parent (13 phases x 8 events each). Well within 51,200 limit. Each child can Continue-As-New independently.

Phase list: IntakePhase, UnderstandPhase, PlanPhase, SetupPhase, ImplementPhase (may CAN internally), ValidatePhase, EvidencePhase, ReviewPhase (waits for human signal, 7-day timeout), PRCreationPhase, PRTrackingPhase (waits for GitHub events), LearnPhase.

### Activity Timeout Profiles

| Activity Type | startToClose | scheduleToClose | heartbeat | maxAttempts |
|---------------|-------------|----------------|-----------|------------|
| DB writes | 30s | -- | -- | 5 |
| GitHub API | 2m | -- | -- | 10, backoff 2x |
| LLM calls | 5m | 30m | -- | 8, backoff 2x |
| Docker ops | 15m | -- | 30s | 3 |

### Task Queues (5)

- `sf-orchestration` (workflows, 100 concurrent)
- `sf-llm` (20 concurrent, 10/sec rate limit, 30s shutdown grace)
- `sf-docker` (5 concurrent, 10s heartbeat throttle)
- `sf-github`
- `sf-db`

### Key Patterns

- **Human approval:** Signal + `wf.condition(allHandlersFinished)` + 7-day timeout
- **Kill switch:** Signal-based (zero event cost), check before every activity
- **Continue-As-New:** trigger at `continueAsNewSuggested` OR `historyLength > 10_000`; re-register handlers; drain with `allHandlersFinished`; never call from signal handler
- **Idempotent writes:** `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`
- **Concurrent handlers:** `async-mutex` (safe in sandbox)
- **Rate limit retry:** `ApplicationFailure.create({ nextRetryDelay: '60s' })`
- **Cleanup on cancel:** `CancellationScope.nonCancellable(async () => { ... })`
- **Patching:** `patched('name')` / `deprecatePatch('name')` for safe code changes
- **Workflow ID:** `task-{taskId}` (orchestrator), `task-{taskId}-{phase}` (children)

## Appendix D: GitHub Integration Detail

### App Permissions

contents:write, pull_requests:write, checks:write, statuses:write, issues:read, administration:read, merge_queues:read. Org: administration:read, members:read.

### Credential Broker

JWT: RS256, `iss` = client ID, `iat` = 60s past, `exp` = max 10 min. Installation tokens: 1 hour (not configurable), rotate at ~50 min. `@octokit/auth-app` caches tokens (toad-cache, 15K entries).

### Webhook Events

pull_request, pull_request_review, check_suite, check_run, merge_group (app-webhook-only), push, installation. Signature: `X-Hub-Signature-256` with timing-safe comparison. Idempotency: `X-GitHub-Delivery`. API version: `2026-03-10`.

### Rate Limits

5,000 req/hr base (to 12,500). 100 concurrent. 80 content-creating/min. GraphQL: 1 pt/query, 5 pts/mutation. ETags for reconciliation (304 = free).

### Capability Scan (10 Steps)

1. Authenticate
2. Repo metadata
3. Rulesets (`includes_parents`)
4. Branch rules
5. Protection
6. CODEOWNERS (3 locations)
7. Environments
8. Parse rules
9. Determine class
10. Report

### CODEOWNERS

Client-side gitignore-style matching required. Last match wins. Case-sensitive. 3 MB limit.

### Check Run Bootstrap

Must submit check once before it can be required. Create on any commit with `conclusion: "success"`.

### Merge Queue GraphQL

`enqueuePullRequest`, `enablePullRequestAutoMerge`, `dequeuePullRequest` mutations.

## Appendix E: Code Indexing Pipeline

### Pipeline Stages

git ls-files -> Governance Filter (picomatch) -> Language Detection -> Parse (tree-sitter) -> Symbol Extraction (tags.scm) -> Import Extraction -> Store (Postgres) -> Build Dependency Graph -> Detect Structure -> Mark Ready

### Performance

~100K lines/sec. Full index: 1K files = 5-10s, 10K = 30-60s, 100K = 5-10min. Incremental (1-10 files): 50-200ms. git diff: 1-2ms.

### Repo Map (Aider-style)

Graph nodes = files, edges = symbol references. PageRank with personalization. Edge weights: chat mention (x10), long identifier (x10), private (x0.1), ubiquitous (x0.1), active file ref (x50). Token budget ~1K.

### Storage Tables

repositories, code_index_versions (repo_id + commit_sha UNIQUE), indexed_files, symbols (with tsvector GIN), imports, file_dependencies, repo_structure. Full-text: 'simple' config (no stemming). Phase 3: pgvector VECTOR(1536) with HNSW.

### Governance Filter

picomatch as FIRST pipeline stage (security boundary). Default exclusions: `secrets/**`, `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `.git/**`, `node_modules/**`. Applied at build, update, AND query time. Resolve symlinks before filtering.

## Appendix F: Docker Sandbox Lifecycle

### Phases

RESOLVE -> CREATE -> SETUP (bridge network, exec -e secrets, docker commit) -> MAINTENANCE (if cached) -> EXECUTION ('none' network, exec -e runtime secrets, monitor) -> CLEANUP

### Security Baseline

CapDrop: ALL, no-new-privileges, ReadonlyRootfs, tmpfs for /tmp + /run + .cache, Memory 4GB, CPU 2, PIDs 256, NetworkMode 'none', User 1000:1000.

### Secrets Injection

`docker exec -e` per phase. Not in docker inspect, not in docker commit. Per-tool granularity.

### Caching

docker commit after setup. Cache key: SHA-256(image + setup + maintenance + secret names + control file hashes). Invalidation on contract/maintenance/secret/control changes. 1-3s restore.

### gVisor (Phase 3)

No nested Docker, partial iptables, DNS issues, 274/350 syscalls, no io_uring. CPU: no overhead. Syscall-heavy: measurable.

## Appendix G: LLM Integration

### Agent Architecture

Hybrid plan-and-execute (outer, Temporal) + ReAct (inner, Vercel AI SDK generateText with maxSteps).

### OpenRouter Config

`allow_fallbacks: false`, single provider order, `data_collection: "deny"`, `require_parameters: true`.

### Cost Tracking

`GET /api/v1/generation?id=` for total_cost, tokens, latency, provider, cache_discount. Budgets: 80% notify, 100% pause. Per-task $10 default, global $100/day. Redis INCR for counters.

### Edit Format

Search/replace blocks with progressive matching (exact -> whitespace-tolerant -> fuzzy). Whole file for small new files. Avoid line numbers.

### Context Priority

System prompt (top) -> Repo map -> Task objective -> Plan -> Files -> Tool history -> Previous results (bottom). "Lost-in-the-middle" effect: rules at start, working context at end.

### Guardrails

maxSteps: 10, no-progress hash (3 identical = pause), loop-of-doom (4 identical failing calls = stop), 30 min wall-clock, Redis cost check before each LLM call, Redis kill switch at every tool invocation.

### Prompt Injection Defense

Trust classification (factory > base-ref > human > external). Delimiters. Content filtering. Tool-call validation. Base-ref-only behavioral files.

## Appendix H: PostgreSQL Data Layer

### State Machine

PG enum + BEFORE UPDATE trigger + task_valid_transitions lookup table. 14 states. Terminal: merged, failed.

### Audit

Append-only, RLS (RESTRICTIVE UPDATE/DELETE), FORCE ROW LEVEL SECURITY, monthly partitions, per-entry SHA-256 (not chain), 90-day content purge (NULL), 2-year metadata retention (DROP partition), JSONL export to MinIO.

### Evidence Bundles

Relational for fixed fields + JSONB for variable. `$type<T>()` for compile-time, Zod for runtime.

### Encryption

AES-256-GCM at application layer (not pgcrypto). Envelope: DEK(32 bytes) + KEK. IV: 96-bit. V1: env var KEK. Pluggable KmsProvider interface.

### Migrations

Drizzle Kit. Forward-only. Custom SQL for triggers, RLS, partitions, seeds, extensions.

### Indexing

Partial index on tasks(state) WHERE NOT IN terminal. GIN on tsvector (symbols), GIN on JSONB (policies). pg.Pool max: 20.

## Appendix I: Deployment and Operations

### Docker Compose (6 Services)

| Service | Image | Ports |
|---------|-------|-------|
| app | Node 22-slim (custom Dockerfile) | 3000 (API) |
| postgres | postgres:16-alpine (data-checksums, scram-sha-256) | 5432 (internal) |
| redis | redis:7-alpine | 6379 (internal) |
| temporal | temporalio/auto-setup (dev) / temporalio/server (prod) | 7233 gRPC (internal) |
| temporal-ui | temporalio/ui | 8080 (optional dev) |
| minio | quay.io/minio/minio | 9000/9001 |

Health checks on all services. `restart: unless-stopped`. JSON logging with rotation (`max-size: 50m`, `max-file: 5`).

### Secrets

Docker Compose file-based (`/run/secrets/`). NOT encrypted at rest. 5 secrets needed: `postgres_password.txt`, `redis_password.txt`, `minio_root_password.txt`, `factory_api_key.txt`, `encryption_master_key.txt`.

### Distribution

Clone + `.env.example` + `./factory install`. Upgrade: `./factory upgrade` (backup first, migrations not reversible). Backup: `pg_dump` + `mc mirror` (not Temporal).

### Observability Tiers

1. **Built-in default:** Pino JSON + `/health` + `/metrics` (Prometheus format)
2. **Optional:** `OTEL_EXPORTER_OTLP_ENDPOINT` env var enables export
3. **Full:** `--profile observability` adds OTel Collector + Jaeger + Grafana

### Redis Patterns

- **Branch lease:** SET NX EX + Lua scripts for atomic check-and-modify
- **Kill switch:** MGET (sub-ms), publish to `factory:system` on activation
- **Pub/Sub:** Dedicated connection (`redis.duplicate()`)
- **Cost counter:** INCR
- **Session:** SET EX, TTL 86400s

### CLI Config

`~/.config/software-factory/config.toml`. TOML format. Precedence: flags > env > project > user > defaults.

### Notifications

Router with pluggable channels. Phase 1: Slack webhook (rate: 1/sec, token bucket, backoff+jitter on 429, batch non-urgent 5min, dedup 60s, dead-letter after 3 retries). Categories: blocked review, circuit breaker, external failure, cost warning (immediate); task completion, system health (batched).

### Health Endpoints

- `/health` -- summary + version
- `/health/ready` -- dependency checks
- `/health/live` -- process health

### OTel Metrics

| Metric | Type |
|--------|------|
| `factory.task.duration` | Histogram |
| `factory.task.count` | Counter (by status) |
| `factory.llm.tokens` | Counter (by model/provider) |
| `factory.llm.cost` | Counter ($/model/provider) |
| `factory.llm.latency` | Histogram |
| `factory.evidence.review_time` | Histogram |
| `factory.sandbox.duration` | Histogram |
| `factory.github.api_calls` | Counter (by endpoint) |
| `factory.credential.rotations` | Counter |

---

## File References

| Source | Path |
|--------|------|
| Three-Model Synthesis | `.claude/plans/research.md` |
| Full Extraction | `.claude/plans/research-full-extraction.md` |
| Codex 5.3 | `docs/codex-5.3-research.md` |
| Codex 5.4 | `docs/codex-5.4-resaerch.md` |
| Gemini | `docs/gemini-research.md` |
| PRD v5.1 | `docs/prd.md` |
| Immutable Rules | `.claude/rules/immutable.md` |
| Stack (TBD) | `.claude/rules/stack.md` |
