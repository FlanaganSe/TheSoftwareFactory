/**
 * Blast radius analysis — deterministic dependency graph traversal.
 * Uses the code index (M7) to find transitive dependents of changed files.
 * Detects migration files, protected surface edits, and classifies revertability.
 */

import type {
  BlastRadius,
  FactoryResult,
  MigrationImpact,
  PolicyConfig,
  RevertabilityClass,
} from "@software-factory/core";
import { createFactoryError, evaluatePath } from "@software-factory/core";
import { indexRepo } from "@software-factory/db";
import type { DbInstance } from "@software-factory/db";
import { err, ok } from "neverthrow";

export interface BlastRadiusConfig {
  readonly indexVersionId: string;
  readonly changedFiles: readonly string[];
  readonly policies: readonly PolicyConfig[];
  readonly db: DbInstance;
  /** Optional: content of SQL migration files for revertability analysis. */
  readonly migrationFileContents?: Readonly<Record<string, string>>;
}

export interface BlastRadiusResult {
  readonly blastRadius: BlastRadius;
  readonly filesChanged: readonly string[];
  readonly packagesAffected: readonly string[];
  readonly protectedSurfaceEdits: readonly string[];
  readonly migrationImpact: MigrationImpact;
  readonly revertabilityClass: RevertabilityClass;
}

// ── Migration patterns ──────────────────────────────────────────────────────

const MIGRATION_PATH_PATTERNS = [
  /migrations?\//i,
  /drizzle\//i,
  /prisma\/migrations\//i,
  /alembic\//i,
  /flyway\//i,
  /liquibase\//i,
];

const SCHEMA_CHANGE_PATTERNS = [
  /schema\.(ts|js|prisma)$/i,
  /drizzle\/.*\.ts$/i,
  /prisma\/schema\.prisma$/i,
];

const DESTRUCTIVE_SQL_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bALTER\s+TABLE\b.*\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

function isMigrationFile(path: string): boolean {
  if (path.endsWith(".sql")) {
    return MIGRATION_PATH_PATTERNS.some((p) => p.test(path));
  }
  return SCHEMA_CHANGE_PATTERNS.some((p) => p.test(path));
}

function isSchemaChangeFile(path: string): boolean {
  return SCHEMA_CHANGE_PATTERNS.some((p) => p.test(path));
}

function hasDestructiveContent(content: string): boolean {
  return DESTRUCTIVE_SQL_PATTERNS.some((p) => p.test(content));
}

// ── Well-known protected paths ──────────────────────────────────────────────

const ALWAYS_FLAGGED_PATTERNS = [
  /^\.factory\//,
  /^\.github\/workflows\//,
  /migrations?\//i,
];

// ── Package inference ───────────────────────────────────────────────────────

function inferPackage(filePath: string): string {
  // Look for package.json proximity: walk up directories
  const parts = filePath.split("/");
  if (parts.length >= 2) {
    return parts.slice(0, 2).join("/");
  }
  return parts[0] ?? "root";
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function computeBlastRadius(
  config: BlastRadiusConfig,
): Promise<FactoryResult<BlastRadiusResult>> {
  try {
    const { indexVersionId, changedFiles, policies, db } = config;

    // 1. Transitive dependents (BFS, up to 3 levels)
    const allAffected = new Set<string>(changedFiles);
    let frontier = new Set<string>(changedFiles);

    for (let depth = 0; depth < 3 && frontier.size > 0; depth++) {
      const nextFrontier = new Set<string>();

      for (const file of frontier) {
        const depsResult = await indexRepo.getFileDependents(
          db,
          indexVersionId,
          file,
        );
        if (depsResult.isOk()) {
          for (const dep of depsResult.value) {
            if (!allAffected.has(dep.sourceFile)) {
              allAffected.add(dep.sourceFile);
              nextFrontier.add(dep.sourceFile);
            }
          }
        }
      }

      frontier = nextFrontier;
    }

    // 2. Packages affected
    const packageSet = new Set<string>();
    for (const file of allAffected) {
      packageSet.add(inferPackage(file));
    }
    const packagesAffected = [...packageSet].sort();

    // 3. Protected surface edits
    const protectedSurfaceEdits: string[] = [];
    for (const file of changedFiles) {
      // Check policy-based protections
      const decision = evaluatePath(file, "write", policies);
      if (!decision.allowed || decision.requiresApproval) {
        protectedSurfaceEdits.push(file);
        continue;
      }

      // Check well-known protected paths
      if (ALWAYS_FLAGGED_PATTERNS.some((p) => p.test(file))) {
        protectedSurfaceEdits.push(file);
      }
    }

    // 4. Migration impact
    const migrationFiles = changedFiles.filter((f) => isMigrationFile(f));
    const schemaChanges = changedFiles.filter((f) => isSchemaChangeFile(f));
    const hasMigrations = migrationFiles.length > 0;

    const migrationImpact: MigrationImpact = {
      hasMigrations,
      migrationFiles: [...migrationFiles],
      schemaChanges: [...schemaChanges],
    };

    // 5. Revertability classification
    let revertabilityClass: RevertabilityClass = "clean_revert";

    if (hasMigrations || schemaChanges.length > 0) {
      revertabilityClass = "revert_with_migration";

      // Check for destructive patterns in migration file contents
      if (config.migrationFileContents) {
        for (const content of Object.values(config.migrationFileContents)) {
          if (hasDestructiveContent(content)) {
            revertabilityClass = "non_revertable";
            break;
          }
        }
      }
    }

    const blastRadius: BlastRadius = {
      files: allAffected.size,
      packages: packagesAffected.length,
    };

    return ok({
      blastRadius,
      filesChanged: [...changedFiles],
      packagesAffected,
      protectedSurfaceEdits,
      migrationImpact,
      revertabilityClass,
    });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Blast radius computation failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
