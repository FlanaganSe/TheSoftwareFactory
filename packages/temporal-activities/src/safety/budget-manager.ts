import type { Redis } from "ioredis";

export interface TaskCostSummary {
  readonly taskId: string;
  readonly currentCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
  readonly overBudget: boolean;
}

export interface DailyCostSummary {
  readonly date: string;
  readonly totalCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
  readonly taskBreakdown: readonly TaskCostEntry[];
}

export interface TaskCostEntry {
  readonly taskId: string;
  readonly costCents: number;
}

export interface BudgetManager {
  setTaskBudget(taskId: string, budgetCents: number): Promise<void>;
  overrideBudget(
    taskId: string,
    newBudgetCents: number,
    actor: string,
  ): Promise<void>;
  getTaskCost(taskId: string): Promise<TaskCostSummary>;
  getDailyCost(date?: string): Promise<DailyCostSummary>;
  setDailyBudget(budgetCents: number): Promise<void>;
  getDailyBudget(): Promise<number>;
  getTasksNearBudget(
    thresholdPercent?: number,
  ): Promise<readonly TaskCostSummary[]>;
}

const BUDGET_KEY_PREFIX = "factory:budget:";
const COST_KEY_PREFIX = "factory:cost:";
const DAILY_COST_PREFIX = "factory:cost:daily:";
const DAILY_BUDGET_KEY = "factory:budget:daily";
const BUDGET_OVERRIDE_PREFIX = "factory:budget_override:";
const DEFAULT_TASK_BUDGET = 1000; // $10.00
const DEFAULT_DAILY_BUDGET = 10_000; // $100.00

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createBudgetManager(redis: Redis): BudgetManager {
  async function getTaskBudget(taskId: string): Promise<number> {
    const val = await redis.get(`${BUDGET_KEY_PREFIX}${taskId}`);
    return val ? Number.parseInt(val, 10) : DEFAULT_TASK_BUDGET;
  }

  return {
    async setTaskBudget(taskId: string, budgetCents: number): Promise<void> {
      await redis.set(`${BUDGET_KEY_PREFIX}${taskId}`, budgetCents.toString());
    },

    async overrideBudget(
      taskId: string,
      newBudgetCents: number,
      actor: string,
    ): Promise<void> {
      const now = new Date().toISOString();
      const meta = JSON.stringify({ actor, newBudgetCents, overriddenAt: now });
      await redis
        .multi()
        .set(`${BUDGET_KEY_PREFIX}${taskId}`, newBudgetCents.toString())
        .set(`${BUDGET_OVERRIDE_PREFIX}${taskId}`, meta)
        .exec();
    },

    async getTaskCost(taskId: string): Promise<TaskCostSummary> {
      const [currentStr, budgetCents] = await Promise.all([
        redis.get(`${COST_KEY_PREFIX}${taskId}`),
        getTaskBudget(taskId),
      ]);
      const currentCents = currentStr ? Number.parseInt(currentStr, 10) : 0;
      const percentUsed =
        budgetCents > 0 ? (currentCents / budgetCents) * 100 : 0;
      return {
        taskId,
        currentCents,
        budgetCents,
        percentUsed,
        overBudget: currentCents > budgetCents,
      };
    },

    async getDailyCost(date?: string): Promise<DailyCostSummary> {
      const dateStr = date ?? todayDateString();
      const dailyKey = `${DAILY_COST_PREFIX}${dateStr}`;
      const [totalStr, budgetStr] = await Promise.all([
        redis.get(dailyKey),
        redis.get(DAILY_BUDGET_KEY),
      ]);
      const totalCents = totalStr ? Number.parseInt(totalStr, 10) : 0;
      const budgetCents = budgetStr
        ? Number.parseInt(budgetStr, 10)
        : DEFAULT_DAILY_BUDGET;
      const percentUsed =
        budgetCents > 0 ? (totalCents / budgetCents) * 100 : 0;

      // Scan for per-task costs to build breakdown
      const taskBreakdown: TaskCostEntry[] = [];
      let cursor = "0";
      do {
        const [nextCursor, foundKeys] = await redis.scan(
          cursor,
          "MATCH",
          `${COST_KEY_PREFIX}*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        for (const key of foundKeys) {
          // Skip daily cost keys
          if (key.startsWith(DAILY_COST_PREFIX)) continue;
          const costStr = await redis.get(key);
          if (costStr) {
            const taskId = key.slice(COST_KEY_PREFIX.length);
            taskBreakdown.push({
              taskId,
              costCents: Number.parseInt(costStr, 10),
            });
          }
        }
      } while (cursor !== "0");

      return {
        date: dateStr,
        totalCents,
        budgetCents,
        percentUsed,
        taskBreakdown,
      };
    },

    async setDailyBudget(budgetCents: number): Promise<void> {
      await redis.set(DAILY_BUDGET_KEY, budgetCents.toString());
    },

    async getDailyBudget(): Promise<number> {
      const val = await redis.get(DAILY_BUDGET_KEY);
      return val ? Number.parseInt(val, 10) : DEFAULT_DAILY_BUDGET;
    },

    async getTasksNearBudget(
      thresholdPercent = 80,
    ): Promise<readonly TaskCostSummary[]> {
      const nearBudget: TaskCostSummary[] = [];
      let cursor = "0";
      do {
        const [nextCursor, foundKeys] = await redis.scan(
          cursor,
          "MATCH",
          `${COST_KEY_PREFIX}*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        for (const key of foundKeys) {
          if (key.startsWith(DAILY_COST_PREFIX)) continue;
          const taskId = key.slice(COST_KEY_PREFIX.length);
          const summary = await this.getTaskCost(taskId);
          if (summary.percentUsed >= thresholdPercent) {
            nearBudget.push(summary);
          }
        }
      } while (cursor !== "0");

      return nearBudget;
    },
  };
}
