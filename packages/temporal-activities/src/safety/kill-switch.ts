import type { Redis } from "ioredis";

export interface ActiveKill {
  readonly scope: "global" | "task";
  readonly taskId?: string;
  readonly actor: string;
  readonly reason?: string;
  readonly activatedAt: string;
}

export interface KillEvent {
  readonly type: "kill_activated";
  readonly scope: "global" | "task";
  readonly taskId?: string;
  readonly actor: string;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface KillSwitch {
  activateGlobal(actor: string, reason?: string): Promise<void>;
  activateForTask(
    taskId: string,
    actor: string,
    reason?: string,
  ): Promise<void>;
  deactivateGlobal(actor: string): Promise<void>;
  deactivateForTask(taskId: string, actor: string): Promise<void>;
  isGlobalActive(): Promise<boolean>;
  isTaskActive(taskId: string): Promise<boolean>;
  getActiveKills(): Promise<readonly ActiveKill[]>;
  onKillActivated(callback: (kill: KillEvent) => void): () => void;
}

const GLOBAL_KEY = "factory:kill_switch";
const GLOBAL_META_KEY = "factory:kill_switch:meta";
const TASK_KEY_PREFIX = "factory:kill:";
const TASK_META_PREFIX = "factory:kill_meta:";
const SYSTEM_CHANNEL = "factory:system";

export function createKillSwitch(redis: Redis, pubsubRedis: Redis): KillSwitch {
  return {
    async activateGlobal(actor: string, reason?: string): Promise<void> {
      const now = new Date().toISOString();
      const meta = JSON.stringify({ actor, reason, activatedAt: now });
      await redis
        .multi()
        .set(GLOBAL_KEY, "1")
        .set(GLOBAL_META_KEY, meta)
        .exec();

      const event: KillEvent = {
        type: "kill_activated",
        scope: "global",
        actor,
        reason,
        timestamp: now,
      };
      await redis.publish(SYSTEM_CHANNEL, JSON.stringify(event));
    },

    async activateForTask(
      taskId: string,
      actor: string,
      reason?: string,
    ): Promise<void> {
      const now = new Date().toISOString();
      const meta = JSON.stringify({ actor, reason, activatedAt: now });
      await redis
        .multi()
        .set(`${TASK_KEY_PREFIX}${taskId}`, "1")
        .set(`${TASK_META_PREFIX}${taskId}`, meta)
        .exec();

      const event: KillEvent = {
        type: "kill_activated",
        scope: "task",
        taskId,
        actor,
        reason,
        timestamp: now,
      };
      await redis.publish(SYSTEM_CHANNEL, JSON.stringify(event));
    },

    async deactivateGlobal(_actor: string): Promise<void> {
      await redis.multi().del(GLOBAL_KEY).del(GLOBAL_META_KEY).exec();
    },

    async deactivateForTask(taskId: string, _actor: string): Promise<void> {
      await redis
        .multi()
        .del(`${TASK_KEY_PREFIX}${taskId}`)
        .del(`${TASK_META_PREFIX}${taskId}`)
        .exec();
    },

    async isGlobalActive(): Promise<boolean> {
      const val = await redis.get(GLOBAL_KEY);
      return val === "1";
    },

    async isTaskActive(taskId: string): Promise<boolean> {
      const val = await redis.get(`${TASK_KEY_PREFIX}${taskId}`);
      return val === "1";
    },

    async getActiveKills(): Promise<readonly ActiveKill[]> {
      const kills: ActiveKill[] = [];

      // Check global
      const globalMeta = await redis.get(GLOBAL_META_KEY);
      if (globalMeta) {
        const parsed = JSON.parse(globalMeta) as {
          actor: string;
          reason?: string;
          activatedAt: string;
        };
        kills.push({
          scope: "global",
          actor: parsed.actor,
          reason: parsed.reason,
          activatedAt: parsed.activatedAt,
        });
      }

      // Scan for per-task kills
      let cursor = "0";
      do {
        const [nextCursor, foundKeys] = await redis.scan(
          cursor,
          "MATCH",
          `${TASK_META_PREFIX}*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        for (const key of foundKeys) {
          const meta = await redis.get(key);
          if (meta) {
            const parsed = JSON.parse(meta) as {
              actor: string;
              reason?: string;
              activatedAt: string;
            };
            const taskId = key.slice(TASK_META_PREFIX.length);
            kills.push({
              scope: "task",
              taskId,
              actor: parsed.actor,
              reason: parsed.reason,
              activatedAt: parsed.activatedAt,
            });
          }
        }
      } while (cursor !== "0");

      return kills;
    },

    onKillActivated(callback: (kill: KillEvent) => void): () => void {
      const handler = (_channel: string, message: string): void => {
        const parsed = JSON.parse(message) as KillEvent;
        if (parsed.type === "kill_activated") {
          callback(parsed);
        }
      };

      pubsubRedis.subscribe(SYSTEM_CHANNEL);
      pubsubRedis.on("message", handler);

      return () => {
        pubsubRedis.off("message", handler);
        pubsubRedis.unsubscribe(SYSTEM_CHANNEL);
      };
    },
  };
}
