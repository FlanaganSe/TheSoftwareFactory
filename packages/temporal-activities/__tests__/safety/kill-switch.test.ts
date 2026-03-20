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
import { createKillSwitch } from "../../src/safety/kill-switch.js";
import type { KillEvent, KillSwitch } from "../../src/safety/kill-switch.js";

let redis: Redis;
let pubsubRedis: Redis;
let ks: KillSwitch;

beforeAll(async () => {
  const redisUrl = inject("redisUrl");
  redis = new Redis(redisUrl, { lazyConnect: false, db: 4 });
  pubsubRedis = new Redis(redisUrl, { lazyConnect: false, db: 4 });
  ks = createKillSwitch(redis, pubsubRedis);
});

afterAll(async () => {
  await redis?.quit();
  await pubsubRedis?.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe("kill switch", () => {
  it("activateGlobal sets global kill flag", async () => {
    await ks.activateGlobal("admin-1", "testing");
    expect(await ks.isGlobalActive()).toBe(true);
  });

  it("activateForTask sets per-task kill flag", async () => {
    await ks.activateForTask("task-1", "admin-1", "testing");
    expect(await ks.isTaskActive("task-1")).toBe(true);
    expect(await ks.isTaskActive("task-2")).toBe(false);
  });

  it("deactivateGlobal clears global kill flag", async () => {
    await ks.activateGlobal("admin-1");
    await ks.deactivateGlobal("admin-1");
    expect(await ks.isGlobalActive()).toBe(false);
  });

  it("deactivateForTask clears per-task kill flag", async () => {
    await ks.activateForTask("task-1", "admin-1");
    await ks.deactivateForTask("task-1", "admin-1");
    expect(await ks.isTaskActive("task-1")).toBe(false);
  });

  it("activateGlobal publishes to factory:system channel", async () => {
    const subscriber = new Redis(inject("redisUrl"), { lazyConnect: false });
    const events: KillEvent[] = [];

    await subscriber.subscribe("factory:system");
    subscriber.on("message", (_ch: string, msg: string) => {
      events.push(JSON.parse(msg) as KillEvent);
    });

    // Small delay to ensure subscription is ready
    await new Promise((r) => setTimeout(r, 50));

    await ks.activateGlobal("admin-1", "emergency");

    // Wait for pub/sub propagation
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("kill_activated");
    expect(events[0].scope).toBe("global");
    expect(events[0].actor).toBe("admin-1");
    expect(events[0].reason).toBe("emergency");

    await subscriber.unsubscribe();
    await subscriber.quit();
  });

  it("getActiveKills lists all active kills", async () => {
    await ks.activateGlobal("admin-1", "global reason");
    await ks.activateForTask("task-1", "admin-1", "task reason");

    const kills = await ks.getActiveKills();
    expect(kills.length).toBeGreaterThanOrEqual(2);
    const globalKill = kills.find((k) => k.scope === "global");
    expect(globalKill).toBeDefined();
    expect(globalKill?.actor).toBe("admin-1");
    const taskKill = kills.find(
      (k) => k.scope === "task" && k.taskId === "task-1",
    );
    expect(taskKill).toBeDefined();
  });

  it("M9 checkKillSwitch detects kills set by kill switch", async () => {
    const killCheck = createKillCheckActivity(redis);

    // Before activation
    let result = await killCheck.checkKillSwitch("task-1");
    expect(result.killed).toBe(false);

    // Activate via kill switch module
    await ks.activateForTask("task-1", "admin-1");
    result = await killCheck.checkKillSwitch("task-1");
    expect(result.killed).toBe(true);
    expect(result.scope).toBe("task");

    // Activate global via kill switch module
    await ks.activateGlobal("admin-1");
    result = await killCheck.checkKillSwitch("task-1");
    expect(result.killed).toBe(true);
    expect(result.scope).toBe("global");
  });

  it("deactivate for one task does not affect other tasks", async () => {
    await ks.activateForTask("task-1", "admin-1");
    await ks.activateForTask("task-2", "admin-1");
    await ks.deactivateForTask("task-1", "admin-1");
    expect(await ks.isTaskActive("task-1")).toBe(false);
    expect(await ks.isTaskActive("task-2")).toBe(true);
  });

  it("onKillActivated receives events via pub/sub", async () => {
    const listenerRedis = new Redis(inject("redisUrl"), { lazyConnect: false });
    const listenerKs = createKillSwitch(redis, listenerRedis);
    const events: KillEvent[] = [];

    const unsubscribe = listenerKs.onKillActivated((event) => {
      events.push(event);
    });

    await new Promise((r) => setTimeout(r, 50));
    await ks.activateForTask("task-99", "admin-1", "test event");
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toHaveLength(1);
    expect(events[0].scope).toBe("task");
    expect(events[0].taskId).toBe("task-99");

    unsubscribe();
    await listenerRedis.quit();
  });
});
