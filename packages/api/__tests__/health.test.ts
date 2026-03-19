import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("health endpoints", () => {
  it("GET /health returns 200 with status and version", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.0.0");
  });

  it("GET /health/live always returns 200", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("GET /health/ready returns 200 when DB is healthy", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.json().checks.database.status).toBe("healthy");
  });
});
