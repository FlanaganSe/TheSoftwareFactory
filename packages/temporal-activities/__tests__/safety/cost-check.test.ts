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
import { createCostCheckActivity } from "../../src/safety/cost-check.js";

let redis: Redis;
let activities: ReturnType<typeof createCostCheckActivity>;

beforeAll(async () => {
  const redisUrl = inject("redisUrl");
  redis = new Redis(redisUrl, { lazyConnect: false });
  activities = createCostCheckActivity(redis);
});

afterAll(async () => {
  await redis?.quit();
});

beforeEach(async () => {
  await redis.flushall();
});

describe("checkCostBudget", () => {
  it("allows when no existing cost (defaults to budget 1000)", async () => {
    const result = await activities.checkCostBudget("task-1", 100);
    expect(result.allowed).toBe(true);
    expect(result.currentCents).toBe(0);
    expect(result.budgetCents).toBe(1000);
    expect(result.percentUsed).toBe(10);
  });

  it("allows when under budget", async () => {
    await redis.set("factory:cost:task-1", "500");
    await redis.set("factory:budget:task-1", "2000");
    const result = await activities.checkCostBudget("task-1", 100);
    expect(result.allowed).toBe(true);
    expect(result.currentCents).toBe(500);
    expect(result.percentUsed).toBe(30);
  });

  it("denies when at budget", async () => {
    await redis.set("factory:cost:task-1", "900");
    const result = await activities.checkCostBudget("task-1", 101);
    expect(result.allowed).toBe(false);
    expect(result.percentUsed).toBeGreaterThan(100);
  });

  it("denies when over budget", async () => {
    await redis.set("factory:cost:task-1", "1500");
    const result = await activities.checkCostBudget("task-1", 100);
    expect(result.allowed).toBe(false);
  });

  it("uses custom budget when set", async () => {
    await redis.set("factory:budget:task-1", "5000");
    const result = await activities.checkCostBudget("task-1", 2000);
    expect(result.allowed).toBe(true);
    expect(result.budgetCents).toBe(5000);
    expect(result.percentUsed).toBe(40);
  });
});

describe("recordCost", () => {
  it("increments task and daily counters", async () => {
    const result1 = await activities.recordCost("task-1", 100);
    expect(result1.totalCents).toBe(100);
    expect(result1.overBudget).toBe(false);

    const result2 = await activities.recordCost("task-1", 200);
    expect(result2.totalCents).toBe(300);
    expect(result2.percentUsed).toBe(30);
  });

  it("detects over-budget after recording", async () => {
    await redis.set("factory:cost:task-1", "950");
    const result = await activities.recordCost("task-1", 100);
    expect(result.totalCents).toBe(1050);
    expect(result.overBudget).toBe(true);
  });

  it("sets TTL on daily key", async () => {
    await activities.recordCost("task-1", 50);
    const dailyKey = `factory:cost:daily:${new Date().toISOString().slice(0, 10)}`;
    const ttl = await redis.ttl(dailyKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86400);
  });
});
