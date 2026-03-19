import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBranchLeaseActivity } from "../../src/safety/branch-lease.js";

let container: StartedTestContainer;
let redis: Redis;
let activities: ReturnType<typeof createBranchLeaseActivity>;

beforeAll(async () => {
  container = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();
  redis = new Redis({
    host: container.getHost(),
    port: container.getMappedPort(6379),
    lazyConnect: false,
  });
  activities = createBranchLeaseActivity(redis);
}, 60_000);

afterAll(async () => {
  await redis.quit();
  await container.stop();
});

beforeEach(async () => {
  await redis.flushall();
});

describe("acquireBranchLease", () => {
  it("acquires lease on empty key", async () => {
    const result = await activities.acquireBranchLease("main", "task-1", 60);
    expect(result).toEqual({ acquired: true });
  });

  it("fails when already taken by another task", async () => {
    await activities.acquireBranchLease("main", "task-1", 60);
    const result = await activities.acquireBranchLease("main", "task-2", 60);
    expect(result.acquired).toBe(false);
    expect(result.existingOwner).toBe("task-1");
  });

  it("allows same task to see lease taken by itself", async () => {
    await activities.acquireBranchLease("main", "task-1", 60);
    const result = await activities.acquireBranchLease("main", "task-1", 60);
    // NX means SET only if not exists — even same value fails
    expect(result.acquired).toBe(false);
    expect(result.existingOwner).toBe("task-1");
  });
});

describe("releaseBranchLease", () => {
  it("releases when owner matches", async () => {
    await activities.acquireBranchLease("main", "task-1", 60);
    const released = await activities.releaseBranchLease("main", "task-1");
    expect(released).toBe(true);
    // Can now acquire again
    const result = await activities.acquireBranchLease("main", "task-2", 60);
    expect(result.acquired).toBe(true);
  });

  it("does NOT release when owner does not match", async () => {
    await activities.acquireBranchLease("main", "task-1", 60);
    const released = await activities.releaseBranchLease("main", "task-2");
    expect(released).toBe(false);
    // Original owner still holds the lease
    const key = "factory:branch_lease:main";
    const owner = await redis.get(key);
    expect(owner).toBe("task-1");
  });
});

describe("renewBranchLease", () => {
  it("renews when owner matches", async () => {
    await activities.acquireBranchLease("main", "task-1", 10);
    const renewed = await activities.renewBranchLease("main", "task-1", 120);
    expect(renewed).toBe(true);
    const ttl = await redis.ttl("factory:branch_lease:main");
    expect(ttl).toBeGreaterThan(10);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it("does NOT renew when owner does not match", async () => {
    await activities.acquireBranchLease("main", "task-1", 60);
    const renewed = await activities.renewBranchLease("main", "task-2", 120);
    expect(renewed).toBe(false);
  });
});

describe("lease expiry", () => {
  it("expires after TTL and allows reacquire", async () => {
    await activities.acquireBranchLease("main", "task-1", 1);
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1500));
    const result = await activities.acquireBranchLease("main", "task-2", 60);
    expect(result.acquired).toBe(true);
  }, 5_000);
});
