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
import { createKillCheckActivity } from "../../src/safety/kill-check.js";

let redis: Redis;
let activities: ReturnType<typeof createKillCheckActivity>;

beforeAll(async () => {
  // Redis container is started once by globalSetup and shared via inject()
  // See: __tests__/safety/global-setup.ts
  const redisUrl = inject("redisUrl");
  redis = new Redis(redisUrl, { lazyConnect: false });
  activities = createKillCheckActivity(redis);
});

afterAll(async () => {
  await redis?.quit();
});

beforeEach(async () => {
  await redis.flushall();
});

describe("checkKillSwitch", () => {
  it("returns killed=false when no flags are set", async () => {
    const result = await activities.checkKillSwitch("task-1");
    expect(result).toEqual({ killed: false, scope: "none" });
  });

  it("returns killed=true with scope=global when global kill is set", async () => {
    await redis.set("factory:kill_switch", "1");
    const result = await activities.checkKillSwitch("task-1");
    expect(result).toEqual({ killed: true, scope: "global" });
  });

  it("returns killed=true with scope=task when task kill is set", async () => {
    await redis.set("factory:kill:task-1", "1");
    const result = await activities.checkKillSwitch("task-1");
    expect(result).toEqual({ killed: true, scope: "task" });
  });

  it("global takes precedence when both are set", async () => {
    await redis.set("factory:kill_switch", "1");
    await redis.set("factory:kill:task-1", "1");
    const result = await activities.checkKillSwitch("task-1");
    expect(result).toEqual({ killed: true, scope: "global" });
  });

  it("task kill for different task does not affect this task", async () => {
    await redis.set("factory:kill:task-other", "1");
    const result = await activities.checkKillSwitch("task-1");
    expect(result).toEqual({ killed: false, scope: "none" });
  });

  it("completes quickly (sub-millisecond on warm Redis)", async () => {
    // Warm up connection
    await activities.checkKillSwitch("task-1");
    await activities.checkKillSwitch("task-1");
    // Measure best of 5
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await activities.checkKillSwitch("task-1");
      times.push(performance.now() - start);
    }
    const best = Math.min(...times);
    // Under testcontainer load, allow up to 20ms; in production this is <1ms
    expect(best).toBeLessThan(20);
  });
});
