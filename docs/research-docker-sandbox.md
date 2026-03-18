# Research: Docker Sandboxing, Container Management, and Security

**Date:** 2026-03-18
**Scope:** Docker-based sandbox for executing AI agent code in isolated, ephemeral containers with phase-separated network and secret policies.
**PRD References:** R-006 (Sandboxed Execution), R-015 (Repo Setup), Section 7 (Setup & Environment), Section 10 (Security)

---

## 1. Programmatic Docker Management in Node.js

### 1.1 dockerode (Recommended)

**Package:** `dockerode` v4.0.9 (latest as of March 2026)
**Types:** `@types/dockerode` v4.0.0 (DefinitelyTyped)
**Source:** [github.com/apocas/dockerode](https://github.com/apocas/dockerode), [npm](https://www.npmjs.com/package/dockerode)

dockerode is the most widely used Node.js client for the Docker Engine API. It wraps the Docker Remote API and supports both callback and Promise interfaces.

**Key characteristics:**
- Passes Docker streams through without breaking them (critical for log collection and exec attach)
- Supports stream demultiplexing (stdout/stderr separation)
- Containers, images, networks, volumes, and execs are first-class entities
- Promise-based API works cleanly with async/await
- TypeScript types available via `@types/dockerode` with full coverage of `ContainerCreateOptions`, `HostConfig`, `ExecCreateOptions`, `NetworkCreateOptions`

**Core API surface relevant to the factory:**

```typescript
import Docker from 'dockerode';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Container lifecycle
const container = await docker.createContainer(options);  // ContainerCreateOptions
await container.start();
const exec = await container.exec(execOptions);           // ExecCreateOptions
await container.stop({ t: 10 });                          // timeout in seconds
await container.remove({ force: true, v: true });         // remove volumes too

// Snapshot/cache
await container.commit({ repo: 'factory-cache', tag: 'sha-abc123' });

// Monitoring
const stats = await container.stats({ stream: false });   // single snapshot
const logStream = await container.logs({ follow: true, stdout: true, stderr: true });

// Network management
const network = await docker.createNetwork({ Name: 'factory-internal', Internal: true });
await network.connect({ Container: container.id });
await network.disconnect({ Container: container.id });

// Image management
const stream = await docker.pull('node:22-slim');
const buildStream = await docker.buildImage(tarStream, { t: 'factory/env:latest' });
```

**HostConfig options critical for the factory (from @types/dockerode):**

| Option | Type | Purpose |
|--------|------|---------|
| `NetworkMode` | `string` | `'none'`, `'bridge'`, network name |
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

**ExecCreateOptions relevant for phase separation:**

| Option | Type | Purpose |
|--------|------|---------|
| `Cmd` | `string[]` | Command to execute |
| `Env` | `string[]` | Environment variables (override/add for this exec only) |
| `User` | `string` | User to run as |
| `WorkingDir` | `string` | Working directory |
| `AttachStdin` | `boolean` | Attach stdin |
| `AttachStdout` | `boolean` | Attach stdout |
| `AttachStderr` | `boolean` | Attach stderr |

### 1.2 Alternative: Docker Engine REST API Directly

The Docker Engine exposes a REST API at `/var/run/docker.sock` (Unix socket) or via TCP. dockerode wraps this API. Using it directly (via `node:http` or `undici`) is possible but offers no advantage -- dockerode handles stream management, multiplexing, and error handling well. The only reason to go direct would be to eliminate the dependency, but dockerode has zero external dependencies itself (just `@balena/dockerignore`, `docker-modem`, `tar-fs`).

**Recommendation:** Use dockerode. It is actively maintained, has comprehensive TypeScript types, and the factory's needs (create, exec, network, commit, stats, logs) are all first-class operations.

---

## 2. Network Isolation

### 2.1 Network Modes

Docker supports several network drivers relevant to the factory:

| Mode | Flag | Behavior | Factory Use |
|------|------|----------|-------------|
| `none` | `--network none` | Only loopback device. No external connectivity. | **Execution phase default** |
| `bridge` | `--network bridge` | Default bridge with NAT to host. Full outbound. | Setup phase (unrestricted) |
| Custom bridge | `--network factory-setup` | User-defined bridge. DNS resolution between containers. | Setup phase (controlled) |
| `internal: true` | Network config | Bridge with no gateway. Containers can talk to each other but not to the outside. | **Allowlist architecture** (internal + proxy) |

**Source:** [Docker Network Docs](https://docs.docker.com/engine/network/), [None Driver](https://docs.docker.com/engine/network/drivers/none/)

### 2.2 Phase Separation: Setup vs. Execution Network

The PRD requires: setup phase has network access; execution phase has network disabled by default with configurable allowlist.

**Implementation strategy (two approaches):**

**Approach A: Network swap (simpler, recommended for V1)**

1. Create container on a bridge network (setup phase)
2. Run setup commands (`npm ci`, etc.) with network access
3. Disconnect from bridge network
4. Connect to `none` network (or leave disconnected)
5. Run agent execution phase

```typescript
// Setup phase: container starts with bridge network
const container = await docker.createContainer({
  Image: 'node:22-slim',
  HostConfig: { NetworkMode: 'bridge' }
});
await container.start();
// ... run setup commands via exec ...

// Transition to execution phase: disconnect network
const bridge = docker.getNetwork('bridge');
await bridge.disconnect({ Container: container.id });
// Container now has no network access (only loopback)
```

dockerode supports `network.connect()` and `network.disconnect()` on running containers without restart.

**Approach B: Squid proxy allowlist (for configurable allowlists)**

When the execution phase needs access to specific domains (e.g., an API endpoint):

1. Create an `internal: true` Docker network (no internet gateway)
2. Run a Squid proxy container connected to both internal and external networks
3. Configure Squid with domain allowlist ACLs
4. Set `http_proxy` / `https_proxy` in the agent container
5. Agent container connects only to the internal network

Architecture:
```
[Agent Container] --internal-network--> [Squid Proxy] --external-network--> Internet
                                         ^
                                         | squid.conf:
                                         | acl allowed dstdomain .api.openai.com
                                         | http_access allow allowed
                                         | http_access deny all
```

**Source:** [jimangel.io/posts/docker-block-internet-squid-proxy](https://www.jimangel.io/posts/docker-block-internet-squid-proxy)

**Squid configuration example:**
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

**Key detail:** The `internal: true` flag on a Docker network means containers on that network have no route to the outside. The Squid container bridges internal and external networks. Application containers cannot bypass the proxy because there is no direct route.

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| Network swap | Simple, zero overhead, no extra containers | Binary: either full network or none. No per-domain control. |
| Squid proxy | Domain-level allowlisting, HTTPS inspection, logging | Extra container, proxy config management, slight latency |

**Recommendation:** V1 uses Approach A (network swap) for the default case (no network in execution phase). When the allowlist feature is needed, add Approach B. The two approaches compose: containers that need no network get disconnected; containers with allowlists get the proxy.

### 2.3 DNS Considerations

- Docker user-defined bridge networks provide embedded DNS (container name resolution)
- `none` network has no DNS (only loopback)
- The Squid proxy approach handles DNS because the proxy resolves domains on behalf of the client
- gVisor has known DNS issues with user-defined bridges (uses 127.0.0.10 loopback DNS which gVisor cannot reach) -- relevant for Phase 3

---

## 3. Secret Injection & Phase Separation

### 3.1 The Codex Pattern (Reference Implementation)

OpenAI Codex implements the exact pattern the PRD describes:

- **Setup phase:** Secrets available as environment variables. Network enabled.
- **Agent phase:** Secrets removed. Network disabled by default.
- **Cache invalidation:** Environment cache invalidated when secrets, setup scripts, or environment variables change.
- Setup scripts run in a **separate Bash session** from the agent, so `export` does not persist.
- All outbound traffic during agent phase routes through an HTTP/HTTPS proxy.

**Source:** [developers.openai.com/codex/cloud/environments](https://developers.openai.com/codex/cloud/environments)

### 3.2 Implementation Strategy for Phase-Separated Secrets

**Approach: exec-based phase separation (recommended)**

Rather than baking secrets into the container environment, inject them per-exec:

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

1. **No persistence in image:** `docker exec -e` injects env vars only into that process. They do not persist in the container's configuration and cannot be extracted via `docker inspect`.
2. **No layer leakage:** Unlike `docker commit`, exec-injected env vars are not captured in committed images.
3. **Clean separation:** Each exec invocation gets exactly the secrets it needs. Setup exec gets setup-only secrets. Agent exec gets runtime secrets. Per-tool exec gets per-tool secrets.
4. **Process isolation:** The env vars live only in the process's `/proc/[pid]/environ`. When the process exits, they are gone.

**Source:** [Docker exec docs](https://docs.docker.com/reference/cli/docker/container/exec/)

### 3.3 Alternative: tmpfs-Mounted Secret Files

For secrets that should be file-based rather than environment variables:

```typescript
const container = await docker.createContainer({
  Image: 'node:22-slim',
  HostConfig: {
    Tmpfs: { '/run/secrets': 'rw,noexec,nosuid,size=1m' },
  },
});
// Write secrets to /run/secrets/ via exec
// Clear /run/secrets/ contents before agent phase via exec
```

This mirrors Docker Swarm's secrets mechanism (tmpfs at `/run/secrets/`) without requiring Swarm mode.

### 3.4 Per-Tool Secret Injection

The PRD specifies per-tool secrets (e.g., `GITHUB_TOKEN` only available when `gh` CLI is invoked). Implementation:

```typescript
// When the agent invokes the gh tool:
const ghExec = await container.exec({
  Cmd: ['gh', 'pr', 'list'],
  Env: ['GITHUB_TOKEN=ghp_xxx'],
  User: 'agent',
  WorkingDir: '/workspace',
});
// GITHUB_TOKEN only exists in this gh process
```

This provides the narrowest possible secret scope -- each tool invocation gets only its declared secrets.

### 3.5 Secret Hygiene Rules

Per OWASP and Docker security best practices:

- Never pass secrets via `docker run -e` (visible in `docker inspect`, process table)
- Never bake secrets into images via `ENV` in Dockerfile
- Never write secrets to logs, audit content, or evidence bundles
- Use `docker exec -e` for per-process injection (not visible in `docker inspect`)
- Use tmpfs-mounted files for file-based secrets (cleared automatically on container removal)
- Secrets in Postgres must be envelope-encrypted (PRD Section 7.2)

**Sources:** [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html), [Docker Secrets Docs](https://docs.docker.com/engine/swarm/secrets/)

---

## 4. Environment Caching / Snapshots

### 4.1 Docker Commit for Snapshotting

`docker commit` creates a new image from a running container's filesystem state.

**What IS captured:**
- Filesystem changes (installed packages, built artifacts, node_modules, etc.)
- Container configuration (ENV, WORKDIR, USER, CMD, ENTRYPOINT, EXPOSE, LABEL) via `--change`

**What is NOT captured:**
- Mounted volume contents
- Running process state / memory
- Network configuration
- Secrets injected via `docker exec -e`

**Source:** [Docker commit docs](https://docs.docker.com/reference/cli/docker/container/commit/)

**Factory caching workflow:**

```
1. Pull/build base image (from .factory/setup.yml `image` field)
2. Create container from base image
3. Run setup commands (npm ci, playwright install, etc.) with setup-only secrets
4. Remove setup-only secrets (they were exec-injected, so already gone)
5. docker commit → factory-cache/{repo}:{setup-hash}
6. Store cache image locally (or push to local registry)
7. For next task: create container from cached image, run maintenance commands
```

**Generating cache keys:**

```typescript
// Cache key = hash of setup-contract contents + secret binding names (not values)
const cacheKey = sha256(JSON.stringify({
  image: setupContract.image,
  setup: setupContract.setup,
  maintenance: setupContract.maintenance,
  secretBindings: Object.keys(setupContract.secrets.setup_only).sort(),
  // Include behavioral control file hashes per PRD Section 7.2
  controlFileHashes: getControlFileHashes(),
}));
```

**Cache invalidation triggers (per PRD):**
- Setup contract changes (`.factory/setup.yml`)
- Maintenance script changes
- Secret binding changes (names, not values -- values change doesn't invalidate)
- Behavioral control file changes

### 4.2 Docker Commit Behavior

- Container is **paused** during commit by default (prevents corruption)
- The `--change` flag applies Dockerfile instructions to the committed image (useful for clearing ENV vars)
- Committed images are local-only by default; push to registry for sharing

```typescript
await container.commit({
  repo: `factory-cache/${repoSlug}`,
  tag: cacheKey,
  comment: `Factory environment cache for ${repoSlug}`,
  changes: [
    'ENV NPM_TOKEN=',  // Clear any leaked env vars (belt-and-suspenders)
  ],
});
```

### 4.3 Layer Caching for Image Builds

When the setup contract specifies a Dockerfile rather than a prebuilt image, Docker BuildKit layer caching applies:

- Unchanged layers are reused from cache
- Order Dockerfile instructions from least to most frequently changing
- Use `--mount=type=cache` for package manager caches (npm, pip)
- Multi-stage builds can separate build-time dependencies from runtime

**Source:** [Docker Build Cache Docs](https://docs.docker.com/build/cache/optimize/)

### 4.4 CRIU Checkpoint/Restore (Future)

Docker supports CRIU (Checkpoint/Restore In Userspace) as an **experimental** feature. CRIU captures full process state including memory, open files, and network connections.

**Status:** Experimental in Docker since v1.13. Not recommended for V1 -- `docker commit` (filesystem-only) is sufficient for environment caching. CRIU would be relevant if the factory needed to checkpoint mid-execution (e.g., for long-running tasks in R-027).

**Source:** [Docker Checkpoint Docs](https://docs.docker.com/reference/cli/docker/checkpoint/)

---

## 5. Security Hardening

### 5.1 Recommended Container Security Profile

The factory should create containers with the following HostConfig:

```typescript
const secureHostConfig: Docker.HostConfig = {
  // Drop ALL capabilities, add back only what's needed
  CapDrop: ['ALL'],
  CapAdd: [
    // Add back ONLY what the specific workload needs
    // For most agent workloads: none needed
    // For git operations: might need CHOWN, DAC_OVERRIDE, FOWNER
  ],

  // Prevent privilege escalation via setuid/setgid
  SecurityOpt: [
    'no-new-privileges:true',
    // Use default seccomp profile (blocks ~44 dangerous syscalls)
    // Custom profile can be specified: 'seccomp=/path/to/profile.json'
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
  // DiskQuota requires XFS with pquota -- see section 5.5

  // Network (phase-dependent)
  NetworkMode: 'none',  // execution phase default

  // User
  User: '1000:1000',  // non-root
};
```

**Sources:** [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html), [Docker Security Docs](https://docs.docker.com/engine/security/)

### 5.2 Capability Management

Docker runs containers with a default set of ~14 capabilities. For maximum security, drop all and add back only what is needed.

**Capabilities most agent workloads need:**
- None for pure code execution (read files, write files, run tests)
- `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID` if the container needs to install packages as root during setup and then switch to non-root
- `NET_RAW` only if ping/raw sockets needed (unlikely for agent workloads)

**Approach:** Start with `CapDrop: ['ALL']` and add back capabilities only when a specific workload fails. Log which capabilities are needed per setup contract for auditability.

### 5.3 Seccomp Profiles

Docker's default seccomp profile blocks ~44 of 300+ syscalls including dangerous operations like `bpf`, `mount`, `ptrace`, `clone` (new namespaces), `reboot`, `kexec_load`, and kernel module operations. The Docker documentation recommends not changing the default profile.

**Blocked syscalls (relevant subset):**
- `bpf` -- eBPF programs
- `clone` with namespace flags -- creating new namespaces
- `mount`, `umount2`, `pivot_root` -- filesystem manipulation
- `ptrace` -- process tracing (container escape vector)
- `reboot`, `kexec_load` -- system control
- `add_key`, `keyctl`, `request_key` -- kernel keyring

**Recommendation:** Use the default seccomp profile for V1. It provides strong protection without compatibility issues. A custom stricter profile can be explored if security audits indicate specific syscalls should be blocked for agent workloads.

**Source:** [Docker Seccomp Docs](https://docs.docker.com/engine/security/seccomp/)

### 5.4 User Namespaces

Docker supports user namespace remapping via `--userns-remap=default`, which maps UID 0 inside the container to a high-numbered UID on the host. This means even if a process runs as "root" inside the container, it has no root privileges on the host.

**Implementation for the factory:**
- Run agent processes as non-root user (e.g., `User: '1000:1000'`)
- Enable `--userns-remap` on the Docker daemon for defense-in-depth
- Note: userns-remap is a daemon-level setting, not per-container

**Source:** [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)

### 5.5 Resource Limits

| Resource | Flag/Option | Recommended Default | Behavior When Exceeded |
|----------|------------|--------------------|-----------------------|
| Memory | `--memory` / `Memory` | 4 GB | OOM killer terminates processes |
| CPU | `--cpus` / `NanoCpus` | 2 CPUs | Throttled (not killed) |
| PIDs | `--pids-limit` / `PidsLimit` | 256 | New process creation fails |
| Disk | `--storage-opt size=` | 10 GB | Write operations fail |
| Open files | `--ulimit nofile=` | 1024:4096 | Open calls fail with EMFILE |
| Processes | `--ulimit nproc=` | 256 | Fork calls fail |

**Disk quota caveat:** Per-container disk quotas via `--storage-opt size=` require the overlay2 storage driver on an XFS filesystem with `pquota` mount option. ext4 does not support this. On macOS (Docker Desktop), this may not be available. For V1, prefer monitoring disk usage via `docker stats` and enforcing via periodic checks rather than hard quotas.

**Source:** [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/)

### 5.6 Read-Only Root Filesystem

Running with `ReadonlyRootfs: true` prevents any writes to the container's root filesystem. Combined with explicit tmpfs mounts for writable areas, this:

1. Prevents attackers from installing persistent malware
2. Prevents agents from modifying system files
3. Forces all writable data through controlled paths

**Required tmpfs mounts for typical agent workloads:**
- `/tmp` -- general temporary files
- `/run` -- runtime state (PIDs, sockets)
- `/home/agent/.cache` -- tool caches (npm, pip)
- `/workspace` is bind-mounted from host (the repo), so it remains writable

**Source:** [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)

### 5.7 Container Escape Prevention Summary

| Vector | Mitigation |
|--------|------------|
| Kernel exploits | Keep host kernel updated; gVisor in Phase 3 |
| `docker.sock` mount | Never mount Docker socket into agent containers |
| Privileged mode | Never use `--privileged`; use `CapDrop: ['ALL']` |
| setuid/setgid binaries | `SecurityOpt: ['no-new-privileges:true']` |
| Dangerous syscalls | Default seccomp profile |
| PID namespace escape | Default PID namespace isolation |
| Network-based attacks | `NetworkMode: 'none'` during execution |
| Filesystem manipulation | `ReadonlyRootfs: true` + limited tmpfs |
| Resource exhaustion | Memory, CPU, PID, disk limits |

---

## 6. gVisor Integration (Phase 3)

### 6.1 How gVisor Works

gVisor is an application kernel that intercepts system calls from the containerized application before they reach the host kernel. It implements its own network stack (netstack) and filesystem layer.

**Key components:**
- **Sentry:** Intercepts syscalls, implements Linux kernel interface in user space
- **Gofer:** File proxy for host filesystem access
- **runsc:** OCI-compatible runtime that replaces runc

**Installation:** `sudo runsc install && sudo systemctl restart docker`
**Usage:** `docker run --runtime=runsc ...`

**Source:** [gVisor Docker Quick Start](https://gvisor.dev/docs/user_guide/quick_start/docker/)

### 6.2 Known Limitations (Critical for Factory)

| Limitation | Impact on Factory | Workaround |
|-----------|------------------|------------|
| No nested Docker | Cannot run Docker-in-Docker for container builds | Class B/C repos only; not needed for V1 Class A |
| Partial iptables | Cannot use iptables-based network filtering inside container | Use Docker-level network isolation (network mode none/proxy) |
| No block-device mounts | Cannot mount raw block devices | Not needed for agent workloads |
| DNS issues on user-defined bridges | gVisor's loopback DNS (127.0.0.10) cannot reach host DNS | Use default bridge with `--link`, host network, or IP-based communication |
| Reports Linux 4.4 kernel | Software checking kernel version may behave differently | Most modern runtimes probe capabilities, not version |
| 274/350 syscalls implemented | Some low-level software may fail | Node.js, Python, Go, Java all tested and compatible |
| io_uring not supported | Some high-performance I/O libraries may fall back | Libraries auto-probe and use alternatives |
| Filesystem caching | Files copied via `docker cp` may not be visible due to dir cache | Create a file in target dir to invalidate cache |
| SELinux conflict | Cannot run gVisor inside containers with SELinux enforcing | Label outer container with `container_engine_t` |

**Source:** [gVisor FAQ](https://gvisor.dev/docs/user_guide/faq/), [gVisor Networking](https://gvisor.dev/docs/user_guide/networking/)

### 6.3 Performance Implications

- **CPU-bound work:** No meaningful overhead. gVisor does not intercept compute operations.
- **Syscall-heavy work:** Measurable overhead. Each syscall goes through gVisor's Sentry.
- **I/O-heavy work:** Higher overhead, especially for network I/O. gVisor's netstack reimplements TCP/IP.
- **File I/O:** Moderate overhead due to Gofer proxy.

For the factory's workload (agent runs code, tests, linters), the overhead is acceptable. The primary bottleneck is LLM API latency, not container syscall throughput.

**Source:** [gVisor Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/)

### 6.4 Integration Plan for Phase 3

1. Install runsc on factory host
2. Configure Docker daemon with `runsc` runtime entry
3. Add `runtime` option to `EnvironmentState` model
4. Default: Docker (runc) for V1. gVisor (runsc) opt-in per repo.
5. Repos requiring nested Docker, full iptables, or block devices stay on runc
6. Test factory's core workloads (Node.js, Python, Go test suites) under gVisor

---

## 7. File System & Workspace Management

### 7.1 Mounting the Repo

```typescript
const container = await docker.createContainer({
  HostConfig: {
    Binds: [
      // Mount repo as workspace
      `${repoPath}:/workspace:rw`,
      // Mount factory tools (read-only)
      `${factoryToolsPath}:/factory/tools:ro`,
    ],
    WorkingDir: '/workspace',
  },
});
```

**Considerations:**
- Repo is bind-mounted read-write (agent needs to create/modify files, run git operations)
- Factory tools (validators, scanners) mounted read-only
- With `ReadonlyRootfs: true`, only bind mounts and tmpfs are writable
- File ownership: ensure container user (1000:1000) can read/write repo files

### 7.2 Collecting Output

After agent execution, the factory needs to collect:
- Modified files (git diff)
- Test results (output captured from exec streams)
- Scan results (output captured from exec streams)
- Any generated artifacts

Since the repo is bind-mounted, modified files are immediately visible on the host. No need to `docker cp`.

For exec output, dockerode provides stream attachment:

```typescript
const exec = await container.exec({
  Cmd: ['npm', 'test'],
  AttachStdout: true,
  AttachStderr: true,
});
const stream = await exec.start({ hijack: true });
// Use docker.modem.demuxStream(stream, stdout, stderr) to separate streams
```

### 7.3 Handling Large Repos

- **Shallow clones:** `git clone --depth 1` for initial checkout; fetch more history as needed
- **Git LFS:** Install `git-lfs` in the container image. Use `GIT_LFS_SKIP_SMUDGE=1` during clone, then `git lfs pull` for needed files
- **Sparse checkout:** For very large repos, checkout only needed paths (Class B feature)
- **Bind mount performance:** On macOS/Docker Desktop, bind mounts are slower due to filesystem translation. Linux hosts have native performance.

### 7.4 Git Operations Inside Container

The agent needs to:
- Create branches, commit, push to candidate branch
- Run `git diff`, `git status`, `git log`
- Perform rebases when base branch moves

**Requirements:**
- `git` installed in container image
- Git credential helper configured for the factory's GitHub App token
- `git-lfs` installed if repo uses LFS

---

## 8. Health Checks & Monitoring

### 8.1 Container Health Checks

Docker supports HEALTHCHECK with configurable parameters:

| Parameter | Default | Factory Setting |
|-----------|---------|----------------|
| `--interval` | 30s | 30s |
| `--timeout` | 30s | 10s |
| `--start-period` | 0s | 60s (allow setup) |
| `--retries` | 3 | 3 |

**Implementation:** The factory defines health checks based on the setup contract's `health_check` field:

```typescript
Healthcheck: {
  Test: ['CMD-SHELL', 'npm run typecheck && npm test -- --bail'],
  Interval: 30_000_000_000,  // nanoseconds
  Timeout: 10_000_000_000,
  Retries: 3,
  StartPeriod: 60_000_000_000,
}
```

### 8.2 Detecting Stuck/Runaway Containers

Multiple detection layers:

1. **Timeout enforcement:** Each task phase has a wall-clock timeout (default 30 min per PRD R-024). The factory monitors elapsed time and kills the container if exceeded.

2. **Resource monitoring:** Poll `container.stats()` periodically:
   ```typescript
   const stats = await container.stats({ stream: false });
   // Check CPU usage, memory usage, PIDs count
   ```

3. **No-progress detection:** PRD R-024 specifies 3 loops without state change triggers pause. The factory tracks exec exit codes and output to detect loops.

4. **OOM detection:** When a container is OOM-killed, Docker reports it via `container.inspect()` -- the `State.OOMKilled` field.

5. **Event monitoring:** Docker emits events for container lifecycle:
   ```typescript
   const eventStream = await docker.getEvents({
     filters: { container: [container.id], event: ['die', 'oom', 'kill'] }
   });
   ```

### 8.3 Log Collection

```typescript
// Stream logs from container
const logStream = await container.logs({
  follow: true,
  stdout: true,
  stderr: true,
  timestamps: true,
});

// Demux stdout/stderr
docker.modem.demuxStream(logStream, process.stdout, process.stderr);
```

Docker captures all stdout/stderr from the container's PID 1 and from exec sessions. The factory should:
- Stream logs to the audit writer (for append-only audit trail)
- Buffer recent logs for the evidence packet
- Apply log rotation / size limits to prevent unbounded storage

### 8.4 Cleanup

On task completion (success or failure):

```typescript
try {
  await container.stop({ t: 10 });  // 10 second grace period
} catch (e) {
  // Container may already be stopped
}
await container.remove({ force: true, v: true });  // remove volumes too
```

The factory must ensure cleanup happens even on crashes. A cleanup sweep (find and remove containers with the factory's label prefix older than N hours) should run periodically.

---

## 9. Git LFS Support

### 9.1 LFS in Containers

For Class A repos with simple LFS:

1. Include `git-lfs` in the base container image (or install during setup phase)
2. Use `GIT_LFS_SKIP_SMUDGE=1` during `git clone` to avoid downloading all LFS objects upfront
3. Run `git lfs pull` to download only the objects needed for the current state
4. LFS objects are stored in `.git/lfs/objects/` within the repo

### 9.2 LFS Object Caching

LFS objects are content-addressed by OID (SHA-256). Caching strategies:

1. **Host-level cache:** Mount a shared LFS cache directory into containers:
   ```typescript
   Binds: [`${lfsCache}:/home/agent/.cache/lfs:rw`]
   ```
   Configure git: `git config --global lfs.storage /home/agent/.cache/lfs`

2. **Proxy cache:** Run a Git LFS caching proxy server that intercepts LFS requests and caches objects locally. The [GitLfsCachingServer](https://github.com/glennawatson/GitLfsCachingServer) project provides this.

3. **Docker commit includes LFS objects:** Since LFS objects live in the filesystem, `docker commit` captures them in the cached image. Subsequent containers from that image start with LFS objects already present.

**Recommendation:** For V1, use approach 1 (host-level cache via bind mount). It is simple and effective for single-host deployment.

**Source:** [Git LFS CI optimization](https://www.naiyerasif.com/post/2020/09/05/using-git-lfs-in-ci/)

---

## 10. Architectural Recommendations

### 10.1 Container Lifecycle for a Single Task

```
1. RESOLVE ENVIRONMENT
   - Parse .factory/setup.yml
   - Compute cache key from setup contract + control file hashes
   - Check if cached image exists

2. CREATE CONTAINER
   IF cached:
     - docker.createContainer from cached image
   ELSE:
     - docker.pull(baseImage) or docker.buildImage(Dockerfile)
     - docker.createContainer from base image

3. SETUP PHASE (if not cached)
   - container on bridge network (outbound allowed)
   - Inject setup-only secrets via exec -e
   - Run setup commands via exec
   - Run health checks
   - docker commit → cache image
   - Disconnect from bridge network

4. MAINTENANCE PHASE (if cached)
   - container on bridge network (outbound allowed)
   - Run maintenance commands via exec
   - Run health checks
   - Disconnect from bridge network

5. EXECUTION PHASE
   - Container on 'none' network (or internal + proxy for allowlist)
   - Inject runtime secrets via exec -e
   - Run agent via exec
   - Monitor: stats, timeout, no-progress, OOM
   - Collect output: logs, modified files, test results

6. CLEANUP
   - Stop container
   - Remove container
   - Clean up any per-task networks or proxy containers
```

### 10.2 Security Layers Summary

| Layer | V1 (Docker) | Phase 3 (gVisor) |
|-------|------------|------------------|
| Process isolation | Linux namespaces (pid, net, mnt, uts, ipc) | gVisor Sentry (user-space kernel) |
| Syscall filtering | Default seccomp profile (~44 blocked) | gVisor intercepts all syscalls |
| Capabilities | `CapDrop: ALL` | gVisor + CapDrop |
| Privilege escalation | `no-new-privileges` | gVisor + no-new-privileges |
| Network | `none` / Squid proxy | gVisor netstack + `none` |
| Filesystem | Read-only root + tmpfs | gVisor Gofer + read-only root |
| Resources | Memory, CPU, PIDs, disk limits | Same limits via cgroups |
| User | Non-root (UID 1000) + optional userns-remap | Same |
| Secrets | exec-based injection, phase-separated | Same |

### 10.3 Key Implementation Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Docker client library | dockerode | Most popular, TypeScript types, Promise API, zero meaningful deps |
| Network isolation (default) | Disconnect from bridge | Simple, zero overhead, covers 90% of cases |
| Network allowlist | Squid proxy on internal network | Domain-level control, HTTPS support, audit logging |
| Secret injection | `exec -e` per phase | No persistence, no layer leakage, narrowest scope |
| Environment caching | `docker commit` | Captures filesystem state, fast restore, no CRIU dependency |
| Cache key | Hash of setup contract + control file hashes | Matches PRD cache invalidation requirements |
| Security baseline | `CapDrop ALL` + seccomp default + read-only root + non-root user | Defense in depth, OWASP-aligned |
| Resource limits | Memory + CPU + PIDs + disk monitoring | Prevent resource exhaustion without XFS dependency |
| Disk quota | Monitor via stats (V1); XFS pquota (later) | XFS requirement too heavy for V1 |
| gVisor | Phase 3 opt-in per repo | Known limitations with DNS, nested Docker, iptables |
| Log collection | dockerode stream demux | Native stream support, no extra tooling |
| LFS caching | Host-level bind mount cache | Simple, effective for single-host |

---

## 11. Open Questions for Planning

1. **Docker socket access:** The control plane needs access to the Docker socket to manage containers. This is a powerful capability. Should the control plane itself run in a container, or on the host? If in a container, it needs the socket mounted -- which is exactly what OWASP says not to do. The Temporal worker that runs the sandbox activity needs Docker access.

2. **macOS development:** Docker Desktop on macOS has different performance characteristics for bind mounts and may not support all features (XFS quotas, userns-remap). How much of the sandbox security profile needs to work on macOS for local development vs. Linux for production?

3. **Image registry:** Should the factory run a local Docker registry for cached images, or is local image storage sufficient for V1? Local is simpler but doesn't share across hosts.

4. **Concurrent containers:** How many agent containers can run simultaneously? This depends on host resources. Need configurable concurrency limits with resource reservation.

5. **Container labeling:** All factory-created containers and networks should have consistent labels for discovery and cleanup (e.g., `com.factory.task-id`, `com.factory.phase`, `com.factory.repo`).

---

## 12. Files Referenced

- `/Users/seanflanagan/proj/software-factory/docs/prd.md` -- PRD v5.1, Sections 5 (Architecture), 7 (Setup & Environment), 8 (Requirements: R-006, R-015), 10 (Security)
- `/Users/seanflanagan/proj/software-factory/.claude/plans/research.md` -- Prior research on Temporal event history
- `/Users/seanflanagan/proj/software-factory/.claude/rules/immutable.md` -- Immutable rules (user control, security-first, transparency)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/stack.md` -- Stack decisions (TBD, but PRD specifies TypeScript/Node.js 22+)
- `/Users/seanflanagan/proj/software-factory/docs/decisions.md` -- ADR log (empty)

## 13. External Sources Consulted

- [dockerode GitHub](https://github.com/apocas/dockerode) -- Node.js Docker client
- [@types/dockerode npm](https://www.npmjs.com/package/@types/dockerode) -- TypeScript types
- [DefinitelyTyped dockerode types](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/dockerode/index.d.ts) -- Type definitions
- [Docker None Network Driver](https://docs.docker.com/engine/network/drivers/none/) -- Network isolation
- [Docker Bridge Network Driver](https://docs.docker.com/engine/network/drivers/bridge/) -- Default networking
- [Docker Packet Filtering & Firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/) -- iptables integration
- [Docker exec reference](https://docs.docker.com/reference/cli/docker/container/exec/) -- Exec with env vars
- [Docker commit reference](https://docs.docker.com/reference/cli/docker/container/commit/) -- Container snapshotting
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/) -- Memory, CPU, PIDs
- [Docker Seccomp Profiles](https://docs.docker.com/engine/security/seccomp/) -- Syscall filtering
- [Docker tmpfs Mounts](https://docs.docker.com/engine/storage/tmpfs/) -- Temporary filesystems
- [Docker Security](https://docs.docker.com/engine/security/) -- Security overview
- [Docker Checkpoint (CRIU)](https://docs.docker.com/reference/cli/docker/checkpoint/) -- Experimental checkpoint/restore
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) -- Security best practices
- [Container Internet Restriction with Squid](https://www.jimangel.io/posts/docker-block-internet-squid-proxy) -- Domain-level allowlisting
- [Docker Outbound Traffic Restriction](https://dev.to/andre/docker-restricting-in--and-outbound-network-traffic-67p) -- Network control patterns
- [gVisor Docker Quick Start](https://gvisor.dev/docs/user_guide/quick_start/docker/) -- Runtime integration
- [gVisor FAQ](https://gvisor.dev/docs/user_guide/faq/) -- Compatibility, limitations
- [gVisor Networking](https://gvisor.dev/docs/user_guide/networking/) -- Network modes, DNS issues
- [gVisor Performance](https://gvisor.dev/docs/architecture_guide/performance/) -- Overhead characteristics
- [gVisor Compatibility](https://gvisor.dev/docs/user_guide/compatibility/) -- Syscall coverage
- [OpenAI Codex Cloud Environments](https://developers.openai.com/codex/cloud/environments) -- Reference implementation for phase-separated secrets
- [OpenAI Codex Sandboxing](https://developers.openai.com/codex/concepts/sandboxing) -- Sandbox architecture
- [Docker Overlay2 Quotas](https://reece.tech/posts/docker-container-size-quota/) -- Disk quota with XFS
- [Git LFS in CI](https://www.naiyerasif.com/post/2020/09/05/using-git-lfs-in-ci/) -- LFS caching patterns
- [GitLfsCachingServer](https://github.com/glennawatson/GitLfsCachingServer) -- LFS proxy cache
