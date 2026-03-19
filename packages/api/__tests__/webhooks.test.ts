import { createHmac } from "node:crypto";
import { webhookRepo } from "@software-factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

function signPayload(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("webhook endpoint", () => {
  it("valid signature → 200, delivery persisted to DB", async () => {
    const payload = JSON.stringify({ action: "opened", zen: "test" });
    const signature = signPayload(payload, "test-webhook-secret");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": "valid-delivery-001",
        "x-github-event": "push",
      },
      payload,
    });

    expect(res.statusCode).toBe(200);

    // Verify persisted to DB
    const processed = await webhookRepo.isDeliveryProcessed(
      ctx.dbConnection.db,
      "valid-delivery-001",
    );
    expect(processed._unsafeUnwrap()).toBe(true);
  });

  it("invalid signature → 401, nothing persisted", async () => {
    const payload = JSON.stringify({ zen: "bad" });
    const badSignature = signPayload(payload, "wrong-secret");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": badSignature,
        "x-github-delivery": "bad-sig-delivery",
        "x-github-event": "push",
      },
      payload,
    });

    expect(res.statusCode).toBe(401);

    // Verify NOT persisted
    const processed = await webhookRepo.isDeliveryProcessed(
      ctx.dbConnection.db,
      "bad-sig-delivery",
    );
    expect(processed._unsafeUnwrap()).toBe(false);
  });

  it("missing X-Hub-Signature-256 → 401", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "no-sig-delivery",
        "x-github-event": "push",
      },
      payload: JSON.stringify({ zen: "test" }),
    });

    expect(res.statusCode).toBe(401);
  });

  it("duplicate X-GitHub-Delivery → 200 (idempotent)", async () => {
    const payload = JSON.stringify({ action: "opened", zen: "dup" });
    const signature = signPayload(payload, "test-webhook-secret");
    const deliveryId = "dup-delivery-001";

    // First request
    const res1 = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": deliveryId,
        "x-github-event": "push",
      },
      payload,
    });
    expect(res1.statusCode).toBe(200);

    // Duplicate request
    const res2 = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": deliveryId,
        "x-github-event": "push",
      },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe("already_processed");
  });

  it("missing X-GitHub-Delivery → 400", async () => {
    const payload = JSON.stringify({ zen: "test" });
    const signature = signPayload(payload, "test-webhook-secret");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "push",
      },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });
});
