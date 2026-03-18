# Research: TypeScript Monorepo Architecture for Software Factory Control Plane

**Date:** 2026-03-18
**Scope:** Project structure, tooling, patterns, and dependency choices for Phase 1 implementation
**PRD Reference:** `/Users/seanflanagan/proj/software-factory/docs/prd.md` (v5.1)

---

## 1. Monorepo vs Modular Monolith

### Recommendation: pnpm Workspaces Monorepo (without Turborepo initially)

**Why monorepo over single package:**

Temporal TypeScript projects have a hard architectural constraint: **workflow code is bundled separately into a V8 isolate** using Webpack (or esbuild). Workflow code cannot import Node.js APIs, cannot import Activity definitions directly, and runs in a deterministic sandbox. This means workflows and activities MUST be in separate modules at the import level. A single-package approach can technically work with careful file organization, but a workspace monorepo makes the boundaries explicit and enforceable.

Additional reasons:
- The CLI, Temporal worker, and (future) dashboard are separate entry points with different dependency trees
- Shared domain types, Zod schemas, and database access code should be importable without duplication
- Co-located tests per package keeps test scope clear
- pnpm's strict dependency resolution prevents phantom dependencies (a package can only import what it declares)

**Why not Turborepo initially:**

For Phase 1 with 4-6 packages, pnpm workspaces alone provide sufficient build orchestration. Turborepo adds value at scale (caching, parallel builds across many packages) but adds configuration overhead. It can be added later with zero code changes since it layers on top of pnpm workspaces.

### Recommended Package Structure

```
software-factory/
├── packages/
│   ├── core/               # Domain types, schemas, shared utilities
│   │   ├── src/
│   │   │   ├── domain/     # Task, EvidenceBundle, ReviewState, etc.
│   │   │   ├── schemas/    # Zod schemas for validation
│   │   │   ├── errors/     # Typed error definitions
│   │   │   └── config/     # Configuration types and validation
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── db/                 # Database access layer (Drizzle + Postgres)
│   │   ├── src/
│   │   │   ├── schema/     # Drizzle table definitions
│   │   │   ├── repositories/ # Query functions per domain entity
│   │   │   ├── migrations/ # SQL migration files
│   │   │   └── connection.ts
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── temporal-workflows/ # Temporal workflow definitions (bundled into V8 isolate)
│   │   ├── src/
│   │   │   ├── task-lifecycle.workflow.ts
│   │   │   ├── intake.workflow.ts
│   │   │   ├── implement.workflow.ts
│   │   │   ├── validate.workflow.ts
│   │   │   └── index.ts    # Re-exports all workflows
│   │   ├── package.json    # MINIMAL deps -- only @temporalio/workflow + core types
│   │   └── tsconfig.json
│   │
│   ├── temporal-activities/ # Temporal activity implementations (normal Node.js)
│   │   ├── src/
│   │   │   ├── github/     # GitHub API activities
│   │   │   ├── sandbox/    # Docker sandbox activities
│   │   │   ├── code-index/ # Code indexing activities
│   │   │   ├── llm/        # LLM provider activities
│   │   │   ├── audit/      # Audit writing activities
│   │   │   └── factories.ts # createActivities() factory functions
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── worker/             # Temporal worker process
│   │   ├── src/
│   │   │   ├── worker.ts   # Worker setup, activity injection
│   │   │   └── config.ts   # Worker configuration
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                # CLI interface (Phase 1 primary UI)
│       ├── src/
│       │   ├── commands/   # Command implementations
│       │   ├── formatters/ # Output formatting (tables, JSON)
│       │   ├── prompts/    # Interactive prompts
│       │   └── index.ts    # Entry point
│       ├── package.json
│       └── tsconfig.json
│
├── pnpm-workspace.yaml
├── package.json            # Root: scripts, devDependencies for tooling
├── tsconfig.base.json      # Shared TypeScript config
├── biome.json              # Linter + formatter config
├── vitest.workspace.ts     # Test configuration
├── docker-compose.yml      # Local dev: Postgres, Redis, Temporal, MinIO
├── Dockerfile              # Production build
└── .factory/               # The product's own setup contract (dogfooding)
    └── setup.yml
```

### Temporal-Specific Structural Constraints

**Critical:** The `temporal-workflows` package has unique constraints:

1. **No Node.js imports.** Workflow code runs in a V8 isolate. Importing `fs`, `http`, `crypto`, or any Node.js built-in causes a runtime error. The sandbox replaces `Math.random()`, `Date`, and `setTimeout()` with deterministic versions. `FinalizationRegistry` and `WeakRef` are removed.

2. **No direct Activity imports.** Workflows use `proxyActivities<T>()` with type-only imports to invoke activities. The actual activity code is never bundled into the workflow.

3. **Bundled with Webpack by default.** The `@temporalio/worker` SDK bundles workflow code on Worker creation. The `build-temporal-workflow` package (by Steve Kinney) provides a drop-in esbuild replacement that is 9-11x faster and uses 94% less memory -- recommended for CI.

4. **Can import pure TypeScript packages.** The `core` package (domain types, Zod schemas, pure functions) CAN be imported from workflows as long as nothing in the import chain references Node.js APIs.

**Source:** [Temporal TypeScript Core Application](https://docs.temporal.io/develop/typescript/core-application), [Intro to Isolated VM](https://temporal.io/blog/intro-to-isolated-vm), [build-temporal-workflow](https://stevekinney.com/writing/build-temporal-workflow)

### Package Dependency Graph

```
core ──────────────────────┐
  │                        │
  ├── db (core)            │
  │                        │
  ├── temporal-workflows (core -- types/schemas only, no Node.js)
  │                        │
  ├── temporal-activities (core, db)
  │                        │
  ├── worker (temporal-workflows, temporal-activities, core, db)
  │                        │
  └── cli (core, db)       │
```

---

## 2. TypeScript Configuration

### Base Config (tsconfig.base.json)

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "compilerOptions": {
    // Node.js 22 target
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],

    // Strict mode -- all flags
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,

    // Output
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "verbatimModuleSyntax": true,

    // Interop
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

**Key decisions:**

- **`module: "NodeNext"`** -- Required for proper ESM support in Node.js 22. Enforces `.js` extensions in imports (which map to `.ts` files during development). This is the recommended setting per the TypeScript/Node.js target mapping.

- **`verbatimModuleSyntax: true`** -- Enforces `import type` for type-only imports. Critical for Temporal workflows where accidental value imports could pull in Node.js code.

- **`composite: true`** -- Enables TypeScript project references for incremental builds across the monorepo. Each package's tsconfig.json extends the base and declares `references` to its dependencies.

- **`noUncheckedIndexedAccess: true`** -- Adds `| undefined` to index signatures. Prevents a common class of runtime errors.

### Live Types Strategy

For internal packages that are never published to npm, use the "live types" approach (per Colin Hacks / Zod creator): point each package's `exports` directly at TypeScript source files during development. Changes propagate instantly without build steps.

```jsonc
// packages/core/package.json
{
  "name": "@sf/core",
  "exports": {
    ".": {
      "import": "./src/index.ts",   // Live during development
      "types": "./src/index.ts"
    }
  }
}
```

For production builds, tsup/tsdown compiles to JS and the exports map switches to compiled output. Since this is a monolith deployed as a single Docker image (not published packages), the live-types approach works well.

**Source:** [Live types in a TypeScript monorepo](https://colinhacks.com/essays/live-types-typescript-monorepo), [@tsconfig/node22](https://www.npmjs.com/package/@tsconfig/node22), [Node Target Mapping](https://github.com/microsoft/TypeScript/wiki/Node-Target-Mapping)

### Build Tooling

| Tool | Purpose |
|------|---------|
| `tsc` | Type checking only (`tsc --noEmit`). Not used for building. |
| `tsx` | Dev-time execution (runs TS directly via esbuild, 5-10x faster than ts-node) |
| `tsup` or `tsdown` | Production builds for packages that need compiled output |
| `build-temporal-workflow` | Workflow bundling (esbuild-based, replaces default Webpack) |

**Note on tsdown:** tsdown is a newer alternative to tsup built on Rolldown (Rust-based), offering better performance and type definition generation. tsup's maintenance has slowed. Both are viable; tsdown is the forward-looking choice but tsup has more battle-testing.

**Source:** [TSX vs ts-node](https://betterstack.com/community/guides/scaling-nodejs/tsx-vs-ts-node/)

---

## 3. Database Access

### Recommendation: Drizzle ORM

**Why Drizzle over Prisma or Kysely:**

| Criterion | Drizzle | Prisma | Kysely |
|-----------|---------|--------|--------|
| Bundle size | ~5KB | ~40KB + 50MB binary | ~8KB |
| Performance overhead | ~12% | ~29% | ~8% |
| Schema definition | TypeScript (co-located with code) | Separate `.prisma` file | TypeScript |
| Migration control | SQL-first, transparent | Opaque, auto-generated | Manual SQL |
| Type safety | Full | Full | Full |
| Query builder | SQL-like + relational | Prisma Client API | SQL-like |
| Edge compatibility | Full | Requires adapter | Full |
| Maintenance | Active, growing | Active, mature | Active |

**Key reasons for Drizzle:**

1. **Schema-in-TypeScript aligns with the monorepo.** Domain types in `@sf/core` and table definitions in `@sf/db` share the same language. No code generation step, no `.prisma` file to keep in sync.

2. **SQL-first approach.** For append-only audit tables with content hashes (R-012), the ability to write precise SQL queries matters. Drizzle's query builder maps closely to SQL while maintaining full type safety.

3. **Migration transparency.** Drizzle Kit generates SQL migration files that are human-readable and auditable -- important for a governance-first product. Prisma's migrations are more opaque.

4. **No binary dependency.** Prisma's 50MB query engine binary adds Docker image size and deployment complexity. Drizzle is pure TypeScript/JS.

5. **Performance.** ~12% overhead vs ~29% for Prisma on simple queries. For audit writes and frequent state queries, this matters.

**Drizzle schema example for core entities:**

```typescript
// packages/db/src/schema/tasks.ts
import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", [
  "created", "needs_clarification", "assigned", "in_progress",
  "evidence_ready", "changes_requested", "approved",
  "pr_created", "external_checks_pending",
  "addressing_review_feedback", "external_blocked",
  "merge_ready", "merged", "failed"
]);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  status: taskStatusEnum("status").notNull().default("created"),
  objective: text("objective").notNull(),
  scope: jsonb("scope"),
  constraints: jsonb("constraints"),
  budget: jsonb("budget"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Connection pooling:** Use `drizzle-orm/node-postgres` with `pg.Pool` for connection pooling. For production, consider PgBouncer in the Docker Compose stack.

**Source:** [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new), [Prisma vs Drizzle vs Kysely 2026](https://www.pkgpulse.com/blog/prisma-vs-drizzle-vs-kysely-typescript-orm-tier-list), [Better Stack Drizzle vs Prisma](https://betterstack.com/community/guides/scaling-nodejs/drizzle-vs-prisma/)

---

## 4. Dependency Injection / Module Composition

### Recommendation: Closure-based Factory Functions (Temporal's official pattern)

**Why this over DI containers or Effect:**

1. **Temporal's official pattern.** The SDK's `activities-dependency-injection` sample uses factory functions that create activity implementations with injected dependencies. This is not optional -- it is how you provide database connections, API clients, and configuration to activities.

2. **No decorator/reflect-metadata magic.** Factory functions are plain TypeScript. No runtime class scanning, no experimental decorators. Aligns with functional style and immutable patterns.

3. **Testable by construction.** Factory functions accept their dependencies explicitly. In tests, pass mocks. No DI container to configure.

4. **Effect-TS is too heavy.** Effect-TS provides a comprehensive functional runtime (dependency injection, concurrency, error handling, streaming) but requires the entire team to learn a new paradigm. Harbor's production experience (Nov 2025) documented significant adoption friction. More critically, Effect has known sandbox violations when run inside Temporal workers (GitHub issue #5986 on Effect-TS/effect). Effect-TS would need careful evaluation for Temporal compatibility before adoption.

### Pattern

```typescript
// packages/temporal-activities/src/factories.ts
import type { TaskRepository } from "@sf/db";
import type { GitHubClient } from "./github/client.js";
import type { AuditWriter } from "./audit/writer.js";

export interface ActivityDeps {
  readonly taskRepo: TaskRepository;
  readonly github: GitHubClient;
  readonly audit: AuditWriter;
}

export function createTaskActivities(deps: ActivityDeps) {
  return {
    async createTask(input: CreateTaskInput): Promise<TaskId> {
      // deps.taskRepo, deps.audit available via closure
    },
    async transitionTask(taskId: TaskId, event: TaskEvent): Promise<TaskState> {
      // ...
    },
  } as const;
}

// packages/worker/src/worker.ts
import { Worker } from "@temporalio/worker";
import { createTaskActivities } from "@sf/temporal-activities";

const deps = {
  taskRepo: createTaskRepository(pool),
  github: createGitHubClient(config),
  audit: createAuditWriter(pool),
};

const worker = await Worker.create({
  taskQueue: "software-factory",
  workflowsPath: require.resolve("@sf/temporal-workflows"),
  activities: {
    ...createTaskActivities(deps),
    ...createGitHubActivities(deps),
    ...createSandboxActivities(deps),
  },
});
```

```typescript
// packages/temporal-workflows/src/task-lifecycle.workflow.ts
import { proxyActivities } from "@temporalio/workflow";
import type { createTaskActivities } from "@sf/temporal-activities";

// Type-only import -- no actual code pulled into the bundle
const { createTask, transitionTask } = proxyActivities<
  ReturnType<typeof createTaskActivities>
>({ startToCloseTimeout: "30s" });
```

**Source:** [Temporal activities-dependency-injection sample](https://github.com/temporalio/samples-typescript/tree/main/activities-dependency-injection), [Harbor on Effect-TS](https://runharbor.com/blog/2025-11-24-why-we-dont-use-effect-ts), [Effect sandbox issue #5986](https://github.com/Effect-TS/effect/issues/5986)

---

## 5. Error Handling

### Recommendation: neverthrow for application code, Temporal error model for workflow/activity errors

**Two error domains:**

1. **Application errors** (database failures, validation errors, GitHub API errors) -- Use `neverthrow` Result types in service/repository code. Pure functions return `Result<T, E>` instead of throwing.

2. **Temporal errors** (activity failures, workflow cancellation, timeouts) -- Use Temporal's built-in error model. Activities throw `ApplicationFailure` for retryable/non-retryable errors. Workflows handle these via Temporal's retry policies and error handlers.

**Why neverthrow:**

- Lightweight (~2KB), single purpose, well-understood API
- `Result<T, E>` with `ok()`, `err()`, `map()`, `mapErr()`, `andThen()` for chaining
- `ResultAsync<T, E>` for async operations -- composable with `safeTry`
- ESLint plugin (`eslint-plugin-neverthrow`) catches forgotten result unwrapping
- Suitable stepping stone -- if Effect-TS proves necessary later, migration path exists with minimal API changes
- TypeScript's type system enforces handling: callers must check `isOk()` / `isErr()`

**Caveat:** neverthrow's maintenance has slowed (unreviewed PRs as of late 2025). Monitor this. The library is small enough to fork if needed, or migrate to Effect's `Either` if the project grows to warrant it.

**Pattern for Temporal integration:**

```typescript
// Activity implementation wraps neverthrow results into Temporal errors
import { ApplicationFailure } from "@temporalio/activity";
import { Result } from "neverthrow";

function unwrapForTemporal<T, E extends Error>(result: Result<T, E>): T {
  if (result.isOk()) return result.value;
  throw ApplicationFailure.nonRetryable(result.error.message, result.error.name);
}

// In activity:
async function createTask(input: CreateTaskInput): Promise<TaskId> {
  const result = await taskRepo.create(input);
  return unwrapForTemporal(result);
}
```

**Source:** [neverthrow GitHub](https://github.com/supermacro/neverthrow), [neverthrow best practices wiki](https://github.com/supermacro/neverthrow/wiki/Error-Handling-Best-Practices), [Effect vs neverthrow](https://effect.website/docs/additional-resources/effect-vs-neverthrow/), [neverthrow practical guide](https://www.solberg.is/neverthrow)

---

## 6. Validation & Schema

### Recommendation: Zod

Zod is the standard choice for TypeScript runtime validation. No real contenders for this use case.

**Usage across the project:**

| Boundary | What Zod Validates |
|----------|-------------------|
| CLI input | Command arguments, flags, interactive prompts |
| API input (future) | Request bodies, query parameters |
| Configuration | `.factory/setup.yml` parsing, `PolicyConfig` |
| Temporal workflow input | Workflow arguments (validated before scheduling) |
| External data | GitHub webhook payloads, LLM API responses |
| Database reads | Optional: validate data from DB if schema evolution is a concern |

**Key patterns:**

1. **Define schemas in `@sf/core`, derive types.** Schemas are the single source of truth. TypeScript types are derived via `z.infer<typeof schema>`.

2. **Use `safeParse` at trust boundaries.** Never `parse` (which throws) -- use `safeParse` and handle the error explicitly. This aligns with neverthrow's approach.

3. **Validate once at the boundary, trust internally.** Parse external input at the CLI layer, API layer, or webhook handler. Internal function calls pass already-validated types.

4. **Shared schemas for Temporal.** Workflow input types are Zod schemas in `@sf/core`. The CLI validates before submitting to Temporal. Activities validate data from external sources (GitHub, LLM).

```typescript
// packages/core/src/schemas/task.ts
import { z } from "zod";

export const createTaskSchema = z.object({
  objective: z.string().min(1).max(10_000),
  repoUrl: z.string().url(),
  issueNumber: z.number().int().positive().optional(),
  budget: z.object({
    maxCostUsd: z.number().positive().default(10),
  }).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
```

**Source:** [Zod documentation](https://zod.dev/), [Zod best practices 2025](https://javascript.plainenglish.io/9-best-practices-for-using-zod-in-2025-31ee7418062e), [Zod validation in TypeScript](https://www.turing.com/blog/data-integrity-through-zod-validation)

---

## 7. CLI Framework

### Recommendation: Commander.js + Ink (for evidence review TUI)

**Why Commander.js for the CLI scaffold:**

- 35M+ weekly downloads, zero dependencies, mature, stable
- Excellent TypeScript support
- 25ms startup time (vs 135ms for oclif) -- important for CLI feel
- Simple API for the command structure needed (submit, status, evidence, approve, config)
- No plugin architecture needed -- this is a single-purpose CLI, not an extensible framework

**Why not oclif:** oclif adds 30+ dependencies, 135ms startup overhead, and a plugin architecture that this project does not need. oclif is designed for CLIs like `heroku` or `sf` (Salesforce) where extensibility matters. The software factory CLI has a fixed command set.

**Evidence review TUI with Ink:**

Evidence packets (R-008) are the primary human review surface. A rich terminal UI for viewing diffs, test results, security scan results, and blast radius is valuable. Ink (React for the terminal) provides:

- Component-based UI with React patterns
- Flexbox layout in the terminal via Yoga
- Full TypeScript support
- ink-ui component library (text inputs, alerts, lists, spinners)
- Composable with Commander.js (Commander parses args, Ink renders output)

**CLI command structure:**

```
factory submit --issue 42 [--repo .] [--budget 10]
factory status [--task T-001]
factory evidence --task T-001          # Opens Ink TUI for evidence review
factory approve --task T-001
factory reject --task T-001 [--reason "..."]
factory request-changes --task T-001   # Opens editor for feedback
factory config init                    # Interactive repo setup
factory config show
factory kill --task T-001              # Emergency stop
```

**Source:** [Commander.js](https://www.npmjs.com/package/commander), [Ink GitHub](https://github.com/vadimdemedes/ink), [Ink UI](https://github.com/vadimdemedes/ink-ui), [CLI framework comparison](https://www.pkgpulse.com/blog/how-to-build-cli-nodejs-commander-yargs-oclif)

---

## 8. Testing Strategy

### Recommendation: Vitest + Temporal Testing Utilities + Testcontainers

**Why Vitest over Jest:**

- Native ESM support (no Babel, no ts-jest configuration)
- Native TypeScript support out of the box
- 4-10x faster cold runs, 30% lower memory
- Jest-compatible API (95% drop-in)
- Works with pnpm workspaces via `vitest.workspace.ts`

**Testing layers:**

| Layer | What | Tools | Location |
|-------|------|-------|----------|
| **Unit** | Pure functions, domain logic, state machines, Zod schemas | Vitest | Co-located: `*.test.ts` next to source |
| **Integration (DB)** | Repository functions against real Postgres | Vitest + Testcontainers (`@testcontainers/postgresql`) | Co-located in `packages/db/` |
| **Integration (Temporal)** | Workflow logic with mocked activities | Vitest + `@temporalio/testing` (`TestWorkflowEnvironment`) | Co-located in `packages/temporal-workflows/` |
| **Integration (Activities)** | Activity implementations with real/mocked deps | Vitest + `MockActivityEnvironment` | Co-located in `packages/temporal-activities/` |
| **E2E** | Full workflow: CLI -> Temporal -> Postgres -> GitHub (mocked) | Vitest + Testcontainers (Postgres, Redis, Temporal) | `tests/e2e/` at root |

**Temporal testing specifics:**

- `TestWorkflowEnvironment` provides a local Temporal server with time-skipping support
- Workflows can be tested with mocked activities (fast, no external deps)
- Activities can be tested with `MockActivityEnvironment` (provides Activity context)
- The test framework supports the Java test server for time-skipping

**Testcontainers for integration tests:**

```typescript
import { PostgreSqlContainer } from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  // Run migrations, create pool
}, 30_000);

afterAll(async () => {
  await container.stop();
});
```

**Co-located test convention:**

```
packages/core/src/domain/
  task.ts
  task.test.ts        # Unit tests for task domain logic
packages/db/src/repositories/
  task-repo.ts
  task-repo.test.ts   # Integration tests with Testcontainers
```

**Source:** [Vitest documentation](https://vitest.dev/guide/comparisons.html), [Temporal TypeScript Testing](https://docs.temporal.io/develop/typescript/testing-suite), [Testcontainers for Node.js](https://testcontainers.com/guides/getting-started-with-testcontainers-for-nodejs/), [Integration Testing Node Vitest Testcontainers](https://nikolamilovic.com/posts/2025-4-15-integration-testing-node-vitest-testcontainers/)

---

## 9. Build & Dev Tooling

### Package Manager: pnpm

- Strict dependency resolution (packages can only use what they declare)
- Symlink-based `node_modules` (disk-efficient, fast installs)
- Built-in workspace support (`workspace:*` protocol)
- Widely adopted in the TypeScript monorepo ecosystem

### Linter + Formatter: Biome

**Why Biome over ESLint + Prettier:**

- Single tool replaces two (ESLint + Prettier)
- 10-25x faster (Rust-based): linting 10K files in ~0.8s vs ~45s for ESLint
- Single config file (`biome.json`) vs 3-4 files
- Zero npm dependencies (single binary)
- 423+ lint rules as of v2.3 (Jan 2026)
- Type-aware linting since v2.0 (June 2025) -- covers ~85% of typescript-eslint rules
- Prettier-compatible formatting

**Trade-off:** Biome covers ~80% of common ESLint rules. The missing 20% is mostly framework-specific plugins. For a Node.js backend + CLI project (no React/Vue/Angular), Biome's coverage is sufficient.

**Exception:** If `eslint-plugin-neverthrow` proves essential for enforcing Result type handling, ESLint can be added alongside Biome for linting only (Biome handles formatting). But try Biome alone first.

### Dev Workflow

| Task | Command | Tool |
|------|---------|------|
| Run TS directly | `pnpm tsx src/index.ts` | tsx (esbuild) |
| Type check | `pnpm tsc --noEmit` | tsc |
| Lint + format | `pnpm biome check --fix` | Biome |
| Test | `pnpm vitest` | Vitest |
| Test (watch) | `pnpm vitest --watch` | Vitest |
| Build (production) | `pnpm tsup` | tsup/tsdown |
| Bundle workflows | `build-temporal-workflow` | esbuild |
| Migrate DB | `pnpm drizzle-kit migrate` | Drizzle Kit |
| Generate migration | `pnpm drizzle-kit generate` | Drizzle Kit |

### Docker Compose for Local Development

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: software_factory
      POSTGRES_USER: sf
      POSTGRES_PASSWORD: sf_dev
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  temporal:
    image: temporalio/auto-setup:latest
    depends_on:
      - postgres
    ports:
      - "7233:7233"  # gRPC
    environment:
      - DB=postgres12
      - DB_PORT=5432
      - POSTGRES_USER=sf
      - POSTGRES_PWD=sf_dev
      - POSTGRES_SEEDS=postgres

  temporal-ui:
    image: temporalio/ui:latest
    depends_on:
      - temporal
    ports:
      - "8233:8080"
    environment:
      - TEMPORAL_ADDRESS=temporal:7233

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio_dev
```

**Note:** Temporal's `auto-setup` image uses its own Postgres database for internal state. The application's Postgres database is separate. In production, these could be separate Postgres instances or separate databases on the same instance.

**Source:** [Biome vs ESLint 2026](https://www.pkgpulse.com/blog/eslint-vs-biome-2026), [Biome migration guide](https://dev.to/pockit_tools/biome-the-eslint-and-prettier-killer-complete-migration-guide-for-2026-27m), [pnpm workspaces](https://pnpm.io/workspaces)

---

## 10. Configuration Management

### Recommendation: Layered config with Zod validation

```typescript
// packages/core/src/config/index.ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  MINIO_ENDPOINT: z.string().default("localhost:9000"),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  OPENROUTER_API_KEY: z.string(),
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Fail fast with clear error messages
    const formatted = result.error.format();
    throw new Error(`Invalid configuration:\n${JSON.stringify(formatted, null, 2)}`);
  }
  return Object.freeze(result.data);
}
```

Config is validated once at startup (worker and CLI entry points), then passed as an immutable object through the dependency injection layer.

---

## 11. Summary of Recommendations

| Area | Choice | Rationale |
|------|--------|-----------|
| Structure | pnpm workspaces monorepo (6 packages) | Temporal requires separate workflow/activity modules; shared types need a home |
| TypeScript | Strict mode, NodeNext modules, composite projects, live types | Node.js 22 ESM, incremental builds, no build step during dev |
| Database | Drizzle ORM | SQL-first, TypeScript schemas, transparent migrations, no binary dep |
| DI Pattern | Closure-based factory functions | Temporal's official pattern; testable, functional, no magic |
| Error Handling | neverthrow (app code) + Temporal error model (workflows) | Lightweight Result types; typed errors without Effect's weight |
| Validation | Zod | Industry standard; shared schemas; safeParse at boundaries |
| CLI | Commander.js + Ink | Lightweight CLI scaffold + React-based TUI for evidence review |
| Testing | Vitest + @temporalio/testing + Testcontainers | ESM-native, fast, Temporal-integrated, real Postgres in tests |
| Linter/Formatter | Biome | Single tool, 25x faster, sufficient rule coverage for backend |
| Package Manager | pnpm | Strict deps, efficient, workspace-native |
| Build | tsx (dev), tsup (prod), build-temporal-workflow (workflows) | Fast dev iteration, optimized production builds |

---

## 12. Open Questions for Planning Phase

1. **Temporal database vs application database.** Should Temporal use a separate Postgres instance, or a separate database on the same instance? Separate instance is cleaner but adds operational overhead for local dev.

2. **Workflow granularity.** The PRD describes per-phase workflows (intake, implement, validate, review) with Continue-As-New handoff. Should these be separate workflow types or a single workflow with phase-based Continue-As-New? Separate types are simpler to test and reason about.

3. **CLI auth.** R-018 specifies API key auth. How does the CLI authenticate? Config file (`~/.config/software-factory/config.json`)? Environment variable? Both?

4. **OpenTelemetry integration.** How early to add observability? Temporal has built-in OTel interceptors for the TypeScript SDK. Adding tracing from day 1 is low-effort and high-value for debugging workflows.

5. **Biome vs ESLint.** If `eslint-plugin-neverthrow` proves essential, should we run both Biome (formatting) and ESLint (linting), or just ESLint + Prettier? Evaluate after initial setup.

---

## 13. Files Referenced

- `/Users/seanflanagan/proj/software-factory/docs/prd.md` -- PRD v5.1 (Sections 5.1-5.4, 7, 11, 17)
- `/Users/seanflanagan/proj/software-factory/.claude/plans/research.md` -- Prior research on Temporal event history vs Postgres
- `/Users/seanflanagan/proj/software-factory/.claude/rules/conventions.md` -- Coding conventions (functional style, immutable patterns)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/stack.md` -- Stack decisions (all TBD)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/immutable.md` -- Immutable rules (user control, security-first, transparency)
- `/Users/seanflanagan/proj/software-factory/docs/decisions.md` -- ADR log (empty)

## 14. External Sources Consulted

### Temporal TypeScript SDK
- [Core Application](https://docs.temporal.io/develop/typescript/core-application) -- Activities, workflows, workers, bundling
- [Testing Suite](https://docs.temporal.io/develop/typescript/testing-suite) -- TestWorkflowEnvironment, MockActivityEnvironment
- [Intro to Isolated VM](https://temporal.io/blog/intro-to-isolated-vm) -- V8 sandbox constraints
- [Activities Dependency Injection Sample](https://github.com/temporalio/samples-typescript/tree/main/activities-dependency-injection) -- Factory function pattern
- [Food Delivery Sample (monorepo)](https://github.com/temporalio/samples-typescript/tree/main/food-delivery) -- pnpm + Turborepo structure
- [build-temporal-workflow](https://stevekinney.com/writing/build-temporal-workflow) -- esbuild replacement for Webpack bundling
- [Effect sandbox issue #5986](https://github.com/Effect-TS/effect/issues/5986) -- Effect-TS incompatibility with Temporal sandbox

### TypeScript Configuration
- [@tsconfig/node22](https://www.npmjs.com/package/@tsconfig/node22) -- Base config for Node.js 22
- [Node Target Mapping](https://github.com/microsoft/TypeScript/wiki/Node-Target-Mapping) -- TypeScript target vs Node.js version
- [Live types in a TypeScript monorepo](https://colinhacks.com/essays/live-types-typescript-monorepo) -- No-build-step internal packages
- [tsconfig best practices](https://notes.shiv.info/javascript/2025/04/21/tsconfig-best-practices/) -- Strict mode and module settings

### Database
- [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new) -- Getting started
- [Drizzle vs Prisma](https://betterstack.com/community/guides/scaling-nodejs/drizzle-vs-prisma/) -- Detailed comparison
- [Prisma vs Drizzle vs Kysely 2026 Tier List](https://www.pkgpulse.com/blog/prisma-vs-drizzle-vs-kysely-typescript-orm-tier-list) -- Performance benchmarks

### Error Handling
- [neverthrow GitHub](https://github.com/supermacro/neverthrow) -- Library documentation
- [neverthrow best practices](https://github.com/supermacro/neverthrow/wiki/Error-Handling-Best-Practices) -- Official wiki
- [Effect vs neverthrow](https://effect.website/docs/additional-resources/effect-vs-neverthrow/) -- Official comparison
- [Harbor on Effect-TS](https://runharbor.com/blog/2025-11-24-why-we-dont-use-effect-ts) -- Production experience report

### CLI & TUI
- [Commander.js](https://www.npmjs.com/package/commander) -- CLI framework
- [Ink](https://github.com/vadimdemedes/ink) -- React for terminal UIs
- [Ink UI](https://github.com/vadimdemedes/ink-ui) -- Component library for Ink
- [CLI framework comparison](https://www.pkgpulse.com/blog/how-to-build-cli-nodejs-commander-yargs-oclif) -- Commander vs yargs vs oclif

### Testing
- [Vitest vs Jest comparison](https://betterstack.com/community/guides/scaling-nodejs/vitest-vs-jest/) -- Performance and features
- [Testcontainers for Node.js](https://testcontainers.com/guides/getting-started-with-testcontainers-for-nodejs/) -- Getting started
- [Integration Testing Node Vitest Testcontainers](https://nikolamilovic.com/posts/2025-4-15-integration-testing-node-vitest-testcontainers/) -- Practical guide

### Linter/Formatter
- [Biome vs ESLint 2026](https://www.pkgpulse.com/blog/eslint-vs-biome-2026) -- Landscape comparison
- [Biome migration guide 2026](https://dev.to/pockit_tools/biome-the-eslint-and-prettier-killer-complete-migration-guide-for-2026-27m) -- Practical migration

### Monorepo
- [Turborepo structuring guide](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) -- Directory layout
- [Monorepo tools 2026](https://viadreams.cc/en/blog/monorepo-tools-2026/) -- Turborepo vs Nx vs pnpm comparison
- [pnpm workspaces](https://pnpm.io/workspaces) -- Configuration reference

### Validation
- [Zod documentation](https://zod.dev/) -- Library reference
- [Zod best practices 2025](https://javascript.plainenglish.io/9-best-practices-for-using-zod-in-2025-31ee7418062e) -- Practical patterns
