---
description: Technology choices and constraints. These are LOCKED — do not deviate without escalating.
---
# Stack

- **Runtime**: Node.js 22 LTS (`node:22-slim` for Docker)
- **Language**: TypeScript strict (`typescript` 5.x, `@tsconfig/node22`)
- **Package manager**: pnpm 10+ (workspaces, strict deps)
- **Monorepo**: pnpm workspaces — 7 packages (core, db, temporal-workflows, temporal-activities, worker, api, cli)
- **HTTP**: Fastify + `@fastify/type-provider-zod`
- **Orchestration**: Temporal (`@temporalio/*` 1.14.x — ALL packages MUST share exact version)
- **Database**: PostgreSQL 16 (`postgres:16-alpine`) — system of record
- **ORM**: Drizzle ORM (`drizzle-orm` + `drizzle-kit` + `pg`)
- **Cache/PubSub**: Redis 7 (`redis:7-alpine` + `ioredis`)
- **Object storage**: MinIO S3-compatible (`quay.io/minio/minio` + `@aws-sdk/client-s3`)
- **LLM**: Vercel AI SDK (`ai` + `@openrouter/ai-sdk-provider`)
- **GitHub**: Octokit (`@octokit/rest` + `@octokit/auth-app` + `@octokit/webhooks` + `@octokit/graphql`)
- **Docker**: dockerode ^4.0.9
- **Code parsing**: tree-sitter (native N-API, WASM fallback)
- **Validation**: Zod (`safeParse` at boundaries, types derived via `z.infer<>`)
- **Error handling**: neverthrow (`Result<T, E>`)
- **CLI**: Commander.js + Ink + ink-ui
- **Tests**: Vitest + `@testcontainers/postgresql` + `@temporalio/testing`
- **Linter/Formatter**: Biome (`@biomejs/biome`)
- **Build (dev)**: tsx
- **Build (prod)**: tsup + `build-temporal-workflow`
- **Logging**: Pino (structured JSON, OTel trace correlation)
- **Observability**: OpenTelemetry (tiered: built-in → optional export → full Grafana)
- **Config**: TOML (`@iarna/toml`, XDG paths)
- **Glob matching**: picomatch (ReDoS-safe, 0 deps)
- **Frontend (Phase 2)**: SvelteKit

## Critical Constraints

- `packages/core` must be pure TypeScript — NO Node.js APIs (imported by Temporal workflows in V8 isolate)
- `verbatimModuleSyntax: true` in tsconfig — enforces `import type` for Temporal safety
- `packages/temporal-workflows` cannot import activity code — use `proxyActivities<T>()` with type-only imports
- Effect-TS is incompatible with Temporal sandbox (GitHub #5986)
- All `@temporalio/*` packages must share exact same version number
