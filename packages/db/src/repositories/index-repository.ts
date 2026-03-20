/**
 * Database repository for code index tables.
 *
 * Provides CRUD operations for code_index_versions, code_files,
 * code_symbols, and code_dependencies.
 */

import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import {
  codeDependencies,
  codeFiles,
  codeIndexVersions,
  codeSymbols,
} from "../schema/code-index.js";

type IndexVersion = typeof codeIndexVersions.$inferSelect;
type CodeSymbol = typeof codeSymbols.$inferSelect;

export interface BulkFileInsert {
  readonly filePath: string;
  readonly fileHash: string;
  readonly language: string | null;
  readonly lineCount: number | null;
  readonly isEntryPoint: boolean | null;
  readonly moduleGroup: string | null;
  readonly governanceExcluded: boolean;
}

export interface BulkSymbolInsert {
  readonly filePath: string | null;
  readonly symbolName: string | null;
  readonly symbolKind: string | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly parentSymbol: string | null;
  readonly signature: string | null;
  readonly isExported: boolean | null;
}

export interface BulkDependencyInsert {
  readonly sourceFile: string;
  readonly targetFile: string;
  readonly importType: string | null;
}

const BATCH_SIZE = 500;

export async function createIndexVersion(
  db: DbInstance,
  repoId: string,
  commitSha: string,
): Promise<FactoryResult<IndexVersion>> {
  try {
    // Return existing index if one already exists for this repo+commit
    const existing = await db
      .select()
      .from(codeIndexVersions)
      .where(
        and(
          eq(codeIndexVersions.repoId, repoId),
          eq(codeIndexVersions.commitSha, commitSha),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return ok(existing[0]);
    }

    const [row] = await db
      .insert(codeIndexVersions)
      .values({ repoId, commitSha, status: "building" })
      .returning();
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create index version: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function markIndexReady(
  db: DbInstance,
  indexVersionId: string,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(codeIndexVersions)
      .set({ status: "ready" })
      .where(eq(codeIndexVersions.id, indexVersionId));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to mark index ready: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function markIndexStale(
  db: DbInstance,
  indexVersionId: string,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(codeIndexVersions)
      .set({ status: "stale" })
      .where(eq(codeIndexVersions.id, indexVersionId));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to mark index stale: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getLatestIndex(
  db: DbInstance,
  repoId: string,
): Promise<FactoryResult<IndexVersion | null>> {
  try {
    const rows = await db
      .select()
      .from(codeIndexVersions)
      .where(
        and(
          eq(codeIndexVersions.repoId, repoId),
          eq(codeIndexVersions.status, "ready"),
        ),
      )
      .orderBy(desc(codeIndexVersions.id))
      .limit(1);
    return ok(rows[0] ?? null);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get latest index: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function bulkInsertFiles(
  db: DbInstance,
  indexVersionId: string,
  files: readonly BulkFileInsert[],
): Promise<FactoryResult<void>> {
  try {
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await db.insert(codeFiles).values(
        batch.map((f) => ({
          indexVersionId,
          filePath: f.filePath,
          fileHash: f.fileHash,
          language: f.language,
          lineCount: f.lineCount,
          isEntryPoint: f.isEntryPoint,
          moduleGroup: f.moduleGroup,
          governanceExcluded: f.governanceExcluded,
        })),
      );
    }
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to bulk insert files: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function bulkInsertSymbols(
  db: DbInstance,
  indexVersionId: string,
  symbols: readonly BulkSymbolInsert[],
): Promise<FactoryResult<void>> {
  try {
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      await db.insert(codeSymbols).values(
        batch.map((s) => ({
          indexVersionId,
          filePath: s.filePath,
          symbolName: s.symbolName,
          symbolKind: s.symbolKind,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          parentSymbol: s.parentSymbol,
          signature: s.signature,
          isExported: s.isExported,
        })),
      );
    }
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to bulk insert symbols: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function bulkInsertDependencies(
  db: DbInstance,
  indexVersionId: string,
  deps: readonly BulkDependencyInsert[],
): Promise<FactoryResult<void>> {
  try {
    for (let i = 0; i < deps.length; i += BATCH_SIZE) {
      const batch = deps.slice(i, i + BATCH_SIZE);
      await db.insert(codeDependencies).values(
        batch.map((d) => ({
          indexVersionId,
          sourceFile: d.sourceFile,
          targetFile: d.targetFile,
          importType: d.importType,
        })),
      );
    }
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to bulk insert dependencies: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function deleteIndexVersion(
  db: DbInstance,
  indexVersionId: string,
): Promise<FactoryResult<void>> {
  try {
    // Delete in order respecting foreign keys (or rely on CASCADE if configured)
    await db
      .delete(codeDependencies)
      .where(eq(codeDependencies.indexVersionId, indexVersionId));
    await db
      .delete(codeSymbols)
      .where(eq(codeSymbols.indexVersionId, indexVersionId));
    await db
      .delete(codeFiles)
      .where(eq(codeFiles.indexVersionId, indexVersionId));
    await db
      .delete(codeIndexVersions)
      .where(eq(codeIndexVersions.id, indexVersionId));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to delete index version: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function searchSymbols(
  db: DbInstance,
  repoId: string,
  query: string,
  options?: { limit?: number; kinds?: readonly string[] },
): Promise<FactoryResult<CodeSymbol[]>> {
  try {
    const limit = options?.limit ?? 50;
    // Use raw SQL for tsvector search
    const result = await db.execute(
      sql`
        SELECT cs.*
        FROM code_symbols cs
        JOIN code_index_versions civ ON cs.index_version_id = civ.id
        WHERE civ.repo_id = ${repoId}
          AND civ.status = 'ready'
          AND cs.symbol_name ILIKE ${`%${query}%`}
        LIMIT ${limit}
      `,
    );
    return ok(result.rows as unknown as CodeSymbol[]);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to search symbols: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getFileSymbols(
  db: DbInstance,
  indexVersionId: string,
  filePath: string,
): Promise<FactoryResult<CodeSymbol[]>> {
  try {
    const rows = await db
      .select()
      .from(codeSymbols)
      .where(
        and(
          eq(codeSymbols.indexVersionId, indexVersionId),
          eq(codeSymbols.filePath, filePath),
        ),
      );
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get file symbols: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getFileDependencies(
  db: DbInstance,
  indexVersionId: string,
  filePath: string,
): Promise<FactoryResult<(typeof codeDependencies.$inferSelect)[]>> {
  try {
    const rows = await db
      .select()
      .from(codeDependencies)
      .where(
        and(
          eq(codeDependencies.indexVersionId, indexVersionId),
          eq(codeDependencies.sourceFile, filePath),
        ),
      );
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get file dependencies: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getFileDependents(
  db: DbInstance,
  indexVersionId: string,
  filePath: string,
): Promise<FactoryResult<(typeof codeDependencies.$inferSelect)[]>> {
  try {
    const rows = await db
      .select()
      .from(codeDependencies)
      .where(
        and(
          eq(codeDependencies.indexVersionId, indexVersionId),
          eq(codeDependencies.targetFile, filePath),
        ),
      );
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get file dependents: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
