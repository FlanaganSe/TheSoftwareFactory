import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function createBudgetCommand(getConfig: () => CLIConfig): Command {
  const cmd = new Command("budget")
    .description("View and manage cost budgets")
    .option("--task <id>", "Show or manage a specific task's cost")
    .option(
      "--override",
      "Override a task's budget (use with --task and --amount)",
    )
    .option("--amount <cents>", "Budget amount in cents", Number.parseInt)
    .option("--daily", "Show or set daily cost")
    .option(
      "--set <cents>",
      "Set daily budget in cents (use with --daily)",
      Number.parseInt,
    )
    .option("--date <date>", "Specific date for daily cost (YYYY-MM-DD)")
    .action(
      async (opts: {
        task?: string;
        override?: boolean;
        amount?: number;
        daily?: boolean;
        set?: number;
        date?: string;
      }) => {
        const config = getConfig();
        const client = createApiClient(config);

        try {
          // Task budget override
          if (opts.task && opts.override && opts.amount !== undefined) {
            await client.overrideTaskBudget(opts.task, opts.amount);
            console.log(
              chalk.green(
                `Budget for task ${opts.task} set to ${formatCents(opts.amount)}`,
              ),
            );
            return;
          }

          // Task cost view
          if (opts.task) {
            const cost = await client.getTaskCost(opts.task);
            if (config.json) {
              console.log(JSON.stringify(cost, null, 2));
              return;
            }
            const pctColor =
              cost.percentUsed >= 90
                ? chalk.red
                : cost.percentUsed >= 70
                  ? chalk.yellow
                  : chalk.green;
            console.log(`Task ${chalk.bold(cost.taskId)}`);
            console.log(
              `  Cost:   ${formatCents(cost.currentCents)} / ${formatCents(cost.budgetCents)}`,
            );
            console.log(
              `  Usage:  ${pctColor(`${cost.percentUsed.toFixed(1)}%`)}`,
            );
            if (cost.overBudget) {
              console.log(chalk.red.bold("  OVER BUDGET"));
            }
            return;
          }

          // Set daily budget
          if (opts.daily && opts.set !== undefined) {
            await client.setDailyBudget(opts.set);
            console.log(
              chalk.green(`Daily budget set to ${formatCents(opts.set)}`),
            );
            return;
          }

          // Show daily cost
          const cost = await client.getDailyCost(opts.date);
          if (config.json) {
            console.log(JSON.stringify(cost, null, 2));
            return;
          }
          const pctColor =
            cost.percentUsed >= 90
              ? chalk.red
              : cost.percentUsed >= 70
                ? chalk.yellow
                : chalk.green;
          console.log(`Daily Cost (${cost.date})`);
          console.log(
            `  Total:  ${formatCents(cost.totalCents)} / ${formatCents(cost.budgetCents)}`,
          );
          console.log(
            `  Usage:  ${pctColor(`${cost.percentUsed.toFixed(1)}%`)}`,
          );
          if (cost.taskBreakdown.length > 0) {
            console.log("  Tasks:");
            for (const entry of cost.taskBreakdown) {
              console.log(
                `    ${entry.taskId}: ${formatCents(entry.costCents)}`,
              );
            }
          }
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  return cmd;
}
