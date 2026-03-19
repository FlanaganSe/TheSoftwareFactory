import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { sideEffects } from "../schema/side-effects.js";

type SideEffect = typeof sideEffects.$inferSelect;

export async function recordSideEffect(
  db: DbInstance,
  taskId: string | null,
  effectType: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<FactoryResult<void>> {
  try {
    await db.insert(sideEffects).values({
      taskId,
      effectType,
      idempotencyKey,
      requestPayloadHash: requestHash,
    });
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to record side effect: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getSideEffect(
  db: DbInstance,
  idempotencyKey: string,
): Promise<FactoryResult<SideEffect | null>> {
  try {
    const row = await db.query.sideEffects.findFirst({
      where: eq(sideEffects.idempotencyKey, idempotencyKey),
    });
    return ok(row ?? null);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get side effect: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function completeSideEffect(
  db: DbInstance,
  idempotencyKey: string,
  responsePayload: Record<string, unknown>,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(sideEffects)
      .set({
        status: "completed",
        responsePayload,
        updatedAt: new Date(),
      })
      .where(eq(sideEffects.idempotencyKey, idempotencyKey));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to complete side effect: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function failSideEffect(
  db: DbInstance,
  idempotencyKey: string,
  errorMessage: string,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(sideEffects)
      .set({
        status: "failed",
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(sideEffects.idempotencyKey, idempotencyKey));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to fail side effect: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
