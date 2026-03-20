import chalk from "chalk";
import { Command } from "commander";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function stateColor(state: string): string {
  if (state === "closed") return chalk.green(state);
  if (state === "open") return chalk.red(state);
  return chalk.yellow(state);
}

export function createSafetyCommand(getConfig: () => CLIConfig): Command {
  const cmd = new Command("safety").description(
    "Safety dashboard and circuit breaker management",
  );

  // Default action: show dashboard
  cmd.action(async () => {
    const config = getConfig();
    const client = createApiClient(config);

    try {
      const status = await client.getSafetyStatus();
      if (config.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(chalk.bold("Safety Dashboard"));
      console.log(
        `  Global kill: ${status.globalKill ? chalk.red.bold("ACTIVE") : chalk.green("inactive")}`,
      );
      console.log("  Circuit breakers:");
      for (const cb of status.circuits) {
        console.log(`    ${cb.service}: ${stateColor(cb.state)}`);
      }
      const pctColor =
        status.dailyCost.percentUsed >= 90
          ? chalk.red
          : status.dailyCost.percentUsed >= 70
            ? chalk.yellow
            : chalk.green;
      console.log(
        `  Daily cost: ${formatCents(status.dailyCost.totalCents)} / ${formatCents(status.dailyCost.budgetCents)} (${pctColor(`${status.dailyCost.percentUsed.toFixed(1)}%`)})`,
      );
      console.log(
        `  Active task kills: ${status.activeKills.filter((k) => k.scope === "task").length}`,
      );
    } catch (e) {
      console.error(chalk.red(e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
    }
  });

  // Subcommand: circuits
  const circuitsCmd = new Command("circuits")
    .description("View and manage circuit breakers")
    .action(async () => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        const circuits = await client.getCircuitBreakers();
        if (config.json) {
          console.log(JSON.stringify(circuits, null, 2));
          return;
        }

        console.log(chalk.bold("Circuit Breakers"));
        for (const cb of circuits) {
          const parts = [
            `  ${cb.service}: ${stateColor(cb.state)}`,
            `${cb.consecutiveFailures} consecutive failures`,
          ];
          if (cb.lastSuccessAt) {
            parts.push(`last success ${timeAgo(cb.lastSuccessAt)}`);
          }
          if (cb.state === "open" && cb.nextRetryAt) {
            const ms = new Date(cb.nextRetryAt).getTime() - Date.now();
            if (ms > 0) {
              parts.push(`retry in ${Math.ceil(ms / 1000)}s`);
            }
          }
          console.log(parts.join(" | "));
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  circuitsCmd
    .command("reset <service>")
    .description("Force-close a circuit breaker")
    .action(async (service: string) => {
      const config = getConfig();
      const client = createApiClient(config);
      try {
        await client.resetCircuitBreaker(service);
        console.log(chalk.green(`Circuit breaker for ${service} reset.`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  circuitsCmd
    .command("trip <service>")
    .description("Force-open a circuit breaker")
    .action(async (service: string) => {
      const config = getConfig();
      const client = createApiClient(config);
      try {
        await client.tripCircuitBreaker(service);
        console.log(chalk.yellow(`Circuit breaker for ${service} tripped.`));
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  cmd.addCommand(circuitsCmd);

  return cmd;
}

function timeAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
