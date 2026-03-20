import { Redis } from "ioredis";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import { createCircuitBreaker } from "../../src/safety/circuit-breaker.js";
import type { CircuitBreaker } from "../../src/safety/circuit-breaker.js";

let redis: Redis;
let cb: CircuitBreaker;

beforeAll(async () => {
  const redisUrl = inject("redisUrl");
  redis = new Redis(redisUrl, { lazyConnect: false, db: 3 });
  cb = createCircuitBreaker(redis, [
    {
      service: "github",
      failureThreshold: 3,
      resetTimeoutMs: 500,
      halfOpenMaxAttempts: 1,
    },
    {
      service: "openrouter",
      failureThreshold: 2,
      resetTimeoutMs: 300,
      halfOpenMaxAttempts: 1,
    },
  ]);
});

afterAll(async () => {
  await redis?.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe("circuit breaker", () => {
  it("closed circuit allows execution", async () => {
    const allowed = await cb.canExecute("github");
    expect(allowed).toBe(true);
  });

  it("records N failures and opens circuit", async () => {
    await cb.recordFailure("github");
    await cb.recordFailure("github");
    expect(await cb.canExecute("github")).toBe(true);

    await cb.recordFailure("github");
    // Now at threshold (3) — circuit should be open
    const status = await cb.getStatus("github");
    expect(status.state).toBe("open");
    expect(await cb.canExecute("github")).toBe(false);
  });

  it("open circuit rejects execution", async () => {
    await cb.forceOpen("github");
    const allowed = await cb.canExecute("github");
    expect(allowed).toBe(false);
  });

  it("after resetTimeout, circuit transitions to half_open", async () => {
    cb = createCircuitBreaker(redis, [
      {
        service: "github",
        failureThreshold: 1,
        resetTimeoutMs: 100,
        halfOpenMaxAttempts: 1,
      },
    ]);
    await cb.recordFailure("github");
    expect(await cb.canExecute("github")).toBe(false);

    // Wait for resetTimeout
    await new Promise((r) => setTimeout(r, 150));
    const allowed = await cb.canExecute("github");
    expect(allowed).toBe(true);

    const status = await cb.getStatus("github");
    expect(status.state).toBe("half_open");
  });

  it("half-open success closes circuit", async () => {
    cb = createCircuitBreaker(redis, [
      {
        service: "github",
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenMaxAttempts: 1,
      },
    ]);
    await cb.recordFailure("github");
    await new Promise((r) => setTimeout(r, 100));
    await cb.canExecute("github"); // transitions to half_open

    await cb.recordSuccess("github");
    const status = await cb.getStatus("github");
    expect(status.state).toBe("closed");
    expect(status.consecutiveFailures).toBe(0);
  });

  it("half-open failure re-opens circuit", async () => {
    cb = createCircuitBreaker(redis, [
      {
        service: "github",
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenMaxAttempts: 1,
      },
    ]);
    await cb.recordFailure("github");
    await new Promise((r) => setTimeout(r, 100));
    await cb.canExecute("github"); // transitions to half_open

    await cb.recordFailure("github");
    const status = await cb.getStatus("github");
    expect(status.state).toBe("open");
  });

  it("forceOpen trips circuit immediately", async () => {
    await cb.forceOpen("github");
    const status = await cb.getStatus("github");
    expect(status.state).toBe("open");
    expect(status.trippedAt).not.toBeNull();
    expect(await cb.canExecute("github")).toBe(false);
  });

  it("forceClose resets circuit immediately", async () => {
    await cb.forceOpen("github");
    await cb.forceClose("github");
    const status = await cb.getStatus("github");
    expect(status.state).toBe("closed");
    expect(status.consecutiveFailures).toBe(0);
    expect(await cb.canExecute("github")).toBe(true);
  });

  it("getStatus returns correct state for each phase", async () => {
    // Closed
    let status = await cb.getStatus("github");
    expect(status.state).toBe("closed");
    expect(status.service).toBe("github");

    // Open
    await cb.forceOpen("github");
    status = await cb.getStatus("github");
    expect(status.state).toBe("open");
    expect(status.trippedAt).not.toBeNull();
    expect(status.nextRetryAt).not.toBeNull();
  });

  it("getAllStatuses returns all configured services", async () => {
    cb = createCircuitBreaker(redis, [
      {
        service: "github",
        failureThreshold: 3,
        resetTimeoutMs: 500,
        halfOpenMaxAttempts: 1,
      },
      {
        service: "openrouter",
        failureThreshold: 2,
        resetTimeoutMs: 300,
        halfOpenMaxAttempts: 1,
      },
    ]);
    const statuses = await cb.getAllStatuses();
    expect(statuses).toHaveLength(2);
    const services = statuses.map((s) => s.service).sort();
    expect(services).toEqual(["github", "openrouter"]);
  });

  it("different services have independent circuits", async () => {
    cb = createCircuitBreaker(redis, [
      {
        service: "github",
        failureThreshold: 2,
        resetTimeoutMs: 500,
        halfOpenMaxAttempts: 1,
      },
      {
        service: "openrouter",
        failureThreshold: 2,
        resetTimeoutMs: 300,
        halfOpenMaxAttempts: 1,
      },
    ]);
    await cb.forceOpen("github");
    expect(await cb.canExecute("github")).toBe(false);
    expect(await cb.canExecute("openrouter")).toBe(true);
  });

  it("success resets failure count", async () => {
    cb = createCircuitBreaker(redis, [
      {
        service: "github",
        failureThreshold: 3,
        resetTimeoutMs: 500,
        halfOpenMaxAttempts: 1,
      },
    ]);
    await cb.recordFailure("github");
    await cb.recordFailure("github");
    let status = await cb.getStatus("github");
    expect(status.consecutiveFailures).toBe(2);

    await cb.recordSuccess("github");
    status = await cb.getStatus("github");
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastSuccessAt).not.toBeNull();
  });

  it("concurrent calls during open state are all rejected", async () => {
    await cb.forceOpen("github");
    const results = await Promise.all([
      cb.canExecute("github"),
      cb.canExecute("github"),
      cb.canExecute("github"),
    ]);
    expect(results).toEqual([false, false, false]);
  });
});
