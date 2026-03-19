import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { desc, eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { auditEntries } from "../schema/audit-entries.js";
import { computeContentHash } from "../utils/content-hash.js";

type AuditEntry = typeof auditEntries.$inferSelect;
type NewAuditEntry = Omit<typeof auditEntries.$inferInsert, "id" | "timestamp">;

export async function insertAuditEntry(
  db: DbInstance,
  entry: NewAuditEntry,
): Promise<FactoryResult<AuditEntry>> {
  try {
    const [row] = await db.insert(auditEntries).values(entry).returning();
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to insert audit entry: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getAuditEntries(
  db: DbInstance,
  taskId: string,
  options?: { limit?: number; offset?: number },
): Promise<FactoryResult<AuditEntry[]>> {
  try {
    const query = db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.taskId, taskId))
      .orderBy(desc(auditEntries.timestamp));

    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const rows = await query;
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get audit entries: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export function verifyContentHash(entry: AuditEntry): boolean {
  if (entry.content === null || entry.content === undefined) {
    return false;
  }
  const recomputed = computeContentHash(entry.content);
  return recomputed === entry.contentHash;
}
