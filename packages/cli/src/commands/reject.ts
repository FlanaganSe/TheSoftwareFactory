import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

export function createRejectCommand(getConfig: () => CLIConfig): Command {
  return new Command("reject")
    .description("Reject a task (terminal)")
    .argument("<task-id>", "Task ID")
    .requiredOption("--reason <reason>", "Rejection reason (required)")
    .option("--yes", "Skip confirmation prompt")
    .action(async (taskId: string, opts: { reason: string; yes?: boolean }) => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        if (!opts.yes) {
          const { confirm } = await import("@inquirer/prompts");
          const proceed = await confirm({
            message: `Reject task ${taskId}? This is permanent.`,
            default: false,
          });
          if (!proceed) {
            console.log(chalk.dim("Cancelled."));
            return;
          }
        }

        await client.rejectTask(taskId, opts.reason);
        console.log(
          chalk.red(`Task ${taskId} rejected. Reason: ${opts.reason}`),
        );
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
