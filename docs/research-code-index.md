# Research: Code Indexing, Symbol Extraction, and Repo Understanding

**Date:** 2026-03-18
**Scope:** Code index subsystem for the software factory control plane (PRD R-014, R-010)
**PRD Reference:** `/Users/seanflanagan/proj/software-factory/docs/prd.md` lines 634-646

---

## 1. Tree-sitter for Symbol Extraction

### 1.1 Package Options for Node.js/TypeScript

There are three viable tree-sitter packages for the Node.js runtime:

| Package | Type | Weekly Downloads | Key Trait |
|---------|------|-----------------|-----------|
| `tree-sitter` (node-tree-sitter) | Native N-API bindings | ~280K | Fastest; requires native compilation |
| `web-tree-sitter` | WASM bindings | ~257K | Portable; no native deps; ~2-5x slower than native |
| `@kreuzberg/tree-sitter-language-pack` | Unified NAPI wrapper | newer | Bundles 170+ grammars; unified `process()` API |

**Recommendation: `tree-sitter` (native N-API bindings).** For a server-side control plane running on known infrastructure, native performance matters and portability to browsers is irrelevant. The WASM variant (`web-tree-sitter`) would only make sense if we needed to run parsing in a browser or worker with strict sandbox constraints.

**Source:** https://www.npmjs.com/package/tree-sitter, https://npmtrends.com/tree-sitter-vs-web-tree-sitter

### 1.2 Language Grammars Available

The tree-sitter organization maintains 87+ grammar repositories. Key grammars for Phase 1:

| Language | npm Package | Status |
|----------|------------|--------|
| TypeScript/TSX | `tree-sitter-typescript` | Mature, official |
| JavaScript | `tree-sitter-javascript` | Mature, official |
| Python | `tree-sitter-python` | Mature, official |
| Go | `tree-sitter-go` | Mature, official |
| Rust | `tree-sitter-rust` | Mature, official |
| Java | `tree-sitter-java` | Mature, official |
| C/C++ | `tree-sitter-c` / `tree-sitter-cpp` | Mature, official |
| Ruby | `tree-sitter-ruby` | Mature, official |
| JSON | `tree-sitter-json` | Mature, official |
| YAML | `tree-sitter-yaml` | Community |
| CSS/HTML | `tree-sitter-css` / `tree-sitter-html` | Mature, official |

**Alternative:** `@kreuzberg/tree-sitter-language-pack` bundles 170+ grammars with a unified `process()` API that returns structured output (functions, classes, imports, comments, chunked segments). This could reduce boilerplate but adds a dependency layer. Worth evaluating if its output format aligns with our symbol table needs.

**Source:** https://github.com/tree-sitter-grammars, https://github.com/Goldziher/tree-sitter-language-pack

### 1.3 How to Extract Symbols

Tree-sitter uses `.scm` (Scheme) query files called `tags.scm` to define patterns for extracting named entities from ASTs. The pattern format uses S-expressions with captures:

**Standard tag captures:**

| Capture | Meaning |
|---------|---------|
| `@definition.function` | Function definition |
| `@definition.class` | Class definition |
| `@definition.interface` | Interface definition |
| `@definition.method` | Method definition |
| `@definition.module` | Module definition |
| `@reference.call` | Function/method call |
| `@reference.class` | Class reference |
| `@reference.implementation` | Interface implementation |
| `@name` | The identifier being tagged |
| `@doc` | Optional docstring |

**Example TypeScript query for function definitions:**
```scheme
(function_declaration
  name: (identifier) @name) @definition.function

(class_declaration
  name: (type_identifier) @name) @definition.class

(interface_declaration
  name: (type_identifier) @name) @definition.interface

(method_definition
  name: (property_identifier) @name) @definition.method
```

**Node.js Query API:**
```typescript
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;

const parser = new Parser();
parser.setLanguage(TypeScript);
const tree = parser.parse(sourceCode);

// Query API
const query = new Parser.Query(TypeScript, queryString);
const matches = query.matches(tree.rootNode);
// Each match: { pattern: number, captures: QueryCapture[] }
// Each capture: { name: string, node: SyntaxNode }
```

Key `Query` methods:
- `matches(node, options?)` -- returns `QueryMatch[]` in match order
- `captures(node, options?)` -- returns `QueryCapture[]` in source order
- `disablePattern(index)` / `disableCapture(name)` -- optimize by skipping irrelevant patterns

**Source:** https://tree-sitter.github.io/tree-sitter/4-code-navigation.html, https://tree-sitter.github.io/node-tree-sitter/classes/Parser.Query.html

### 1.4 Performance Characteristics

- Tree-sitter parses at approximately **100,000 lines per second** (general benchmark from Crader RFC)
- A 10,000-line C file parses in under 100ms on standard workstations
- Incremental parsing reduces parsing time by **up to 70%** compared to full re-parsing
- The `tree.edit()` + `parser.parse(newSource, oldTree)` pattern enables incremental updates
- `tree.getChangedRanges(newTree)` identifies exactly which ranges changed

**Estimated indexing times (full parse, not incremental):**

| Repo Size | Estimated Lines | Parse Time (estimate) |
|-----------|----------------|----------------------|
| Small (1K files) | ~100K lines | ~1 second |
| Medium (10K files) | ~1M lines | ~10 seconds |
| Large (100K files) | ~10M lines | ~100 seconds |

These are parse-only estimates. Symbol extraction, storage, and graph construction add overhead but are I/O-bound rather than CPU-bound.

**Source:** https://github.com/orgs/sheeptechnologies/discussions/4, https://dasroot.net/posts/2026/02/incremental-parsing-tree-sitter-code-analysis/

### 1.5 Concrete Pattern: Building a Symbol Table

Based on Aider's implementation (the most proven open-source approach), the symbol extraction pattern is:

```
Tag = { rel_path, abs_path, line, name, kind: "def" | "ref" }
```

Per-file extraction:
1. Detect language from file extension
2. Load appropriate tree-sitter grammar
3. Parse file into AST
4. Run `tags.scm` query against AST
5. Collect all `@definition.*` and `@reference.*` captures
6. Store as Tag tuples with file path, line number, symbol name, and kind

**Source:** https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping

---

## 2. Dependency Graph Construction

### 2.1 Import/Require Statement Analysis

Tree-sitter can extract import statements from ASTs. For TypeScript:

```scheme
; ES6 imports
(import_statement
  source: (string) @source) @import

; CommonJS require
(call_expression
  function: (identifier) @_fn (#eq? @_fn "require")
  arguments: (arguments (string) @source)) @import

; Dynamic import
(call_expression
  function: (import)
  arguments: (arguments (string) @source)) @import
```

Import resolution requires heuristics beyond AST parsing:
- Relative paths (`./foo`, `../bar`) -- resolve against file location
- Package imports (`lodash`, `@scope/pkg`) -- resolve via `node_modules`
- Path aliases (`@/components`) -- resolve via `tsconfig.json` paths
- Extension probing (`.ts`, `.tsx`, `.js`, `/index.ts`)

**Trade-off:** Full TypeScript-compiler-accurate resolution (via `ts.resolveModuleName`) gives 100% accuracy but requires a working `tsconfig.json` and installed dependencies. Heuristic resolution (longest-prefix matching + extension probing) achieves ~90% accuracy without build setup. The Crader RFC chose heuristics as sufficient for retrieval purposes.

### 2.2 Package Manifest Parsing

For external dependency graphs:
- `package.json` -- `dependencies`, `devDependencies`, `peerDependencies`
- `requirements.txt` / `pyproject.toml` -- Python deps
- `go.mod` -- Go module dependencies
- `Cargo.toml` -- Rust crate dependencies
- `pom.xml` / `build.gradle` -- Java/Kotlin deps

These are JSON/TOML/YAML files parseable without tree-sitter. They provide the external boundary of the dependency graph.

### 2.3 Building the Module Dependency Graph

The graph structure (following Aider's proven approach):

```
Nodes: files (relative paths)
Edges: file A references a symbol defined in file B
Edge weight: importance score (see Section 3)
```

Construction:
1. Extract all definitions per file (symbol -> defining file)
2. Extract all references per file (symbol -> referencing file)
3. For each reference, resolve which definition it points to
4. Create directed edge: referencing_file -> defining_file

### 2.4 Detecting Entry Points and Module Boundaries

**Entry points** can be identified by:
- Files referenced in `package.json` `main`, `module`, `exports`, `bin` fields
- Files matching common patterns: `index.ts`, `main.ts`, `app.ts`, `server.ts`
- Files with high in-degree (many files import from them) in the dependency graph
- Files with zero in-degree but non-zero out-degree (top-level orchestrators)

**Module boundaries** can be detected by:
- Directory-level `index.ts` barrel files (re-export pattern)
- Workspace/package boundaries from `package.json` locations
- Directories with distinct import clusters (community detection on the graph)

**Source:** https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping

---

## 3. Repo Map Generation

### 3.1 What Makes a Good Repo Map for an AI Agent

A repo map must answer: "Given a task description, which files and symbols are relevant?" The key qualities:

1. **Token-efficient** -- fits within the LLM context window alongside the task and other context
2. **Ranked by relevance** -- most important files/symbols first
3. **Structurally informative** -- shows function signatures, class hierarchies, not just file names
4. **Task-personalized** -- different tasks surface different parts of the codebase

### 3.2 Aider's Repo Map Approach (Pioneering Implementation)

Aider's `RepoMap` class is the most proven open-source implementation. Architecture:

**Graph construction:**
- Nodes = files (relative paths)
- Edges = shared symbol references between files
- Built as a `NetworkX.MultiDiGraph`

**Edge weight computation (multiplicative factors):**

| Factor | Multiplier | Purpose |
|--------|-----------|---------|
| Base | 1.0 | Default |
| Identifier mentioned in chat | x10 | Boost task-relevant symbols |
| Long identifier (>=8 chars, camelCase/snake_case) | x10 | Favor specific names over generic ones |
| Private identifier (starts with `_`) | x0.1 | Demote internal details |
| Symbol defined in >5 files | x0.1 | Demote ubiquitous symbols |
| Reference in active chat files | x50 | Heavily boost files user is working on |
| Reference count | x sqrt(num_refs) | Sublinear boost for popular symbols |

**PageRank with personalization:**
- Files mentioned in chat get initial weight 100/len(fnames)
- Files with path components matching mentioned identifiers also boosted
- Standard PageRank distributes rank through the graph
- Final ranking: (file, identifier) pairs sorted by rank

**Token budget optimization:**
- Binary search to fit maximum tags within token limit
- Default: 1K tokens (`--map-tokens`)
- Sampling-based token counting for texts >= 200 chars
- Lines truncated to 100 chars max

**Three-level caching:**
1. `TAGS_CACHE` -- disk cache (diskcache), keyed by file path, invalidated on mtime change
2. `map_cache` -- in-memory, keyed by (chat_fnames, other_fnames, max_tokens)
3. `tree_cache` -- in-memory, keyed by (file, lines_of_interest, mtime)

**Source:** https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping, https://aider.chat/2023/10/22/repomap.html

### 3.3 Cursor's Approach

Cursor uses a different strategy focused on embeddings:

1. **Merkle tree** for change detection -- hash of every file, folder hashes derived from children
2. **AST-based chunking** -- tree-sitter splits code into semantic units (functions, classes) fitting token limits
3. **Embedding generation** -- vectors per chunk via OpenAI or proprietary models
4. **Vector storage** -- Turbopuffer (external), indexed by chunk hash for deduplication
5. **Retrieval** -- RAG: embed query, find nearest chunks, rerank, provide as context
6. **Sync** -- every 10 minutes, compare Merkle root hashes, re-index changed files only

**Key insight:** Cursor's approach is embedding-first (semantic search from day one), while Aider's is graph-first (structural relationships via PageRank). For Phase 1 of our system, the Aider/graph approach is more appropriate because it requires no embedding model and provides deterministic, explainable results.

**Source:** https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast

### 3.4 Recommended Phase 1 Approach

Follow Aider's tag-based + PageRank approach for Phase 1:
- Tree-sitter for symbol extraction (deterministic, no model dependency)
- Graph-based file ranking (explainable, no embedding cost)
- Token-limited output formatted as file + key symbol signatures

Defer embedding-based semantic search to Phase 3+ per PRD.

---

## 4. Incremental Indexing

### 4.1 Git Diff-Based Incremental Updates

Strategy: only re-index files changed since the last indexed commit.

```bash
# Get list of changed files between indexed commit and HEAD
git diff --name-only <last-indexed-sha> HEAD

# Get list of changed files including untracked
git diff --name-only <last-indexed-sha> HEAD
git ls-files --others --exclude-standard
```

This is extremely fast: `git diff --name-only` completes in 1-2ms even on large repos.

**Incremental update flow:**
1. Store `last_indexed_commit_sha` in the index metadata
2. On index refresh, run `git diff --name-only <stored-sha> HEAD`
3. For each changed file: re-parse with tree-sitter, extract symbols, update DB
4. For deleted files: remove all symbols from DB
5. For renamed files: detect via `git diff --name-status -M` and update paths
6. Rebuild affected portions of the dependency graph
7. Update `last_indexed_commit_sha` to HEAD

**Performance targets (from Crader RFC):**
- Full SCIP reindex: 60-120 seconds
- Tree-sitter incremental update: 50-200 milliseconds
- Three orders of magnitude improvement

### 4.2 Branch-Aware Freshness

Per PRD R-014: "Branch-aware freshness: index versioned by commit SHA."

Schema approach:
```sql
-- Each index snapshot is tied to a specific commit
CREATE TABLE code_index_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id),
  commit_sha VARCHAR(40) NOT NULL,
  branch VARCHAR(255),
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'building', -- building, ready, failed
  file_count INTEGER,
  symbol_count INTEGER,
  duration_ms INTEGER,
  UNIQUE(repo_id, commit_sha)
);
```

When a task starts, it references the current index version. If the index is stale (HEAD has advanced), trigger an incremental update before the UNDERSTAND step.

### 4.3 Cache Invalidation Strategies

1. **Content-hash based** -- hash file content; skip re-parse if hash unchanged (handles `git checkout` that restores old content)
2. **Mtime based** -- faster check but less reliable (Aider uses this for its TAGS_CACHE)
3. **Git SHA based** -- authoritative for committed changes; combine with content-hash for uncommitted changes

**Recommended:** Git SHA for committed state + content-hash for working tree changes.

**Source:** https://github.com/orgs/sheeptechnologies/discussions/4, https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping

---

## 5. Governance-Aware Filtering

### 5.1 Path Exclusion Pattern Matching

Per PRD R-010: "When building the code index, excluded paths are filtered before any content is indexed, summarized, or included in repo maps."

**Recommended library: `picomatch`**

| Library | Weekly Downloads | Dependencies | ReDoS Safe | Brace Expansion |
|---------|-----------------|-------------|------------|-----------------|
| `picomatch` | 220M | 0 | Yes | No (by design) |
| `micromatch` | ~60M | picomatch | Yes | Yes |
| `minimatch` | ~100M | brace-expansion | **No** (CVE-2022-3517) | Yes |

**`picomatch`** is the correct choice for security-sensitive path matching:
- Zero dependencies
- Not vulnerable to ReDoS (catastrophic backtracking)
- Built-in limits: brace expansion capped at 10K patterns, range expansion at 1K items
- Used by chokidar, fast-glob, Rollup, Jest, Astro, Cloudflare Miniflare, and 5M+ projects
- Full Bash glob support: `*`, `**`, `?`, `[...]`, extglobs `@(...)`, `!(...)`, etc.

If brace expansion is needed for exclusion patterns like `{secrets,credentials}/**`, use `micromatch` which wraps `picomatch`.

**Source:** https://github.com/micromatch/picomatch, https://npm-compare.com/micromatch,minimatch

### 5.2 Implementation: Governance Filter Pipeline

The exclusion filter MUST be the first stage in the indexing pipeline. This is a security invariant.

```
File Discovery (git ls-files / glob)
         |
         v
  +-----------------+
  | GOVERNANCE      |  <-- picomatch against exclusion patterns
  | FILTER          |  <-- Reject: secrets/**, .env*, *.pem, etc.
  +-----------------+  <-- This is the security boundary
         |
         v (only allowed files pass)
  Parse with tree-sitter
         |
         v
  Extract symbols
         |
         v
  Store in index
```

**Critical invariant (from PRD R-010 AC):** "Given read exclusion on `secrets/**`, code index does not contain content from those paths. Agent context retrieval skips them."

Default exclusion patterns (from PRD):
```
secrets/**
.env*
*.pem
*.key
*.p12
*.pfx
*.jks
.git/**
node_modules/**
```

The exclusion list must be configurable per repo via `PolicyConfig` and applied at EVERY entry point to the index: initial build, incremental update, and query-time retrieval.

---

## 6. Existing Tools and Libraries

### 6.1 Prior Art Comparison

| Tool | Approach | Strengths | Weaknesses for Our Use Case |
|------|----------|-----------|---------------------------|
| **Aider RepoMap** | Tree-sitter tags + PageRank graph | Proven, explainable, no model dependency | Python-only; tightly coupled to Aider's chat model |
| **Sourcegraph SCIP** | Compiler-accurate indexing via language-specific indexers | Precise; cross-repo navigation | Requires build toolchain; non-incremental; heavy deps |
| **scip-typescript** | TypeScript compiler-based SCIP indexer | 10x faster than LSIF; precise types | Requires tsconfig.json and installed deps; full reindex only |
| **Cursor** | Merkle tree + AST chunking + embeddings + Turbopuffer | Semantic search; efficient sync | Proprietary; requires embedding model; not open source |
| **Continue.dev** | Tree-sitter chunking + embeddings + LanceDB | Open source; local-first | Embedding-dependent; accuracy limits noted |
| **codebase-memory-mcp** | Tree-sitter + SQLite knowledge graph | 64 languages; sub-ms queries; Cypher-like query | Go binary; SQLite not Postgres; opinionated graph model |
| **Crader (RFC)** | Tree-sitter + pgvector + Postgres | File-incremental; Postgres-native; composable | RFC stage; not yet production |
| **ctags/universal-ctags** | Regex-based symbol extraction | Fast; simple; well-known | No AST understanding; limited to definitions |

### 6.2 What to Leverage vs. Build

**Leverage:**
- `tree-sitter` + language grammars (parsing and AST)
- `tags.scm` query patterns from tree-sitter grammar repos and Aider's modified versions
- `picomatch` / `micromatch` (glob matching)
- `pgvector` extension (Phase 3 semantic search)
- Aider's tag extraction and graph ranking algorithms (as reference/inspiration, rewritten in TypeScript)

**Build from scratch:**
- Symbol extraction pipeline (TypeScript, wrapping tree-sitter)
- Dependency graph construction
- Postgres storage layer for symbols and graph
- Governance-aware filtering pipeline
- Incremental indexing engine (git-diff based)
- Query API for task-relevant file retrieval

**Do not use:**
- SCIP/scip-typescript -- too heavy for our needs; requires full build toolchain; non-incremental
- LSP servers -- designed for editor interaction, not batch indexing
- Full ctags -- tree-sitter is strictly better for our use case

### 6.3 The Crader RFC: Most Aligned Prior Art

The Crader project's RFC 001 (https://github.com/orgs/sheeptechnologies/discussions/4) describes an architecture almost identical to what we need:

- Replace SCIP with tree-sitter-based file-incremental indexing
- Per-file AST processing (no cross-file compiler dependency)
- Lightweight import tracking via heuristic resolution
- PostgreSQL storage with tsvector for full-text search + pgvector for embeddings
- Composable retrieval primitives rather than prescriptive pipelines

**Key trade-offs they accepted (also applicable to us):**
- Loss of compiler-accurate references (mitigated by embedding similarity)
- Loss of cross-file type inference (mitigated by explicit source-level types)
- Heuristic import resolution (~90% accuracy, sufficient for retrieval)

Their performance targets: <500ms incremental updates, full indexing within 2x of SCIP baseline.

**Source:** https://github.com/orgs/sheeptechnologies/discussions/4

---

## 7. Storage Design

### 7.1 Proposed Postgres Schema for Code Index

```sql
-- Repository tracking
CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  default_branch VARCHAR(255) NOT NULL DEFAULT 'main',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(github_owner, github_repo)
);

-- Index version per commit
CREATE TABLE code_index_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id),
  commit_sha VARCHAR(40) NOT NULL,
  branch VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'building',
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_count INTEGER,
  symbol_count INTEGER,
  duration_ms INTEGER,
  UNIQUE(repo_id, commit_sha)
);

-- Indexed files with content hash for cache invalidation
CREATE TABLE indexed_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_version_id UUID NOT NULL REFERENCES code_index_versions(id) ON DELETE CASCADE,
  rel_path VARCHAR(1024) NOT NULL,
  language VARCHAR(50),
  content_hash VARCHAR(64) NOT NULL,  -- SHA-256 of file content
  line_count INTEGER,
  byte_size INTEGER,
  UNIQUE(index_version_id, rel_path)
);

-- Symbol table: functions, classes, interfaces, exports, imports
CREATE TABLE symbols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES indexed_files(id) ON DELETE CASCADE,
  name VARCHAR(512) NOT NULL,
  kind VARCHAR(50) NOT NULL,  -- function, class, interface, method, type, variable, export, import
  line_start INTEGER NOT NULL,
  line_end INTEGER,
  column_start INTEGER,
  column_end INTEGER,
  signature TEXT,              -- function signature, class declaration line
  doc_comment TEXT,            -- extracted docstring
  is_exported BOOLEAN DEFAULT false,
  parent_symbol_id UUID REFERENCES symbols(id),  -- for methods within classes
  -- Full-text search on symbol names
  name_tsvector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', replace(replace(name, '_', ' '), '.', ' '))
  ) STORED
);

-- Import relationships (lightweight, heuristic-resolved)
CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES indexed_files(id) ON DELETE CASCADE,
  source_path VARCHAR(1024) NOT NULL,  -- raw import path
  resolved_file_id UUID REFERENCES indexed_files(id),  -- resolved target (nullable)
  imported_names TEXT[],  -- specific named imports, or NULL for * / default
  is_type_only BOOLEAN DEFAULT false,
  line_number INTEGER
);

-- File dependency edges (derived from imports)
CREATE TABLE file_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_version_id UUID NOT NULL REFERENCES code_index_versions(id) ON DELETE CASCADE,
  source_file_id UUID NOT NULL REFERENCES indexed_files(id),
  target_file_id UUID NOT NULL REFERENCES indexed_files(id),
  dependency_type VARCHAR(20) NOT NULL DEFAULT 'import',  -- import, require, re-export
  weight REAL DEFAULT 1.0,
  UNIQUE(index_version_id, source_file_id, target_file_id, dependency_type)
);

-- Repo map metadata: entry points, module boundaries
CREATE TABLE repo_structure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_version_id UUID NOT NULL REFERENCES code_index_versions(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES indexed_files(id),
  role VARCHAR(50) NOT NULL,  -- entry_point, barrel_export, config, test, migration
  confidence REAL DEFAULT 1.0,
  metadata JSONB
);

-- Indexes
CREATE INDEX idx_symbols_file_id ON symbols(file_id);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_name_tsvector ON symbols USING GIN(name_tsvector);
CREATE INDEX idx_imports_file_id ON imports(file_id);
CREATE INDEX idx_imports_resolved ON imports(resolved_file_id);
CREATE INDEX idx_file_deps_source ON file_dependencies(source_file_id);
CREATE INDEX idx_file_deps_target ON file_dependencies(target_file_id);
CREATE INDEX idx_indexed_files_path ON indexed_files(rel_path);
CREATE INDEX idx_indexed_files_version ON indexed_files(index_version_id);
CREATE INDEX idx_repo_structure_version ON repo_structure(index_version_id);

-- Phase 3+: Embedding column for semantic search
-- ALTER TABLE symbols ADD COLUMN embedding VECTOR(1536);
-- CREATE INDEX idx_symbols_embedding ON symbols USING hnsw(embedding vector_cosine_ops);
```

### 7.2 Query Patterns

**"Find all files related to authentication":**
```sql
SELECT DISTINCT f.rel_path, s.name, s.kind, s.signature
FROM symbols s
JOIN indexed_files f ON s.file_id = f.id
WHERE f.index_version_id = $1
  AND s.name_tsvector @@ to_tsquery('simple', 'auth | authenticate | login | session | jwt | token')
ORDER BY f.rel_path;
```

**"Find the function that handles X" (e.g., payment processing):**
```sql
SELECT f.rel_path, s.name, s.kind, s.signature, s.line_start
FROM symbols s
JOIN indexed_files f ON s.file_id = f.id
WHERE f.index_version_id = $1
  AND s.kind IN ('function', 'method')
  AND s.name_tsvector @@ to_tsquery('simple', 'payment | pay | charge | invoice')
ORDER BY f.rel_path, s.line_start;
```

**"Get the dependency chain for a file":**
```sql
WITH RECURSIVE deps AS (
  SELECT fd.target_file_id, 1 AS depth
  FROM file_dependencies fd
  WHERE fd.source_file_id = $1 AND fd.index_version_id = $2
  UNION ALL
  SELECT fd.target_file_id, d.depth + 1
  FROM file_dependencies fd
  JOIN deps d ON fd.source_file_id = d.target_file_id
  WHERE fd.index_version_id = $2 AND d.depth < 5  -- limit depth
)
SELECT DISTINCT f.rel_path, d.depth
FROM deps d
JOIN indexed_files f ON d.target_file_id = f.id
ORDER BY d.depth, f.rel_path;
```

**"Get repo map -- top symbols per file, ranked by importance":**
```sql
SELECT f.rel_path, s.name, s.kind, s.signature,
       (SELECT COUNT(*) FROM imports i WHERE i.resolved_file_id = f.id) AS import_count
FROM indexed_files f
LEFT JOIN symbols s ON s.file_id = f.id AND s.is_exported = true
WHERE f.index_version_id = $1
ORDER BY import_count DESC, f.rel_path, s.line_start;
```

### 7.3 Full-Text Search vs. External Search

**Postgres tsvector** is sufficient for Phase 1:
- GIN index on `name_tsvector` provides fast symbol name search
- Custom dictionary can handle camelCase/snake_case splitting
- No external dependency

**tsvector limitations:**
- Lexeme-based, not semantic -- "authenticate" won't match "login" unless both are in the query
- No fuzzy matching by default (pg_trgm extension adds this)
- No ranking by semantic relevance

**Phase 3+ path:** Add `pgvector` column to `symbols` table for embedding-based semantic search. This is why the schema includes the commented-out `VECTOR(1536)` column. The Postgres-native approach means no additional infrastructure (no Pinecone, no Qdrant) and atomic transactions with the rest of the index.

**Source:** https://www.postgresql.org/docs/current/textsearch-intro.html, https://github.com/pgvector/pgvector

---

## 8. Performance Considerations

### 8.1 Indexing Time Estimates

Based on tree-sitter benchmarks and codebase-memory-mcp real-world data:

| Repo Size | Files | Est. Parse Time | Est. Total (parse + extract + store) |
|-----------|-------|----------------|-------------------------------------|
| Small | ~1K | ~1s | ~5-10s |
| Medium | ~10K | ~10s | ~30-60s |
| Large | ~100K | ~100s | ~5-10 min |

**codebase-memory-mcp benchmarks (Apple M3 Pro):**
- Django codebase (49K nodes, 196K edges): ~6s fresh index
- Incremental reindex: ~1.2s (content-hash skip)
- Query latency: <1ms for structural queries, <10ms for regex search

**Incremental updates (changed files only):**
- 1-10 files changed: 50-200ms (Crader RFC target)
- Git diff check: 1-2ms

### 8.2 Memory Usage During Indexing

Tree-sitter is designed for low memory usage:
- AST is a compact concrete syntax tree
- Each file is parsed independently (no need to hold all files in memory)
- Peak memory proportional to largest single file, not total codebase

For very large files (>100K lines), memory usage could spike. Mitigation: skip files above a configurable size threshold (e.g., 1MB) or generated files.

**scip-typescript memory note:** Large codebases can exhaust Node.js heap. Mitigation via `node --max-old-space-size=16000`. Our tree-sitter approach avoids this because we do not need the TypeScript compiler's type checker.

### 8.3 Query Performance

With proper Postgres indexes:
- Symbol name lookup (B-tree): <1ms
- Full-text search on names (GIN/tsvector): <10ms
- Dependency graph traversal (recursive CTE, depth 5): <50ms
- File listing for an index version: <5ms

These are well within acceptable latency for the UNDERSTAND step of the workflow, which is not user-interactive (it runs as part of a Temporal activity).

### 8.4 Storage Size Estimates

| Repo Size | Files | Est. Symbols | Est. DB Size |
|-----------|-------|-------------|-------------|
| Small | ~1K | ~50K | ~50MB |
| Medium | ~10K | ~500K | ~500MB |
| Large | ~100K | ~5M | ~5GB |

These are rough estimates. Actual size depends on symbol density and metadata stored. Multiple index versions for the same repo can be pruned (keep latest per branch + any referenced by active tasks).

---

## 9. Risks and Open Questions

### 9.1 Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Tree-sitter grammar quality varies by language | Medium | Start with well-tested grammars (TS, JS, Python, Go); add languages incrementally |
| Heuristic import resolution may miss dependencies | Medium | Log unresolved imports; allow manual resolution hints in `.factory/` config |
| Large repos may have slow initial index | Low | Background indexing; show progress; incremental updates fast after initial |
| `node-tree-sitter` native bindings may have platform issues | Low | WASM fallback (`web-tree-sitter`) available if native fails |
| Governance filter bypass via symlinks or generated files | Medium | Resolve symlinks before filtering; filter on resolved paths |

### 9.2 Open Questions

1. **Should we use `@kreuzberg/tree-sitter-language-pack` or individual grammar packages?** The language pack simplifies setup but adds a dependency. Individual packages give more control but more boilerplate.

2. **Should the dependency graph be stored in Postgres or computed on-the-fly from symbols?** Stored graph is faster to query but needs rebuilding on incremental updates. On-the-fly computation is simpler but slower for complex queries.

3. **How should we handle monorepo workspace boundaries?** The schema supports it via `repo_structure` metadata, but the detection heuristics need design.

4. **What is the right granularity for the repo map?** File-level (Aider default), function-level, or class-level? Likely configurable, defaulting to exported-symbol level.

5. **Should the index be a Temporal activity or a standalone service?** Indexing as a Temporal activity fits the workflow model (called during UNDERSTAND step, retryable), but a standalone index-maintenance service could keep the index warm.

---

## 10. Recommended Architecture Summary

```
┌────────────────────────────────────────────────────────────┐
│                     INDEX PIPELINE                          │
│                                                            │
│  1. File Discovery (git ls-files)                          │
│         │                                                  │
│  2. Governance Filter (picomatch)     <── PolicyConfig     │
│         │                                                  │
│  3. Language Detection (file extension)                    │
│         │                                                  │
│  4. Parse (tree-sitter + language grammar)                 │
│         │                                                  │
│  5. Symbol Extraction (tags.scm queries)                   │
│         │                                                  │
│  6. Import Extraction (AST queries + heuristic resolution) │
│         │                                                  │
│  7. Store (Postgres: symbols, imports, files)              │
│         │                                                  │
│  8. Build Dependency Graph (file_dependencies table)       │
│         │                                                  │
│  9. Detect Structure (entry points, module boundaries)     │
│         │                                                  │
│  10. Mark Index Ready (code_index_versions.status)         │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│                     QUERY LAYER                             │
│                                                            │
│  Given: task objective text                                │
│                                                            │
│  1. Extract key terms from objective                       │
│  2. tsvector search on symbol names                        │
│  3. Dependency graph traversal from matched files          │
│  4. PageRank-style ranking (Phase 1: simplified)           │
│  5. Token-budget fitting                                   │
│  6. Return: ranked list of (file, symbols, signatures)     │
│                                                            │
│  Phase 3+: Add embedding search via pgvector               │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│                  INCREMENTAL UPDATE                         │
│                                                            │
│  Trigger: new commit on watched branch                     │
│                                                            │
│  1. git diff --name-only <last-sha> HEAD                   │
│  2. Filter changed files through governance filter         │
│  3. Re-parse only changed files                            │
│  4. Update symbols + imports for changed files             │
│  5. Rebuild affected dependency edges                      │
│  6. Update code_index_versions with new commit SHA         │
└────────────────────────────────────────────────────────────┘
```

**Key dependencies for implementation:**
- `tree-sitter` (npm) -- native Node.js bindings
- `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go` (npm) -- Phase 1 grammars
- `picomatch` (npm) -- governance-aware glob matching
- PostgreSQL 16 with `pgvector` extension (install early, use in Phase 3+)

---

## 11. External Sources Consulted

- https://www.npmjs.com/package/tree-sitter (node-tree-sitter npm package)
- https://github.com/tree-sitter/node-tree-sitter (Node.js bindings repo)
- https://github.com/tree-sitter/tree-sitter-typescript (TypeScript grammar)
- https://tree-sitter.github.io/tree-sitter/4-code-navigation.html (tags.scm documentation)
- https://tree-sitter.github.io/node-tree-sitter/classes/Parser.Query.html (Query API)
- https://aider.chat/2023/10/22/repomap.html (Aider repo map blog post)
- https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping (Aider repo map architecture)
- https://sourcegraph.com/blog/announcing-scip (SCIP protocol announcement)
- https://github.com/sourcegraph/scip/blob/main/scip.proto (SCIP protobuf schema)
- https://github.com/sourcegraph/scip-typescript (TypeScript SCIP indexer)
- https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast (Cursor indexing)
- https://docs.continue.dev/walkthroughs/codebase-embeddings (Continue.dev indexing)
- https://github.com/DeusData/codebase-memory-mcp (codebase-memory-mcp)
- https://github.com/orgs/sheeptechnologies/discussions/4 (Crader RFC 001 -- tree-sitter incremental indexing)
- https://github.com/Goldziher/tree-sitter-language-pack (170+ grammar language pack)
- https://github.com/micromatch/picomatch (glob matching library)
- https://npm-compare.com/micromatch,minimatch (glob library comparison)
- https://github.com/pgvector/pgvector (Postgres vector extension)
- https://www.postgresql.org/docs/current/textsearch-intro.html (Postgres full-text search)
- https://www.crunchydata.com/blog/indexing-jsonb-in-postgres (JSONB GIN indexing)
- https://dasroot.net/posts/2026/02/incremental-parsing-tree-sitter-code-analysis/ (tree-sitter performance benchmarks)
- https://npmtrends.com/tree-sitter-vs-web-tree-sitter (package comparison)

---

## 12. Files Referenced

- `/Users/seanflanagan/proj/software-factory/docs/prd.md` -- PRD v5.1, Section 5.3 (CodeIndex entity), R-010 (Path/File Policy), R-014 (Code Understanding)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/immutable.md` -- Immutable rules (user control, security-first, transparency)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/conventions.md` -- Conventions (immutable patterns, functional style)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/stack.md` -- Stack decisions (TBD, but PRD specifies TypeScript + Postgres)
- `/Users/seanflanagan/proj/software-factory/.claude/plans/research.md` -- Prior research on Temporal vs. Postgres
- `/Users/seanflanagan/proj/software-factory/docs/decisions.md` -- ADR log (empty, no prior code-index decisions)
