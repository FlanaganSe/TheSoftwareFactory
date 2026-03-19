import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { webhookDeliveries } from "../schema/webhook-deliveries.js";

export async function recordDelivery(
  db: DbInstance,
  deliveryId: string,
  event: string,
  action: string | null,
  payloadHash: string,
): Promise<FactoryResult<void>> {
  try {
    await db
      .insert(webhookDeliveries)
      .values({ deliveryId, event, action, payloadHash });
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to record delivery: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function isDeliveryProcessed(
  db: DbInstance,
  deliveryId: string,
): Promise<FactoryResult<boolean>> {
  try {
    const row = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.deliveryId, deliveryId),
    });
    return ok(row?.status === "processed");
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to check delivery status: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function markDeliveryProcessed(
  db: DbInstance,
  deliveryId: string,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(webhookDeliveries)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to mark delivery processed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function markDeliveryFailed(
  db: DbInstance,
  deliveryId: string,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed" })
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to mark delivery failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
