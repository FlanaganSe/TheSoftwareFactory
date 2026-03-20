import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";
import { formatReadinessReport } from "../ui/readiness-report.js";
import { formatTable } from "../ui/table-display.js";

export function createRepoCommand(getConfig: () => CLIConfig): Command {
  const cmd = new Command("repo").description(
    "Repository scanning and readiness reports",
  );

  // ── factory repo scan <owner/repo> ──

  cmd
    .command("scan")
    .description("Scan a repository and display readiness report")
    .argument("<owner/repo>", "GitHub owner/repo (e.g. acme/my-app)")
    .action(async (slug: string) => {
      const config = getConfig();
      const client = createApiClient(config);

      const parts = slug.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        console.error(
          chalk.red(`Invalid repository format: ${slug}. Expected: owner/repo`),
        );
        process.exitCode = 1;
        return;
      }
      const [owner, repo] = parts;

      const spinner = ora(`Scanning ${slug}...`).start();

      try {
        const result = await client.scanRepo(owner, repo);
        spinner.stop();

        if (config.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(chalk.bold(`\nScan complete: ${owner}/${repo}\n`));
        console.log(formatReadinessReport(result.snapshot));
        console.log(`\n${chalk.dim(`Scanned at ${result.capturedAt}`)}`);
      } catch (e) {
        spinner.stop();
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  // ── factory repo list ──

  cmd
    .command("list")
    .description("List all scanned repositories")
    .action(async () => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        const { repos } = await client.listRepos();

        if (config.json) {
          console.log(JSON.stringify(repos, null, 2));
          return;
        }

        if (repos.length === 0) {
          console.log(
            chalk.dim(
              'No repositories found. Run "factory repo scan owner/repo" to scan one.',
            ),
          );
          return;
        }

        console.log(
          formatTable(
            [
              { header: "Repository", width: 30 },
              { header: "Class", width: 8 },
              { header: "Branch", width: 14 },
              { header: "Last Scanned", width: 20 },
            ],
            repos.map((r) => [
              `${r.githubOwner}/${r.githubRepo}`,
              r.repoClass,
              r.defaultBranch,
              r.lastScannedAt
                ? new Date(r.lastScannedAt).toLocaleDateString()
                : chalk.dim("never"),
            ]),
          ),
        );
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  // ── factory repo status <id-or-slug> ──

  cmd
    .command("status")
    .description("Show repository status and latest scan summary")
    .argument("<id>", "Repository ID or owner/repo slug")
    .action(async (idOrSlug: string) => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        // If it contains a slash, resolve by listing and matching
        let repoId = idOrSlug;
        if (idOrSlug.includes("/")) {
          const { repos } = await client.listRepos();
          const match = repos.find(
            (r) => `${r.githubOwner}/${r.githubRepo}` === idOrSlug,
          );
          if (!match) {
            console.error(
              chalk.red(
                `Repository not found: ${idOrSlug}. Run "factory repo scan ${idOrSlug}" first.`,
              ),
            );
            process.exitCode = 1;
            return;
          }
          repoId = match.id;
        }

        const data = await client.getRepo(repoId);

        if (config.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const r = data.repo;
        console.log(chalk.bold(`${r.githubOwner}/${r.githubRepo}`));
        console.log(`  ID:        ${chalk.dim(r.id)}`);
        console.log(`  Class:     ${r.repoClass}`);
        console.log(`  Branch:    ${r.defaultBranch}`);
        console.log(`  Autonomy:  ${r.autonomyLevel}`);
        console.log(
          `  Scanned:   ${r.lastScannedAt ? new Date(r.lastScannedAt).toLocaleString() : chalk.dim("never")}`,
        );

        if (data.latestSnapshot) {
          console.log(
            `\n${chalk.dim("Latest scan revision:")} ${data.sourceRevision ?? "unknown"}`,
          );
          console.log(formatReadinessReport(data.latestSnapshot));
        } else {
          console.log(
            chalk.dim(
              `\nNo scan data. Run "factory repo scan ${r.githubOwner}/${r.githubRepo}" to scan.`,
            ),
          );
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });

  return cmd;
}
