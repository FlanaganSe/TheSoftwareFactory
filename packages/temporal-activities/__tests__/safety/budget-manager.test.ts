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
import { createBudgetManager } from "../../src/safety/budget-manager.js";
import type { BudgetManager } from "../../src/safety/budget-manager.js";

let redis: Redis;
let bm: BudgetManager;

beforeAll(async () => {
  const redisUrl = inject("redisUrl");
  redis = new Redis(redisUrl, { lazyConnect: false, db: 5 });
  bm = createBudgetManager(redis);
});

afterAll(async () => {
  await redis?.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe("budget manager", () => {
  it("setTaskBudget is retrievable via getTaskCost", async () => {
    await bm.setTaskBudget("task-1", 2000);
    const cost = await bm.getTaskCost("task-1");
    expect(cost.budgetCents).toBe(2000);
    expect(cost.currentCents).toBe(0);
    expect(cost.percentUsed).toBe(0);
    expect(cost.overBudget).toBe(false);
  });

  it("overrideBudget updates budget", async () => {
    await bm.setTaskBudget("task-1", 1000);
    await bm.overrideBudget("task-1", 5000, "admin-1");
    const cost = await bm.getTaskCost("task-1");
    expect(cost.budgetCents).toBe(5000);
  });

  it("getDailyCost returns today's accumulated cost", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await redis.set(`factory:cost:daily:${today}`, "4200");

    const daily = await bm.getDailyCost();
    expect(daily.date).toBe(today);
    expect(daily.totalCents).toBe(4200);
  });

  it("getDailyCost with specific date returns historical data", async () => {
    await redis.set("factory:cost:daily:2026-01-15", "9900");

    const daily = await bm.getDailyCost("2026-01-15");
    expect(daily.date).toBe("2026-01-15");
    expect(daily.totalCents).toBe(9900);
  });

  it("getTasksNearBudget returns tasks above threshold", async () => {
    await bm.setTaskBudget("task-1", 1000);
    await redis.set("factory:cost:task-1", "850");
    await bm.setTaskBudget("task-2", 1000);
    await redis.set("factory:cost:task-2", "200");

    const nearBudget = await bm.getTasksNearBudget(80);
    expect(nearBudget.length).toBe(1);
    expect(nearBudget[0].taskId).toBe("task-1");
    expect(nearBudget[0].percentUsed).toBe(85);
  });

  it("setDailyBudget is reflected in getDailyCost", async () => {
    await bm.setDailyBudget(50_000);
    const daily = await bm.getDailyCost();
    expect(daily.budgetCents).toBe(50_000);
  });

  it("getDailyBudget returns default when not set", async () => {
    const budget = await bm.getDailyBudget();
    expect(budget).toBe(10_000); // $100 default
  });

  it("getDailyBudget returns set value", async () => {
    await bm.setDailyBudget(25_000);
    const budget = await bm.getDailyBudget();
    expect(budget).toBe(25_000);
  });

  it("cost accumulation across multiple recordCost calls", async () => {
    // Simulate cost recording (using raw Redis, as M9's recordCost does)
    await redis.incrby("factory:cost:task-1", 100);
    await redis.incrby("factory:cost:task-1", 250);
    await redis.incrby("factory:cost:task-1", 150);

    await bm.setTaskBudget("task-1", 1000);
    const cost = await bm.getTaskCost("task-1");
    expect(cost.currentCents).toBe(500);
    expect(cost.percentUsed).toBe(50);
    expect(cost.overBudget).toBe(false);
  });

  it("overBudget is true when cost exceeds budget", async () => {
    await bm.setTaskBudget("task-1", 500);
    await redis.set("factory:cost:task-1", "600");

    const cost = await bm.getTaskCost("task-1");
    expect(cost.overBudget).toBe(true);
    expect(cost.percentUsed).toBe(120);
  });

  it("getTaskCost returns default budget when not explicitly set", async () => {
    const cost = await bm.getTaskCost("task-new");
    expect(cost.budgetCents).toBe(1000); // $10 default
  });
});
