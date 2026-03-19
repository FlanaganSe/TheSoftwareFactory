import { apiKeyRepo } from "@software-factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;
let adminKey: string;
let operatorKey: string;
let viewerKey: string;

beforeAll(async () => {
  ctx = await setupTestApp();

  // Create test API keys
  const adminResult = await apiKeyRepo.createApiKey(
    ctx.dbConnection.db,
    "test-admin",
    "admin",
    "test",
  );
  adminKey = adminResult._unsafeUnwrap().rawKey;

  const operatorResult = await apiKeyRepo.createApiKey(
    ctx.dbConnection.db,
    "test-operator",
    "operator",
    "test",
  );
  operatorKey = operatorResult._unsafeUnwrap().rawKey;

  const viewerResult = await apiKeyRepo.createApiKey(
    ctx.dbConnection.db,
    "test-viewer",
    "viewer",
    "test",
  );
  viewerKey = viewerResult._unsafeUnwrap().rawKey;
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("auth middleware", () => {
  it("request without Authorization header → 401", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(401);
  });

  it("request with invalid API key → 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: "Bearer sf_invalid_key_here" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("request with malformed Authorization header → 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: "Basic abc123" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("request with valid admin key → passes", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    // 501 = stub (not implemented), but NOT 401
    expect(res.statusCode).toBe(501);
  });

  it("request with valid operator key → passes", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(res.statusCode).toBe(501);
  });

  it("request with valid viewer key → passes", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.statusCode).toBe(501);
  });

  it("request with expired API key → 401", async () => {
    const expiredResult = await apiKeyRepo.createApiKey(
      ctx.dbConnection.db,
      "test-expired",
      "admin",
      "test",
      new Date("2020-01-01"),
    );
    const expiredKey = expiredResult._unsafeUnwrap().rawKey;

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${expiredKey}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("request with revoked API key → 401", async () => {
    const revokedResult = await apiKeyRepo.createApiKey(
      ctx.dbConnection.db,
      "test-revoked",
      "admin",
      "test",
    );
    const revokedData = revokedResult._unsafeUnwrap();
    await apiKeyRepo.revokeApiKey(ctx.dbConnection.db, revokedData.id);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${revokedData.rawKey}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
