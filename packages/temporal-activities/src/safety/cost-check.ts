import type { Redis } from "ioredis";

export interface CostCheckResult {
  readonly allowed: boolean;
  readonly currentCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
}

export interface CostStatus {
  readonly totalCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
  readonly overBudget: boolean;
}

export function createCostCheckActivity(redis: Redis) {
  return {
    async checkCostBudget(
      taskId: string,
      estimatedCost: number,
    ): Promise<CostCheckResult> {
      const key = `factory:cost:${taskId}`;
      const current = Number.parseInt((await redis.get(key)) ?? "0", 10);
      const budget = Number.parseInt(
        (await redis.get(`factory:budget:${taskId}`)) ?? "1000",
        10,
      );
      const projected = current + estimatedCost;
      const percentUsed = (projected / budget) * 100;
      return {
        allowed: projected <= budget,
        currentCents: current,
        budgetCents: budget,
        percentUsed,
      };
    },

    async recordCost(taskId: string, costCents: number): Promise<CostStatus> {
      const key = `factory:cost:${taskId}`;
      const dailyKey = `factory:cost:daily:${new Date().toISOString().slice(0, 10)}`;
      // Redis INCRBY requires an integer — round to guard against fractional cents
      const intCents = Math.round(costCents);
      if (intCents <= 0) {
        const current = Number.parseInt((await redis.get(key)) ?? "0", 10);
        const budget = Number.parseInt(
          (await redis.get(`factory:budget:${taskId}`)) ?? "1000",
          10,
        );
        return {
          totalCents: current,
          budgetCents: budget,
          percentUsed: (current / budget) * 100,
          overBudget: current > budget,
        };
      }
      const [taskTotal] = await Promise.all([
        redis.incrby(key, intCents),
        redis.incrby(dailyKey, intCents),
      ]);
      // Set daily key to expire at midnight + 1 day
      await redis.expire(dailyKey, 86400);
      const budget = Number.parseInt(
        (await redis.get(`factory:budget:${taskId}`)) ?? "1000",
        10,
      );
      return {
        totalCents: taskTotal,
        budgetCents: budget,
        percentUsed: (taskTotal / budget) * 100,
        overBudget: taskTotal > budget,
      };
    },
  };
}
