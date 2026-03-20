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
import { withCircuitBreaker } from "../../src/safety/with-circuit-breaker.js";

let redis: Redis;
let cb: CircuitBreaker;

beforeAll(async () => {
  const redisUrl = inject("redisUrl");
  redis = new Redis(redisUrl, { lazyConnect: false, db: 6 });
  cb = createCircuitBreaker(redis, [
    {
      service: "test-service",
      failureThreshold: 2,
      resetTimeoutMs: 100,
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

describe("withCircuitBreaker", () => {
  it("successful call records success and returns ok result", async () => {
    const result = await withCircuitBreaker(
      cb,
      "test-service",
      async () => "ok",
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("ok");

    const status = await cb.getStatus("test-service");
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.consecutiveFailures).toBe(0);
  });

  it("failed call records failure and returns err result", async () => {
    const result = await withCircuitBreaker(cb, "test-service", async () => {
      throw new Error("boom");
    });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("service_unavailable");
    expect(error.message).toContain("boom");

    const status = await cb.getStatus("test-service");
    expect(status.consecutiveFailures).toBe(1);
  });

  it("circuit open returns err without calling fn", async () => {
    await cb.forceOpen("test-service");

    let called = false;
    const result = await withCircuitBreaker(cb, "test-service", async () => {
      called = true;
      return "should not reach";
    });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("service_unavailable");
    expect(error.message).toContain("Circuit breaker open");
    expect(called).toBe(false);
  });

  it("circuit half_open allows one attempt", async () => {
    cb = createCircuitBreaker(redis, [
      {
        service: "test-service",
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenMaxAttempts: 1,
      },
    ]);
    await cb.recordFailure("test-service");
    await new Promise((r) => setTimeout(r, 100));
    const allowed = await cb.canExecute("test-service");
    expect(allowed).toBe(true);

    const result = await withCircuitBreaker(
      cb,
      "test-service",
      async () => "recovered",
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("recovered");

    const status = await cb.getStatus("test-service");
    expect(status.state).toBe("closed");
  });
});
