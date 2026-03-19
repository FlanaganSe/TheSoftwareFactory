import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";
import { formatEvidence } from "../ui/evidence-display.js";

export function createEvidenceCommand(getConfig: () => CLIConfig): Command {
  return new Command("evidence")
    .description("View evidence packet for a task")
    .argument("<task-id>", "Task ID")
    .option("--attempt <n>", "Specific attempt number")
    .action(async (taskId: string, opts: { attempt?: string }) => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        const attemptNumber = opts.attempt
          ? Number.parseInt(opts.attempt, 10)
          : undefined;
        const evidence = await client.getEvidence(taskId, attemptNumber);

        if (config.json) {
          console.log(JSON.stringify(evidence, null, 2));
          return;
        }

        // Check freshness
        try {
          const freshness = await client.getFreshness(taskId);
          if (!freshness.fresh) {
            console.log(
              chalk.yellow(
                "⚠ Evidence may be stale — base branch has moved since evidence was generated.",
              ),
            );
            console.log(
              chalk.yellow(
                `  Evidence base: ${freshness.evidenceBaseSha.slice(0, 7)}  Current: ${freshness.currentBaseSha.slice(0, 7)}`,
              ),
            );
            console.log(chalk.yellow("  Consider re-running validation.\n"));
          }
        } catch {
          // Freshness check is best-effort; don't block on failure
        }

        console.log(formatEvidence(evidence));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}
