# M8: Observer Mode CLI — Implementation Plan

## Context

M8 is the last genuinely incomplete milestone (M17/M18 were implemented but unchecked). It sits at the Phase 2/3 boundary — the factory's pre-task repo onboarding flow. Without it:
- Users cannot inspect a repo's governance posture before submitting tasks
- `CapabilitySnapshot` data is ephemeral (workflow memory only, never persisted)
- Dashboard repo pages are empty placeholder shells
- The CLI has no repo-related commands

**Goal:** `factory repo scan <owner/repo>` → API runs capability scan → persists snapshot → CLI displays readiness report. Secondary: `factory repo list`, `factory repo status`, dashboard population.

---

## Step 1: Database — `capability_snapshots` table

### Schema file: `packages/db/src/schema/capability-snapshots.ts` (NEW)

```
capability_snapshots table:
  id: uuid PK (defaultRandom)
  repoId: uuid FK → repos.id (notNull)
  capturedAt: timestamptz (notNull, defaultNow)
  sourceRevision: text (notNull) — commit SHA of default branch at scan time
  snapshot: jsonb.$type<CapabilitySnapshot>() (notNull) — full scan result
  createdAt: timestamptz (notNull, defaultNow)

Indexes:
  (repo_id, captured_at DESC) — for "latest snapshot" lookups
```

Pattern: Follow `evidence-bundles.ts` — JSONB with `.$type<T>()`, FK to parent table, immutable after creation.

### Schema index: `packages/db/src/schema/index.ts` (MODIFY)
Add `export * from "./capability-snapshots.js";`

### Repository: `packages/db/src/repositories/capability-snapshot-repository.ts` (NEW)

Functions (following `repo-repository.ts` pattern — `FactoryResult<T>` returns, `try/catch → err(createFactoryError(...))`):
- `createCapabilitySnapshot(db, input)` → insert with audit entry in transaction (follow `evidence-repository.ts` pattern)
- `getLatestCapabilitySnapshot(db, repoId)` → select where repoId, order by capturedAt DESC, limit 1
- `listCapabilitySnapshots(db, repoId)` → select where repoId, order by capturedAt DESC

### DB index: `packages/db/src/index.ts` (MODIFY)
Add `export * as capabilitySnapshotRepo from "./repositories/capability-snapshot-repository.js";`

### Migration: `packages/db/drizzle/0003_capability_snapshots.sql` (NEW)
Generate via `drizzle-kit generate` after schema file is created, or hand-write SQL following the `-->statement-breakpoint` pattern.

### Update `repos` table on scan: `packages/db/src/repositories/repo-repository.ts` (MODIFY)
Add `updateRepoFromScan(db, repoId, { repoClass, defaultBranch })` to sync repo row with latest scan.

---

## Step 2: API — Repo routes + CredentialBroker

### Key decision: How the API runs scans

The API already depends on `@software-factory/temporal-activities` (`packages/api/package.json:18`). `scanRepository` and `CredentialBroker` are exported from that package and have zero Temporal dependencies — they're pure async functions. The API constructs a `CredentialBroker` from env vars (same as the worker does in `packages/worker/src/worker.ts:61`).

### Config: `packages/api/src/app.ts` (MODIFY)

Add to `AppConfig`:
```typescript
readonly githubAppId?: string;
readonly githubPrivateKey?: string;
readonly githubInstallationId?: number;
```

Read from env vars in direct execution block (lines 89-111):
```typescript
githubAppId: process.env.GITHUB_APP_ID,
githubPrivateKey: process.env.GITHUB_PRIVATE_KEY,
githubInstallationId: process.env.GITHUB_INSTALLATION_ID ? Number(process.env.GITHUB_INSTALLATION_ID) : undefined,
```

Construct CredentialBroker (if credentials present) and decorate on server:
```typescript
if (config.githubAppId && config.githubPrivateKey && config.githubInstallationId) {
  const broker = new CredentialBroker(config.githubAppId, config.githubPrivateKey, config.githubInstallationId);
  server.decorate("credentialBroker", broker);
  server.decorate("githubInstallationId", config.githubInstallationId);
}
```

Register `repoRoutes`:
```typescript
await server.register(repoRoutes);
```

### Server types: `packages/api/src/middleware/auth.ts` (MODIFY)

Add to `FastifyInstance` augmentation (lines 10-18):
```typescript
credentialBroker?: import("@software-factory/temporal-activities").CredentialBroker;
githubInstallationId?: number;
```

### Server options: `packages/api/src/server.ts` (MODIFY)

Add to `ServerOptions`:
```typescript
readonly githubAppId?: string;
readonly githubPrivateKey?: string;
readonly githubInstallationId?: number;
```

Pass through in `createServer` and conditionally construct/decorate the CredentialBroker there (not in app.ts — keep server.ts as the decorator source). This keeps app.ts clean.

### Routes: `packages/api/src/routes/repos.ts` (NEW)

Follow `tasks.ts` pattern: async function, Zod validation, auth middleware, error responses.

**`GET /api/repos`** — List repos with latest scan metadata
- Auth: `authMiddleware` (any authenticated role)
- Calls `repoRepo.listRepos(app.db)`
- For each repo, get latest snapshot metadata (capturedAt, repoClass) — use a lightweight query
- Response: `{ repos: Array<{ id, githubOwner, githubRepo, defaultBranch, repoClass, autonomyLevel, lastScannedAt? }> }`

**`GET /api/repos/:id`** — Get repo with latest capability snapshot
- Auth: `authMiddleware`
- Calls `repoRepo.getRepo(app.db, id)`
- Calls `capabilitySnapshotRepo.getLatestCapabilitySnapshot(app.db, id)`
- Response: `{ repo: {...}, latestSnapshot: CapabilitySnapshot | null, capturedAt: string | null }`

**`POST /api/repos/scan`** — Run capability scan
- Auth: `authMiddleware, requireRole("admin", "operator")`
- Body: `{ owner: string, repo: string }` (Zod `.strict()`)
- Guard: if `!app.credentialBroker`, return 503 `"github_not_configured"`
- Get or create repo: `repoRepo.getOrCreateRepo(app.db, owner, repo)`
- Run scan: `scanRepository(owner, repo, app.credentialBroker, app.githubInstallationId)`
- If scan fails: return 502 with scan error
- Persist: `capabilitySnapshotRepo.createCapabilitySnapshot(app.db, {...})`
- Update repo: `repoRepo.updateRepoFromScan(app.db, repoId, { repoClass, defaultBranch })`
- Response: `{ repo: {...}, snapshot: CapabilitySnapshot, capturedAt: string }`

---

## Step 3: CLI — Repo command + API client

### API client: `packages/cli/src/api-client.ts` (MODIFY)

Add response types:
```typescript
export interface RepoSummary {
  readonly id: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly defaultBranch: string;
  readonly repoClass: string;
  readonly autonomyLevel: string;
  readonly lastScannedAt?: string;
}

export interface RepoListResponse {
  readonly repos: readonly RepoSummary[];
}

export interface RepoDetailResponse {
  readonly repo: RepoSummary;
  readonly latestSnapshot: Record<string, unknown> | null;
  readonly capturedAt: string | null;
}

export interface ScanResponse {
  readonly repo: RepoSummary;
  readonly snapshot: Record<string, unknown>;
  readonly capturedAt: string;
}
```

Add client methods:
```typescript
async listRepos(): Promise<RepoListResponse> {
  return request<RepoListResponse>("GET", "/api/repos");
},
async getRepo(repoId: string): Promise<RepoDetailResponse> {
  return request<RepoDetailResponse>("GET", `/api/repos/${repoId}`);
},
async scanRepo(owner: string, repo: string): Promise<ScanResponse> {
  return request<ScanResponse>("POST", "/api/repos/scan", { owner, repo });
},
```

### Repo command: `packages/cli/src/commands/repo.ts` (NEW)

Follow the `safety.ts` subcommand pattern:

```
factory repo scan <owner/repo>  — Run scan, display readiness report
factory repo list               — List repos in table format
factory repo status <id>        — Show repo with latest scan summary
```

**`scan` subcommand:**
1. Parse `<owner/repo>` argument (split on `/`)
2. `const config = getConfig(); const client = createApiClient(config);`
3. Show spinner via `ora` while scanning
4. `const result = await client.scanRepo(owner, repo)`
5. If `config.json`: `console.log(JSON.stringify(result, null, 2)); return;`
6. Display readiness report via `formatReadinessReport(result.snapshot)`
7. Error handling: `catch (e) { console.error(chalk.red(...)); process.exitCode = 1; }`

**`list` subcommand:**
1. `const { repos } = await client.listRepos()`
2. If `config.json`: JSON output
3. Display via `formatTable` with columns: Owner/Repo, Class, Branch, Last Scanned

**`status` subcommand:**
1. `const data = await client.getRepo(repoId)`
2. If `config.json`: JSON output
3. Display repo info + abbreviated snapshot summary

### Register: `packages/cli/src/index.ts` (MODIFY)
Add `import { createRepoCommand } from "./commands/repo.js";`
Add `program.addCommand(createRepoCommand(getConfig));`

---

## Step 4: Readiness Report Formatter

### `packages/cli/src/ui/readiness-report.ts` (NEW)

Follow `evidence-display.ts` pattern: pure function, returns string, uses chalk + formatTable.

```typescript
export function formatReadinessReport(snapshot: Record<string, unknown>): string
```

**Sections:**
1. **Repository Overview** — owner/repo, visibility, class (A/B/C), supported status + reasons, archived/fork warnings
2. **Branch Protection** — review count, dismiss stale, code owner review, signed commits, linear history
3. **Rulesets** — count (own + inherited), enforcement, bypass actors, key rules
4. **CODEOWNERS** — found/not, location, entry count, parse errors
5. **Merge Configuration** — merge queue, allowed strategies, required checks
6. **Security** — dangerous workflows, push restrictions, environments
7. **Warnings** — all warnings from scan
8. **Setup Contract** — whether `.factory/setup.yml` detected (from snapshot data), suggested next steps

Uses `section()` helper (same as evidence-display.ts) for section headers.
Uses `formatTable()` for structured data (rulesets, checks).
Color-codes: `chalk.green` for good states, `chalk.yellow` for warnings, `chalk.red` for blockers.

---

## Step 5: Dashboard — Populate repo pages

### Dashboard API client: `apps/dashboard/src/lib/api/client.ts` (MODIFY)

Add response types and methods following existing pattern:
```typescript
// Add to return object:
getRepos: () => request<RepoListResponse>("/api/repos"),
getRepo: (id: string) => request<RepoDetailResponse>(`/api/repos/${id}`),
```

### Repo list page: `apps/dashboard/src/routes/repos/+page.svelte` (MODIFY)
- Fetch repos from API on mount
- Display in a table: owner/repo, class, default branch, last scanned
- Link each row to `/repos/{id}`
- Keep scan CTA: "Run `factory repo scan owner/repo` to scan a new repository"

### Repo detail page: `apps/dashboard/src/routes/repos/[id]/+page.svelte` (MODIFY)
- Fetch repo + latest snapshot from API on mount
- Display capability snapshot sections (branch protection, rulesets, CODEOWNERS, merge config, warnings)
- If no snapshot: "This repository has not been scanned yet"

---

## Step 6: Tests

### CLI tests: `packages/cli/__tests__/commands.test.ts` (MODIFY)
- `factory repo --help` shows scan/list/status subcommands
- `factory repo scan` without args shows usage error

### API client tests: `packages/cli/__tests__/api-client.test.ts` (MODIFY)
- Mock `POST /api/repos/scan` → returns scan result
- Mock `GET /api/repos` → returns repo list
- Mock `GET /api/repos/:id` → returns repo detail

### Readiness report tests: `packages/cli/__tests__/readiness-report.test.ts` (NEW)
- Test with full CapabilitySnapshot mock → verify all sections present
- Test with minimal snapshot (no rulesets, no CODEOWNERS) → verify graceful display
- Test with unsupported repo → verify red warnings

### API route tests: `packages/api/__tests__/repo-routes.test.ts` (NEW)
- `GET /api/repos` returns empty list → returns list after scan
- `POST /api/repos/scan` without GitHub config → 503
- `GET /api/repos/:id` → returns repo + snapshot

---

## Files Summary

### CREATE (7 files)
| File | Purpose |
|------|---------|
| `packages/db/src/schema/capability-snapshots.ts` | Drizzle schema |
| `packages/db/src/repositories/capability-snapshot-repository.ts` | CRUD repository |
| `packages/db/drizzle/0003_capability_snapshots.sql` | Migration |
| `packages/api/src/routes/repos.ts` | API routes |
| `packages/cli/src/commands/repo.ts` | CLI command |
| `packages/cli/src/ui/readiness-report.ts` | Report formatter |
| `packages/cli/__tests__/readiness-report.test.ts` | Formatter tests |

### MODIFY (10 files)
| File | Change |
|------|--------|
| `packages/db/src/schema/index.ts` | Export capability-snapshots |
| `packages/db/src/index.ts` | Export capabilitySnapshotRepo |
| `packages/db/src/repositories/repo-repository.ts` | Add `updateRepoFromScan` |
| `packages/api/src/app.ts` | Add GitHub config, construct broker, register repoRoutes |
| `packages/api/src/server.ts` | Add GitHub options, decorate broker |
| `packages/api/src/middleware/auth.ts` | Augment FastifyInstance with credentialBroker |
| `packages/cli/src/api-client.ts` | Add repo methods + response types |
| `packages/cli/src/index.ts` | Register createRepoCommand |
| `apps/dashboard/src/lib/api/client.ts` | Add repo methods + types |
| `apps/dashboard/src/routes/repos/+page.svelte` | Fetch + display repo list |
| `apps/dashboard/src/routes/repos/[id]/+page.svelte` | Fetch + display capability snapshot |

### DO NOT TOUCH
| File | Reason |
|------|--------|
| `packages/cli/src/config.ts` | Already complete |
| `packages/cli/src/commands/config.ts` | Already complete |
| `packages/core/src/schemas/capability.ts` | Stable schema |
| `packages/temporal-activities/src/github/capability-scan.ts` | Working scan, reuse as-is |
| `packages/temporal-workflows/src/orchestrator.ts` | No changes needed |

---

## Verification

1. `pnpm install` — no new external dependencies needed
2. `pnpm run typecheck` — all packages compile
3. `pnpm --filter @software-factory/db run db:migrate` — migration applies cleanly
4. `pnpm run test` — all existing + new tests pass
5. Manual: `factory repo scan <owner/repo>` displays readiness report (requires API + GitHub App running)
6. Manual: `factory repo list` shows scanned repos in table
7. Manual: `factory repo scan --json <owner/repo>` outputs valid JSON
8. Dashboard: `/repos` page shows repo list, `/repos/{id}` shows capability snapshot

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| API scan is synchronous — could timeout for repos with many rulesets | GitHub API calls are bounded (~15 calls max). Set Fastify route timeout to 30s. |
| CredentialBroker constructed in API — same env vars as worker | Guard with `if (!app.credentialBroker)` → 503 gracefully. Same `.env` file used by both. |
| `scanRepository` imports pull in Temporal transitive deps | Verified: `scanRepository` and `CredentialBroker` have zero Temporal imports. |
| Migration conflicts with in-flight `0002_last_argent.sql` | `0002` is already committed. `0003` is the next sequential slot. |
