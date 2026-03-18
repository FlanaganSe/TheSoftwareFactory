# Research: Deployment, Distribution, CLI UX, Observability, and Operational Patterns

**Date:** 2026-03-18
**Scope:** Docker Compose production setup, self-hosted distribution, CLI UX, OpenTelemetry, Redis patterns, notifications, SvelteKit dashboard, upgrade/maintenance, documentation strategy

---

## 1. Docker Compose Production Setup

### 1.1 Service Definitions

The Phase 1 stack requires six services. Recommended image versions and configurations:

| Service | Image | Exposed Ports | Internal Ports |
|---------|-------|---------------|----------------|
| **app** (control plane) | Custom Dockerfile (Node 22-slim) | 3000 (API) | -- |
| **postgres** | `postgres:16-alpine` | -- (internal only) | 5432 |
| **redis** | `redis:7-alpine` | -- (internal only) | 6379 |
| **temporal** | `temporalio/auto-setup` (dev) / `temporalio/server` (prod) | -- (internal only) | 7233 (gRPC) |
| **temporal-ui** | `temporalio/ui` | 8080 (optional, dev) | 8080 |
| **minio** | `minio/minio` | 9000 (API), 9001 (console) | 9000, 9001 |

**Temporal note:** The `temporalio/auto-setup` image handles database schema initialization automatically but is NOT recommended for production. The production pattern is: (1) use `auto-setup` once to initialize the database schema, (2) switch to `temporalio/server` for ongoing operation. The auto-setup script registers the default namespace and populates schema tables. Without it, Temporal has no namespaces registered.

**Source:** https://hub.docker.com/r/temporalio/auto-setup, https://github.com/temporalio/docker-compose

**MinIO note:** MinIO stopped updating Docker Hub images as of October 2025. For production, consider Chainguard's maintained MinIO image or pulling directly from `quay.io/minio/minio`.

### 1.2 Health Checks

Every service needs a health check. Dependent services should use `depends_on` with `condition: service_healthy`.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U factory -d factory"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  temporal:
    image: temporalio/server
    healthcheck:
      test: ["CMD", "temporal", "operator", "cluster", "health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  minio:
    image: minio/minio
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    # Custom health check endpoint
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 15s
```

**Source:** https://last9.io/blog/docker-compose-health-checks/, https://github.com/minio/minio/issues/18389

### 1.3 Volume Management

Named volumes for all persistent data. Never use bind mounts for database data in production.

```yaml
volumes:
  postgres_data:    # /var/lib/postgresql/data
  redis_data:       # /data (if AOF persistence enabled)
  minio_data:       # /data
  temporal_data:    # Temporal stores state in Postgres, not its own volume
```

PostgreSQL should use `POSTGRES_INITDB_ARGS: "--data-checksums"` for data integrity and `POSTGRES_HOST_AUTH_METHOD: "scram-sha-256"` for security.

### 1.4 Networking

Use a single internal bridge network. Only expose ports that the user needs:

- **Must expose:** app API (3000), MinIO console (9001, optional for admin)
- **Should NOT expose:** Postgres (5432), Redis (6379), Temporal gRPC (7233)
- **Optional:** Temporal UI (8080, dev/debug only)

```yaml
networks:
  factory-internal:
    driver: bridge
```

### 1.5 Resource Limits

Without resource limits, a single runaway container can starve all other services. Use the `deploy` key:

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 256M
```

Recommended minimums for the full stack: 4 CPU cores, 8 GB RAM. Postgres and Temporal are the heaviest consumers. Sentry's self-hosted requires 4 cores / 16 GB + 16 GB swap -- the software factory stack is lighter but should document minimum requirements clearly.

**Source:** https://oneuptime.com/blog/post/2026-02-02-docker-resource-limits/view

### 1.6 Restart Policies

```yaml
services:
  postgres:
    restart: unless-stopped
  redis:
    restart: unless-stopped
  temporal:
    restart: unless-stopped
  minio:
    restart: unless-stopped
  app:
    restart: unless-stopped
```

`unless-stopped` is preferred over `always` because it respects explicit `docker compose stop` commands while still recovering from crashes.

### 1.7 Environment Variable Management

Use a `.env` file for non-secret configuration, loaded by Docker Compose automatically:

```env
POSTGRES_DB=factory
POSTGRES_USER=factory
TEMPORAL_DB=temporal
TEMPORAL_VISIBILITY_DB=temporal_visibility
MINIO_BUCKET=factory-artifacts
NODE_ENV=production
```

### 1.8 Secrets Handling

Docker Compose secrets mount as files at `/run/secrets/<name>` inside containers. This is safer than environment variables, which can leak into logs, child processes, and crash dumps.

```yaml
secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
  redis_password:
    file: ./secrets/redis_password.txt
  minio_root_password:
    file: ./secrets/minio_root_password.txt
  factory_api_key:
    file: ./secrets/factory_api_key.txt
  encryption_master_key:
    file: ./secrets/encryption_master_key.txt

services:
  postgres:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password
```

**Limitation:** Docker Compose secrets are NOT encrypted at rest (that is a Docker Swarm feature). They are simply file mounts. The host filesystem security is the actual protection layer. For the initial target user (solo builders / small teams), this is adequate. Document the limitation.

The PRD specifies envelope-encrypted secrets in Postgres with an operator-managed master key. The `encryption_master_key` secret is the operator's master key, loaded via Docker Compose secrets.

**Source:** https://docs.docker.com/compose/how-tos/use-secrets/

### 1.9 Logging Configuration

Use JSON logging driver for structured log aggregation:

```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
        tag: "factory-app"
```

Without `max-size` / `max-file`, Docker logs grow unbounded and will fill the disk.

---

## 2. Self-Hosted Product Distribution

### 2.1 How Successful Products Distribute

| Product | Installation Method | Upgrade Method | Key Pattern |
|---------|-------------------|----------------|-------------|
| **Sentry** | `./install.sh` (bash script in repo) | Re-run `./install.sh` | Hard stops at specific versions; schema migrations non-reversible |
| **GitLab** | Docker Compose with `docker compose pull && docker compose up -d` | Edit image tag in compose file, pull, up | Must follow upgrade path (cannot skip versions); upgrade path tool |
| **Supabase** | Docker Compose (recommended) | Pull new images, restart | Single-command upgrade |
| **Outline** | Docker Compose | Pull + restart | Standard Docker Compose lifecycle |
| **Cal.com** | Docker Compose in main repo | Pull + restart | Config via `.env` |

**Common pattern:** Every successful self-hosted product uses Docker Compose as the primary distribution mechanism. None require Kubernetes for initial setup. None use `curl | sh` from a remote URL as the primary installation method.

**Source:** https://develop.sentry.dev/self-hosted/, https://docs.gitlab.com/install/docker/installation/

### 2.2 Recommended Installation Flow

```
1. User clones the repository (or downloads a release archive)
2. User copies .env.example to .env and edits configuration
3. User runs ./factory install  (or ./install.sh)
   - Validates Docker/Compose versions
   - Generates secrets if not present
   - Runs docker compose pull
   - Initializes database schema (via Temporal auto-setup + app migrations)
   - Creates default admin API key
   - Runs health checks
   - Prints success message with next steps
4. User runs docker compose up -d
```

**Safer alternative to `curl | sh`:** Ship the install script in the repository. Users clone/download first, can inspect the script, then run it locally. This is the Sentry pattern and is safer than piping remote scripts to a shell.

### 2.3 First-Run Configuration Wizard

The install script should function as a minimal configuration wizard:

1. Check Docker and Docker Compose versions (fail fast with clear error)
2. Check available system resources (warn if below minimums)
3. Generate secrets if `./secrets/` directory is empty (using `openssl rand`)
4. Prompt for GitHub App credentials (or defer to later `factory config` command)
5. Set initial admin API key
6. Write `.env` with sensible defaults
7. Initialize databases and run schema migrations

This follows the CLI UX pattern of "first-run wizard": a few high-signal prompts with safe defaults and a clear escape hatch. Power users can skip with flags (`./factory install --non-interactive`).

### 2.4 Upgrade Path

**Critical constraint from Sentry/GitLab experience:** Database migrations are NOT reversible. Always backup before upgrading.

Recommended upgrade flow:

```bash
# 1. Backup
./factory backup                    # pg_dump + minio export

# 2. Pull new version
git pull origin main               # or download release
# OR: edit FACTORY_VERSION in .env

# 3. Run upgrade
./factory upgrade                   # Pulls images, runs migrations, restarts
# Internally:
#   docker compose pull
#   docker compose run --rm app npm run migrate
#   docker compose up -d
#   docker compose exec app factory health-check
```

**Version upgrade path:** Use semantic versioning. Define "hard stop" versions where schema changes are significant. The upgrade script validates that the user is on a compatible version before proceeding and refuses to skip hard stops.

**Rollback strategy:** Since database migrations are not reversible, rollback means restoring from backup. Document this clearly. Consider two-phase migrations where possible: (1) add new columns/tables (backwards compatible), (2) in the next version, remove old columns.

### 2.5 Backup/Restore

```bash
./factory backup                        # Creates timestamped backup
./factory backup --output ./backup.tar  # Custom output path
./factory restore ./backup.tar          # Restore from backup

# Internally:
# - pg_dump for Postgres
# - mc mirror for MinIO
# - Export factory configuration
# - Does NOT backup Temporal (Temporal data is ephemeral/operational)
```

### 2.6 Distribution Approaches Comparison

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Docker Compose** (files in repo) | Simple, inspectable, portable | Manual scaling, single-node | **Phase 1 -- primary** |
| **Helm chart** | Kubernetes-native, scalable | Requires Kubernetes, higher barrier | Phase 3+ |
| **Single binary** | Simplest distribution | Cannot easily bundle Postgres/Redis/Temporal | Not viable for this stack |
| **VM image (AMI/OVA)** | Pre-configured | Cloud-specific, hard to update | Not recommended |

---

## 3. CLI UX Design

### 3.1 Framework Selection

| Framework | Weekly Downloads | TypeScript | Plugins | Shell Completions | Best For |
|-----------|-----------------|------------|---------|-------------------|----------|
| **Commander.js** | ~35M | Yes | No | Via external pkg | Simple CLIs |
| **oclif** | ~1M | Yes (native) | Yes (first-class) | Yes (built-in) | Multi-command tools |
| **yargs** | ~30M | Via @types | No | Yes (`yargs.completion()`) | Middleware-heavy CLIs |
| **citty** (unjs) | ~3M | Yes | No | No | Lightweight, modern |
| **clipanion** (yarn) | ~500K | Yes | No | No | Stateful CLIs |

**Recommendation:** **oclif** for the software factory CLI. Rationale:

- Powers Heroku CLI, Salesforce CLI, Shopify CLI -- proven at scale for developer tools
- First-class TypeScript support (generates TS projects)
- Built-in plugin architecture (aligns with eventual extensibility)
- Auto-generated help, man pages, shell completions
- Test infrastructure included
- Command structure maps naturally to the factory's domain (`factory submit`, `factory evidence`, `factory approve`)

**Source:** https://oclif.io/, https://www.grizzlypeaksoftware.com/library/cli-framework-comparison-commander-vs-yargs-vs-oclif-utxlf9v9

### 3.2 Command Structure

```
factory
  submit          Submit a task (--issue 42, --directive "...")
  status          Show task status (--task T-001, or list all)
  evidence        Display evidence packet (--task T-001)
  approve         Approve task for PR creation (--task T-001)
  reject          Reject task (--task T-001 --reason "...")
  changes         Request changes (--task T-001 --feedback "...")
  kill            Emergency stop (--task T-001 or --all)
  config          Configure factory (init, set, get, list)
  repo            Repo management (scan, onboard, status)
  logs            View task/system logs (--task T-001, --follow)
  health          System health check
  backup          Backup factory state
  upgrade         Upgrade factory version
```

### 3.3 Eight CLI UX Patterns to Implement

From research on excellent developer CLIs (gh, railway, vercel, fly):

**1. First-Run Wizard**
First invocation should guide setup: API key, GitHub App, repo config. Safe defaults, escape hatch with flags. Not a questionnaire -- a few high-signal prompts.

**2. Helpful Help**
Every command has examples, not just flag descriptions. `factory submit --help` should show `factory submit --issue 42 --repo my-org/my-repo`.

**3. Dry-Run with Diff**
`factory submit --dry-run` shows what would happen without executing. Critical for a control-plane product where user control is a core principle.

**4. Idempotent Retries**
`factory approve --task T-001` should succeed or report "already approved" -- not error on duplicate invocation.

**5. Structured Output**
`factory status --json` for machine consumption. `factory status --format table` for humans. Default to human-readable with color.

**6. Smart Errors**
Errors should include: what went wrong, why, and what to do next. Example: "Task T-001 is in state 'needs_clarification'. Run `factory respond --task T-001` to provide clarification."

**7. Honest Progress**
Live progress for long operations: spinners for indeterminate, progress bars for determinate. Use `ora` for spinners, `cli-progress` or `listr2` for multi-step progress.

**8. Shell Completions**
oclif provides this out of the box. Support bash, zsh, fish.

### 3.4 Evidence Display in Terminal

The evidence packet (R-008) is rich structured data. Terminal display strategy:

- **Annotated diff:** Use `diff2html` or custom ANSI coloring (green/red for add/remove). Page with less/more for large diffs.
- **Test results:** Table format with pass/fail indicators (checkmark/X unicode).
- **Blast radius:** Compact summary table.
- **Security scan:** Severity-colored table (red: critical, yellow: warning).
- **Protected file edits:** Highlighted with warning color, justification inline.
- **Markdown rendering:** Use `marked-terminal` or `cli-markdown` for rendering markdown in terminal.

```
factory evidence --task T-001

  Task T-001: Add user authentication
  Status: evidence_ready

  Blast Radius
  Files changed: 4  |  Packages affected: 2  |  Downstream consumers: 1

  Test Results
  [PASS] 24 passed  [FAIL] 0 failed  [SKIP] 2 skipped

  Security Scan
  No vulnerabilities found

  Protected File Edits
  [!] src/middleware/auth.test.ts (flagged: test file modification)
      Justification: Added tests for new auth middleware

  Diff Summary
  src/middleware/auth.ts        | +45 -0
  src/routes/login.ts           | +32 -2
  src/middleware/auth.test.ts   | +28 -0
  src/types/auth.ts             | +12 -0

  [View full diff: factory evidence --task T-001 --diff]
  [Approve: factory approve --task T-001]
  [Request changes: factory changes --task T-001 --feedback "..."]
```

### 3.5 Colors, Unicode, and Accessibility

- Detect `NO_COLOR` environment variable (https://no-color.org/) and disable color output
- Detect terminal capabilities (`TERM`, `COLORTERM`)
- Use `chalk` for color (respects `NO_COLOR` and `FORCE_COLOR`)
- Use unicode symbols with ASCII fallbacks for non-unicode terminals
- Use `--no-color` flag as override
- Test with screen readers (some terminal outputs are read aloud)

### 3.6 Configuration

Follow XDG Base Directory spec:
- Config: `~/.config/factory/config.toml` (or `$XDG_CONFIG_HOME/factory/`)
- Per-project: `.factory/config.toml` in repo root
- Environment variables: `FACTORY_API_KEY`, `FACTORY_API_URL`
- Flag override: `--api-key`, `--api-url`

Precedence: flags > env vars > project config > user config > defaults

Config format: TOML (human-readable, well-typed, standard for developer tools). JSON and YAML also viable.

### 3.7 Interactive Approval Workflow

For `factory approve`, use an interactive mode:

```
factory review --task T-001

  [Evidence summary displayed]

  What would you like to do?
  > Approve (create PR)
    Request changes
    Reject
    View full diff
    View test details
    Skip (decide later)
```

Use `@inquirer/prompts` (the modern, modular Inquirer.js) for interactive prompts. Falls back to `--approve` / `--reject` / `--changes` flags for non-interactive use.

---

## 4. OpenTelemetry Integration

### 4.1 Core Setup

Install the OTel SDK and auto-instrumentation packages:

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/api \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/exporter-metrics-otlp-grpc \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

Create `src/instrumentation.ts` loaded via `--import` before application code:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'software-factory',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 60_000,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Run with: `node --import ./src/instrumentation.ts src/index.ts`

**Source:** https://opentelemetry.io/docs/languages/js/getting-started/nodejs/

### 4.2 Temporal-Specific OTel Integration

The `@temporalio/interceptors-opentelemetry` package propagates tracing context across the full Temporal execution path: Client -> Workflow -> Child Workflows -> Activities.

**Key constraint:** Temporal workflows run in an isolated V8 sandbox for determinism. Standard Node.js OTel instrumentation does NOT work inside workflows. The interceptors package uses Temporal's "sinks" mechanism to export spans from the sandbox to the Node.js runtime.

**Client setup:**

```typescript
import { Client } from '@temporalio/client';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry';

const client = new Client({
  interceptors: {
    workflow: [new OpenTelemetryWorkflowClientInterceptor()],
  },
});
```

**Worker setup:**

```typescript
import { Worker } from '@temporalio/worker';
import { makeWorkflowExporter } from '@temporalio/interceptors-opentelemetry';

const worker = await Worker.create({
  taskQueue: 'factory-tasks',
  workflowsPath: require.resolve('./workflows'),
  sinks: makeWorkflowExporter(traceExporter, resource),
  interceptors: {
    workflowModules: [require.resolve('./workflow-interceptors')],
    activity: [(ctx) => ({ inbound: new OpenTelemetryActivityInboundInterceptor(ctx) })],
  },
});
```

**Worker metrics:** Temporal workers can emit metrics via Prometheus or OTel collector:

```typescript
const worker = await Worker.create({
  // ...
  telemetryOptions: {
    metrics: {
      prometheus: { bindAddress: '0.0.0.0:9464' },
      // OR
      otel: { url: 'http://otel-collector:4317' },
    },
  },
});
```

**Source:** https://docs.temporal.io/develop/typescript/observability, https://www.npmjs.com/package/@temporalio/interceptors-opentelemetry

### 4.3 Custom Spans for Factory-Specific Operations

Beyond auto-instrumentation, add manual spans for domain operations:

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('software-factory');

// LLM calls
async function callLLM(prompt: string): Promise<string> {
  return tracer.startActiveSpan('llm.call', async (span) => {
    span.setAttribute('llm.model', model);
    span.setAttribute('llm.provider', 'openrouter');
    try {
      const result = await openrouter.chat(prompt);
      span.setAttribute('llm.tokens.input', result.usage.prompt_tokens);
      span.setAttribute('llm.tokens.output', result.usage.completion_tokens);
      span.setAttribute('llm.cost', result.usage.cost);
      return result;
    } finally {
      span.end();
    }
  });
}
```

### 4.4 Metrics to Track

| Metric | Type | Purpose |
|--------|------|---------|
| `factory.task.duration` | Histogram | Time from task creation to merge |
| `factory.task.count` | Counter | Tasks by status (created, merged, failed) |
| `factory.llm.tokens` | Counter | Token usage by model/provider |
| `factory.llm.cost` | Counter | Dollar cost by model/provider |
| `factory.llm.latency` | Histogram | LLM call latency by model |
| `factory.evidence.review_time` | Histogram | Time in human review |
| `factory.sandbox.duration` | Histogram | Sandbox execution time |
| `factory.github.api_calls` | Counter | GitHub API calls by endpoint |
| `factory.credential.rotations` | Counter | Credential rotation count |

### 4.5 Structured Logging with Trace Correlation

Use Pino (fast, structured JSON logging) with OTel trace correlation:

```typescript
import pino from 'pino';

const logger = pino({
  mixin() {
    const span = trace.getActiveSpan();
    if (span) {
      const ctx = span.spanContext();
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    }
    return {};
  },
});
```

This automatically includes traceId/spanId in every log entry, enabling correlation between logs and traces.

### 4.6 Self-Hosted Observability Strategy

**For a self-hosted product, do NOT require external observability infrastructure.** The product must work without Jaeger/Grafana/etc.

Tiered approach:

1. **Built-in (default):** Console/file logging with structured JSON. `/health` endpoint with service status. `/metrics` endpoint (Prometheus format) for basic monitoring.
2. **Optional OTel export:** If `OTEL_EXPORTER_OTLP_ENDPOINT` is set, export traces/metrics to the configured collector. Zero-config: just set the env var.
3. **Optional full stack:** Docker Compose profile (`--profile observability`) that adds Jaeger + Grafana + OTel Collector. Not required, but available for users who want full observability.

```yaml
# docker-compose.yml
services:
  # ... core services ...

  otel-collector:
    profiles: ["observability"]
    image: otel/opentelemetry-collector-contrib
    # ...

  jaeger:
    profiles: ["observability"]
    image: jaegertracing/all-in-one
    # ...

  grafana:
    profiles: ["observability"]
    image: grafana/grafana
    # ...
```

Users opt in with: `docker compose --profile observability up -d`

**Source:** https://opentelemetry.io/docs/languages/js/getting-started/nodejs/

---

## 5. Redis Patterns

### 5.1 Connection Management (ioredis)

Use `ioredis` -- it is the standard Redis client for Node.js/TypeScript with full TypeScript support, Cluster, Sentinel, Pub/Sub, Lua scripting, and pipelining.

```typescript
import Redis from 'ioredis';

// Single connection for commands
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  lazyConnect: true,
});

// Separate connection for pub/sub (required by Redis protocol)
const redisSub = redis.duplicate();
```

**Critical note:** Redis Pub/Sub requires a dedicated connection. A connection in subscriber mode cannot issue other commands. Always create a separate connection for pub/sub.

**Source:** https://github.com/redis/ioredis

### 5.2 Pub/Sub for Real-Time Dashboard Updates

```typescript
// Publisher (in Activities / API handlers)
async function publishTaskUpdate(taskId: string, event: TaskEvent): Promise<void> {
  await redis.publish('factory:tasks', JSON.stringify({
    taskId,
    event,
    timestamp: Date.now(),
  }));
}

// Subscriber (in SSE endpoint / WebSocket handler)
redisSub.subscribe('factory:tasks', 'factory:system');

redisSub.on('message', (channel, message) => {
  const event = JSON.parse(message);
  // Forward to connected SSE/WebSocket clients
  broadcastToClients(channel, event);
});
```

Channel design:
- `factory:tasks` -- task state changes, evidence ready, approvals
- `factory:system` -- system health, circuit breaker trips
- `factory:task:{taskId}` -- per-task updates (for targeted subscriptions)

### 5.3 Kill Switch (R-025: Circuit Breaker)

The kill switch must be checked at every tool invocation. Use a simple Redis key check:

```typescript
const KILL_SWITCH_KEY = 'factory:kill_switch';
const TASK_KILL_KEY = (taskId: string) => `factory:kill:${taskId}`;

// Check before every tool invocation
async function isKilled(taskId: string): Promise<boolean> {
  const [globalKill, taskKill] = await redis.mget(
    KILL_SWITCH_KEY,
    TASK_KILL_KEY(taskId),
  );
  return globalKill === '1' || taskKill === '1';
}

// Activate kill switch
async function killAll(): Promise<void> {
  await redis.set(KILL_SWITCH_KEY, '1');
  await redis.publish('factory:system', JSON.stringify({
    type: 'kill_switch_activated',
    scope: 'global',
  }));
}

// Activate per-task kill
async function killTask(taskId: string): Promise<void> {
  await redis.set(TASK_KILL_KEY(taskId), '1');
  await redis.publish('factory:system', JSON.stringify({
    type: 'kill_switch_activated',
    scope: 'task',
    taskId,
  }));
}
```

**Performance:** `MGET` is O(N) for N keys, extremely fast. Checking two keys per tool invocation adds negligible latency (sub-millisecond on localhost).

### 5.4 Branch Leases with TTL (R-002: Concurrency)

The "one active mutator per branch" rule uses Redis SETNX + EXPIRE:

```typescript
const BRANCH_LEASE_PREFIX = 'factory:branch_lease:';
const LEASE_TTL_SECONDS = 3600; // 1 hour

async function acquireBranchLease(
  branch: string,
  taskId: string,
): Promise<boolean> {
  const key = `${BRANCH_LEASE_PREFIX}${branch}`;
  // Atomic SET NX EX -- sets only if key does not exist
  const result = await redis.set(key, taskId, 'EX', LEASE_TTL_SECONDS, 'NX');
  return result === 'OK';
}

async function renewBranchLease(
  branch: string,
  taskId: string,
): Promise<boolean> {
  // Lua script: renew only if we own the lease
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("expire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;
  const result = await redis.eval(script, 1,
    `${BRANCH_LEASE_PREFIX}${branch}`, taskId, LEASE_TTL_SECONDS);
  return result === 1;
}

async function releaseBranchLease(
  branch: string,
  taskId: string,
): Promise<boolean> {
  // Lua script: delete only if we own the lease
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  const result = await redis.eval(script, 1,
    `${BRANCH_LEASE_PREFIX}${branch}`, taskId);
  return result === 1;
}
```

**Why Lua scripts for release/renew:** Prevents race conditions. Without atomic check-and-delete, a task could release another task's lease if its own lease expired and was re-acquired.

**Source:** https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/

### 5.5 Session State

For CLI/dashboard session state, use Redis with expiring keys:

```typescript
const SESSION_PREFIX = 'factory:session:';
const SESSION_TTL = 86400; // 24 hours

async function createSession(apiKey: string, metadata: SessionMetadata): Promise<string> {
  const sessionId = crypto.randomUUID();
  await redis.set(
    `${SESSION_PREFIX}${sessionId}`,
    JSON.stringify({ apiKey, ...metadata }),
    'EX', SESSION_TTL,
  );
  return sessionId;
}
```

---

## 6. Notification System

### 6.1 Architecture

Extensible notification router with pluggable channels:

```
Event Source (Temporal Activity / API)
    |
    v
Notification Router
    |
    +-- Rate Limiter (per channel, per category)
    |
    +-- Channel: Slack Webhook
    +-- Channel: Discord Webhook (future)
    +-- Channel: Email (future)
    +-- Channel: Custom Webhook (future)
```

### 6.2 Notification Categories (R-022)

| Category | Urgency | Default Delivery | Example |
|----------|---------|------------------|---------|
| **Blocked review** | Real-time | Immediate | "Task T-001 evidence ready for review" |
| **Circuit breaker trip** | Real-time | Immediate | "Kill switch activated: budget exceeded" |
| **External failure** | Real-time | Immediate | "Task T-001 blocked: required check failed" |
| **Cost warning** | Real-time | Immediate | "Task T-001 at 80% budget ($8.00/$10.00)" |
| **Task completion** | Normal | Batched (configurable) | "Task T-001 merged successfully" |
| **System health** | Normal | Batched | "Daily digest: 5 tasks completed, 1 failed" |

### 6.3 Slack Webhook Integration

```typescript
interface SlackNotifier {
  send(message: SlackMessage): Promise<void>;
}

// Rate limit: 1 message per second per webhook URL
// Slack returns HTTP 429 with Retry-After header on exceeding
class SlackWebhookNotifier implements SlackNotifier {
  private readonly webhookUrl: string;
  private readonly rateLimiter: RateLimiter; // token bucket, 1/sec

  async send(message: SlackMessage): Promise<void> {
    await this.rateLimiter.acquire();
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '30');
      await delay(retryAfter * 1000);
      return this.send(message); // Retry once
    }
  }
}
```

**Source:** https://docs.slack.dev/apis/web-api/rate-limits/

### 6.4 Rate Limiting Strategy

- Token bucket rate limiter: 1 token per second per webhook URL
- Exponential backoff with jitter on HTTP 429
- Message batching for non-urgent categories: collect messages for 5 minutes, send as single digest
- Deduplication: same notification within 60 seconds is suppressed (e.g., multiple budget warnings)
- Dead-letter queue: messages that fail after 3 retries are logged to audit trail

### 6.5 Extensible Channel Interface

```typescript
interface NotificationChannel {
  readonly name: string;
  send(notification: Notification): Promise<void>;
  supports(category: NotificationCategory): boolean;
}

interface NotificationRouter {
  register(channel: NotificationChannel): void;
  notify(notification: Notification): Promise<void>;
}
```

New channels are registered at startup. Each channel declares which categories it supports. The router fans out to all matching channels.

---

## 7. SvelteKit Dashboard (Phase 2 Planning)

### 7.1 Real-Time Architecture

Two options for real-time updates:

| Approach | Direction | Complexity | Best For |
|----------|-----------|------------|----------|
| **SSE (Server-Sent Events)** | Server -> Client only | Low | Read-heavy dashboards, monitoring |
| **WebSocket** | Bidirectional | Medium | Interactive features, commands |

**Recommendation:** Use SSE for the primary dashboard feed. The review inbox is primarily read-heavy (display evidence, show status updates). Commands (approve, reject, kill) go through the REST API. SSE is simpler, auto-reconnects, and works through proxies without special configuration.

SvelteKit 2.19+ has native WebSocket support for cases where bidirectional communication is needed (e.g., interactive terminal output).

**Source:** https://sveltetalk.com/posts/building-real-time-sveltekit-apps-with-server-sent-events

### 7.2 SSE Endpoint Pattern

```typescript
// src/routes/api/events/+server.ts
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };

  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to Redis pub/sub
      const redisSub = createRedisSubscriber();
      redisSub.subscribe('factory:tasks', 'factory:system');

      redisSub.on('message', (channel, message) => {
        const chunk = `event: ${channel}\ndata: ${message}\n\n`;
        controller.enqueue(new TextEncoder().encode(chunk));
      });

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        redisSub.unsubscribe();
        redisSub.quit();
        controller.close();
      });
    },
  });

  return new Response(stream, { headers });
};
```

### 7.3 Review Inbox as Primary View

The PRD (R-019) specifies the review inbox as the primary dashboard view. It should display:

- Tasks awaiting review (evidence_ready state)
- Dual-boundary status: internal evidence vs. external merge readiness
- Task cards with summary: objective, blast radius, test results, cost
- Expand to full evidence view
- Action buttons: approve, request changes, reject
- Filter/sort by: urgency, age, repo, assignee

### 7.4 Shared Types Between Backend and Frontend

Since both backend and frontend are TypeScript, share types via a common package:

```
packages/
  shared/              # Shared types package
    src/
      types/
        task.ts        # Task, TaskStatus, TaskEvent
        evidence.ts    # EvidenceBundle, EvidenceField
        review.ts      # ReviewState, ReviewAction
        notification.ts
        api.ts         # API request/response types
```

Use a monorepo tool (npm workspaces, turborepo, or nx) to share the types package between backend and frontend.

### 7.5 Authentication

Same API key auth as CLI (R-018). The dashboard sends the API key as a Bearer token in the Authorization header. For the SSE connection, pass the API key as a query parameter (SSE does not support custom headers from the browser's EventSource API).

```typescript
// Client-side
const eventSource = new EventSource(`/api/events?token=${apiKey}`);
```

Consider switching to cookie-based sessions for the dashboard to avoid exposing the API key in URLs.

---

## 8. Upgrade and Maintenance

### 8.1 Semantic Versioning

Use strict semver: `MAJOR.MINOR.PATCH`

- **MAJOR:** Breaking changes (schema migrations that alter existing tables, config format changes, API breaking changes)
- **MINOR:** New features, backwards-compatible schema additions
- **PATCH:** Bug fixes, security patches

### 8.2 Database Migration Strategy

Use a migration tool that supports:
- Forward-only migrations (numbered, sequential)
- Transactional DDL (PostgreSQL supports this)
- Migration status tracking table
- CLI command: `factory migrate` / `factory migrate --status`

Recommended tool: **node-pg-migrate** or **Drizzle Kit** (if using Drizzle ORM) or **Prisma Migrate** (if using Prisma).

Migration rules:
1. Migrations are append-only. Never edit a migration after it has been released.
2. Backwards-compatible migrations where possible (add columns, add tables).
3. Multi-phase for destructive changes: (a) add new column, (b) backfill, (c) remove old column in next version.
4. Document which versions are "hard stops" requiring sequential upgrade.

### 8.3 Breaking Change Handling

When a breaking change is unavoidable:
1. Bump MAJOR version
2. Document in CHANGELOG with migration guide
3. The `factory upgrade` command checks current version, target version, and refuses to skip hard stops
4. Pre-upgrade validation: check that current state is compatible with target version

### 8.4 Changelog Generation

Use Conventional Commits (`feat:`, `fix:`, `breaking:`) and auto-generate changelogs. Tools: `changesets` (recommended for monorepos) or `conventional-changelog`.

### 8.5 Health Check Endpoints

```
GET /health          -> { status: "ok", version: "1.2.0" }
GET /health/ready    -> { postgres: "ok", redis: "ok", temporal: "ok", minio: "ok" }
GET /health/live     -> { status: "ok" }  (for container orchestrators)
```

- `/health/live` -- is the process running? (for Docker health checks)
- `/health/ready` -- can the service accept work? (all dependencies healthy)
- `/health` -- summary with version info

---

## 9. Documentation Strategy

### 9.1 What a Self-Hosted Product Needs

| Document | Priority | Audience | Purpose |
|----------|----------|----------|---------|
| **Getting Started** | P0 | New users | Install and run first task in <15 minutes |
| **Architecture Overview** | P0 | Builders, contributors | How the system works, data flow, boundaries |
| **Configuration Reference** | P0 | Operators | Every config option, env var, secret |
| **CLI Reference** | P0 | Users | Every command, flag, example |
| **API Reference** | P1 | Integrators | REST API endpoints, request/response types |
| **Troubleshooting** | P0 | Operators | Common errors, diagnostic commands, FAQ |
| **Upgrade Guide** | P0 | Operators | Version-specific upgrade instructions |
| **Security Model** | P1 | Security reviewers | Threat model, controls, boundaries |
| **Contributing** | P1 | Contributors | Dev setup, PR process, architecture decisions |
| **Concepts/Glossary** | P1 | All | Domain terminology, design principles |

### 9.2 Documentation Tool Recommendation

| Tool | Framework | Pros | Cons |
|------|-----------|------|------|
| **VitePress** | Vue | Fast (Vite), clean default theme, lightweight | Smaller ecosystem |
| **Docusaurus** | React | Versioning, i18n, plugin ecosystem, Algolia search | Heavier, React dependency |
| **Mintlify** | Custom | Beautiful defaults, API reference generation | Hosted SaaS (conflicts with self-hosted ethos) |
| **Plain Markdown** | None | Zero dependencies, GitHub-rendered | No search, no navigation, poor UX |

**Recommendation:** **VitePress** for documentation. Rationale:
- TypeScript/Vue alignment with SvelteKit is closer than React/Docusaurus
- Lightning-fast build (sub-second HMR)
- Clean, professional default theme
- Lightweight -- does not add a heavy framework dependency
- Excellent code block support (syntax highlighting, line highlighting, code groups)
- Good enough for the project's scale; Docusaurus's extra features (versioning, i18n) are not needed initially

Alternative: plain Markdown in `/docs` for Phase 1 (zero overhead), VitePress when docs become user-facing.

### 9.3 Getting Started Guide Structure

```
1. Prerequisites (Docker, Docker Compose, git)
2. Clone the repository
3. Run the install script
4. Configure GitHub App
5. Submit your first task
6. Review evidence and approve
7. Watch the PR get created
8. Next steps (configuration, onboarding more repos)
```

Target: a new user should go from zero to first task submission in under 15 minutes. This is the single most important document for adoption.

---

## 10. Key Decisions and Recommendations

### 10.1 Decisions That Can Be Made Now

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| CLI framework | oclif | Plugin arch, TypeScript, shell completions, proven at scale |
| Redis client | ioredis | Standard, full TypeScript support, Pub/Sub, Lua scripting |
| OTel approach | Tiered (built-in default, optional export, optional full stack) | Self-hosted products must not require external infra |
| Logging | Pino with OTel trace correlation | Fast, structured JSON, trace IDs in every log line |
| Secret handling | Docker Compose file-based secrets | Safer than env vars; document the encryption limitation |
| Documentation | VitePress (or plain Markdown for Phase 1) | Lightweight, fast, TypeScript-aligned |
| Config format | TOML | Human-readable, well-typed, standard for dev tools |
| Dashboard real-time | SSE (primary) + REST API (commands) | Simpler than WebSocket for read-heavy dashboard |
| Migration tool | Decide with ORM choice (Drizzle Kit, Prisma Migrate, or node-pg-migrate) | Depends on data layer decision |
| Notification arch | Channel-based router with rate limiting | Extensible, prevents spam |

### 10.2 Decisions That Depend on Other Choices

| Decision | Depends On | Options |
|----------|-----------|---------|
| Database migration tool | ORM choice | Drizzle Kit, Prisma Migrate, node-pg-migrate |
| Monorepo structure | Whether dashboard and backend share a repo | npm workspaces, turborepo |
| Shared types strategy | Monorepo decision | Shared package vs. generated types |

### 10.3 Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Docker Compose secrets not encrypted at rest | Document limitation; operator responsible for host security; KMS integration for app-level encryption |
| MinIO Docker Hub images deprecated | Use Chainguard image or quay.io; document in install guide |
| Temporal auto-setup not production-ready | Use auto-setup for schema init only, then switch to temporalio/server |
| Slack webhook rate limit (1/sec) | Message batching, rate limiter with token bucket, dedup |
| SSE browser connection limits (6 per domain) | Use a single SSE connection multiplexing all event types |
| OTel overhead in production | Make OTel export optional; built-in metrics endpoint is lightweight |

---

## 11. Files Referenced

- `/Users/seanflanagan/proj/software-factory/docs/prd.md` -- PRD v5.1 (Sections 5.2, 8, 11, 17)
- `/Users/seanflanagan/proj/software-factory/.claude/plans/research.md` -- Prior research on Temporal event history
- `/Users/seanflanagan/proj/software-factory/.claude/rules/immutable.md` -- Immutable rules (user control, security-first, transparency)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/stack.md` -- Stack decisions (all TBD)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/conventions.md` -- Code conventions

## 12. External Sources Consulted

- https://docs.docker.com/compose/how-tos/use-secrets/ (Docker Compose secrets)
- https://last9.io/blog/docker-compose-health-checks/ (health check patterns)
- https://oneuptime.com/blog/post/2026-02-02-docker-resource-limits/view (resource limits)
- https://github.com/temporalio/docker-compose (Temporal Docker Compose reference)
- https://hub.docker.com/r/temporalio/auto-setup (auto-setup vs production)
- https://temporal.io/blog/auto-setup (auto-setup explained)
- https://docs.temporal.io/develop/typescript/observability (Temporal OTel)
- https://www.npmjs.com/package/@temporalio/interceptors-opentelemetry (interceptors package)
- https://github.com/temporalio/samples-typescript/tree/main/interceptors-opentelemetry (OTel sample)
- https://opentelemetry.io/docs/languages/js/getting-started/nodejs/ (OTel Node.js setup)
- https://develop.sentry.dev/self-hosted/ (Sentry self-hosted distribution)
- https://docs.gitlab.com/install/docker/installation/ (GitLab Docker install)
- https://docs.gitlab.com/install/docker/upgrade/ (GitLab Docker upgrade)
- https://cal.com/docs/self-hosting/docker (Cal.com self-hosted)
- https://oclif.io/ (oclif CLI framework)
- https://github.com/redis/ioredis (ioredis client)
- https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/ (Redis distributed locks)
- https://docs.slack.dev/apis/web-api/rate-limits/ (Slack rate limits)
- https://sveltetalk.com/posts/building-real-time-sveltekit-apps-with-server-sent-events (SvelteKit SSE)
- https://github.com/minio/minio/issues/18389 (MinIO health check)
- https://no-color.org/ (NO_COLOR standard)
