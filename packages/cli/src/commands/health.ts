import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

export function createHealthCommand(getConfig: () => CLIConfig): Command {
  return new Command("health")
    .description("Check factory API health")
    .action(async () => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        const health = await client.checkHealth();

        if (config.json) {
          console.log(JSON.stringify(health, null, 2));
          return;
        }

        const isOk = health.status === "ok";
        console.log(
          `Factory API: ${isOk ? chalk.green("healthy") : chalk.red("unhealthy")}`,
        );

        if (health.checks) {
          for (const [name, status] of Object.entries(health.checks)) {
            const check = status as { status?: string };
            const checkOk = check.status === "healthy";
            console.log(
              `  ${name}: ${checkOk ? chalk.green("ok") : chalk.red(JSON.stringify(status))}`,
            );
          }
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        console.error(
          chalk.dim("Is the factory running? Try: docker compose up -d"),
        );
        process.exitCode = 1;
      }
    });
}
