# Research: .env Loading in pnpm Monorepo (Node 22+/24)

**Date:** 2026-03-20

## Problem Statement

Three dev scripts need environment variables from the root `.env`:
1. **Root** `worker:dev`: `cd packages/worker && npx tsx src/index.ts` -- cwd = `packages/worker/`
2. **packages/api** `dev`: `tsx src/app.ts` -- cwd = `packages/api/` (when run via `pnpm --filter`)
3. **packages/db** `db:migrate` / `db:generate`: `drizzle-kit migrate` / `drizzle-kit generate` -- cwd = `packages/db/`

pnpm sets cwd to the **package directory** when running filtered commands, so packages 2 levels deep cannot find a root `.env` without explicit path handling.

---

## Question 1: Does `tsx` support `--env-file`?

**Yes.** tsx is a drop-in node replacement that passes through all Node.js CLI flags. From the official docs (tsx.is/node-enhancement):

> "You can pass in Node CLI flags [...] `tsx --env-file=.env ./file.js`"

All Node CLI flags (with a few tsx-specific exceptions) are propagated directly to the underlying Node.js process. So `tsx --env-file=../../.env src/app.ts` works correctly.

**Conclusion:** tsx supports `--env-file` natively. No wrapper needed.

---

## Question 2: Does `node --import tsx` work as a replacement that allows `--env-file`?

**Yes.** `node --env-file=.env --import=tsx src/index.ts` is a valid pattern documented on tsx.is. The `--import` flag registers tsx as a loader, while `--env-file` is handled by Node itself before any user code runs.

However, this is **unnecessary** since tsx CLI already passes through `--env-file` (Question 1). The `node --import tsx` pattern is useful for cases where you need deeper Node.js flag control (e.g., `--watch`, diagnostics flags), but for simple env file loading, `tsx --env-file=... script.ts` is simpler and equivalent.

**Conclusion:** Works but unnecessary. tsx CLI already handles it.

---

## Question 3: Does pnpm have built-in `.env` loading?

**No.** pnpm has no built-in mechanism for loading `.env` files into script execution environments. pnpm-workspace.yaml supports `${NAME}` variable interpolation in configuration values (from the shell environment), but this is for pnpm config, not for populating `process.env` in spawned scripts.

pnpm does set `INIT_CWD` to the directory where `pnpm` was invoked, which could theoretically be used to locate the root, but this doesn't help with env loading.

**Conclusion:** pnpm provides no help here. Env loading must be handled at the script level.

---

## Question 4: What do popular TypeScript monorepos do?

### Turborepo
- Does **not** load `.env` files into task runtimes. Leaves that to frameworks or tools like `dotenv`.
- Uses `.env` files for **cache hashing** only (via `globalDependencies` in turbo.json).
- Recommends `dotenv-cli` as a prefix: `"dev": "dotenv -- turbo dev"`.
- Best practice: define `.env` files in the apps that need them, not at workspace root.

### Nx
- Has `@nx/js:node` executor that supports `envFile` option.
- Generally recommends per-project `.env` files with an optional shared root `.env`.

### Common community pattern
- `dotenv-cli` as a dev dependency at root, prefixed on scripts.
- Or: Node's native `--env-file` flag (increasingly popular since Node 20.6+).

**Conclusion:** The ecosystem is moving toward Node's native `--env-file`. `dotenv-cli` remains the most common runtime-agnostic wrapper but is becoming a legacy approach.

---

## Question 5: Is `dotenv-cli` the standard approach?

**It was.** `dotenv-cli` is widely used but adds an unnecessary dependency now that Node 22+ has native `--env-file` support. In a monorepo context:

```json
"dev": "dotenv -e ../../.env -- tsx src/app.ts"
```

The `-e` flag accepts a relative path. This works, but requires installing `dotenv-cli` as a devDependency.

### Alternatives considered
| Tool | Fit | Notes |
|------|-----|-------|
| `dotenv-cli` | Good | Well-known, cross-platform, but an extra dep |
| `@dotenv-run/cli` | Over-engineered | Auto-walks from cwd to workspace root. Heavy for this use case |
| `dotenv-mono` | Niche | Centralized `.env` for monorepos. Low adoption |
| `dotenvx` | Overkill | Successor to dotenv with encryption focus |
| Node `--env-file` | Best | Zero deps, idiomatic for Node 22+, tsx passes it through |

**Conclusion:** `dotenv-cli` works but is now a legacy approach for Node 22+ projects. Prefer `--env-file`.

---

## Question 6: Node 22's `--env-file` combined with tsx -- the recommended approach

### How `--env-file` works
- Available since Node 20.6.0, stable in Node 22+
- Resolves paths **relative to cwd** (not relative to the script)
- Shell environment variables **take precedence** over `.env` file values
- Multiple `--env-file` flags are supported; later files override earlier ones
- `--env-file=path` **exits with error** if the file is missing
- `--env-file-if-exists=path` silently skips if missing (Node 22.9+)
- Known bug: `--env-file-if-exists` + `--watch` throws even when file is missing (Node 22.14). Not relevant here.

### Why this is the best fit
1. Zero additional dependencies
2. Idiomatic for Node 22+/24 projects
3. tsx passes it through as a native Node flag
4. Path resolution relative to cwd matches pnpm's behavior (cwd = package dir)
5. Env vars are loaded before any user code executes (no race conditions)

---

## Recommendation

### For tsx-based scripts: use `--env-file`

| Script | Current | Proposed |
|--------|---------|----------|
| root `worker:dev` | `cd packages/worker && npx tsx src/index.ts` | `tsx --env-file=.env packages/worker/src/index.ts` |
| api `dev` | `tsx src/app.ts` | `tsx --env-file=../../.env src/app.ts` |

**Note on worker:dev:** The current script does `cd packages/worker` then runs tsx. The proposed version runs from root, so cwd stays at the project root. **Caveat:** If any worker code uses `process.cwd()` or relative paths expecting to be inside `packages/worker/`, this change would break those. Verify before changing. If cwd matters, keep the `cd` pattern:
```json
"worker:dev": "cd packages/worker && npx tsx --env-file=../../.env src/index.ts"
```

### For drizzle-kit: keep `DOTENV_CONFIG_PATH` (current approach is correct)

drizzle-kit has **built-in dotenv** that auto-loads `.env` from cwd. It also respects the `DOTENV_CONFIG_PATH` environment variable. The current scripts already use this correctly:

```json
"db:migrate": "DOTENV_CONFIG_PATH=../../.env drizzle-kit migrate",
"db:generate": "DOTENV_CONFIG_PATH=../../.env drizzle-kit generate"
```

This works because:
1. drizzle-kit bundles the `dotenv` package internally
2. `dotenv` respects `DOTENV_CONFIG_PATH` as an override for the file location
3. The path is relative to cwd (which is `packages/db/`), so `../../.env` resolves to root

Alternatives for drizzle-kit:
- `node --env-file=../../.env ./node_modules/.bin/drizzle-kit migrate` -- works but ugly
- drizzle-kit is adding native `--env-file` flag support (GitHub issue #4588) -- not yet released
- The `DOTENV_CONFIG_PATH` approach is the cleanest available option today

### Why NOT `dotenv-cli`?
- Adds a runtime dependency for something Node handles natively
- `--env-file` is the idiomatic Node 22+ approach
- Fewer moving parts, less to maintain

### Why NOT `node --import tsx`?
- tsx CLI already passes through `--env-file`
- `node --import tsx` is more verbose for no benefit in this use case
- Only useful if you need flags tsx doesn't pass through (which is rare)

---

## Edge Cases and Considerations

1. **Missing `.env` file:** `--env-file` will exit with an error if the file doesn't exist. Use `--env-file-if-exists` if you want graceful handling (e.g., in CI where env vars come from the environment). For dev scripts, erroring on missing `.env` is actually desirable -- it's a clear signal.

2. **Variable precedence:** Shell env vars override `.env` values. This is the correct behavior for 12-factor apps and CI environments.

3. **Multiple env files:** If you later need `.env.local` overrides:
   ```json
   "dev": "tsx --env-file=../../.env --env-file-if-exists=../../.env.local src/app.ts"
   ```

4. **Docker Compose:** The `docker-compose.yml` already has its own `env_file` support. The `--env-file` flag is only for host-side dev scripts.

5. **Cross-platform:** `--env-file` works on all platforms Node supports. No shell-specific syntax issues (unlike `DOTENV_CONFIG_PATH=x cmd` which requires `cross-env` on Windows, though this project appears macOS-only for now).

---

## Relevant Files

- `/Users/seanflanagan/proj/software-factory/package.json` -- line 15: `worker:dev` script
- `/Users/seanflanagan/proj/software-factory/packages/api/package.json` -- line 9: `dev` script
- `/Users/seanflanagan/proj/software-factory/packages/db/package.json` -- lines 9-10: db scripts with `DOTENV_CONFIG_PATH`
- `/Users/seanflanagan/proj/software-factory/packages/db/drizzle.config.ts` -- line 8: reads `DATABASE_URL` from `process.env`
- `/Users/seanflanagan/proj/software-factory/packages/worker/src/config.ts` -- lines 19-45: all env var reads
- `/Users/seanflanagan/proj/software-factory/packages/api/src/app.ts` -- lines 90-105: env var reads
- `/Users/seanflanagan/proj/software-factory/.gitignore` -- lines 20-22: `.env` patterns (`.env`, `.env.*`, `!.env.example`)

## Sources

- [tsx Node.js Enhancement docs](https://tsx.is/node-enhancement) -- confirms tsx passes through all Node CLI flags including `--env-file`
- [tsx GitHub - privatenumber/tsx](https://github.com/privatenumber/tsx) -- official repo
- [tsx issue #463 - Read .env by default](https://github.com/privatenumber/tsx/issues/463) -- community discussion confirming `--env-file` is the right approach
- [Node.js CLI docs](https://nodejs.org/api/cli.html) -- `--env-file` and `--env-file-if-exists` documentation
- [Node.js --env-file-if-exists issue #50993](https://github.com/nodejs/node/issues/50993) -- landed in Node 22.9
- [pnpm Workspaces docs](https://pnpm.io/workspaces) -- confirms no built-in env loading
- [pnpm Discussion #5888](https://github.com/orgs/pnpm/discussions/5888) -- community workarounds
- [Turborepo - Using environment variables](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables) -- recommends `dotenv-cli` but doesn't auto-load
- [drizzle-kit dotenv support discussion #3405](https://github.com/drizzle-team/drizzle-orm/discussions/3405) -- confirms built-in dotenv and `DOTENV_CONFIG_PATH` support
- [drizzle-kit --env-file feature request #4588](https://github.com/drizzle-team/drizzle-orm/issues/4588) -- native flag coming but not yet shipped
