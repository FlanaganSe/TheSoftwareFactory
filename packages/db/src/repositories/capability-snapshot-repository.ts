import type { CapabilitySnapshot, FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { desc, eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { auditEntries } from "../schema/audit-entries.js";
import { capabilitySnapshots } from "../schema/capability-snapshots.js";
import { computeContentHash } from "../utils/content-hash.js";

type CapabilitySnapshotRecord = typeof capabilitySnapshots.$inferSelect;

export interface CreateCapabilitySnapshotInput {
  readonly repoId: string;
  readonly sourceRevision: string;
  readonly snapshot: CapabilitySnapshot;
}

export async function createCapabilitySnapshot(
  db: DbInstance,
  input: CreateCapabilitySnapshotInput,
): Promise<FactoryResult<CapabilitySnapshotRecord>> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(capabilitySnapshots)
        .values({
          repoId: input.repoId,
          sourceRevision: input.sourceRevision,
          snapshot: input.snapshot,
        })
        .returning();

      const contentHash = computeContentHash({
        snapshotId: row.id,
        repoId: input.repoId,
        sourceRevision: input.sourceRevision,
      });

      await tx.insert(auditEntries).values({
        actor: "system",
        actionType: "capability_scan_completed",
        targetType: "repo",
        targetId: input.repoId,
        result: "success",
        content: {
          snapshotId: row.id,
          sourceRevision: input.sourceRevision,
          repoClass: input.snapshot.repoClass,
          supportedByFactory: input.snapshot.supportedByFactory,
        },
        contentHash,
      });

      return ok(row);
    });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create capability snapshot: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getLatestCapabilitySnapshot(
  db: DbInstance,
  repoId: string,
): Promise<FactoryResult<CapabilitySnapshotRecord | null>> {
  try {
    const [row] = await db
      .select()
      .from(capabilitySnapshots)
      .where(eq(capabilitySnapshots.repoId, repoId))
      .orderBy(desc(capabilitySnapshots.capturedAt))
      .limit(1);
    return ok(row ?? null);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get latest capability snapshot: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function listCapabilitySnapshots(
  db: DbInstance,
  repoId: string,
): Promise<FactoryResult<CapabilitySnapshotRecord[]>> {
  try {
    const rows = await db
      .select()
      .from(capabilitySnapshots)
      .where(eq(capabilitySnapshots.repoId, repoId))
      .orderBy(desc(capabilitySnapshots.capturedAt));
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to list capability snapshots: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
