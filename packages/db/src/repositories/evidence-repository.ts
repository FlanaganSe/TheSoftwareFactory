import type {
  CommandRecord,
  DiffAnnotation,
  EvidenceBundle,
  FactoryResult,
  LintResults,
  MigrationImpact,
  ProtectedEdit,
  RevertabilityClass,
  SecurityScanResults,
  TestResults,
} from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { and, desc, eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { auditEntries } from "../schema/audit-entries.js";
import { evidenceBundles } from "../schema/evidence-bundles.js";
import { computeContentHash } from "../utils/content-hash.js";

type EvidenceBundleRecord = typeof evidenceBundles.$inferSelect;

export interface CreateEvidenceBundleInput {
  readonly taskId: string;
  readonly schemaVersion: number;
  readonly objective: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeBaseSha: string;
  readonly revertabilityClass: RevertabilityClass;
  readonly blastRadiusFiles: number;
  readonly blastRadiusPackages: number;
  readonly hasProtectedSurfaceEdits: boolean;
  readonly hasMigrationImpact: boolean;
  readonly artifactUrl: string | null;
  readonly annotatedDiff: DiffAnnotation[];
  readonly ownersImpacted: string[];
  readonly testResults: TestResults;
  readonly securityScanResults: SecurityScanResults;
  readonly lintResults: LintResults;
  readonly protectedSurfaceEdits: ProtectedEdit[];
  readonly migrationImpact: MigrationImpact;
  readonly unresolvedAssumptions: string[];
  readonly commandsRun: CommandRecord[];
  readonly pendingExternalChecks: string[];
}

export async function createEvidenceBundle(
  db: DbInstance,
  input: CreateEvidenceBundleInput,
): Promise<FactoryResult<EvidenceBundleRecord>> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(evidenceBundles)
        .values({
          taskId: input.taskId,
          schemaVersion: input.schemaVersion,
          objective: input.objective,
          baseSha: input.baseSha,
          headSha: input.headSha,
          mergeBaseSha: input.mergeBaseSha,
          revertabilityClass: input.revertabilityClass,
          blastRadiusFiles: input.blastRadiusFiles,
          blastRadiusPackages: input.blastRadiusPackages,
          hasProtectedSurfaceEdits: input.hasProtectedSurfaceEdits,
          hasMigrationImpact: input.hasMigrationImpact,
          artifactUrl: input.artifactUrl,
          annotatedDiff: input.annotatedDiff,
          ownersImpacted: input.ownersImpacted,
          testResults: input.testResults,
          securityScanResults: input.securityScanResults,
          lintResults: input.lintResults,
          protectedSurfaceEdits: input.protectedSurfaceEdits,
          migrationImpact: input.migrationImpact,
          unresolvedAssumptions: input.unresolvedAssumptions,
          commandsRun: input.commandsRun,
          pendingExternalChecks: input.pendingExternalChecks,
        })
        .returning();

      // Audit entry in the same transaction
      const contentHash = computeContentHash({
        bundleId: row.id,
        taskId: input.taskId,
        baseSha: input.baseSha,
        headSha: input.headSha,
      });

      await tx.insert(auditEntries).values({
        actor: "system",
        actionType: "evidence_generated",
        targetType: "evidence",
        targetId: row.id,
        result: "success",
        taskId: input.taskId,
        content: {
          bundleId: row.id,
          schemaVersion: input.schemaVersion,
          baseSha: input.baseSha,
          headSha: input.headSha,
        },
        contentHash,
      });

      return ok(row);
    });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create evidence bundle: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getEvidenceBundle(
  db: DbInstance,
  bundleId: string,
): Promise<FactoryResult<EvidenceBundleRecord | null>> {
  try {
    const row = await db.query.evidenceBundles.findFirst({
      where: eq(evidenceBundles.id, bundleId),
    });
    return ok(row ?? null);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get evidence bundle: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getEvidenceForTask(
  db: DbInstance,
  taskId: string,
  attemptNumber?: number,
): Promise<FactoryResult<EvidenceBundleRecord[]>> {
  try {
    const conditions = [eq(evidenceBundles.taskId, taskId)];
    if (attemptNumber !== undefined) {
      conditions.push(eq(evidenceBundles.version, attemptNumber));
    }
    const rows = await db
      .select()
      .from(evidenceBundles)
      .where(and(...conditions))
      .orderBy(desc(evidenceBundles.createdAt));
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get evidence for task: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function sealEvidence(
  db: DbInstance,
  bundleId: string,
  manifestHash: string,
): Promise<FactoryResult<void>> {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: evidenceBundles.id })
        .from(evidenceBundles)
        .where(eq(evidenceBundles.id, bundleId));

      if (!existing) {
        return err(
          createFactoryError(
            "unknown_internal",
            `Evidence bundle not found: ${bundleId}`,
          ),
        );
      }

      // Update artifact URL with manifest hash to mark as sealed
      await tx
        .update(evidenceBundles)
        .set({ artifactUrl: `sealed:${manifestHash}` })
        .where(eq(evidenceBundles.id, bundleId));

      const contentHash = computeContentHash({
        bundleId,
        manifestHash,
        sealedAt: new Date().toISOString(),
      });

      await tx.insert(auditEntries).values({
        actor: "system",
        actionType: "evidence_generated",
        targetType: "evidence",
        targetId: bundleId,
        result: "sealed",
        content: { bundleId, manifestHash, action: "seal" },
        contentHash,
      });

      return ok(undefined);
    });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to seal evidence: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
