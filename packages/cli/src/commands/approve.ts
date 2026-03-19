import chalk from "chalk";
import { Command } from "commander";
import { ApiClientError, createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

export function createApproveCommand(getConfig: () => CLIConfig): Command {
  return new Command("approve")
    .description("Approve a task (triggers PR creation)")
    .argument("<task-id>", "Task ID")
    .option("--yes", "Skip confirmation prompt")
    .action(async (taskId: string, opts: { yes?: boolean }) => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        // Check freshness
        try {
          const freshness = await client.getFreshness(taskId);
          if (!freshness.fresh) {
            console.log(
              chalk.yellow(
                `⚠ Evidence may be stale — base branch has moved (${freshness.evidenceBaseSha.slice(0, 7)} → ${freshness.currentBaseSha.slice(0, 7)})`,
              ),
            );
          }
        } catch {
          // best-effort
        }

        if (!opts.yes) {
          const { confirm } = await import("@inquirer/prompts");
          const proceed = await confirm({
            message: `Approve task ${taskId}?`,
            default: false,
          });
          if (!proceed) {
            console.log(chalk.dim("Cancelled."));
            return;
          }
        }

        await client.approveTask(taskId);
        console.log(
          chalk.green(`Task ${taskId} approved. PR creation will begin.`),
        );
      } catch (e) {
        if (
          e instanceof ApiClientError &&
          e.errorCode === "separation_of_duties"
        ) {
          console.error(
            chalk.red(
              "Cannot approve: task submitter cannot be sole approver (separation of duties).",
            ),
          );
          console.error(
            chalk.dim("Ask another operator or admin to approve this task."),
          );
        } else {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        }
        process.exitCode = 1;
      }
    });
}
