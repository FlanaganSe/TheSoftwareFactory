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
    expect(body.version).toBe("0.1.0");
  });

  it("GET /health/live always returns 200", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("GET /health/ready includes all dependency checks", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    const body = res.json();

    // DB is healthy (Testcontainers Postgres is running)
    expect(body.checks.database).toBeDefined();
    expect(body.checks.database.status).toBe("healthy");

    // Redis, Temporal, MinIO are not configured in test — should be unhealthy
    expect(body.checks.redis).toBeDefined();
    expect(body.checks.redis.status).toBe("unhealthy");
    expect(body.checks.temporal).toBeDefined();
    expect(body.checks.temporal.status).toBe("unhealthy");
    expect(body.checks.minio).toBeDefined();
    expect(body.checks.minio.status).toBe("unhealthy");
  });

  it("GET /health/ready returns 503 when dependencies are down", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    // Redis/Temporal/MinIO are not configured → at least one unhealthy → 503
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
  });

  it("GET /health/ready returns version in response", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    const body = res.json();
    expect(body.version).toBe("0.1.0");
  });

  it("GET /health/ready has latency info for healthy services", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    const body = res.json();
    // DB is healthy and should have latency
    expect(typeof body.checks.database.latencyMs).toBe("number");
  });

  it("GET /health/ready has error info for unhealthy services", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    const body = res.json();
    // Redis is unhealthy and should have an error message
    expect(typeof body.checks.redis.error).toBe("string");
  });
});
