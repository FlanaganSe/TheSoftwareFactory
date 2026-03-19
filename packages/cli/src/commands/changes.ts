import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

export function createChangesCommand(getConfig: () => CLIConfig): Command {
  return new Command("changes")
    .description("Request changes on a task (agent re-implements)")
    .argument("<task-id>", "Task ID")
    .requiredOption("--message <message>", "What to change (required)")
    .action(async (taskId: string, opts: { message: string }) => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        await client.requestChanges(taskId, opts.message);
        console.log(
          chalk.yellow(
            `Changes requested for ${taskId}. The agent will re-implement.`,
          ),
        );
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
