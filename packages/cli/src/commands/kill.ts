import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

export function createKillCommand(getConfig: () => CLIConfig): Command {
  const cmd = new Command("kill")
    .description("Kill a task or activate global kill switch")
    .argument("[task-id]", "Task ID to kill")
    .option("--all", "Activate global kill switch")
    .option("--deactivate", "Deactivate global kill switch (use with --all)")
    .option("--reason <reason>", "Reason for killing")
    .option("--yes", "Skip confirmation")
    .action(
      async (
        taskId: string | undefined,
        opts: {
          all?: boolean;
          deactivate?: boolean;
          reason?: string;
          yes?: boolean;
        },
      ) => {
        const config = getConfig();
        const client = createApiClient(config);

        try {
          if (opts.all && opts.deactivate) {
            await client.deactivateGlobalKill();
            console.log(chalk.green("Global kill switch deactivated."));
            return;
          }

          if (opts.all) {
            if (!opts.yes) {
              console.log(
                chalk.red.bold("WARNING: This will stop ALL running tasks."),
              );
              console.log(chalk.red("Type KILL ALL to confirm:"));
              const response = await readLine();
              if (response.trim() !== "KILL ALL") {
                console.log("Aborted.");
                return;
              }
            }

            const result = await client.activateGlobalKill(opts.reason);
            console.log(chalk.red.bold("Global kill switch activated."));
            console.log(`Workflows signaled: ${result.workflowsSignaled}`);
            return;
          }

          if (!taskId) {
            console.error(chalk.red("Error: provide a task ID or use --all"));
            process.exitCode = 1;
            return;
          }

          if (!opts.yes) {
            console.log(`Kill task ${chalk.bold(taskId)}? [y/N]`);
            const response = await readLine();
            if (response.trim().toLowerCase() !== "y") {
              console.log("Aborted.");
              return;
            }
          }

          await client.killTask(taskId, opts.reason);
          console.log(chalk.red(`Task ${taskId} killed.`));
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exitCode = 1;
        }
      },
    );

  return cmd;
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.once("data", (data) => {
      stdin.pause();
      resolve(String(data));
    });
  });
}
