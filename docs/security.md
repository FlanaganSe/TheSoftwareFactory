# Security Model

Software Factory is designed around the principle that **AI agents should never be trusted implicitly**. Every capability is gated, every action is auditable, and control files are tamper-proof.

## Threat Model

Six prioritized threats, derived from the PRD:

| # | Threat | Severity | Mitigation |
|---|--------|----------|------------|
| 1 | **Evaluator tampering** | Critical | Validation configs load from pinned base SHA, not the agent's working branch |
| 2 | **Behavioral file poisoning** | Critical | Trusted Base Context pins CLAUDE.md, AGENTS.md, `.factory/` to base SHA at intake |
| 3 | **Prompt injection** | High | Structured tool outputs, governance-enforced file access, sandbox isolation |
| 4 | **Credential exposure** | High | Phase-separated secrets, AES-256-GCM encrypted storage, 50-min rotation |
| 5 | **Data governance bypass** | High | Path-level policies enforced at read, write, index, and search layers |
| 6 | **Unauthorized egress** | Medium | Docker sandbox has no network access; commands run in isolated containers |

## Trust Boundaries

```
┌─────────────────────────────────────────────────┐
│  TRUSTED ZONE                                   │
│                                                 │
│  Base branch configs ──→ Trusted Base Context   │
│  (pinned at intake, immutable for task lifetime) │
│                                                 │
│  Policy Engine ──→ governs all file access      │
│  State Machine ──→ enforced at DB level         │
│  Audit Log     ──→ RLS prevents tampering       │
└─────────────────────────────────────────────────┘
                    │
                    │ (one-way: trusted zone governs untrusted)
                    ▼
┌─────────────────────────────────────────────────┐
│  UNTRUSTED ZONE                                 │
│                                                 │
│  LLM Agent   ──→ runs inside Docker sandbox     │
│  Agent output ──→ validated before use          │
│  Working branch ──→ can't influence own rules   │
└─────────────────────────────────────────────────┘
```

### Trusted Base Context

At task intake, the system captures behavioral control files from the **base branch** (e.g., `main`) at a pinned SHA:

- `CLAUDE.md`, `AGENTS.md`, and similar instruction files
- `.factory/setup.yml` (build/test contract)
- `.factory/policies.yml` (path-level governance rules)

These are frozen for the task's lifetime. If the agent edits these files on its working branch, the edits are treated as diff content — they don't change the agent's behavior or validation rules.

### Validator Boundary

Validation (tests, lint, security scans) uses configuration from the base branch:
- The agent cannot modify `.eslintrc`, `tsconfig.json`, `vitest.config.ts`, etc. to make its code pass
- Validation runs in a separate context from the agent's sandbox
- Results are recorded in the evidence packet for human review

## Policy Engine

Path-level governance with strict priority ordering:

```
read_exclusion  →  blocks read, index, and search (highest priority)
edit_deny       →  blocks all writes
edit_protected  →  allows writes but flags for mandatory review
edit_allowed    →  allows writes (lowest priority)
```

### Default Exclusions (Always Enforced)

These paths are excluded regardless of user policy configuration:

```
secrets/**    .env*        *.pem       *.key
*.p12         *.pfx        *.jks       .git/**
node_modules/**
```

### Policy Evaluation

1. Check default exclusions → block if matched
2. Find highest-priority matching policy
3. Apply operation-specific rules (read vs write vs index vs search)
4. Return decision with reason and protection class

## Credential Management

### Phase Separation

Credentials are scoped by workflow phase:
- **Setup phase** — has install-time credentials (npm tokens, package registry auth)
- **Execution phase** — install-time credentials are removed; only runtime credentials available
- **PR phase** — has GitHub write tokens for PR creation

This prevents the agent from exfiltrating install-time secrets during code execution.

### Storage

- Secrets stored in Postgres with AES-256-GCM encryption (`secret_bindings` table)
- Injected into Docker containers at runtime via environment variables
- 50-minute credential leases with automatic rotation
- Lease tracking in `credential_leases` table

## Audit System

### Append-Only Log

Every significant action is recorded in `audit_entries`:

- Task state transitions
- Side effects (GitHub API calls, file writes, command executions)
- Cost records (LLM tokens, compute time)
- Policy decisions (allowed/denied file access)

### Immutability Guarantees

- PostgreSQL Row-Level Security (RLS) prevents UPDATE and DELETE on audit entries
- SHA-256 content hashes for integrity verification
- Entries include actor, timestamp, and correlation IDs

### What's Audited

| Event | Recorded Fields |
|-------|----------------|
| State transition | from_state, to_state, actor, reason |
| File write | path, policy decision, protection class |
| Command execution | command, exit code, duration |
| GitHub API call | endpoint, response status, rate limit remaining |
| LLM request | model, token count, cost, duration |
| Cost milestone | cumulative cost, budget remaining |

## Safety Primitives

All backed by Redis for low-latency checks:

### Kill Switch

- **Global** — halts all tasks immediately
- **Per-task** — halts a specific task
- Checked at every activity entry point (before any work begins)
- Triggers the `kill` signal on the Temporal workflow → immediate cancellation

### Cost Budgets

- Per-task spending limits set at creation
- Tracked in Redis for real-time enforcement
- Overridable via `cost_override` signal (requires authorized actor)
- Cost records persisted to Postgres for audit

### Circuit Breakers

- Automatic halt after configurable failure threshold
- Scoped per failure domain (e.g., GitHub API errors, LLM timeouts)
- Prevents cascading failures and runaway costs

### Branch Leases

- Prevent two tasks from working on the same branch concurrently
- Lease acquired at setup, released at completion/cancellation
- Stale lease detection and cleanup

## Authentication & Authorization

### API Keys

- Format: `sf_<random>` prefix for easy identification
- Storage: SHA-256 hashed in Postgres (raw key never stored)
- First-run bootstrap prints an admin key to stdout

### Roles

| Role | Capabilities |
|------|-------------|
| `admin` | Full access: create/manage API keys, configure system |
| `operator` | Submit tasks, approve/reject, manage safety controls |
| `viewer` | Read-only access to tasks and evidence |

### Separation of Duties

The task submitter cannot be the sole approver of their own task's evidence. This prevents a single actor from submitting and rubber-stamping AI-generated code.

## Docker Sandbox

- **No network access** — `network_mode: none` or isolated bridge with no external routes
- **Resource limits** — CPU, memory, and disk quotas
- **Ephemeral** — containers destroyed after each phase
- **Read-only root filesystem** — writes only to designated volumes
- **No privilege escalation** — `--security-opt=no-new-privileges`
