import chalk from "chalk";
import { Command } from "commander";
import { type EvidenceResponse, createApiClient } from "../api-client.js";
import type { CLIConfig } from "../config.js";
import { formatAnnotatedDiff } from "../ui/diff-display.js";
import {
  formatEvidence,
  formatSecurityTable,
  formatTestResultsTable,
} from "../ui/evidence-display.js";

export function createReviewCommand(getConfig: () => CLIConfig): Command {
  return new Command("review")
    .description("Interactive review of a task")
    .argument("<task-id>", "Task ID")
    .action(async (taskId: string) => {
      const config = getConfig();
      const client = createApiClient(config);

      try {
        const evidence = await client.getEvidence(taskId);

        // Show abbreviated summary
        console.log(formatEvidence(evidence));
        console.log();

        // Interactive menu loop
        const { select, input, confirm } = await import("@inquirer/prompts");

        let done = false;
        while (!done) {
          const action = await select({
            message: "What would you like to do?",
            choices: [
              { name: "View full annotated diff", value: "diff" },
              { name: "View test results", value: "tests" },
              { name: "View security scan", value: "security" },
              {
                name: "View blast radius",
                value: "blast_radius",
              },
              {
                name: "View protected file edits",
                value: "protected",
              },
              { name: "View risk summary", value: "risk" },
              {
                name: chalk.green("Approve"),
                value: "approve",
              },
              {
                name: chalk.yellow("Request changes"),
                value: "changes",
              },
              { name: chalk.red("Reject"), value: "reject" },
              { name: "Exit", value: "exit" },
            ],
          });

          switch (action) {
            case "diff":
              showDiff(evidence);
              break;
            case "tests":
              showTests(evidence);
              break;
            case "security":
              showSecurity(evidence);
              break;
            case "blast_radius":
              showBlastRadius(evidence);
              break;
            case "protected":
              showProtected(evidence);
              break;
            case "risk":
              showRisk(evidence);
              break;
            case "approve": {
              const proceed = await confirm({
                message: `Approve task ${taskId}?`,
                default: false,
              });
              if (proceed) {
                await client.approveTask(taskId);
                console.log(
                  chalk.green(
                    `Task ${taskId} approved. PR creation will begin.`,
                  ),
                );
                done = true;
              }
              break;
            }
            case "changes": {
              const message = await input({
                message: "What changes should be made?",
              });
              if (message.trim()) {
                await client.requestChanges(taskId, message);
                console.log(
                  chalk.yellow(
                    `Changes requested for ${taskId}. The agent will re-implement.`,
                  ),
                );
                done = true;
              }
              break;
            }
            case "reject": {
              const reason = await input({
                message: "Rejection reason:",
              });
              if (reason.trim()) {
                const proceed = await confirm({
                  message: `Reject task ${taskId}? This is permanent.`,
                  default: false,
                });
                if (proceed) {
                  await client.rejectTask(taskId, reason);
                  console.log(
                    chalk.red(`Task ${taskId} rejected. Reason: ${reason}`),
                  );
                  done = true;
                }
              }
              break;
            }
            case "exit":
              done = true;
              break;
          }
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
    });
}

function showDiff(evidence: EvidenceResponse): void {
  const annotations = evidence.annotatedDiff as {
    file: string;
    hunkIndex: number;
    annotation: string;
    riskLevel: string;
    affectedConsumers: readonly string[];
  }[];
  const protectedEdits = evidence.protectedSurfaceEdits as {
    filePath: string;
    protectionClass: string;
    justification: string;
  }[];
  console.log(chalk.bold("\n── Full Annotated Diff ──\n"));
  console.log(formatAnnotatedDiff(annotations, protectedEdits));
  console.log();
}

function showTests(evidence: EvidenceResponse): void {
  const testResults = evidence.testResults as {
    passed: number;
    failed: number;
    skipped: number;
    details?: { name: string; status: string; durationMs?: number }[];
  };
  console.log(chalk.bold("\n── Test Results ──\n"));
  console.log(formatTestResultsTable(testResults));
  console.log();
}

function showSecurity(evidence: EvidenceResponse): void {
  const security = evidence.securityScanResults as {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    vulnerabilities: {
      id: string;
      severity: string;
      description: string;
      file?: string;
      line?: number;
    }[];
  };
  console.log(chalk.bold("\n── Security Scan ──\n"));
  console.log(formatSecurityTable(security));
  console.log();
}

function showBlastRadius(evidence: EvidenceResponse): void {
  console.log(chalk.bold("\n── Blast Radius ──\n"));
  console.log(
    `Files: ${evidence.blastRadiusFiles} changed, ${evidence.blastRadiusPackages} packages affected`,
  );
  console.log(`Revertability: ${evidence.revertabilityClass}`);
  console.log();
}

function showProtected(evidence: EvidenceResponse): void {
  const protectedEdits = evidence.protectedSurfaceEdits as {
    filePath: string;
    protectionClass: string;
    justification: string;
  }[];
  console.log(chalk.bold("\n── Protected Surface Edits ──\n"));
  if (protectedEdits.length === 0) {
    console.log(chalk.dim("None"));
  } else {
    for (const edit of protectedEdits) {
      console.log(
        `${chalk.yellow("⚠")} ${chalk.bold(edit.filePath)} [${edit.protectionClass}] — ${edit.justification}`,
      );
    }
  }
  console.log();
}

function showRisk(evidence: EvidenceResponse): void {
  const annotations = evidence.annotatedDiff as {
    riskLevel: string;
  }[];
  const security = evidence.securityScanResults as {
    criticalCount: number;
    highCount: number;
    vulnerabilities: { severity: string }[];
  };
  const testResults = evidence.testResults as { failed: number };
  const lintResults = evidence.lintResults as {
    errorCount: number;
    warningCount: number;
  };
  const protectedEdits = evidence.protectedSurfaceEdits as unknown[];
  const migration = evidence.migrationImpact as {
    hasMigrations: boolean;
  };

  console.log(chalk.bold("\n── Risk Summary ──\n"));
  const high = annotations.filter((a) => a.riskLevel === "high").length;
  const low = annotations.filter((a) => a.riskLevel === "low").length;
  const medVulns = security.vulnerabilities.filter(
    (v) => v.severity === "medium",
  ).length;

  if (testResults.failed > 0 || security.criticalCount > 0) {
    console.log(
      chalk.red(
        `Hard Blockers: ${testResults.failed} test failures, ${security.criticalCount} critical vulns`,
      ),
    );
  } else {
    console.log(chalk.green("Hard Blockers: 0"));
  }
  console.log(
    `Soft Concerns: ${high} high-risk hunks, ${protectedEdits.length} protected edits, ${security.highCount} high vulns, ${lintResults.errorCount} lint errors`,
  );
  console.log(
    `Human Judgment: ${migration.hasMigrations ? "migrations" : "none"}, ${medVulns} medium vulns`,
  );
  console.log(
    `Informational: ${lintResults.warningCount} warnings, ${low} low-risk changes`,
  );
  console.log();
}
