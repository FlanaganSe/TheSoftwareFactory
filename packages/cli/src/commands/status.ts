import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

export function createStatusCommand(getConfig: () => CLIConfig): Command {
  return new Command("status")
    .description("Show task status")
    .argument("<task-id>", "Task ID")
    .option("--watch", "Poll every 5s until terminal state")
    .action(async (taskId: string, opts: { watch?: boolean }) => {
      const config = getConfig();
      const client = createApiClient(config);

      const display = async (): Promise<boolean> => {
        try {
          const task = await client.getTask(taskId);

          if (config.json) {
            console.log(JSON.stringify(task, null, 2));
            return true;
          }

          console.log(chalk.bold(`Task ${task.taskId}`));
          console.log(`  Status:    ${colorStatus(task.status)}`);
          if (task.currentPhase)
            console.log(`  Phase:     ${task.currentPhase}`);
          if (task.objective) console.log(`  Objective: ${task.objective}`);
          if (task.createdBy) console.log(`  Created by: ${task.createdBy}`);
          if (task.startTime)
            console.log(`  Started:   ${chalk.dim(task.startTime)}`);

          const terminal = [
            "COMPLETED",
            "FAILED",
            "CANCELLED",
            "TERMINATED",
          ].includes(task.status);
          return terminal;
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
          return true;
        }
      };

      const isTerminal = await display();

      if (opts.watch && !isTerminal) {
        const interval = setInterval(async () => {
          console.log(chalk.dim("\n--- refreshing ---\n"));
          const done = await display();
          if (done) clearInterval(interval);
        }, 5000);
      }
    });
}

function colorStatus(status: string): string {
  switch (status) {
    case "RUNNING":
      return chalk.blue(status);
    case "COMPLETED":
      return chalk.green(status);
    case "FAILED":
    case "CANCELLED":
    case "TERMINATED":
      return chalk.red(status);
    default:
      return chalk.yellow(status);
  }
}
