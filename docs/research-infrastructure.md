# Infrastructure Research: Complete Implementation Reference

**Date:** 2026-03-18
**PRD Version:** 5.1
**Purpose:** Single consolidated reference for all infrastructure decisions, schemas, configurations, and implementation patterns. Every detail from the research phase preserved for milestone planning.

---

## 1. Consolidated Technology Stack

| Layer | Package(s) | Version | Notes |
|-------|-----------|---------|-------|
| Runtime | Node.js | 22+ | Node 18 dropped in Temporal SDK v1.15.0 |
| Language | TypeScript | strict mode | `@tsconfig/node22` base |
| Package Manager | pnpm | 10+ | strict deps, workspace-native |
| Monorepo | pnpm workspaces | -- | No Turborepo initially; 6 packages sufficient for Phase 1 |
| Orchestration | `@temporalio/workflow`, `@temporalio/activity`, `@temporalio/client`, `@temporalio/worker`, `@temporalio/testing` | 1.14.x-1.15.x | **All `@temporalio/*` packages MUST have the same version number** (enforced by peer deps) |
| Primary DB | PostgreSQL | 16 | with `pgcrypto` extension; `pgvector` installed early for Phase 3 |
| ORM | `drizzle-orm` + `drizzle-orm/node-postgres` | latest | SQL-first, TypeScript schemas, ~5KB bundle, ~12% overhead |
| DB Driver | `pg` (node-postgres) | latest | `pg.Pool` with `max: 20` as starting point |
| Cache/PubSub | Redis | 7 | `redis:7-alpine` image |
| Redis Client | `ioredis` | latest | Full TS support, Pub/Sub requires separate connection, Lua scripting |
| Object Store | MinIO | latest | **Use `quay.io/minio/minio` or Chainguard -- Docker Hub deprecated Oct 2025** |
| LLM SDK | `ai` (Vercel AI SDK) + `@openrouter/ai-sdk-provider` | latest | Unified interface, OTel telemetry built in, `prepareStep` for dynamic context |
| GitHub Client | `@octokit/rest` + `@octokit/auth-app` + `@octokit/webhooks` + `@octokit/graphql` | latest | REST for CRUD, **GraphQL required** for merge queue + review threads + auto-merge + stale review detection |
| Docker Client | `dockerode` + `@types/dockerode` | 4.x | Promise API, stream demux, zero meaningful deps |
| Code Parser | `tree-sitter` (native N-API) | latest | ~280K weekly downloads; WASM fallback via `web-tree-sitter` if native fails |
| Phase 1 Grammars | `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java` | latest | Official, mature |
| Glob Matching | `picomatch` | latest | 0 deps, ReDoS-safe, 220M weekly downloads; `minimatch` has CVE-2022-3517 |
| Validation | `zod` | latest | `safeParse` at boundaries, derive types via `z.infer` |
| Error Handling | `neverthrow` | latest | ~2KB, `Result<T, E>`; maintenance has slowed (late 2025), monitor |
| CLI | `commander` + `ink` + `ink-ui` | latest | Commander 25ms startup vs oclif 135ms; Ink for TUI evidence review |
| Testing | `vitest` + `@temporalio/testing` + `@testcontainers/postgresql` | latest | ESM-native, time-skipping, real Postgres in tests |
| Linter/Formatter | `biome` | latest | Single tool replaces ESLint+Prettier; ~80% ESLint rule coverage; 10-25x faster |
| Build (dev) | `tsx` | latest | esbuild-based, zero config |
| Build (prod) | `tsup` (or `tsdown`) + `build-temporal-workflow` | latest | `build-temporal-workflow` is esbuild-based, 9-11x faster than Webpack default for Temporal workflows |
| Logging | `pino` | latest | Fast structured JSON, OTel trace correlation via `mixin()` |
| Observability | `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@temporalio/interceptors-opentelemetry` | latest | Tiered: built-in default, optional OTel export, optional full Grafana stack |
| Token Counting | `js-tiktoken` | latest | For offline pre-flight estimates only; always use API response for billing |
| Dashboard (Phase 2) | SvelteKit | latest | SSE for real-time, REST API for commands |
| Documentation (Phase 2) | VitePress | latest | Plain Markdown for Phase 1 |

---

## 2. Monorepo Architecture

### 2.1 Package Layout (6 packages)

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

### 2.2 Package Dependency Graph

```
core
  |-- db (core)
  |-- temporal-workflows (core -- types/schemas only, NO Node.js)
  |-- temporal-activities (core, db)
  |-- worker (temporal-workflows, temporal-activities, core, db)
  |-- cli (core, db)
```

### 2.3 Critical Structural Constraint: Temporal Workflows

- Workflow code runs in a V8 isolate sandbox
- CANNOT import Node.js APIs (`fs`, `http`, `crypto`, etc.)
- CANNOT import activity code directly -- use `proxyActivities<T>()` with type-only imports
- `Math.random()`, `Date`, `setTimeout()` replaced with deterministic versions
- `FinalizationRegistry` and `WeakRef` are removed
- CAN import pure TypeScript packages (e.g., `core`) as long as nothing in the import chain references Node.js
- Bundled with Webpack by default; use `build-temporal-workflow` (esbuild) for 9-11x faster bundling

### 2.4 TypeScript Configuration (tsconfig.base.json)

Key settings: `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `lib: [ES2024]`, all strict flags enabled, `verbatimModuleSyntax: true` (enforces `import type` -- CRITICAL for Temporal), `composite: true` for incremental builds.

### 2.5 "Live Types" Pattern

Internal packages export TypeScript source directly during dev. Point `exports` in package.json at `.ts` files. Only `temporal-workflows` and `cli` need production builds.

### 2.6 Dependency Injection

Closure-based factory functions (Temporal's official pattern). No DI container. Activities created via `createXActivities(deps)`, spread into Worker's activities config.

---

## 3. Temporal Orchestration

### 3.1 Workflow Architecture: Parent Orchestrator + Child Phases

Parent spawns child workflows per phase. ~104 events for parent (13 phases x 8 events each). Well within 51,200 limit. Each child can Continue-As-New independently.

Phase list: IntakePhase, UnderstandPhase, PlanPhase, SetupPhase, ImplementPhase (may CAN internally), ValidatePhase, EvidencePhase, ReviewPhase (waits for human signal, 7-day timeout), PRCreationPhase, PRTrackingPhase (waits for GitHub events), LearnPhase.

### 3.2 Activity Timeout Profiles

| Activity Type | startToClose | scheduleToClose | heartbeat | maxAttempts |
|---------------|-------------|----------------|-----------|------------|
| DB writes | 30s | -- | -- | 5 |
| GitHub API | 2m | -- | -- | 10, backoff 2x |
| LLM calls | 5m | 30m | -- | 8, backoff 2x |
| Docker ops | 15m | -- | 30s | 3 |

### 3.3 Task Queues (5)

- `sf-orchestration` (workflows, 100 concurrent)
- `sf-llm` (20 concurrent, 10/sec rate limit, 30s shutdown grace)
- `sf-docker` (5 concurrent, 10s heartbeat throttle)
- `sf-github`
- `sf-db`

### 3.4 Key Patterns

- **Human approval:** Signal + `wf.condition(allHandlersFinished)` + 7-day timeout
- **Kill switch:** Signal-based (zero event cost), check before every activity
- **Continue-As-New:** trigger at `continueAsNewSuggested` OR `historyLength > 10_000`; re-register handlers; drain with `allHandlersFinished`; never call from signal handler
- **Idempotent writes:** `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`
- **Concurrent handlers:** `async-mutex` (safe in sandbox)
- **Rate limit retry:** `ApplicationFailure.create({ nextRetryDelay: '60s' })`
- **Cleanup on cancel:** `CancellationScope.nonCancellable(async () => { ... })`
- **Patching:** `patched('name')` / `deprecatePatch('name')` for safe code changes
- **Workflow ID:** `task-{taskId}` (orchestrator), `task-{taskId}-{phase}` (children)

### 3.5 Testing

- `TestWorkflowEnvironment.createTimeSkipping()` for time-skipping
- `MockActivityEnvironment` for unit testing activities
- `Worker.runReplayHistory` for determinism verification
- Bulk replay: `Worker.runReplayHistories` with `client.workflow.list().intoHistories()`

---

## 4. Docker Sandbox

### 4.1 Docker Client Library: dockerode

**Package:** `dockerode` v4.0.9
**Types:** `@types/dockerode` v4.0.0 (DefinitelyTyped)

Why dockerode:
- Most widely used Node.js Docker client
- Wraps Docker Engine REST API at `/var/run/docker.sock`
- Promise-based API, async/await compatible
- Full TypeScript types: `ContainerCreateOptions`, `HostConfig`, `ExecCreateOptions`, `NetworkCreateOptions`
- Stream demultiplexing (stdout/stderr separation) built in
- Zero meaningful external dependencies (only `@balena/dockerignore`, `docker-modem`, `tar-fs`)
- Containers, images, networks, volumes, and execs are all first-class entities

#### Core API Surface

| Operation | API Call | Notes |
|-----------|----------|-------|
| Create container | `docker.createContainer(options)` | Returns Container object |
| Start container | `container.start()` | |
| Execute command | `container.exec(execOptions)` | Per-phase secret injection via `Env` field |
| Stop container | `container.stop({ t: 10 })` | `t` = timeout in seconds |
| Remove container | `container.remove({ force: true, v: true })` | `v: true` removes volumes |
| Snapshot/cache | `container.commit({ repo, tag })` | Filesystem-only snapshot |
| Stats (single) | `container.stats({ stream: false })` | Single snapshot, not streaming |
| Logs (streaming) | `container.logs({ follow: true, stdout: true, stderr: true })` | |
| Create network | `docker.createNetwork({ Name, Internal })` | `Internal: true` = no gateway |
| Connect network | `network.connect({ Container: id })` | Works on running containers |
| Disconnect network | `network.disconnect({ Container: id })` | Works on running containers, no restart needed |
| Pull image | `docker.pull('node:22-slim')` | Returns stream |
| Build image | `docker.buildImage(tarStream, { t: tag })` | |
| Events | `docker.getEvents({ filters })` | For lifecycle monitoring |
| Stream demux | `docker.modem.demuxStream(stream, stdout, stderr)` | Separates stdout/stderr |

#### HostConfig Options (from @types/dockerode)

| Option | Type | Purpose |
|--------|------|---------|
| `NetworkMode` | `string` | `'none'`, `'bridge'`, or network name |
| `CapDrop` | `string[]` | Linux capabilities to drop |
| `CapAdd` | `string[]` | Linux capabilities to add |
| `SecurityOpt` | `string[]` | Security options (seccomp, no-new-privileges) |
| `ReadonlyRootfs` | `boolean` | Read-only root filesystem |
| `Tmpfs` | `Record<string, string>` | tmpfs mounts: `{ '/tmp': 'rw,noexec,size=256m' }` |
| `Memory` | `number` | Memory limit in bytes |
| `NanoCpus` | `number` | CPU limit (1e9 = 1 CPU) |
| `PidsLimit` | `number` | Max PIDs (fork bomb protection) |
| `Binds` | `string[]` | Volume mounts: `['/host/path:/container/path:rw']` |
| `UsernsMode` | `string` | User namespace mode |
| `StorageOpt` | `Record<string, string>` | `{ size: '10G' }` (requires XFS + overlay2) |

#### ExecCreateOptions (for phase separation)

| Option | Type | Purpose |
|--------|------|---------|
| `Cmd` | `string[]` | Command to execute |
| `Env` | `string[]` | Environment variables (override/add for this exec only) |
| `User` | `string` | User to run as |
| `WorkingDir` | `string` | Working directory |
| `AttachStdin` | `boolean` | Attach stdin |
| `AttachStdout` | `boolean` | Attach stdout |
| `AttachStderr` | `boolean` | Attach stderr |

Alternative: Docker REST API directly via `node:http` or `undici` to `/var/run/docker.sock`, but offers no advantage. dockerode handles stream management, multiplexing, and error handling. Only reason to go direct would be eliminating the dependency, but dockerode has zero external dependencies itself.

### 4.2 Network Isolation: Phase-Separated Networking

#### Network Modes

| Mode | `NetworkMode` value | Behavior | Factory Use |
|------|---------------------|----------|-------------|
| `none` | `'none'` | Only loopback. Zero external connectivity. | **Execution phase default** |
| `bridge` | `'bridge'` | Default bridge with NAT to host. Full outbound. | Setup phase (unrestricted) |
| Custom bridge | Network name string | User-defined bridge. DNS between containers. | Setup phase (controlled) |
| Internal | Network with `internal: true` | Bridge with no gateway. Container-to-container only. | **Allowlist architecture** (internal + proxy) |

#### Two Approaches (Composable)

**Approach A: Network Swap (V1 default, recommended)**

1. Create container on bridge network (setup phase)
2. Run setup commands with network access
3. `bridge.disconnect({ Container: container.id })` -- disconnect from bridge
4. Container now has only loopback (no network)
5. Run execution phase

Key implementation detail: dockerode `network.connect()` and `network.disconnect()` work on **running containers without restart**.

Code pattern:
```typescript
// Setup phase
const container = await docker.createContainer({
  Image: 'node:22-slim',
  HostConfig: { NetworkMode: 'bridge' }
});
await container.start();
// ... run setup commands via exec ...

// Transition to execution phase
const bridge = docker.getNetwork('bridge');
await bridge.disconnect({ Container: container.id });
// Container now has no network access (only loopback)
```

**Approach B: Squid Proxy Allowlist (for configurable domain access)**

Architecture:
```
[Agent Container] --internal-network--> [Squid Proxy] --external-network--> Internet
```

- Internal network has `internal: true` (no gateway -- agent cannot bypass proxy)
- Squid container connected to both internal and external networks
- Agent container uses `http_proxy`/`https_proxy` env vars pointing to Squid

Squid ACL config:
```
acl allowed_domains dstdomain .api.openrouter.ai
acl allowed_domains dstdomain .api.openai.com
acl SSL_ports port 443
acl CONNECT method CONNECT
http_access allow CONNECT SSL_ports allowed_domains
http_access allow allowed_domains
http_access deny all
http_port 3128
```

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| Network swap | Simple, zero overhead, no extra containers | Binary: full network or none. No per-domain control. |
| Squid proxy | Domain-level allowlisting, HTTPS, audit logging | Extra container, proxy config management, slight latency |

**Recommendation:** V1 uses Approach A. Add Approach B when allowlist feature needed. The two compose: no-network containers get disconnected; allowlist containers get the proxy.

#### DNS Details

- User-defined bridge networks: embedded DNS (container name resolution)
- `none` network: no DNS (only loopback)
- Squid proxy approach: proxy resolves domains on behalf of client (handles DNS transparently)
- **Gotcha (Phase 3):** gVisor has DNS issues with user-defined bridges -- uses `127.0.0.10` loopback DNS which gVisor cannot reach

### 4.3 Secret Injection: Phase-Separated, Exec-Based

#### Reference Implementation: OpenAI Codex Pattern

Codex implements exactly the PRD's pattern:
- Setup phase: secrets as env vars, network enabled
- Agent phase: secrets removed, network disabled
- Setup scripts run in **separate Bash session** from agent (`export` does not persist)
- Cache invalidated when secrets, setup scripts, or env vars change
- All outbound traffic during agent phase routes through HTTP/HTTPS proxy

#### Exec-Based Injection (Recommended)

Inject secrets per-exec, not per-container:

```typescript
// Phase 1: Setup (secrets available)
const setupExec = await container.exec({
  Cmd: ['sh', '-c', 'npm ci && npx playwright install'],
  Env: [
    'NPM_TOKEN=secret-value-here',
    'GITHUB_TOKEN=ghp_xxx',
  ],
  AttachStdout: true,
  AttachStderr: true,
});
// Secrets exist ONLY in this exec process's environment

// Phase 2: Execution (no setup secrets, runtime secrets only)
const agentExec = await container.exec({
  Cmd: ['node', 'agent.js'],
  Env: [
    'DATABASE_URL=postgres://...',  // runtime secret only
    // NPM_TOKEN is NOT here
  ],
  AttachStdout: true,
  AttachStderr: true,
});
```

**Why exec-based injection is superior to container-level env vars:**
1. **No persistence in image:** `docker exec -e` injects env vars only into that process. Not visible via `docker inspect`.
2. **No layer leakage:** Unlike `docker commit`, exec-injected env vars are NOT captured in committed images.
3. **Clean separation:** Each exec gets exactly its declared secrets.
4. **Process isolation:** Env vars live only in `/proc/[pid]/environ`. Gone when process exits.

#### Per-Tool Secret Injection

PRD specifies per-tool secrets (e.g., `GITHUB_TOKEN` only when `gh` CLI invoked):

```typescript
const ghExec = await container.exec({
  Cmd: ['gh', 'pr', 'list'],
  Env: ['GITHUB_TOKEN=ghp_xxx'],
  User: 'agent',
  WorkingDir: '/workspace',
});
// GITHUB_TOKEN exists ONLY in this gh process
```

Narrowest possible secret scope -- each tool invocation gets only its declared secrets.

#### Alternative: tmpfs-Mounted Secret Files

For file-based secrets (mirrors Docker Swarm's `/run/secrets/` without Swarm mode):

```typescript
HostConfig: {
  Tmpfs: { '/run/secrets': 'rw,noexec,nosuid,size=1m' },
}
// Write secrets to /run/secrets/ via exec
// Clear /run/secrets/ contents before agent phase via exec
```

#### Secret Hygiene Rules

- Never pass secrets via `docker run -e` (visible in `docker inspect`, process table)
- Never bake secrets into images via `ENV` in Dockerfile
- Never write secrets to logs, audit content, or evidence bundles
- Use `docker exec -e` for per-process injection (not visible in `docker inspect`)
- Use tmpfs-mounted files for file-based secrets
- Secrets in Postgres must be envelope-encrypted (PRD Section 7.2)

### 4.4 Environment Caching via Docker Commit

#### What Docker Commit Captures vs. Does Not

**Captured:**
- Filesystem changes (installed packages, built artifacts, node_modules)
- Container configuration (ENV, WORKDIR, USER, CMD, ENTRYPOINT, EXPOSE, LABEL) via `--change`

**NOT captured:**
- Mounted volume contents
- Running process state / memory
- Network configuration
- Secrets injected via `docker exec -e`

#### Caching Workflow

```
1. Pull/build base image (from .factory/setup.yml `image` field)
2. Create container from base image
3. Run setup commands (npm ci, etc.) with setup-only secrets
4. Secrets already gone (exec-injected, process exited)
5. docker commit -> factory-cache/{repo}:{setup-hash}
6. Store locally (or push to local registry)
7. Next task: create container from cached image, run maintenance commands
```

#### Cache Key Generation

```typescript
const cacheKey = sha256(JSON.stringify({
  image: setupContract.image,
  setup: setupContract.setup,
  maintenance: setupContract.maintenance,
  secretBindings: Object.keys(setupContract.secrets.setup_only).sort(),
  controlFileHashes: getControlFileHashes(),
}));
```

**Cache invalidation triggers:**
- Setup contract changes (`.factory/setup.yml`)
- Maintenance script changes
- Secret binding name changes (NOT values -- value changes do not invalidate)
- Behavioral control file changes

#### Commit Details

- Container is **paused** during commit by default (prevents corruption)
- `--change` flag applies Dockerfile instructions to committed image
- Use `changes: ['ENV NPM_TOKEN=']` to clear any leaked env vars (belt-and-suspenders)

```typescript
await container.commit({
  repo: `factory-cache/${repoSlug}`,
  tag: cacheKey,
  comment: `Factory environment cache for ${repoSlug}`,
  changes: [
    'ENV NPM_TOKEN=',  // Clear any leaked env vars
  ],
});
```

#### Layer Caching for Image Builds (BuildKit)

When setup contract specifies a Dockerfile:
- Unchanged layers reused from cache
- Order instructions from least to most frequently changing
- Use `--mount=type=cache` for package manager caches (npm, pip)
- Multi-stage builds separate build-time from runtime dependencies

#### CRIU Checkpoint/Restore (Future Only)

Experimental in Docker since v1.13. Captures full process state including memory, open files, network. **NOT recommended for V1.** Only relevant for Phase 3+ long-running task checkpointing (PRD R-027).

### 4.5 Security Hardening Profile

#### Recommended HostConfig

```typescript
const secureHostConfig: Docker.HostConfig = {
  // Drop ALL capabilities, add back only what's needed
  CapDrop: ['ALL'],
  CapAdd: [
    // Most agent workloads: none needed
    // For git operations: might need CHOWN, DAC_OVERRIDE, FOWNER
  ],

  // Prevent privilege escalation via setuid/setgid
  SecurityOpt: [
    'no-new-privileges:true',
    // Default seccomp profile auto-applied (blocks ~44 dangerous syscalls)
  ],

  // Read-only root filesystem
  ReadonlyRootfs: true,

  // tmpfs for writable areas
  Tmpfs: {
    '/tmp': 'rw,noexec,nosuid,size=512m',
    '/run': 'rw,noexec,nosuid,size=64m',
    '/home/agent/.cache': 'rw,noexec,nosuid,size=1g',
  },

  // Resource limits
  Memory: 4 * 1024 * 1024 * 1024,    // 4 GB (configurable per repo)
  NanoCpus: 2 * 1e9,                  // 2 CPUs (configurable)
  PidsLimit: 256,                      // Fork bomb protection

  // Network (phase-dependent)
  NetworkMode: 'none',  // execution phase default

  // User
  User: '1000:1000',  // non-root
};
```

#### Capability Management

- Default Docker gives ~14 capabilities. Drop ALL, add back only as needed.
- Most agent workloads (read/write files, run tests): **no capabilities needed**
- Setup phase (install packages as root then switch): may need `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID`
- `NET_RAW` only if ping/raw sockets needed (unlikely)
- **Approach:** Start with `CapDrop: ['ALL']`, add back only when a specific workload fails. Log which capabilities are needed per setup contract for auditability.

#### Seccomp

Default seccomp profile blocks ~44 of 300+ syscalls including:
- `bpf` (eBPF programs)
- `clone` with namespace flags (creating new namespaces)
- `mount`, `umount2`, `pivot_root` (filesystem manipulation)
- `ptrace` (process tracing -- container escape vector)
- `reboot`, `kexec_load` (system control)
- `add_key`, `keyctl`, `request_key` (kernel keyring)

**Recommendation:** Use default profile for V1. Custom stricter profile for later security audits.

#### User Namespaces

- `--userns-remap=default` maps UID 0 in container to high UID on host
- This is a **daemon-level** setting, not per-container
- Defense-in-depth alongside non-root user (UID 1000)

#### Resource Limits

| Resource | Option | Default | Behavior When Exceeded |
|----------|--------|---------|----------------------|
| Memory | `Memory` | 4 GB | OOM killer terminates processes |
| CPU | `NanoCpus` | 2 CPUs | Throttled (not killed) |
| PIDs | `PidsLimit` | 256 | New process creation fails |
| Disk | `StorageOpt.size` | 10 GB | Write operations fail |
| Open files | ulimit `nofile` | 1024:4096 | Open calls fail with EMFILE |
| Processes | ulimit `nproc` | 256 | Fork calls fail |

**Disk quota caveat:** `--storage-opt size=` requires overlay2 storage driver on XFS filesystem with `pquota` mount option. ext4 does not support this. macOS Docker Desktop may not support it. **V1 recommendation: monitor disk via `docker stats` + periodic checks rather than hard quotas.**

#### Read-Only Root Filesystem

`ReadonlyRootfs: true` prevents all writes to container root filesystem.

Required tmpfs mounts for agent workloads:
- `/tmp` -- general temporary files
- `/run` -- runtime state (PIDs, sockets)
- `/home/agent/.cache` -- tool caches (npm, pip)
- `/workspace` -- bind-mounted from host (repo), remains writable

#### Container Escape Prevention Matrix

| Vector | Mitigation |
|--------|------------|
| Kernel exploits | Keep host kernel updated; gVisor in Phase 3 |
| `docker.sock` mount | **Never mount Docker socket into agent containers** |
| Privileged mode | **Never use `--privileged`**; use `CapDrop: ['ALL']` |
| setuid/setgid binaries | `SecurityOpt: ['no-new-privileges:true']` |
| Dangerous syscalls | Default seccomp profile |
| PID namespace escape | Default PID namespace isolation |
| Network-based attacks | `NetworkMode: 'none'` during execution |
| Filesystem manipulation | `ReadonlyRootfs: true` + limited tmpfs |
| Resource exhaustion | Memory, CPU, PID, disk limits |

### 4.6 gVisor Integration (Phase 3 Only)

#### Architecture

- **Sentry:** Intercepts syscalls, implements Linux kernel interface in user space
- **Gofer:** File proxy for host filesystem access
- **runsc:** OCI-compatible runtime replacing runc
- Installation: `sudo runsc install && sudo systemctl restart docker`
- Usage: `docker run --runtime=runsc ...`

#### Known Limitations (Critical for Factory)

| Limitation | Factory Impact | Workaround |
|-----------|---------------|------------|
| No nested Docker | Cannot Docker-in-Docker | Class B/C only; not needed for V1 Class A |
| Partial iptables | No iptables-based filtering in container | Use Docker-level network isolation |
| DNS issues on user-defined bridges | gVisor loopback DNS (127.0.0.10) unreachable | Use default bridge, host network, or IP-based |
| Reports Linux 4.4 kernel | Software checking version may behave differently | Most runtimes probe capabilities, not version |
| 274/350 syscalls implemented | Some low-level software may fail | Node.js, Python, Go, Java all tested compatible |
| io_uring not supported | High-performance I/O libraries fall back | Libraries auto-probe alternatives |
| Filesystem caching | `docker cp` files may be invisible | Create file in target dir to invalidate cache |
| SELinux conflict | Cannot run gVisor with SELinux enforcing | Label outer container `container_engine_t` |

#### Performance Characteristics

- **CPU-bound:** No meaningful overhead
- **Syscall-heavy:** Measurable overhead (each syscall goes through Sentry)
- **I/O-heavy:** Higher overhead (gVisor netstack reimplements TCP/IP)
- **File I/O:** Moderate overhead (Gofer proxy)
- **Factory context:** LLM API latency is the bottleneck, not container syscall throughput. Overhead acceptable.

#### Integration Plan

1. Install runsc on factory host
2. Configure Docker daemon with `runsc` runtime entry
3. Add `runtime` option to `EnvironmentState` model
4. Default: runc (V1). gVisor opt-in per repo.
5. Repos requiring nested Docker, iptables, or block devices stay on runc
6. Test Node.js, Python, Go test suites under gVisor

### 4.7 Filesystem & Workspace Management

#### Mounting the Repo

```typescript
HostConfig: {
  Binds: [
    `${repoPath}:/workspace:rw`,            // Repo (agent read/write)
    `${factoryToolsPath}:/factory/tools:ro`, // Factory tools (read-only)
  ],
  WorkingDir: '/workspace',
}
```

- With `ReadonlyRootfs: true`, only bind mounts and tmpfs are writable
- File ownership: container user (1000:1000) must read/write repo files
- Modified files immediately visible on host (bind-mounted, no `docker cp` needed)

#### Output Collection

Exec output via dockerode stream attachment:
```typescript
const exec = await container.exec({
  Cmd: ['npm', 'test'],
  AttachStdout: true,
  AttachStderr: true,
});
const stream = await exec.start({ hijack: true });
docker.modem.demuxStream(stream, stdout, stderr);
```

Collected outputs: modified files (git diff), test results (exec streams), scan results (exec streams), generated artifacts.

#### Large Repos

- **Shallow clones:** `git clone --depth 1`, fetch more history as needed
- **Git LFS:** Install `git-lfs` in image. `GIT_LFS_SKIP_SMUDGE=1` during clone, then `git lfs pull`
- **Sparse checkout:** Class B feature
- **macOS gotcha:** Bind mount performance slower due to filesystem translation. Linux hosts have native performance.

#### Git Operations Inside Container

Requirements:
- `git` installed in container image
- Git credential helper configured for factory's GitHub App token
- `git-lfs` installed if repo uses LFS

Agent needs to: create branches, commit, push to candidate branch, run `git diff`/`status`/`log`, perform rebases.

### 4.8 Health Checks & Monitoring

#### Health Check Configuration

| Parameter | Docker Default | Factory Setting |
|-----------|---------------|----------------|
| Interval | 30s | 30s |
| Timeout | 30s | 10s |
| Start period | 0s | 60s (allow setup) |
| Retries | 3 | 3 |

**Note:** Docker health check values are in **nanoseconds** (e.g., `30_000_000_000` = 30s).

#### Stuck/Runaway Detection (5 Layers)

1. **Wall-clock timeout:** Default 30 min per PRD R-024. Kill container if exceeded.
2. **Resource monitoring:** Poll `container.stats({ stream: false })` for CPU, memory, PIDs.
3. **No-progress detection:** PRD R-024 says 3 loops without state change triggers pause. Track exec exit codes and output.
4. **OOM detection:** `container.inspect()` -> `State.OOMKilled` field.
5. **Event monitoring:** `docker.getEvents({ filters: { container: [id], event: ['die', 'oom', 'kill'] } })`

#### Log Collection

```typescript
const logStream = await container.logs({
  follow: true,
  stdout: true,
  stderr: true,
  timestamps: true,
});
docker.modem.demuxStream(logStream, process.stdout, process.stderr);
```

Docker captures stdout/stderr from PID 1 and exec sessions. Factory should:
- Stream to audit writer (append-only trail)
- Buffer recent logs for evidence packet
- Apply log rotation / size limits

#### Cleanup

```typescript
try {
  await container.stop({ t: 10 });  // 10 second grace period
} catch (e) {
  // Container may already be stopped
}
await container.remove({ force: true, v: true });  // remove volumes too
```

**Critical:** Cleanup must happen even on crashes. Run periodic cleanup sweep: find and remove containers with factory label prefix older than N hours.

### 4.9 Git LFS Support

#### LFS in Containers

1. Include `git-lfs` in base container image (or install during setup)
2. `GIT_LFS_SKIP_SMUDGE=1` during `git clone` (avoid downloading all objects upfront)
3. `git lfs pull` downloads only objects for current state
4. Objects stored in `.git/lfs/objects/` (content-addressed by SHA-256)

#### LFS Caching (V1: Host-Level Bind Mount)

```typescript
Binds: [`${lfsCache}:/home/agent/.cache/lfs:rw`]
// Configure: git config --global lfs.storage /home/agent/.cache/lfs
```

- Alternative: LFS caching proxy server (GitLfsCachingServer). Not needed for V1 single-host.
- `docker commit` captures LFS objects since they live in filesystem. Subsequent containers from cached image start with LFS objects present.

### 4.10 Complete Container Lifecycle for a Single Task

```
1. RESOLVE ENVIRONMENT
   - Parse .factory/setup.yml
   - Compute cache key (setup contract + control file hashes)
   - Check if cached image exists

2. CREATE CONTAINER
   IF cached: createContainer from cached image
   ELSE: pull(baseImage) or buildImage(Dockerfile), then createContainer

3. SETUP PHASE (if not cached)
   - Bridge network (outbound allowed)
   - Inject setup-only secrets via exec -e
   - Run setup commands via exec
   - Run health checks
   - docker commit -> cache image
   - Disconnect from bridge network

4. MAINTENANCE PHASE (if cached)
   - Bridge network (outbound allowed)
   - Run maintenance commands via exec
   - Run health checks
   - Disconnect from bridge network

5. EXECUTION PHASE
   - 'none' network (or internal + proxy for allowlist)
   - Inject runtime secrets via exec -e
   - Run agent via exec
   - Monitor: stats, timeout, no-progress, OOM
   - Collect output: logs, modified files, test results

6. CLEANUP
   - Stop container (10s grace)
   - Remove container + volumes
   - Clean up per-task networks or proxy containers
```

### 4.11 Security Layers Summary (V1 vs Phase 3)

| Layer | V1 (Docker/runc) | Phase 3 (gVisor/runsc) |
|-------|-------------------|------------------------|
| Process isolation | Linux namespaces (pid, net, mnt, uts, ipc) | gVisor Sentry (user-space kernel) |
| Syscall filtering | Default seccomp (~44 blocked) | gVisor intercepts all syscalls |
| Capabilities | `CapDrop: ALL` | gVisor + CapDrop |
| Privilege escalation | `no-new-privileges` | gVisor + no-new-privileges |
| Network | `none` / Squid proxy | gVisor netstack + `none` |
| Filesystem | Read-only root + tmpfs | gVisor Gofer + read-only root |
| Resources | Memory, CPU, PIDs, disk limits | Same (via cgroups) |
| User | Non-root (UID 1000) + optional userns-remap | Same |
| Secrets | Exec-based injection, phase-separated | Same |

### 4.12 Key Implementation Decisions (Consolidated)

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Docker client | `dockerode` v4.0.9 + `@types/dockerode` v4.0.0 | Most popular, TS types, Promise API, zero meaningful deps |
| Network isolation (default) | Disconnect from bridge | Simple, zero overhead, covers 90% of cases |
| Network allowlist | Squid proxy on internal network | Domain-level control, HTTPS, audit logging |
| Secret injection | `exec -e` per phase | No persistence, no layer leakage, narrowest scope |
| Environment caching | `docker commit` | Filesystem state capture, fast restore, no CRIU dependency |
| Cache key | Hash of setup contract + control file hashes | Matches PRD invalidation requirements |
| Security baseline | CapDrop ALL + seccomp default + read-only root + non-root | Defense in depth, OWASP-aligned |
| Resource limits | Memory + CPU + PIDs + disk monitoring | No XFS dependency for V1 |
| Disk quota | Monitor via stats (V1); XFS pquota (later) | XFS requirement too heavy for V1 |
| gVisor | Phase 3 opt-in per repo | Known limitations with DNS, nested Docker, iptables |
| Log collection | dockerode stream demux | Native stream support |
| LFS caching | Host-level bind mount | Simple, effective for single-host |

### 4.13 Open Questions (Unresolved)

1. **Docker socket access:** Control plane needs Docker socket to manage containers. Should it run in a container (needs socket mounted -- OWASP says don't) or on the host? Temporal worker running sandbox activity needs Docker access.
2. **macOS development:** Docker Desktop on macOS has different perf characteristics (bind mounts) and may not support all features (XFS quotas, userns-remap). How much security profile needs to work on macOS vs. Linux-only production?
3. **Image registry:** Local Docker registry for cached images vs. local image storage? Local is simpler but no multi-host sharing. V1: local storage sufficient.
4. **Concurrent containers:** Configurable concurrency limits with resource reservation needed. Depends on host resources.
5. **Container labeling:** All factory containers/networks need consistent labels for discovery and cleanup: `com.factory.task-id`, `com.factory.phase`, `com.factory.repo`.

### 4.14 Dependencies for package.json (Docker Sandbox)

**Runtime:**
- `dockerode` ^4.0.9

**Dev:**
- `@types/dockerode` ^4.0.0

**Infrastructure (container images):**
- `node:22-slim` (base for Node.js agent workloads)
- Squid proxy image (when allowlist feature added)

**Host Requirements:**
- Docker Engine with socket at `/var/run/docker.sock`
- Linux recommended for production (native bind mount performance, XFS quotas, userns-remap)
- Docker Desktop sufficient for macOS development (with noted limitations)

---

## 5. PostgreSQL Data Layer

### 5.1 Schema Design

#### Task State Machine (R-002)

**State flow:**
```
created -> [needs_clarification ->] assigned -> in_progress ->
  evidence_ready -> [changes_requested -> in_progress ->] approved ->
  pr_created -> external_checks_pending ->
    [addressing_review_feedback -> external_checks_pending ->]
    [external_blocked -> external_checks_pending ->]
  merge_ready -> merged | failed
```

**Implementation:** Postgres enum type `task_state` (14 values) + a BEFORE UPDATE trigger (`validate_task_transition`) that queries a separate `task_valid_transitions` relational table. The trigger fires via `WHEN (OLD.state IS DISTINCT FROM NEW.state)` -- no-op transitions (same state) are silently allowed (RETURN NEW).

**Terminal states:** `merged` and `failed` have no outgoing transitions. The trigger naturally rejects any state change from them.

**Why NOT CHECK constraints:** CHECK constraints cannot reference `OLD` row values -- they only see the row being written. The trigger can compare `OLD.state` to `NEW.state`.

**Transitions table:** `task_valid_transitions(from_state task_state, to_state task_state)` with composite PK on both columns. Contains 18 valid transitions seeded via migration INSERT. This makes transitions inspectable, testable, and changeable without modifying trigger code.

**Specific valid transitions (18 total):**
- created -> needs_clarification, assigned
- needs_clarification -> assigned
- assigned -> in_progress
- in_progress -> evidence_ready, failed
- evidence_ready -> changes_requested, approved
- changes_requested -> in_progress
- approved -> pr_created
- pr_created -> external_checks_pending
- external_checks_pending -> addressing_review_feedback, external_blocked, merge_ready
- addressing_review_feedback -> external_checks_pending
- external_blocked -> external_checks_pending
- merge_ready -> merged, failed

**Drizzle enum definition:**
```typescript
export const taskStateEnum = pgEnum('task_state', [
  'created', 'needs_clarification', 'assigned', 'in_progress',
  'evidence_ready', 'changes_requested', 'approved',
  'pr_created', 'external_checks_pending',
  'addressing_review_feedback', 'external_blocked',
  'merge_ready', 'merged', 'failed',
]);
```

#### Tasks Table

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, defaultRandom() |
| state | task_state enum | NOT NULL, default 'created' |
| objective | text | NOT NULL |
| scope | jsonb | nullable |
| constraints | jsonb | nullable |
| budgetCents | numeric(10, 0) | nullable |
| repoId | uuid | NOT NULL, FK -> repos.id |
| createdBy | text | NOT NULL |
| createdAt | timestamptz | NOT NULL, defaultNow() |
| updatedAt | timestamptz | NOT NULL, defaultNow() |

#### Audit Entries Table (R-012) -- Append-Only, Partitioned

**Partitioned by:** RANGE on `timestamp` (monthly partitions).

| Column | Type | Constraints | Retention |
|--------|------|-------------|-----------|
| id | uuid | PK, defaultRandom() | 2 years |
| timestamp | timestamptz | NOT NULL, defaultNow() | 2 years (partition key) |
| actor | text | NOT NULL | 2 years |
| action_type | text | NOT NULL | 2 years |
| target_type | text | NOT NULL | 2 years |
| target_id | text | NOT NULL | 2 years |
| result | text | NOT NULL | 2 years |
| cost_cents | numeric(10, 0) | nullable | 2 years |
| task_id | uuid | FK -> tasks.id | 2 years |
| content | jsonb | nullable | 90 days (then NULLed) |
| content_hash | text | NOT NULL (SHA-256 hex) | 2 years |

**RLS policies (FORCE ROW LEVEL SECURITY enabled on table):**
- `audit_no_update`: RESTRICTIVE, FOR UPDATE, USING (false) -- blocks ALL UPDATEs
- `audit_no_delete`: RESTRICTIVE, FOR DELETE, USING (false) -- blocks ALL DELETEs
- `audit_allow_insert`: FOR INSERT, WITH CHECK (true) -- allows all INSERTs
- `audit_allow_select`: FOR SELECT, USING (true) -- allows all SELECTs

**Critical security note:** RLS is bypassed by superusers and roles with `BYPASSRLS` privilege. The application role (`factory_app`) MUST NOT be a superuser and MUST NOT have `BYPASSRLS`. Only the privileged `factory_admin` role can bypass RLS (needed for GDPR purge operations).

**Content hash computation:** Application-layer SHA-256 of deterministically serialized JSON (keys sorted). Done BEFORE INSERT. Implementation:
```typescript
import { createHash } from 'node:crypto';
function computeContentHash(content: unknown): string {
  const serialized = JSON.stringify(content, Object.keys(content as object).sort());
  return createHash('sha256').update(serialized).digest('hex');
}
```

**Why per-entry hashing, NOT hash chaining:**
- Hash chaining prevents concurrent inserts (strict ordering required)
- Hash chain break on any out-of-order insert
- Recovery from broken chains is complex
- Partitioning complications (chain spans partitions)
- Per-entry hashing is parallel-safe and sufficient for "did this entry's content change?"

#### Evidence Bundles Table (R-008) -- Hybrid Relational + JSONB

**Design rationale:** Some fields are always present and well-typed (objective, revertability class). Others are variable-structure (test results, scan results). Pure JSONB loses type safety on fixed fields. Pure relational requires too many columns for variable content.

**Relational (fixed) columns:**
- id: uuid PK, defaultRandom()
- taskId: uuid FK -> tasks.id, NOT NULL
- version: integer, default 1, NOT NULL
- objective: text, NOT NULL
- revertabilityClass: enum (clean_revert | revert_with_migration | non_revertable), NOT NULL
- blastRadiusFiles: integer, NOT NULL
- blastRadiusPackages: integer, NOT NULL
- hasProtectedSurfaceEdits: boolean, default false, NOT NULL
- hasMigrationImpact: boolean, default false, NOT NULL
- artifactUrl: text, nullable
- createdAt: timestamptz, NOT NULL, defaultNow()

**JSONB (variable-structure) columns with `$type<T>()` annotations:**
- annotatedDiff: `$type<AnnotatedDiff>()`
- ownersImpacted: `$type<string[]>()`
- testResults: `$type<TestResults>()`
- securityScanResults: `$type<ScanResults>()`
- lintResults: `$type<LintResults>()`
- protectedSurfaceEdits: `$type<ProtectedEdit[]>()`
- migrationImpact: `$type<MigrationImpact>()`
- unresolvedAssumptions: `$type<string[]>()`
- commandsRun: `$type<CommandRecord[]>()`
- pendingExternalChecks: `$type<string[]>()`

**IMPORTANT gotcha:** `$type<T>()` annotations provide compile-time type safety ONLY -- NO runtime validation. Runtime validation MUST be done at the application service layer (e.g., with Zod) before writing to the database.

#### ReviewState Table (R-002, Section 6.3) -- Dual-Boundary Lifecycle

**Relationship:** 1:1 with tasks (unique constraint on task_id).

**review_state enum (10 values):** pending_evidence, evidence_ready, approved, changes_requested, pr_created, external_checks_pending, external_blocked, merge_ready, merged, closed

**Internal (factory) boundary fields:**
- evidenceBundleId: uuid FK -> evidence_bundles.id
- internalApprovedBy: text
- internalApprovedAt: timestamptz

**External (GitHub) boundary fields (NULL until PR created):**
- prNumber: integer
- prUrl: text
- requiredChecks: jsonb `$type<RequiredCheck[]>()`
- codeownersStatus: jsonb `$type<CodeownersStatus[]>()`
- unresolvedThreads: integer, default 0
- staleReviews: boolean, default false
- mergeQueueStatus: text

**Reconciliation fields:**
- lastGithubSync: timestamptz
- githubReconciliationData: jsonb

#### Code Index Tables (R-014)

**Four tables for persistent code index per repo:**

**code_index_versions:** repoId (FK), commitSha, status (building | ready | stale). Unique index on (repoId, commitSha).

**code_symbols:** indexVersionId (FK), filePath, symbolName, symbolKind (function | class | interface | type | variable | export), lineStart, lineEnd, parentSymbol, signature, isExported, searchVector (tsvector generated column). Indexes on symbolName, filePath, symbolKind.

**code_dependencies:** indexVersionId (FK), sourceFile, targetFile, importType (static | dynamic | type_only). Indexes on sourceFile, targetFile.

**code_files:** indexVersionId (FK), filePath, fileHash (for incremental updates), language, lineCount, isEntryPoint, moduleGroup (for repo map boundaries), governanceExcluded.

**Performance note:** index_version_id FK allows bulk deletion when a new index version replaces an old one. Incremental updates work by comparing file hashes. For large repos (10K+ files), these tables could be large -- consider garbage-collecting old index versions.

#### Policy Config Tables (R-010)

**Enums:**
- policy_type: read_exclusion, edit_deny, edit_protected, edit_allowed
- protection_class: hard_protected, flagged, light_protected

**Columns:** repoId (FK), name, policyType, protectionClass, pathPatterns (JSONB string[] NOT NULL), autonomyLevel (L0/L1/L2), requiresApproval (boolean, default false), approverRole (admin | operator), isActive (boolean, default true), createdBy, createdAt, updatedAt

**Indexes:** B-tree on repoId, GIN on pathPatterns

**IMPORTANT:** Glob pattern matching (e.g., `secrets/**`, `**/*.test.*`) MUST happen at the application layer, NOT in SQL. The GIN index on pathPatterns is useful for containment queries ("does any policy include this exact pattern?") but glob evaluation requires application logic.

#### Credential/Secret Tables (Section 7.2)

**secret_class enum:** setup_only, runtime, per_tool

**credential_leases table:**
- id: uuid PK
- taskId: uuid FK -> tasks.id, NOT NULL
- tokenType: text NOT NULL (e.g., github_app_installation)
- scope: jsonb string[] NOT NULL
- expiresAt: timestamptz NOT NULL
- rotatedAt: timestamptz nullable
- revokedAt: timestamptz nullable
- createdAt: timestamptz NOT NULL
- Indexes on taskId and expiresAt

**secret_bindings table:**
- id: uuid PK
- repoId: uuid FK -> repos.id, NOT NULL
- name: text NOT NULL
- secretClass: secret_class enum NOT NULL
- toolScope: text nullable (for per_tool secrets)
- encryptedValue: bytea NOT NULL
- encryptedDek: bytea NOT NULL
- kekId: text NOT NULL (identifies which KEK was used)
- createdAt: timestamptz NOT NULL
- rotatedAt: timestamptz nullable
- Unique index on (repoId, name)

#### Supporting Tables

**repos:**
- githubOwner + githubRepo: unique composite index
- defaultBranch: text, default 'main'
- repoClass: text, default 'A' (A/B/C classification)
- autonomyLevel: text, default 'L1'
- setupContractPath: text nullable

**environment_states:**
- repoId: uuid FK -> repos.id
- imageRef: text nullable
- setupContractHash: text nullable
- cacheValid: boolean, default false
- lastHealthCheck: timestamptz nullable
- healthStatus: text nullable (healthy | unhealthy | unknown)

**cost_records:**
- taskId: uuid FK -> tasks.id, nullable
- modelId: text NOT NULL
- inputTokens: integer NOT NULL
- outputTokens: integer NOT NULL
- costCents: numeric(10, 4) NOT NULL
- latencyMs: integer nullable
- timestamp: timestamptz NOT NULL, defaultNow()
- Indexes on taskId, timestamp

### 5.2 Envelope Encryption

#### Pattern

1. Generate random 32-byte DEK (AES-256)
2. Encrypt secret with DEK using AES-256-GCM (96-bit IV / 12 bytes)
3. Wrap DEK with KEK (via KMS provider interface)
4. Store: encrypted_value (bytea) + encrypted_dek (bytea) + kek_id (text)
5. Discard plaintext DEK from memory immediately

#### Application-Layer Encryption, NOT pgcrypto

**Rationale:**
- pgcrypto encrypts inside Postgres, meaning data transits in plaintext between app and DB
- Application-layer encryption means Postgres NEVER sees plaintext secret values
- External KMS integration (AWS/GCP `Encrypt`/`Decrypt` API calls) must happen at app layer regardless
- Node.js `crypto` module supports AES-256-GCM natively with authentication tags

**Implementation:**
```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;       // 12 bytes (96-bit) for GCM
  authTag: Buffer;
}

function encryptWithDek(plaintext: string, dek: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

function decryptWithDek(payload: EncryptedPayload, dek: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', dek, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString('utf8');
}
```

**Note:** Research source code has a bug in `decryptWithDek` -- references `payload.dek` on line 526 of research-postgres.md. Should use the `dek` function parameter directly. The code above is the corrected version.

#### Storage Format

Concatenate IV + authTag + ciphertext into a single `bytea` column. Simpler than JSONB with base64 and avoids JSON overhead.

#### KEK Management -- Pluggable Interface

```typescript
interface KmsProvider {
  wrapDek(plaintextDek: Buffer, kekId: string): Promise<Buffer>;
  unwrapDek(wrappedDek: Buffer, kekId: string): Promise<Buffer>;
  readonly providerId: string;
}
```

**V1:** `LocalKmsProvider` using `FACTORY_MASTER_KEY` environment variable as KEK. Uses AES-256-GCM or AES key wrapping (RFC 3394) to wrap/unwrap DEKs locally.
**Future:** AWS KMS, GCP KMS implementations via same interface.

#### Key Rotation

**DEK rotation:** New DEK for each new secret value. Rotation = decrypt with old DEK, generate new DEK, re-encrypt with new DEK, wrap new DEK with current KEK.

**KEK rotation:** Re-wrap ALL DEKs with new KEK. Data is NOT re-encrypted -- only DEK wrappers change. The `kek_id` column tracks which KEK version, enabling gradual migration.
```sql
SELECT id, name FROM secret_bindings WHERE kek_id = 'old-kek-version';
```

#### What Needs Encryption

| Data | Encrypt? | Rationale |
|------|----------|-----------|
| Secret values (API keys, tokens, passwords) | Yes | Core requirement |
| Credential lease tokens | No | Short-lived (1h), stored in Redis/memory |
| Audit content (prompts, outputs) | No | Hash provides tamper detection; encryption prevents search/analysis. GDPR purge handles deletion. |
| Audit metadata | No | Must be queryable |
| Policy config | No | Not sensitive, must be queryable |
| Code index data | No | Derived from repo, governance-filtered at index time |

### 5.3 Audit Tamper Detection and Retention

#### Verification

Periodic job (hourly or daily) reads batches of audit entries, recomputes hashes at application layer, flags mismatches. This runs on a schedule, NOT on every read.

**Verification SQL (must be combined with app-layer hash recomputation):**
```sql
SELECT id, timestamp, actor, action_type
FROM audit_entries
WHERE content IS NOT NULL
  AND content_hash != expected_hash; -- computed by app
```

#### Export to Object Storage (MinIO/R2)

- **Format:** JSONL (one JSON object per line)
- **Manifest per export file:** time range covered, entry count, SHA-256 hash of the export file itself, list of entry IDs
- **Schedule:** Daily export of previous day's entries. Idempotent (re-exporting same range produces same output).
- **Future consideration:** Parquet for analytics in Phase 2.

#### Retention via Partitioning

- **Monthly partitions** created 3 months ahead to prevent INSERT failures
- **Partition naming:** `audit_entries_YYYY_MM` (e.g., `audit_entries_2026_01`)
- **90-day content purge:** `UPDATE audit_entries SET content = NULL WHERE timestamp < now() - interval '90 days' AND content IS NOT NULL` -- requires privileged `factory_admin` role to bypass RLS
- **2-year metadata retention:** `DROP TABLE audit_entries_2024_01;` -- instant operation, no row-by-row deletion

#### GDPR "Right to Erasure"

1. NULL the `content` column on affected entries
2. Retain `content_hash` as proof of what existed
3. Retain all metadata fields (non-personal: action_type, timestamp, etc.)
4. Log the purge action itself as a new audit entry
5. REQUIRES the privileged migration role (`factory_admin`) that bypasses UPDATE RLS policy. The app role CANNOT perform purges.

#### Partition Sizing Estimate

- ~1000 audit entries per task
- ~50 tasks/day for an active installation
- = ~50K entries/day = ~1.5M entries/month
- At ~1KB per entry (with content) = ~1.5GB per monthly partition

### 5.4 Migration Strategy

#### Tool: Drizzle Kit

- `drizzle-kit generate` -- diffs TypeScript schema against previous migrations, generates SQL files
- `drizzle-kit migrate` -- applies unapplied migrations sequentially
- `drizzle-kit push` -- direct schema application (DEVELOPMENT ONLY)
- Programmatic application:
```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const db = drizzle(process.env.DATABASE_URL);
await migrate(db);
```

#### Forward-Only (No Down Migrations)

**Rationale:** Data-destructive changes cannot be reversed (dropped columns, changed types). Production rollback via down migration is rarely safe. Forward-only forces thinking about backward compatibility. If a migration needs to be "undone," write a new forward migration that reverses the change.

#### Custom SQL Required In Migrations

Drizzle Kit generates SQL for schema changes, but custom SQL is needed for:
- Trigger creation (state machine validation)
- RLS policies (audit table protection)
- Partition creation
- Seed data (valid transitions table)
- Extension enabling (`CREATE EXTENSION IF NOT EXISTS pgcrypto`)

#### Migration File Structure

```
drizzle/
  0000_initial_schema/
    migration.sql
    snapshot.json
  0001_add_cost_records/
    migration.sql
    snapshot.json
```

#### Zero-Downtime Schema Change Patterns

| Operation | Safe? | Notes |
|-----------|-------|-------|
| ADD COLUMN (nullable, no default) | Yes | No table rewrite |
| ADD COLUMN (with DEFAULT, PG 11+) | Yes | Default stored in catalog, no rewrite |
| ADD COLUMN (NOT NULL, no default) | No | Requires rewrite or multi-step approach |
| DROP COLUMN | Yes | Marks as dropped, no rewrite |
| ADD INDEX | Use CONCURRENTLY | `CREATE INDEX CONCURRENTLY` avoids table lock |
| ADD CONSTRAINT (CHECK) | Use NOT VALID + VALIDATE | Two-step: add without scanning, then validate separately |
| ADD CONSTRAINT (FK) | Use NOT VALID + VALIDATE | Same two-step approach |
| ALTER COLUMN TYPE | No (usually) | Requires rewrite. Use new column + backfill instead. |

### 5.5 Performance and Indexing

#### Index Design for Common Queries

**Tasks:**
- Partial B-tree on state: `WHERE state NOT IN ('merged', 'failed')` -- for active tasks dashboard
- B-tree on repo_id
- B-tree on created_at DESC (recent tasks view)

**Audit entries:**
- Partition pruning handles time-range queries automatically (enabled by default PG 10+)
- B-tree on task_id
- B-tree on actor
- B-tree on action_type

**Cost records:**
- B-tree on task_id (cost aggregation by task)
- B-tree on timestamp (daily/monthly spend)
- B-tree on model_id (provider analytics)

#### JSONB Indexing

- GIN on `policy_configs.path_patterns` (containment queries)
- GIN on `evidence_bundles.test_results` (if querying by result status)
- `jsonb_path_ops` variant: smaller index, supports only `@>` operator
- **GIN is useful for:** `@>` (containment), `?` (key existence), `?|` (any key), `?&` (all keys)
- **GIN is NOT useful for:** `->>` (text extraction) -- use B-tree on generated columns or expression indexes instead

#### Full-Text Search for Code Symbols (R-014)

Generated tsvector column combining symbol_name and file_path:
```sql
ALTER TABLE code_symbols
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(symbol_name, '') || ' ' || coalesce(file_path, ''))
  ) STORED;
CREATE INDEX idx_symbols_search ON code_symbols USING GIN (search_vector);
```

- Uses `'simple'` text search config (NOT 'english') -- no stemming, better for code symbol names (prevents `users` -> `user` stemming)
- Query pattern: `WHERE search_vector @@ to_tsquery('simple', 'handleAuth & controller')` with `ts_rank` for ordering

#### Connection Pooling

**Phase 1:** `pg.Pool` at application layer:
```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
const db = drizzle({ client: pool });
```

**Pool sizing rule of thumb:** `(2 * CPU cores) + effective_spindle_count`. For Docker Compose single-instance, `max: 20` is reasonable.

**When to add PgBouncer:** When scaling to multiple application replicas or when Temporal workers create many concurrent DB connections. Use transaction pooling mode.

### 5.6 Operational Patterns

#### Docker Compose Configuration

- Image: `postgres:16-alpine`
- Database name: `factory`, user: `factory`, password via `${POSTGRES_PASSWORD}`
- Data volume: `postgres_data:/var/lib/postgresql/data`
- Init scripts: `./init-scripts:/docker-entrypoint-initdb.d`
- Health check: `pg_isready -U factory -d factory` (5s interval, 5s timeout, 5 retries)

**Postgres tuning parameters (command-line):**
- `shared_buffers=256MB`
- `effective_cache_size=768MB`
- `work_mem=4MB`
- `maintenance_work_mem=64MB`
- `max_connections=100`
- `log_min_duration_statement=200` (milliseconds -- logs queries slower than 200ms)

#### Database Roles (Minimum 2)

| Role | Type | Purpose | Capabilities |
|------|------|---------|-------------|
| `factory_app` | Non-superuser, no BYPASSRLS | Application runtime | INSERT + SELECT on audit_entries, standard DML on other tables |
| `factory_admin` | Privileged | Migrations, GDPR purge | ALL on database, can bypass RLS |

**Open question:** Third read-only role for dashboard?

#### Init Scripts (`init-scripts/01-setup.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE factory_app LOGIN PASSWORD 'app_password';
GRANT CONNECT ON DATABASE factory TO factory_app;
CREATE ROLE factory_admin LOGIN PASSWORD 'admin_password';
GRANT ALL ON DATABASE factory TO factory_admin;
```

#### Backup Strategy

**Automated:** `prodrigestivill/postgres-backup-local` Docker image
- Schedule: `@daily`
- Retention: 30 days (`BACKUP_KEEP_DAYS: 30`)
- Volume: `postgres_backups:/backups`
- Depends on postgres service health check

**Manual:**
```bash
pg_dump -U factory -d factory -Fc > factory_backup.dump
pg_restore -U factory -d factory -Fc factory_backup.dump
```

#### Monitoring Queries

- Active connections: `SELECT count(*) FROM pg_stat_activity;`
- Table sizes: `SELECT pg_size_pretty(pg_total_relation_size('audit_entries'));`
- Slow queries: `pg_stat_statements` extension
- Connection pool utilization: node-postgres Pool events

#### Health Check Pattern

```typescript
async function checkDatabaseHealth(): Promise<HealthStatus> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'unhealthy', error: String(error) };
  }
}
```

### 5.7 Transaction Patterns

#### Atomic State Change + Audit Entry

Task state change and audit entry INSERT MUST be wrapped in a single `db.transaction()`. The trigger validates the transition inside the transaction. If the trigger rejects, the entire transaction (including the audit entry) is rolled back.

```typescript
async function transitionTaskState(
  taskId: string,
  newState: TaskState,
  actor: string,
  auditContent: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(tasks)
      .set({ state: newState, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    const contentHash = computeContentHash(auditContent);
    await tx.insert(auditEntries).values({
      actor,
      actionType: 'task_state_change',
      targetType: 'task',
      targetId: taskId,
      result: newState,
      content: auditContent,
      contentHash,
      taskId,
    });
  });
}
```

#### Isolation Levels

- **Default (`read committed`):** Sufficient for most operations
- **`serializable`:** Required ONLY for branch lease acquisition (prevent double-lease race condition). Use `SELECT ... FOR UPDATE` inside serializable transaction.

#### Branch Leases -- Two Options

**Preferred: Redis** `SET key value NX EX ttl` for atomic lease acquisition (lower latency, native TTL).

**Alternative: Postgres** serializable transaction with `SELECT ... FOR UPDATE`:
```typescript
await db.transaction(async (tx) => {
  const existing = await tx.select()
    .from(branchLeases)
    .where(and(
      eq(branchLeases.branch, branchName),
      gt(branchLeases.expiresAt, new Date()),
    ))
    .for('update');
  if (existing.length > 0) {
    throw new Error(`Branch ${branchName} is already leased`);
  }
  await tx.insert(branchLeases).values({
    branch: branchName, taskId,
    expiresAt: new Date(Date.now() + ttlMs),
  });
}, { isolationLevel: 'serializable' });
```

### 5.8 Type Safety

#### Drizzle Type Inference (No Codegen Needed)

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
type Task = InferSelectModel<typeof tasks>;      // or: typeof tasks.$inferSelect
type NewTask = InferInsertModel<typeof tasks>;    // or: typeof tasks.$inferInsert
```

Types reflect column nullability, defaults, and custom type overrides. Inferred at compile time.

#### Enum TypeScript Types

```typescript
type TaskState = typeof taskStateEnum.enumValues[number];
// = 'created' | 'needs_clarification' | 'assigned' | ...
```

For shared use across the codebase (not just DB operations), mirror with Zod:
```typescript
const TaskStateSchema = z.enum(taskStateEnum.enumValues);
type TaskState = z.infer<typeof TaskStateSchema>;
```

#### Validation Boundary: Database vs Application

**Database-level (invariants that must NEVER be violated):**
- Enum types (valid state names)
- NOT NULL constraints (required fields)
- UNIQUE constraints (no duplicate repos, no duplicate secret names per repo)
- CHECK constraints (budget >= 0, token count >= 0)
- Foreign key constraints (referential integrity)
- Trigger-based state machine validation (valid transitions)
- RLS policies (append-only audit)

**Application-level (business rules that may change):**
- JSONB structure validation (evidence bundle fields, policy path patterns) via Zod
- Business rules (budget limits, autonomy level requirements)
- Cross-entity validation (task submitter != sole approver)
- Glob pattern validation (policy path patterns are valid globs)
- Content hash computation (before audit entry INSERT)

**Principle:** Use database constraints for invariants (data integrity). Use application validation for business rules (domain logic). The database is the last line of defense; the application is the first.

### 5.9 Open Questions from Research

1. **Partition automation:** Temporal workflow vs cron job vs startup check? Research notes Temporal workflow aligns with existing infrastructure.
2. **Audit export format:** Start with JSONL; Parquet for analytics in Phase 2 if needed.
3. **Code index storage for large repos (10K+ files):** Keep historical index versions or garbage-collect old ones aggressively?
4. **GDPR purge automation:** Manual CLI command sufficient for V1; automated webhook-triggered purge later.
5. **Read-only dashboard role:** Third DB role beyond factory_app and factory_admin?

### 5.10 Key Dependencies and Versions

| Dependency | Version/Variant | Purpose |
|------------|----------------|---------|
| PostgreSQL | 16-alpine (Docker) | Primary database |
| Drizzle ORM | (latest) | Type-safe ORM |
| drizzle-orm/node-postgres | - | PG driver integration |
| drizzle-kit | - | Migration generation and application |
| node-postgres (pg) | - | PostgreSQL driver with Pool |
| pgcrypto extension | (bundled with PG 16) | UUID generation via gen_random_uuid() |
| Node.js crypto module | (built-in, Node 22+) | AES-256-GCM encryption |
| Zod | - | Runtime JSONB validation |
| MinIO or R2 | - | Object storage for audit exports |

### 5.11 Summary of Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | Drizzle ORM | Type-safe, SQL-close, supports all PG features needed |
| Driver | node-postgres (pg) with Pool | Mature, well-supported, built-in pooling |
| State machine | PG enum + trigger + transitions table | DB-enforced, inspectable, testable |
| Audit table | Append-only with RLS, monthly partitions | Tamper-resistant, efficient retention, instant partition drops |
| Content hashing | Per-entry SHA-256 (not chain) | Simpler, parallel-safe, sufficient |
| Encryption | App-layer AES-256-GCM (not pgcrypto) | Postgres never sees plaintext |
| KEK management | Pluggable KmsProvider interface, V1 = operator env var | Extensible to AWS/GCP KMS later |
| Migrations | Drizzle Kit, forward-only, no down migrations | Version-controlled SQL, forces backward-compat thinking |
| JSONB usage | Hybrid relational + JSONB per table | Type safety on stable fields, flexibility on variable ones |
| Connection pooling | pg.Pool Phase 1, PgBouncer when scaling | Sufficient for Phase 1 monolith |
| Full-text search | tsvector with 'simple' config + GIN index | Code symbols need exact/prefix match, not stemming |
| Branch leases | Prefer Redis (SET NX EX) over PG serializable | Lower latency, native TTL |

### 5.12 Bug Found in Source

**File:** `/Users/seanflanagan/proj/software-factory/docs/research-postgres.md`, line 526
**Issue:** `decryptWithDek` function references `payload.dek` but `EncryptedPayload` interface has no `dek` field. Should use the `dek` parameter directly:
```typescript
// Bug:   const decipher = createDecipheriv('aes-256-gcm', payload.dek, payload.iv);
// Fixed: const decipher = createDecipheriv('aes-256-gcm', dek, payload.iv);
```

---

## 6. Docker Compose Production Setup

### 6.1 Service Definitions (6 services)

| Service | Image | Exposed Ports | Internal Ports |
|---------|-------|---------------|----------------|
| **app** (control plane) | Custom Dockerfile (Node 22-slim) | 3000 (API) | -- |
| **postgres** | `postgres:16-alpine` | -- (internal only) | 5432 |
| **redis** | `redis:7-alpine` | -- (internal only) | 6379 |
| **temporal** | `temporalio/auto-setup` (dev) / `temporalio/server` (prod) | -- (internal only) | 7233 (gRPC) |
| **temporal-ui** | `temporalio/ui` | 8080 (optional, dev) | 8080 |
| **minio** | `minio/minio` | 9000 (API), 9001 (console) | 9000, 9001 |

**Gotchas:**
- `temporalio/auto-setup` is NOT for production. Pattern: use auto-setup once for schema init, then switch to `temporalio/server`. Auto-setup registers default namespace and populates schema tables.
- MinIO stopped updating Docker Hub images (Oct 2025). Use Chainguard's image or `quay.io/minio/minio`.

### 6.2 Health Checks

All services need health checks. Dependent services use `depends_on` with `condition: service_healthy`.

- **postgres:** `pg_isready -U factory -d factory` (interval: 10s, timeout: 5s, retries: 5, start_period: 30s)
- **redis:** `redis-cli ping` (interval: 10s, timeout: 5s, retries: 5)
- **temporal:** `temporal operator cluster health` (interval: 10s, timeout: 5s, retries: 10, start_period: 30s)
- **minio:** `mc ready local` (interval: 5s, timeout: 5s, retries: 5)
- **app:** `curl -f http://localhost:3000/health` (interval: 15s, timeout: 5s, retries: 3, start_period: 15s)

### 6.3 Volume Management

Named volumes only. Never bind mounts for DB data in production.

- `postgres_data` -> `/var/lib/postgresql/data`
- `redis_data` -> `/data` (if AOF persistence enabled)
- `minio_data` -> `/data`
- Temporal stores state in Postgres, not its own volume

**PostgreSQL init args:**
- `POSTGRES_INITDB_ARGS: "--data-checksums"` (data integrity, must be set at init time)
- `POSTGRES_HOST_AUTH_METHOD: "scram-sha-256"` (security)

### 6.4 Networking

Single internal bridge network (`factory-internal`). Expose: app API (3000), MinIO console (9001 optional). Do NOT expose: Postgres (5432), Redis (6379), Temporal gRPC (7233). Optional: Temporal UI (8080, dev only).

### 6.5 Resource Limits

Use `deploy.resources` (limits + reservations). **Minimum: 4 CPU, 8 GB RAM.** Postgres and Temporal are heaviest.

### 6.6 Restart + Logging

`restart: unless-stopped` (respects manual stop, recovers from crash). JSON log driver with `max-size: "50m"`, `max-file: "5"` (prevents unbounded growth).

### 6.7 Environment Variables

`.env` file: `POSTGRES_DB=factory`, `POSTGRES_USER=factory`, `TEMPORAL_DB=temporal`, `TEMPORAL_VISIBILITY_DB=temporal_visibility`, `MINIO_BUCKET=factory-artifacts`, `NODE_ENV=production`.

### 6.8 Secrets Handling

Docker Compose secrets mount as files at `/run/secrets/<name>`.

**Required secrets files:** `postgres_password.txt`, `redis_password.txt`, `minio_root_password.txt`, `factory_api_key.txt`, `encryption_master_key.txt`

Postgres uses `POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password`.

**Limitation:** NOT encrypted at rest (Swarm-only feature). Host filesystem security is the protection. The `encryption_master_key` is for envelope-encrypted secrets in Postgres per PRD.

### 6.9 Self-Hosted Product Distribution

#### Industry Pattern

All major self-hosted products (Sentry, GitLab, Supabase, Outline, Cal.com) use Docker Compose. None require K8s for initial setup.

#### Installation Flow

Clone repo -> copy `.env.example` -> run `./factory install` (validates Docker, generates secrets via `openssl rand`, pulls images, inits schema, creates admin API key, health checks) -> `docker compose up -d`. Non-interactive: `--non-interactive` flag.

#### Upgrade Flow

**Migrations are NOT reversible.** Always backup first.

`./factory backup` -> `git pull` -> `./factory upgrade` (internally: `docker compose pull` -> `docker compose run --rm app npm run migrate` -> `docker compose up -d` -> health check).

Hard stop versions: upgrade script validates and refuses to skip. Rollback = restore from backup. Two-phase migrations recommended.

#### Backup/Restore

`pg_dump` for Postgres, `mc mirror` for MinIO, config export. Does NOT backup Temporal. `./factory backup [--output path]`, `./factory restore <path>`.

#### Distribution Phase Plan

Phase 1: Docker Compose. Phase 3+: Helm. Single binary not viable. VM images not recommended.

---

## 7. Redis Patterns

### 7.1 Client: ioredis

`maxRetriesPerRequest: 3`, `retryStrategy: Math.min(times * 200, 5000)`, `lazyConnect: true`. **Pub/Sub needs dedicated connection** (`redis.duplicate()`).

### 7.2 Channels

- `factory:tasks` (state changes)
- `factory:system` (health, circuit breaker)
- `factory:task:{taskId}` (per-task)

### 7.3 Kill Switch (R-025)

- `factory:kill_switch` (global)
- `factory:kill:${taskId}` (per-task)
- Check via `MGET` (sub-ms)
- Publish to `factory:system` on activation

### 7.4 Branch Leases (R-002)

- Key: `factory:branch_lease:{branch}`, TTL 3600s
- Acquire: `SET NX EX`
- Renew/Release: **Lua scripts required** for atomic check-and-modify (prevents race conditions where task releases another's lease)

### 7.5 Sessions

`factory:session:{uuid}`, TTL 86400s, JSON `{apiKey, ...metadata}`.

---

## 8. OpenTelemetry Integration

### 8.1 Core Packages (9)

1. `@opentelemetry/sdk-node`
2. `@opentelemetry/api`
3. `@opentelemetry/auto-instrumentations-node`
4. `@opentelemetry/sdk-metrics`
5. `@opentelemetry/sdk-trace-node`
6. `@opentelemetry/exporter-trace-otlp-grpc`
7. `@opentelemetry/exporter-metrics-otlp-grpc`
8. `@opentelemetry/resources`
9. `@opentelemetry/semantic-conventions`

Instrumentation: `src/instrumentation.ts` loaded via `node --import`. Service: `software-factory`, endpoint: `http://localhost:4317`, metric interval: 60s.

### 8.2 Temporal OTel

**Package:** `@temporalio/interceptors-opentelemetry`

**Critical:** V8 sandbox blocks standard OTel. Use sinks mechanism: `makeWorkflowExporter()` in worker sinks, `OpenTelemetryWorkflowClientInterceptor` on client, `OpenTelemetryActivityInboundInterceptor` for activities.

Worker metrics: Prometheus `:9464` or OTel collector.

### 8.3 Custom Spans for LLM

LLM calls: `llm.model`, `llm.provider`, `llm.tokens.input`, `llm.tokens.output`, `llm.cost`.

### 8.4 Metrics (9)

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

### 8.5 Logging

Pino + `mixin()` extracting `traceId`/`spanId` from active span. Every log entry gets trace correlation.

### 8.6 Tiered Observability (3 tiers)

1. **Built-in default:** JSON logging + `/health` + `/metrics` (Prometheus format)
2. **Optional:** `OTEL_EXPORTER_OTLP_ENDPOINT` env var enables export
3. **Full:** `docker compose --profile observability up -d` adds `otel/opentelemetry-collector-contrib` + `jaegertracing/all-in-one` + `grafana/grafana`

---

## 9. Upgrade & Maintenance

- **Versioning:** Semver
- **Migrations:** Forward-only (transactional DDL). Append-only, backwards-compatible, multi-phase destructive. Conventional Commits + `changesets`.
- **Health endpoints:**
  - `/health` -- summary + version
  - `/health/ready` -- dependency checks
  - `/health/live` -- process check

---

## 10. Implementation-Critical Details (Cross-Cutting)

1. **Temporal V8 sandbox** blocks standard OTel; use `@temporalio/interceptors-opentelemetry` sinks
2. **Redis Pub/Sub** needs separate connection (subscriber cannot issue commands)
3. **Branch lease Lua scripts** mandatory (race conditions without atomic check-and-modify)
4. **Docker log rotation** required (`max-size`/`max-file`) or disk fills
5. **`POSTGRES_PASSWORD_FILE`** reads from file path, not env var content
6. **SSE EventSource** cannot set headers; auth via query parameter
7. **MinIO health:** `mc ready local` (not curl)
8. **Temporal health:** `temporal operator cluster health`
9. **PostgreSQL `--data-checksums`** only settable at init time
10. **`unless-stopped`** not `always` for restart policy
