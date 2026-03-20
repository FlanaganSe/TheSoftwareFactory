import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("metrics endpoint", () => {
  it("GET /metrics returns 200", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
  });

  it("GET /metrics returns text/plain content type", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/metrics" });
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("GET /metrics contains factory_api metrics", async () => {
    // Make a request first to populate metrics
    await ctx.app.inject({ method: "GET", url: "/health" });

    const res = await ctx.app.inject({ method: "GET", url: "/metrics" });
    const body = res.body;
    // Should contain at least the default process metrics or custom API metrics
    expect(body).toContain("factory_api");
  });
});
