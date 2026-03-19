import type { Redis } from "ioredis";

export interface KillCheckResult {
  readonly killed: boolean;
  readonly scope: "global" | "task" | "none";
}

export function createKillCheckActivity(redis: Redis) {
  return {
    async checkKillSwitch(taskId: string): Promise<KillCheckResult> {
      const [globalKill, taskKill] = await redis.mget(
        "factory:kill_switch",
        `factory:kill:${taskId}`,
      );
      if (globalKill === "1") return { killed: true, scope: "global" };
      if (taskKill === "1") return { killed: true, scope: "task" };
      return { killed: false, scope: "none" };
    },
  };
}
