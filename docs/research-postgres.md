# Research: PostgreSQL Schema Design, Security, and Operational Patterns

**Date:** 2026-03-18
**Scope:** Database layer for the software factory control plane (PRD v5.1)
**Stack context:** TypeScript (Node.js 22+), PostgreSQL 16, Drizzle ORM, Docker Compose

---

## 1. Schema Design Patterns

### 1.1 Task Table with State Machine Enforcement

The PRD (R-002) defines a task state machine with dual-boundary separation:

```
created -> [needs_clarification ->] assigned -> in_progress ->
  evidence_ready -> [changes_requested -> in_progress ->] approved ->
  pr_created -> external_checks_pending ->
    [addressing_review_feedback -> external_checks_pending ->]
    [external_blocked -> external_checks_pending ->]
  merge_ready -> merged | failed
```

**Recommended approach: Postgres enum type + trigger-based transition validation.**

The enum type enforces that only valid state names are stored. A BEFORE UPDATE trigger validates that the transition from OLD.state to NEW.state is legal. This is preferable to CHECK constraints alone because CHECK constraints can validate column values but cannot reference the previous row value (OLD) -- they only see the row being written.

```sql
-- Enum for task states
CREATE TYPE task_state AS ENUM (
  'created',
  'needs_clarification',
  'assigned',
  'in_progress',
  'evidence_ready',
  'changes_requested',
  'approved',
  'pr_created',
  'external_checks_pending',
  'addressing_review_feedback',
  'external_blocked',
  'merge_ready',
  'merged',
  'failed'
);

-- Transition validation trigger function
CREATE OR REPLACE FUNCTION validate_task_transition()
RETURNS TRIGGER AS $$
DECLARE
  valid boolean;
BEGIN
  IF OLD.state = NEW.state THEN
    RETURN NEW; -- no-op transition, allow
  END IF;

  -- Lookup valid transitions
  SELECT EXISTS (
    SELECT 1 FROM task_valid_transitions
    WHERE from_state = OLD.state AND to_state = NEW.state
  ) INTO valid;

  IF NOT valid THEN
    RAISE EXCEPTION 'Invalid task transition: % -> %', OLD.state, NEW.state;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_task_transition
  BEFORE UPDATE OF state ON tasks
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION validate_task_transition();
```

**Drizzle ORM mapping:**

```typescript
import { pgEnum, pgTable, uuid, text, timestamp, jsonb, numeric } from 'drizzle-orm/pg-core';

export const taskStateEnum = pgEnum('task_state', [
  'created', 'needs_clarification', 'assigned', 'in_progress',
  'evidence_ready', 'changes_requested', 'approved',
  'pr_created', 'external_checks_pending',
  'addressing_review_feedback', 'external_blocked',
  'merge_ready', 'merged', 'failed',
]);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: taskStateEnum('state').notNull().default('created'),
  objective: text('objective').notNull(),
  scope: jsonb('scope'),
  constraints: jsonb('constraints'),
  budgetCents: numeric('budget_cents', { precision: 10, scale: 0 }),
  repoId: uuid('repo_id').notNull().references(() => repos.id),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Key design note:** The valid transitions table is a separate relational table, not hardcoded in the trigger. This makes transitions inspectable, testable, and changeable via migration.

```sql
CREATE TABLE task_valid_transitions (
  from_state task_state NOT NULL,
  to_state task_state NOT NULL,
  PRIMARY KEY (from_state, to_state)
);

-- Seed with PRD-specified transitions
INSERT INTO task_valid_transitions (from_state, to_state) VALUES
  ('created', 'needs_clarification'),
  ('created', 'assigned'),
  ('needs_clarification', 'assigned'),
  ('assigned', 'in_progress'),
  ('in_progress', 'evidence_ready'),
  ('in_progress', 'failed'),
  ('evidence_ready', 'changes_requested'),
  ('evidence_ready', 'approved'),
  ('changes_requested', 'in_progress'),
  ('approved', 'pr_created'),
  ('pr_created', 'external_checks_pending'),
  ('external_checks_pending', 'addressing_review_feedback'),
  ('external_checks_pending', 'external_blocked'),
  ('external_checks_pending', 'merge_ready'),
  ('addressing_review_feedback', 'external_checks_pending'),
  ('external_blocked', 'external_checks_pending'),
  ('merge_ready', 'merged'),
  ('merge_ready', 'failed');
```

**Terminal states:** `merged` and `failed` have no outgoing transitions. The trigger naturally rejects any UPDATE that tries to change their state.

### 1.2 Append-Only Audit Pattern

The PRD (R-012) requires an append-only audit table with:
- Structured metadata (who/what/when/why)
- SHA-256 content hash for tamper detection
- 2-year metadata retention, 90-day full content retention
- GDPR-compatible purge (null content, retain metadata + hash)

**Recommended approach: INSERT-only table with RLS preventing UPDATE/DELETE, partitioned by month.**

```sql
CREATE TABLE audit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Metadata (retained 2 years)
  timestamp timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  result text NOT NULL,
  cost_cents numeric(10, 0),
  task_id uuid REFERENCES tasks(id),
  -- Content (retained 90 days, then NULLed)
  content jsonb,
  -- Tamper detection
  content_hash text NOT NULL -- SHA-256 hex of content
) PARTITION BY RANGE (timestamp);

-- Row-Level Security: prevent UPDATE and DELETE
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_no_update ON audit_entries
  AS RESTRICTIVE FOR UPDATE USING (false);

CREATE POLICY audit_no_delete ON audit_entries
  AS RESTRICTIVE FOR DELETE USING (false);

CREATE POLICY audit_allow_insert ON audit_entries
  FOR INSERT WITH CHECK (true);

CREATE POLICY audit_allow_select ON audit_entries
  FOR SELECT USING (true);

-- Force RLS even for table owner
ALTER TABLE audit_entries FORCE ROW LEVEL SECURITY;
```

**Critical security note:** RLS is bypassed by superusers and roles with `BYPASSRLS`. The application database role must NOT be a superuser. Use a dedicated `app` role with only INSERT and SELECT grants on audit_entries.

**Content hash computation:** Done at the application layer before INSERT. The hash covers the full `content` JSONB value serialized deterministically (keys sorted). This is simpler and more portable than hash chaining (where each entry's hash includes the previous entry's hash), which adds ordering dependencies and makes parallel inserts impossible.

```typescript
import { createHash } from 'node:crypto';

function computeContentHash(content: unknown): string {
  const serialized = JSON.stringify(content, Object.keys(content as object).sort());
  return createHash('sha256').update(serialized).digest('hex');
}
```

**GDPR purge:** Update content to NULL while retaining metadata and the original content_hash. This requires a privileged migration role (not the app role) that can bypass the UPDATE RLS policy. The content_hash remains as proof that content existed and what it contained, even after purge.

**Partition management:** See Section 5 below.

### 1.3 Evidence Bundles: JSONB vs Relational

The PRD (R-008) defines evidence bundles with structured fields: objective, annotated diff, blast radius, owners impacted, test results, security scan results, lint results, protected-surface edits, migration impact, revertability class, unresolved assumptions, commands run, pending external checks.

**Recommendation: Hybrid -- relational table with JSONB for variable-structure fields.**

Some fields are always present and well-typed (objective, revertability class, task reference). Others are variable-structure (test results, scan results, annotated diff). A pure JSONB column loses type safety and indexing on the fixed fields. A pure relational model requires too many columns for variable content.

```typescript
export const revertabilityEnum = pgEnum('revertability_class', [
  'clean_revert', 'revert_with_migration', 'non_revertable'
]);

export const evidenceBundles = pgTable('evidence_bundles', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  version: integer('version').notNull().default(1),
  objective: text('objective').notNull(),
  revertabilityClass: revertabilityEnum('revertability_class').notNull(),
  blastRadiusFiles: integer('blast_radius_files').notNull(),
  blastRadiusPackages: integer('blast_radius_packages').notNull(),
  hasProtectedSurfaceEdits: boolean('has_protected_surface_edits').notNull().default(false),
  hasMigrationImpact: boolean('has_migration_impact').notNull().default(false),
  // Variable-structure data as JSONB
  annotatedDiff: jsonb('annotated_diff').$type<AnnotatedDiff>(),
  ownersImpacted: jsonb('owners_impacted').$type<string[]>(),
  testResults: jsonb('test_results').$type<TestResults>(),
  securityScanResults: jsonb('security_scan_results').$type<ScanResults>(),
  lintResults: jsonb('lint_results').$type<LintResults>(),
  protectedSurfaceEdits: jsonb('protected_surface_edits').$type<ProtectedEdit[]>(),
  migrationImpact: jsonb('migration_impact').$type<MigrationImpact>(),
  unresolvedAssumptions: jsonb('unresolved_assumptions').$type<string[]>(),
  commandsRun: jsonb('commands_run').$type<CommandRecord[]>(),
  pendingExternalChecks: jsonb('pending_external_checks').$type<string[]>(),
  // Artifact references (object storage)
  artifactUrl: text('artifact_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Trade-off:** The `$type<T>()` annotations provide compile-time type safety but NO runtime validation. Runtime validation should be done at the application service layer (e.g., with Zod) before writing to the database.

### 1.4 ReviewState: Dual-Boundary Lifecycle

The PRD (R-002, Section 6.3) requires tracking both internal evidence readiness and external merge readiness:

```typescript
export const reviewStateEnum = pgEnum('review_state', [
  'pending_evidence',
  'evidence_ready',
  'approved',
  'changes_requested',
  'pr_created',
  'external_checks_pending',
  'external_blocked',
  'merge_ready',
  'merged',
  'closed',
]);

export const reviewStates = pgTable('review_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().unique().references(() => tasks.id),
  state: reviewStateEnum('state').notNull().default('pending_evidence'),
  // Internal (factory) boundary
  evidenceBundleId: uuid('evidence_bundle_id').references(() => evidenceBundles.id),
  internalApprovedBy: text('internal_approved_by'),
  internalApprovedAt: timestamp('internal_approved_at', { withTimezone: true }),
  // External (GitHub) boundary
  prNumber: integer('pr_number'),
  prUrl: text('pr_url'),
  requiredChecks: jsonb('required_checks').$type<RequiredCheck[]>(),
  codeownersStatus: jsonb('codeowners_status').$type<CodeownersStatus[]>(),
  unresolvedThreads: integer('unresolved_threads').default(0),
  staleReviews: boolean('stale_reviews').default(false),
  mergeQueueStatus: text('merge_queue_status'),
  // Reconciliation
  lastGithubSync: timestamp('last_github_sync', { withTimezone: true }),
  githubReconciliationData: jsonb('github_reconciliation_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Key design choice:** One ReviewState per Task (1:1 via unique constraint on task_id). The ReviewState evolves as the task progresses, tracking both boundaries. GitHub-specific fields (prNumber, requiredChecks, codeownersStatus) are NULL until the PR is created.

### 1.5 Code Index Tables

The PRD (R-014) requires persistent code index per repo: file structure, dependency graph, symbol table, repo map, branch-aware freshness, governance-filtered.

```typescript
export const codeIndexVersions = pgTable('code_index_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id').notNull().references(() => repos.id),
  commitSha: text('commit_sha').notNull(),
  status: text('status').notNull().default('building'), // building | ready | stale
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_code_index_repo_commit').on(table.repoId, table.commitSha),
]);

export const codeSymbols = pgTable('code_symbols', {
  id: uuid('id').primaryKey().defaultRandom(),
  indexVersionId: uuid('index_version_id').notNull().references(() => codeIndexVersions.id),
  filePath: text('file_path').notNull(),
  symbolName: text('symbol_name').notNull(),
  symbolKind: text('symbol_kind').notNull(), // function | class | interface | type | variable | export
  lineStart: integer('line_start').notNull(),
  lineEnd: integer('line_end'),
  parentSymbol: text('parent_symbol'),
  signature: text('signature'),
  isExported: boolean('is_exported').notNull().default(false),
  // Full-text search column (generated, see Section 5.3)
  searchVector: /* tsvector generated column */
}, (table) => [
  index('idx_symbols_name').on(table.symbolName),
  index('idx_symbols_file').on(table.filePath),
  index('idx_symbols_kind').on(table.symbolKind),
]);

export const codeDependencies = pgTable('code_dependencies', {
  id: uuid('id').primaryKey().defaultRandom(),
  indexVersionId: uuid('index_version_id').notNull().references(() => codeIndexVersions.id),
  sourceFile: text('source_file').notNull(),
  targetFile: text('target_file').notNull(),
  importType: text('import_type').notNull(), // static | dynamic | type_only
}, (table) => [
  index('idx_deps_source').on(table.sourceFile),
  index('idx_deps_target').on(table.targetFile),
]);

export const codeFiles = pgTable('code_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  indexVersionId: uuid('index_version_id').notNull().references(() => codeIndexVersions.id),
  filePath: text('file_path').notNull(),
  fileHash: text('file_hash').notNull(), // for incremental updates
  language: text('language'),
  lineCount: integer('line_count'),
  isEntryPoint: boolean('is_entry_point').notNull().default(false),
  moduleGroup: text('module_group'), // for repo map module boundaries
  governanceExcluded: boolean('governance_excluded').notNull().default(false),
});
```

**Performance note:** Code index tables can be large for big repos. The index_version_id FK allows bulk deletion when a new index version replaces an old one. Incremental updates work by comparing file hashes.

**Full-text search for symbols:** See Section 5.3.

### 1.6 Policy Config Storage

The PRD (R-010) requires path-level policies with glob patterns. JSONB is the right fit because policy rules are tree-structured and variable per repo.

```typescript
export const policyTypeEnum = pgEnum('policy_type', [
  'read_exclusion',
  'edit_deny',
  'edit_protected',
  'edit_allowed',
]);

export const protectionClassEnum = pgEnum('protection_class', [
  'hard_protected',
  'flagged',
  'light_protected',
]);

export const policyConfigs = pgTable('policy_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id').notNull().references(() => repos.id),
  name: text('name').notNull(),
  policyType: policyTypeEnum('policy_type').notNull(),
  protectionClass: protectionClassEnum('protection_class'),
  pathPatterns: jsonb('path_patterns').$type<string[]>().notNull(),
  autonomyLevel: text('autonomy_level'), // L0, L1, L2
  requiresApproval: boolean('requires_approval').notNull().default(false),
  approverRole: text('approver_role'), // admin | operator
  isActive: boolean('is_active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_policy_repo').on(table.repoId),
  // GIN index for path pattern containment queries
  index('idx_policy_patterns').using('gin', table.pathPatterns),
]);
```

**Path matching:** Glob pattern matching (e.g., `secrets/**`, `**/*.test.*`) should happen at the application layer, not in SQL. The GIN index on pathPatterns is useful for containment queries ("does any policy include this exact pattern?") but glob evaluation requires application logic.

### 1.7 Credential and Secret Management Tables

The PRD (Section 7.2) requires envelope-encrypted secrets with lifecycle classes.

```typescript
export const secretClassEnum = pgEnum('secret_class', [
  'setup_only',
  'runtime',
  'per_tool',
]);

export const credentialLeases = pgTable('credential_leases', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  tokenType: text('token_type').notNull(), // github_app_installation
  scope: jsonb('scope').$type<string[]>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_cred_lease_task').on(table.taskId),
  index('idx_cred_lease_expires').on(table.expiresAt),
]);

export const secretBindings = pgTable('secret_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id').notNull().references(() => repos.id),
  name: text('name').notNull(),
  secretClass: secretClassEnum('secret_class').notNull(),
  toolScope: text('tool_scope'), // for per_tool secrets
  // Envelope-encrypted value (see Section 2)
  encryptedValue: bytea('encrypted_value').notNull(),
  encryptedDek: bytea('encrypted_dek').notNull(),
  kekId: text('kek_id').notNull(), // identifies which KEK was used
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('idx_secret_repo_name').on(table.repoId, table.name),
]);
```

### 1.8 Supporting Tables

```typescript
export const repos = pgTable('repos', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubOwner: text('github_owner').notNull(),
  githubRepo: text('github_repo').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  repoClass: text('repo_class').notNull().default('A'), // A, B, C
  autonomyLevel: text('autonomy_level').notNull().default('L1'),
  setupContractPath: text('setup_contract_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_repo_github').on(table.githubOwner, table.githubRepo),
]);

export const environmentStates = pgTable('environment_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id').notNull().references(() => repos.id),
  imageRef: text('image_ref'),
  setupContractHash: text('setup_contract_hash'),
  cacheValid: boolean('cache_valid').notNull().default(false),
  lastHealthCheck: timestamp('last_health_check', { withTimezone: true }),
  healthStatus: text('health_status'), // healthy | unhealthy | unknown
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const costRecords = pgTable('cost_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id),
  modelId: text('model_id').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costCents: numeric('cost_cents', { precision: 10, scale: 4 }).notNull(),
  latencyMs: integer('latency_ms'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_cost_task').on(table.taskId),
  index('idx_cost_timestamp').on(table.timestamp),
]);
```

---

## 2. Envelope Encryption in Postgres

### 2.1 The Pattern

Envelope encryption separates concerns: data is encrypted with a Data Encryption Key (DEK), and the DEK is encrypted with a Key Encryption Key (KEK). The encrypted data and the encrypted DEK are stored together. Only the KEK management system (operator-managed or external KMS) can unwrap the DEK.

**Workflow (encrypt):**
1. Generate a random DEK (32 bytes for AES-256)
2. Encrypt the secret value with the DEK using AES-256-GCM
3. Send the plaintext DEK to KMS, receive the encrypted (wrapped) DEK
4. Store: `encrypted_value` (data encrypted by DEK) + `encrypted_dek` (DEK encrypted by KEK) + `kek_id` (which KEK was used)
5. Discard the plaintext DEK from memory

**Workflow (decrypt):**
1. Read `encrypted_dek` and `kek_id` from the database
2. Send `encrypted_dek` to KMS with `kek_id`, receive plaintext DEK
3. Decrypt `encrypted_value` with the plaintext DEK
4. Discard the plaintext DEK from memory

### 2.2 Application-Layer vs pgcrypto

**Recommendation: Application-layer encryption (Node.js `crypto` module), NOT pgcrypto.**

Reasons:
- pgcrypto operates inside Postgres, meaning plaintext data transits between the application and Postgres. The encryption is happening in the wrong place -- the database server sees plaintext.
- Application-layer encryption means Postgres never sees plaintext secret values. Data is encrypted before INSERT and decrypted after SELECT.
- External KMS integration (AWS KMS `Encrypt`/`Decrypt` API calls) must happen at the application layer regardless.
- Node.js `crypto` module supports AES-256-GCM natively, with authentication tags for tamper detection.

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function encryptWithDek(plaintext: string, dek: Buffer): EncryptedPayload {
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

function decryptWithDek(payload: EncryptedPayload, dek: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', payload.dek, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString('utf8');
}
```

**Storage format:** Concatenate IV + authTag + ciphertext into a single `bytea` column, or use a structured JSONB column with base64-encoded fields. The single-bytea approach is simpler and avoids JSON overhead.

### 2.3 KEK Management

**V1 (operator-managed):** The operator provides a master key via environment variable (`FACTORY_MASTER_KEY`). This key is the KEK. The application wraps/unwraps DEKs locally using AES key wrapping (RFC 3394) or simpler AES-256-GCM encryption of the DEK.

**V1.x (external KMS):** Pluggable interface:

```typescript
interface KmsProvider {
  wrapDek(plaintextDek: Buffer, kekId: string): Promise<Buffer>;
  unwrapDek(wrappedDek: Buffer, kekId: string): Promise<Buffer>;
  readonly providerId: string;
}

// V1 implementation: local master key
class LocalKmsProvider implements KmsProvider {
  constructor(private masterKey: Buffer) {}
  readonly providerId = 'local';
  async wrapDek(dek: Buffer, _kekId: string): Promise<Buffer> { /* AES-GCM encrypt */ }
  async unwrapDek(wrapped: Buffer, _kekId: string): Promise<Buffer> { /* AES-GCM decrypt */ }
}

// Future: AWS KMS, GCP KMS implementations
```

### 2.4 Key Rotation Strategy

**DEK rotation:** Generate a new DEK for each new secret value. When rotating an existing secret, decrypt with old DEK, generate new DEK, re-encrypt with new DEK, wrap new DEK with current KEK.

**KEK rotation:** When the master key changes, re-wrap all DEKs with the new KEK. This does NOT require re-encrypting the data -- only the DEK wrappers change. The `kek_id` column tracks which KEK version was used, enabling gradual migration.

```sql
-- Find secrets still using old KEK
SELECT id, name FROM secret_bindings WHERE kek_id = 'old-kek-version';
```

### 2.5 What Needs Encryption

| Data | Encrypt? | Rationale |
|------|----------|-----------|
| Secret values (API keys, tokens, passwords) | Yes | Core requirement |
| Credential lease tokens | No | Short-lived (1h), stored transiently in Redis or memory |
| Audit content (prompts, outputs) | No | Content hash provides tamper detection; encryption would prevent search/analysis. GDPR purge handles deletion. |
| Audit metadata | No | Must be queryable |
| Policy config | No | Not sensitive, must be queryable |
| Code index data | No | Derived from repo content, governance-filtered at index time |

---

## 3. Append-Only Audit with Tamper Detection

### 3.1 Hash Strategy

**Recommendation: Per-entry SHA-256 of content, NOT hash chaining.**

Hash chaining (where each entry's hash includes the previous entry's hash) provides stronger tamper evidence but introduces significant operational complexity:
- Requires strict ordering -- no concurrent inserts
- Hash chain break on any out-of-order insert
- Recovery from broken chains is complex
- Partitioning complications (chain spans partitions)

Per-entry hashing provides:
- Content verification: "did this audit entry's content change after it was written?"
- Parallel inserts: no ordering dependency
- Simple verification: recompute hash from content and compare
- GDPR purge compatibility: content NULLed, hash retained as proof of what existed

**Verification query:**

```sql
-- Find tampered entries (content hash mismatch)
-- Must be done at application layer since SHA-256 computation
-- requires deterministic JSON serialization
SELECT id, timestamp, actor, action_type
FROM audit_entries
WHERE content IS NOT NULL
  AND content_hash != expected_hash; -- computed by app
```

**Periodic verification job:** A scheduled job reads batches of audit entries, recomputes hashes at the application layer, and flags mismatches. This runs hourly or daily, not on every read.

### 3.2 Periodic Export to Object Storage

The PRD specifies periodic export to object storage (MinIO/R2) for long-term retention and disaster recovery.

**Export format:** JSONL (one JSON object per line) for each partition/time range. Each export file includes a manifest with:
- Time range covered
- Entry count
- SHA-256 hash of the export file itself
- List of entry IDs included

**Export schedule:** Daily export of the previous day's entries. The export is idempotent -- re-exporting the same time range produces the same output (assuming no tampering).

### 3.3 Retention Policies via Partitioning

Monthly partitions enable efficient retention management:

```sql
-- Create monthly partitions
CREATE TABLE audit_entries_2026_01 PARTITION OF audit_entries
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE audit_entries_2026_02 PARTITION OF audit_entries
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

**90-day content purge:** A scheduled job NULLs the content column on partitions older than 90 days. This preserves metadata, content_hash, and all relational references.

```sql
-- Purge content from entries older than 90 days (run by privileged migration role)
UPDATE audit_entries
SET content = NULL
WHERE timestamp < now() - interval '90 days'
  AND content IS NOT NULL;
```

**2-year metadata retention:** Drop entire partitions older than 24 months:

```sql
-- Drop partition (instant, no row-by-row deletion)
DROP TABLE audit_entries_2024_01;
```

**Partition creation automation:** A scheduled job or migration creates partitions 3 months ahead to avoid INSERT failures.

### 3.4 GDPR Purge

GDPR "right to erasure" applies to personal data in audit content (e.g., user emails, IP addresses in prompt content). The pattern:

1. NULL the `content` column on affected entries
2. Retain `content_hash` (proves what existed)
3. Retain all metadata fields (non-personal: action_type, timestamp, etc.)
4. Log the purge action itself as an audit entry

This requires the privileged migration role that bypasses the UPDATE RLS policy. The app role cannot perform purges.

---

## 4. Migration Strategy

### 4.1 Tool Recommendation: Drizzle Kit

Given the stack choice of Drizzle ORM, Drizzle Kit is the natural migration tool. It provides:

- **`drizzle-kit generate`**: Diffs TypeScript schema against previous migrations, generates SQL files
- **`drizzle-kit migrate`**: Applies unapplied migrations sequentially
- **`drizzle-kit push`**: Direct schema application (development only)

**Migration file structure:**
```
drizzle/
  0000_initial_schema/
    migration.sql
    snapshot.json
  0001_add_cost_records/
    migration.sql
    snapshot.json
```

**Programmatic application:**
```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const db = drizzle(process.env.DATABASE_URL);
await migrate(db);
```

### 4.2 Forward-Only Migrations

**Recommendation: No down migrations.**

Down migrations create a false sense of safety. In practice:
- Data-destructive changes cannot be reversed (dropped columns, changed types)
- Production rollback via down migration is rarely safe
- Forward-only forces thinking about backward compatibility

If a migration needs to be "undone," write a new forward migration that reverses the change.

### 4.3 Custom SQL in Migrations

Drizzle Kit generates SQL for schema changes, but custom SQL is needed for:
- Trigger creation (state machine validation)
- RLS policies (audit table protection)
- Partition creation
- Seed data (valid transitions table)
- Extension enabling (`CREATE EXTENSION IF NOT EXISTS pgcrypto`)

These should be written as manual SQL files within the migration directory, applied in order.

### 4.4 Zero-Downtime Patterns

For PostgreSQL schema changes that avoid locking:

| Operation | Safe? | Notes |
|-----------|-------|-------|
| ADD COLUMN (nullable, no default) | Yes | No table rewrite |
| ADD COLUMN (with DEFAULT, PG 11+) | Yes | PG 11+ stores default in catalog, no rewrite |
| ADD COLUMN (NOT NULL, no default) | No | Requires rewrite or multi-step |
| DROP COLUMN | Yes | Marks as dropped, no rewrite |
| ADD INDEX | Use CONCURRENTLY | `CREATE INDEX CONCURRENTLY` avoids table lock |
| ADD CONSTRAINT (CHECK) | Use NOT VALID + VALIDATE | Two-step: add without scan, then validate |
| ADD CONSTRAINT (FK) | Use NOT VALID + VALIDATE | Same two-step |
| ALTER COLUMN TYPE | No (usually) | Requires rewrite. Use new column + backfill instead. |

---

## 5. Performance & Indexing

### 5.1 Index Design for Common Queries

**Tasks:**
```sql
-- Tasks by state (dashboard: active tasks view)
CREATE INDEX idx_tasks_state ON tasks (state) WHERE state NOT IN ('merged', 'failed');

-- Tasks by repo
CREATE INDEX idx_tasks_repo ON tasks (repo_id);

-- Tasks by creation time (recent tasks view)
CREATE INDEX idx_tasks_created ON tasks (created_at DESC);
```

**Audit entries:**
```sql
-- Audit entries by time range (primary query pattern)
-- Handled by partition pruning on the timestamp partition key

-- Audit entries by task
CREATE INDEX idx_audit_task ON audit_entries (task_id);

-- Audit entries by actor
CREATE INDEX idx_audit_actor ON audit_entries (actor);

-- Audit entries by action type
CREATE INDEX idx_audit_action ON audit_entries (action_type);
```

**Cost records:**
```sql
-- Cost aggregation by task
CREATE INDEX idx_cost_task ON cost_records (task_id);

-- Cost aggregation by time (daily/monthly spend)
CREATE INDEX idx_cost_timestamp ON cost_records (timestamp);

-- Cost by model (provider analytics)
CREATE INDEX idx_cost_model ON cost_records (model_id);
```

### 5.2 JSONB Indexing

For the policy config path patterns and evidence bundle queries:

```sql
-- GIN index on policy path patterns (containment queries)
CREATE INDEX idx_policy_patterns ON policy_configs USING GIN (path_patterns);

-- GIN index on evidence bundle test results (if querying by result status)
CREATE INDEX idx_evidence_tests ON evidence_bundles USING GIN (test_results);

-- jsonb_path_ops variant: smaller index, supports @> only
CREATE INDEX idx_policy_patterns_ops ON policy_configs
  USING GIN (path_patterns jsonb_path_ops);
```

**When to use GIN:** For JSONB columns queried with `@>` (containment), `?` (key existence), `?|` (any key exists), `?&` (all keys exist). NOT useful for `->>` (text extraction) queries -- use B-tree indexes on generated columns or expression indexes for those.

### 5.3 Full-Text Search for Code Symbols

For searching code symbols by name (R-014):

```sql
-- Generated tsvector column on code_symbols
ALTER TABLE code_symbols
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(symbol_name, '') || ' ' || coalesce(file_path, ''))
  ) STORED;

-- GIN index for full-text search
CREATE INDEX idx_symbols_search ON code_symbols USING GIN (search_vector);
```

**Search query:**
```sql
SELECT symbol_name, file_path, symbol_kind
FROM code_symbols
WHERE search_vector @@ to_tsquery('simple', 'handleAuth & controller')
ORDER BY ts_rank(search_vector, to_tsquery('simple', 'handleAuth & controller')) DESC;
```

**Note:** Using 'simple' text search configuration (no stemming) is better for code symbol search than 'english' (which would stem `users` to `user`, etc.). Code symbol names should match exactly or by prefix.

### 5.4 Partitioning Audit Tables

**Monthly range partitions on timestamp** (covered in Section 3.3).

Partition sizing guideline: Assuming ~1000 audit entries per task, ~50 tasks/day for an active installation = ~50K entries/day = ~1.5M entries/month. At ~1KB per entry (with content), that is ~1.5GB per monthly partition -- well within manageable range.

**Partition pruning:** PostgreSQL automatically prunes partitions that cannot contain matching rows when the query includes a WHERE clause on the partition key. Enabled by default in PG 10+.

```sql
-- This query only scans the March 2026 partition
SELECT * FROM audit_entries
WHERE timestamp >= '2026-03-01' AND timestamp < '2026-04-01';
```

### 5.5 Connection Pooling

**Recommendation: node-postgres (`pg`) Pool at the application layer.**

PgBouncer is beneficial for high-concurrency scenarios (many short-lived connections), but for a Phase 1 TypeScript monolith, the built-in `pg.Pool` is sufficient.

```typescript
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,           // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const db = drizzle({ client: pool });
```

**Pool sizing rule of thumb:** `max_connections = (2 * CPU cores) + effective_spindle_count`. For a Docker Compose setup with a single Postgres instance, `max: 20` is a reasonable starting point.

**When to add PgBouncer:** When the application scales to multiple replicas or when Temporal workers create many concurrent database connections. PgBouncer in transaction pooling mode multiplexes many application connections onto fewer Postgres connections.

---

## 6. Operational Patterns

### 6.1 Docker Compose Postgres Setup

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: factory
      POSTGRES_USER: factory
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U factory -d factory"]
      interval: 5s
      timeout: 5s
      retries: 5
    command: >
      postgres
        -c shared_buffers=256MB
        -c effective_cache_size=768MB
        -c work_mem=4MB
        -c maintenance_work_mem=64MB
        -c max_connections=100
        -c log_min_duration_statement=200

volumes:
  postgres_data:
```

**Init scripts** (`init-scripts/01-setup.sql`):
```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create application role (non-superuser, no BYPASSRLS)
CREATE ROLE factory_app LOGIN PASSWORD 'app_password';
GRANT CONNECT ON DATABASE factory TO factory_app;

-- Create privileged role for migrations and GDPR purge
CREATE ROLE factory_admin LOGIN PASSWORD 'admin_password';
GRANT ALL ON DATABASE factory TO factory_admin;
```

### 6.2 Backup and Restore

**Automated daily backups:**
```yaml
services:
  postgres-backup:
    image: prodrigestivill/postgres-backup-local
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_DB: factory
      POSTGRES_USER: factory
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      SCHEDULE: "@daily"
      BACKUP_KEEP_DAYS: 30
    volumes:
      - postgres_backups:/backups
    depends_on:
      postgres:
        condition: service_healthy
```

**Manual backup/restore:**
```bash
# Backup
pg_dump -U factory -d factory -Fc > factory_backup.dump

# Restore
pg_restore -U factory -d factory -Fc factory_backup.dump
```

### 6.3 Monitoring and Health Checks

**Key metrics to monitor:**
- Active connections: `SELECT count(*) FROM pg_stat_activity;`
- Table sizes: `SELECT pg_size_pretty(pg_total_relation_size('audit_entries'));`
- Slow queries: `pg_stat_statements` extension
- Replication lag (if applicable)
- Connection pool utilization (from node-postgres Pool events)

**Health check endpoint pattern:**
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

### 6.4 Transaction Patterns

**Task state change + audit entry (must be atomic):**

```typescript
async function transitionTaskState(
  taskId: string,
  newState: TaskState,
  actor: string,
  auditContent: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Update task state (trigger validates transition)
    await tx.update(tasks)
      .set({ state: newState, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));

    // 2. Write audit entry
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

**Isolation level:** `read committed` (PostgreSQL default) is sufficient for most operations. Use `serializable` only for branch lease acquisition to prevent race conditions.

```typescript
// Branch lease acquisition (serializable to prevent double-lease)
await db.transaction(async (tx) => {
  // Check for existing active lease
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
    branch: branchName,
    taskId,
    expiresAt: new Date(Date.now() + ttlMs),
  });
}, { isolationLevel: 'serializable' });
```

**Note:** Branch leases with TTL are listed in the PRD as potentially Redis-backed. If Redis is the choice, use Redis `SET key value NX EX ttl` for atomic lease acquisition. If Postgres is the choice, use the serializable transaction pattern above.

---

## 7. Type Safety

### 7.1 Generating TypeScript Types from Schema

Drizzle ORM provides automatic type inference from schema definitions:

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Inferred types from schema
type Task = InferSelectModel<typeof tasks>;
type NewTask = InferInsertModel<typeof tasks>;
type AuditEntry = InferSelectModel<typeof auditEntries>;
type NewAuditEntry = InferInsertModel<typeof auditEntries>;

// Or using the $inferSelect / $inferInsert helpers
type Task = typeof tasks.$inferSelect;
type NewTask = typeof tasks.$inferInsert;
```

This generates types that reflect column nullability, defaults, and custom type overrides. No code generation step needed -- types are inferred at compile time.

### 7.2 Enum Types

Drizzle's `pgEnum` creates both a PostgreSQL enum type and a corresponding TypeScript type:

```typescript
export const taskStateEnum = pgEnum('task_state', [
  'created', 'needs_clarification', 'assigned', ...
]);

// Extract the TypeScript union type
type TaskState = typeof taskStateEnum.enumValues[number];
// = 'created' | 'needs_clarification' | 'assigned' | ...
```

**Application-layer enum validation:** For shared use across the codebase (not just database operations), define a Zod schema that mirrors the Drizzle enum:

```typescript
import { z } from 'zod';

const TaskStateSchema = z.enum(taskStateEnum.enumValues);
type TaskState = z.infer<typeof TaskStateSchema>;
```

### 7.3 Domain Validation: Database vs Application

**Database-level enforcement:**
- Enum types (valid state names)
- NOT NULL constraints (required fields)
- UNIQUE constraints (no duplicate repos, no duplicate secret names per repo)
- CHECK constraints (budget >= 0, token count >= 0)
- Foreign key constraints (referential integrity)
- Trigger-based state machine validation (valid transitions)
- RLS policies (append-only audit)

**Application-level enforcement (Zod or similar):**
- JSONB structure validation (evidence bundle fields, policy path patterns)
- Business rules (budget limits, autonomy level requirements)
- Cross-entity validation (task submitter != sole approver)
- Glob pattern validation (policy path patterns are valid globs)
- Content hash computation (before audit entry INSERT)

**Principle:** Use database constraints for invariants that must NEVER be violated (data integrity). Use application validation for business rules that may change (domain logic). The database is the last line of defense; the application is the first.

---

## 8. Summary of Recommendations

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| ORM | Drizzle ORM | Type-safe, SQL-close, supports all PG features needed |
| Driver | node-postgres (pg) with Pool | Mature, well-supported, built-in pooling |
| State machine | PG enum + trigger + transitions table | Enforced at DB level, inspectable, testable |
| Audit table | Append-only with RLS, partitioned by month | Tamper-resistant, efficient retention, instant partition drops |
| Content hashing | Per-entry SHA-256 (not hash chain) | Simpler, parallel-safe, sufficient for tamper detection |
| Encryption | Application-layer AES-256-GCM (not pgcrypto) | Postgres never sees plaintext secrets |
| KEK management | Pluggable interface, V1 = operator env var | Extensible to AWS/GCP KMS later |
| Migrations | Drizzle Kit, forward-only | No down migrations, version-controlled SQL |
| JSONB usage | Hybrid: relational for fixed fields, JSONB for variable | Type safety on stable fields, flexibility on variable ones |
| Connection pooling | pg.Pool (app-level), PgBouncer later | Sufficient for Phase 1 monolith |
| Full-text search | tsvector with 'simple' config + GIN index | Code symbols need exact/prefix match, not stemming |
| Branch leases | Prefer Redis (SET NX EX) over Postgres serializable | Lower latency, TTL is native |

---

## 9. Open Questions for Planning

1. **Partition automation:** Should partition creation be a scheduled Temporal workflow, a cron job, or a startup check? Temporal workflow aligns with the existing infrastructure.

2. **Audit export format:** JSONL is simplest, but Parquet enables analytics. Start with JSONL, add Parquet export in Phase 2 if needed.

3. **Code index storage size:** For large repos (10K+ files), the code_symbols and code_dependencies tables could be large. Consider whether to keep historical index versions or garbage-collect old ones aggressively.

4. **GDPR purge automation:** How is a purge request received and processed? Manual CLI command is sufficient for V1; automated webhook-triggered purge is later.

5. **Database role separation:** Two roles (app + admin) are minimum. Should there be a third read-only role for the dashboard?

---

## 10. Files Referenced

- `/Users/seanflanagan/proj/software-factory/docs/prd.md` -- PRD v5.1, Sections 5.2, 5.3, 7.2, 8 (R-001 through R-018)
- `/Users/seanflanagan/proj/software-factory/.claude/plans/research.md` -- Prior research on Temporal vs event-sourced Postgres (Option B selected: CRUD tables + audit log)
- `/Users/seanflanagan/proj/software-factory/docs/decisions.md` -- ADR log (empty, no prior schema decisions)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/conventions.md` -- Conventions (immutable patterns, functional style)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/stack.md` -- Stack (TBD, but PRD specifies TypeScript + PG 16)

## 11. External Sources Consulted

- https://orm.drizzle.team/docs/get-started/postgresql-new (Drizzle ORM setup, schema definition)
- https://orm.drizzle.team/docs/column-types/pg (PG column types: jsonb, enum, uuid, timestamp, bytea)
- https://orm.drizzle.team/docs/indexes-constraints (Index and constraint definitions)
- https://orm.drizzle.team/docs/migrations (Drizzle Kit migration workflow)
- https://orm.drizzle.team/docs/rqb (Relational queries and joins)
- https://orm.drizzle.team/docs/transactions (Transaction support, isolation levels)
- https://orm.drizzle.team/docs/goodies (Type inference, SQL template literals)
- https://orm.drizzle.team/docs/custom-types (Custom column types for encryption wrappers)
- https://orm.drizzle.team/docs/connect-overview (Connection options, driver support)
- https://www.postgresql.org/docs/16/pgcrypto.html (pgcrypto extension: PGP and raw encryption functions)
- https://www.postgresql.org/docs/16/ddl-partitioning.html (Range partitioning, partition pruning, maintenance)
- https://www.postgresql.org/docs/16/ddl-rowsecurity.html (Row-Level Security for append-only tables)
- https://www.postgresql.org/docs/16/sql-createtrigger.html (Triggers for state machine validation)
- https://www.postgresql.org/docs/16/functions-json.html (JSONB operators, GIN indexes, path queries)
- https://www.postgresql.org/docs/16/textsearch-tables.html (Full-text search: tsvector, tsquery, GIN)
- https://docs.cloud.google.com/kms/docs/envelope-encryption (Envelope encryption pattern: DEK/KEK workflow)
- https://node-postgres.com/features/pooling (Connection pool configuration)
- https://www.pgbouncer.org/features.html (PgBouncer pooling modes)
- https://wiki.postgresql.org/wiki/Audit_trigger_91plus (PostgreSQL audit trigger patterns)
