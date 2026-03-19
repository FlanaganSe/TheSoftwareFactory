import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isDeliveryProcessed,
  markDeliveryProcessed,
  recordDelivery,
} from "../src/repositories/webhook-repository.js";
import { type TestContext, setupTestDb, teardownTestDb } from "./setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestDb();
}, 120_000);

afterAll(async () => {
  await teardownTestDb(ctx);
});

describe("webhook dedup", () => {
  it("record delivery with unique deliveryId: succeeds", async () => {
    const result = await recordDelivery(
      ctx.db,
      "delivery-001",
      "push",
      null,
      "hash-abc",
    );
    expect(result.isOk()).toBe(true);
  });

  it("record duplicate deliveryId: fails (unique constraint)", async () => {
    // First insert
    await recordDelivery(ctx.db, "delivery-dup", "push", null, "hash-1");

    // Duplicate
    const result = await recordDelivery(
      ctx.db,
      "delivery-dup",
      "push",
      null,
      "hash-2",
    );
    expect(result.isErr()).toBe(true);
  });

  it("isDeliveryProcessed returns false for new, true for processed", async () => {
    await recordDelivery(ctx.db, "delivery-check", "push", null, "hash-chk");

    const beforeResult = await isDeliveryProcessed(ctx.db, "delivery-check");
    expect(beforeResult._unsafeUnwrap()).toBe(false);

    await markDeliveryProcessed(ctx.db, "delivery-check");

    const afterResult = await isDeliveryProcessed(ctx.db, "delivery-check");
    expect(afterResult._unsafeUnwrap()).toBe(true);
  });
});
