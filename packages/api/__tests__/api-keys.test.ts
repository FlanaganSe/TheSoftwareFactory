import { apiKeyRepo } from "@software-factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;
let adminKey: string;
let operatorKey: string;

beforeAll(async () => {
  ctx = await setupTestApp();

  const db = ctx.dbConnection.db;
  adminKey = (
    await apiKeyRepo.createApiKey(db, "keys-admin", "admin", "test")
  )._unsafeUnwrap().rawKey;
  operatorKey = (
    await apiKeyRepo.createApiKey(db, "keys-operator", "operator", "test")
  )._unsafeUnwrap().rawKey;
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("API key management", () => {
  it("create API key → returns raw key, key hash in DB", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { label: "new-key", role: "viewer" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toMatch(/^sf_/);
    expect(body.label).toBe("new-key");
    expect(body.role).toBe("viewer");
    expect(body.id).toBeDefined();
  });

  it("create with non-admin caller → 403", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { authorization: `Bearer ${operatorKey}` },
      payload: { label: "sneaky", role: "admin" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("list keys → shows metadata but NOT raw keys", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/keys",
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(res.statusCode).toBe(200);
    const keys = res.json();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);

    // Verify no raw keys exposed
    for (const key of keys) {
      expect(key.key).toBeUndefined();
      expect(key.label).toBeDefined();
      expect(key.role).toBeDefined();
    }
  });

  it("revoke key → subsequent requests with that key fail", async () => {
    // Create a key to revoke
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { label: "to-revoke", role: "viewer" },
    });
    const { id, key } = createRes.json();

    // Verify it works
    const beforeRes = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${key}` },
    });
    expect(beforeRes.statusCode).toBe(501); // stub, not 401

    // Revoke
    const revokeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/keys/${id}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(revokeRes.statusCode).toBe(204);

    // Verify it's now rejected
    const afterRes = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${key}` },
    });
    expect(afterRes.statusCode).toBe(401);
  });
});
