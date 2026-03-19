import chalk from "chalk";
import type { EvidenceResponse } from "../api-client.js";
import { formatAnnotatedDiff } from "./diff-display.js";
import { formatTable } from "./table-display.js";

export interface DisplayOptions {
  readonly useColor?: boolean;
}

interface DiffAnnotation {
  readonly file: string;
  readonly hunkIndex: number;
  readonly annotation: string;
  readonly riskLevel: string;
  readonly affectedConsumers: readonly string[];
}

interface TestResults {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly details?: readonly {
    readonly name: string;
    readonly status: string;
    readonly durationMs?: number;
  }[];
}

interface SecurityScanResults {
  readonly totalFindings: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly vulnerabilities: readonly {
    readonly id: string;
    readonly severity: string;
    readonly description: string;
    readonly file?: string;
    readonly line?: number;
  }[];
}

interface LintResults {
  readonly errorCount: number;
  readonly warningCount: number;
}

interface ProtectedEdit {
  readonly filePath: string;
  readonly protectionClass: string;
  readonly justification: string;
}

interface MigrationImpact {
  readonly hasMigrations: boolean;
  readonly migrationFiles: readonly string[];
  readonly schemaChanges: readonly string[];
}

interface CommandRecord {
  readonly command: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

function section(title: string): string {
  return `\n${chalk.bold(`── ${title} ${"─".repeat(Math.max(0, 44 - title.length))}`)}\n`;
}

export function formatEvidence(bundle: EvidenceResponse): string {
  const c = chalk;
  const lines: string[] = [];

  // Header box
  const taskLabel = bundle.taskId.slice(0, 8);
  lines.push(c.dim("╭──────────────────────────────────────────────╮"));
  lines.push(
    c.dim("│") +
      c.bold(`  Evidence Packet — Task ${taskLabel}`) +
      " ".repeat(Math.max(0, 21 - taskLabel.length)) +
      c.dim("│"),
  );
  const attemptLine = `  Attempt: ${bundle.version}  |  Created: ${bundle.createdAt.slice(0, 16)}`;
  lines.push(
    `${c.dim("│")}${attemptLine}${" ".repeat(Math.max(0, 45 - attemptLine.length))}${c.dim("│")}`,
  );
  const shaLine = `  Base: ${bundle.baseSha.slice(0, 7)}  |  Head: ${bundle.headSha.slice(0, 7)}`;
  lines.push(
    `${c.dim("│")}${shaLine}${" ".repeat(Math.max(0, 45 - shaLine.length))}${c.dim("│")}`,
  );
  lines.push(c.dim("╰──────────────────────────────────────────────╯"));

  // 1. Objective
  lines.push(section("Objective"));
  lines.push(bundle.objective);

  // 2. Risk Summary (computed from annotations)
  lines.push(section("Risk Summary"));
  const annotations = bundle.annotatedDiff as DiffAnnotation[];
  const security = bundle.securityScanResults as SecurityScanResults;
  const testResults = bundle.testResults as TestResults;
  const lintResults = bundle.lintResults as LintResults;
  const protectedEdits = bundle.protectedSurfaceEdits as ProtectedEdit[];

  const hardBlockers: string[] = [];
  const softConcerns: string[] = [];
  const humanJudgment: string[] = [];
  const informational: string[] = [];

  if (testResults.failed > 0)
    hardBlockers.push(`${testResults.failed} test failure(s)`);
  if (security.criticalCount > 0)
    hardBlockers.push(`${security.criticalCount} critical vulnerability(ies)`);
  if (annotations.filter((a) => a.riskLevel === "high").length > 0)
    softConcerns.push(
      `${annotations.filter((a) => a.riskLevel === "high").length} high-risk hunk(s)`,
    );
  if (protectedEdits.length > 0)
    softConcerns.push(`${protectedEdits.length} protected edit(s)`);
  if (security.highCount > 0)
    softConcerns.push(`${security.highCount} high vulnerability(ies)`);
  if (lintResults.errorCount > 0)
    softConcerns.push(`${lintResults.errorCount} lint error(s)`);
  const migration = bundle.migrationImpact as MigrationImpact;
  if (migration.hasMigrations) humanJudgment.push("Migration impact detected");
  const mediumVulns = security.vulnerabilities.filter(
    (v) => v.severity === "medium",
  ).length;
  if (mediumVulns > 0)
    humanJudgment.push(`${mediumVulns} medium-severity finding(s)`);
  if (lintResults.warningCount > 0)
    informational.push(`${lintResults.warningCount} lint warning(s)`);
  const lowRiskCount = annotations.filter((a) => a.riskLevel === "low").length;
  if (lowRiskCount > 0)
    informational.push(`${lowRiskCount} low-risk change(s)`);

  lines.push(
    `${c.red("Hard Blockers:")} ${hardBlockers.length > 0 ? hardBlockers.join(", ") : c.green("0")}`,
  );
  lines.push(
    `${c.yellow("Soft Concerns:")} ${softConcerns.length > 0 ? softConcerns.join(", ") : c.green("0")}`,
  );
  lines.push(
    `${c.hex("#FF8C00")("Human Judgment:")} ${humanJudgment.length > 0 ? humanJudgment.join(", ") : c.green("0")}`,
  );
  lines.push(
    `${c.blue("Informational:")} ${informational.length > 0 ? informational.join(", ") : "0"}`,
  );

  // 3. Test Results
  lines.push(section("Test Results"));
  lines.push(
    `${c.green(`✓ ${testResults.passed} passed`)}  ${c.red(`✗ ${testResults.failed} failed`)}  ${c.dim(`⊘ ${testResults.skipped} skipped`)}`,
  );

  // 4. Lint Results
  lines.push(section("Lint Results"));
  lines.push(
    `${lintResults.errorCount === 0 ? c.green(`✓ ${lintResults.errorCount} errors`) : c.red(`✗ ${lintResults.errorCount} errors`)}  ${c.yellow(`⚠ ${lintResults.warningCount} warnings`)}`,
  );

  // 5. Security Scan
  lines.push(section("Security Scan"));
  const lowVulns = security.vulnerabilities.filter(
    (v) => v.severity === "low",
  ).length;
  lines.push(
    `Findings: ${security.criticalCount} critical, ${security.highCount} high, ${mediumVulns} medium, ${lowVulns} low`,
  );
  for (const vuln of security.vulnerabilities) {
    const sevColor =
      vuln.severity === "critical" || vuln.severity === "high"
        ? c.red
        : vuln.severity === "medium"
          ? c.yellow
          : c.dim;
    const location = vuln.file
      ? ` in ${vuln.file}${vuln.line ? `:${vuln.line}` : ""}`
      : "";
    lines.push(
      `  ${sevColor(`[${vuln.severity}]`)} ${vuln.description}${location}`,
    );
  }

  // 6. Blast Radius
  lines.push(section("Blast Radius"));
  lines.push(
    `Files: ${bundle.blastRadiusFiles} changed, ${bundle.blastRadiusPackages} packages affected`,
  );
  lines.push(`Revertability: ${bundle.revertabilityClass}`);

  // 7. Owners Impacted
  lines.push(section("Owners Impacted"));
  if (bundle.ownersImpacted.length === 0) {
    lines.push(c.dim("None"));
  } else {
    for (const owner of bundle.ownersImpacted) {
      lines.push(owner);
    }
  }

  // 8. Protected Surface Edits
  lines.push(section("Protected Surface Edits"));
  if (protectedEdits.length === 0) {
    lines.push(c.dim("None"));
  } else {
    for (const edit of protectedEdits) {
      lines.push(
        `${c.yellow("⚠")} ${c.bold(edit.filePath)} [${edit.protectionClass}] — ${edit.justification}`,
      );
    }
  }

  // 9. Migration Impact
  lines.push(section("Migration Impact"));
  if (!migration.hasMigrations) {
    lines.push(c.dim("No migrations detected"));
  } else {
    lines.push(
      `${migration.migrationFiles.length} migration file(s): ${migration.migrationFiles.join(", ")}`,
    );
    for (const change of migration.schemaChanges) {
      lines.push(`  • ${change}`);
    }
  }

  // 10. Annotated Diff
  lines.push(
    section(
      `Annotated Diff (${new Set(annotations.map((a) => a.file)).size} files)`,
    ),
  );
  lines.push(formatAnnotatedDiff(annotations, protectedEdits));

  // 11. Unresolved Assumptions
  lines.push(section("Unresolved Assumptions"));
  if (bundle.unresolvedAssumptions.length === 0) {
    lines.push(c.dim("None"));
  } else {
    for (const assumption of bundle.unresolvedAssumptions) {
      lines.push(`• ${assumption}`);
    }
  }

  // 12. Pending External Checks
  lines.push(section("Pending External Checks"));
  if (bundle.pendingExternalChecks.length === 0) {
    lines.push(c.dim("None"));
  } else {
    for (const check of bundle.pendingExternalChecks) {
      lines.push(`• ${check}`);
    }
  }

  // 13. Commands Run
  const commandsRun = bundle.commandsRun as CommandRecord[];
  lines.push(section("Commands Run"));
  if (commandsRun.length === 0) {
    lines.push(c.dim("None"));
  } else {
    lines.push(
      formatTable(
        [
          { header: "#", width: 3, align: "right" },
          { header: "Command", width: 30 },
          { header: "Exit", width: 4, align: "right" },
          { header: "Time", width: 8, align: "right" },
        ],
        commandsRun.map((cmd, i) => [
          String(i + 1),
          cmd.command.length > 30
            ? `${cmd.command.slice(0, 27)}...`
            : cmd.command,
          cmd.exitCode === 0
            ? c.green(String(cmd.exitCode))
            : c.red(String(cmd.exitCode)),
          `${(cmd.durationMs / 1000).toFixed(1)}s`,
        ]),
      ),
    );
  }

  // Actions footer
  const taskId = bundle.taskId.slice(0, 8);
  lines.push(`\n${c.dim("──────────────────────────────────────────────")}`);
  lines.push(c.bold("Actions:"));
  lines.push(
    `  ${c.green(`factory approve ${taskId}`)}     Approve and begin PR creation`,
  );
  lines.push(
    `  ${c.yellow(`factory changes ${taskId}`)}     Request changes (agent re-implements)`,
  );
  lines.push(
    `  ${c.red(`factory reject ${taskId}`)}      Reject task (terminal)`,
  );

  return lines.join("\n");
}

export function formatTestResultsTable(testResults: TestResults): string {
  if (!testResults.details || testResults.details.length === 0) {
    return chalk.dim("No test details available");
  }

  return formatTable(
    [
      { header: "Test", width: 30 },
      { header: "Status", width: 8 },
      { header: "Time", width: 8, align: "right" },
    ],
    testResults.details.map((t) => [
      t.name.length > 30 ? `${t.name.slice(0, 27)}...` : t.name,
      t.status === "passed"
        ? chalk.green("✓ pass")
        : t.status === "failed"
          ? chalk.red("✗ fail")
          : chalk.dim("⊘ skip"),
      t.durationMs !== undefined ? `${t.durationMs}ms` : chalk.dim("—"),
    ]),
  );
}

export function formatSecurityTable(security: SecurityScanResults): string {
  if (security.vulnerabilities.length === 0) {
    return chalk.green("No security findings");
  }

  return formatTable(
    [
      { header: "Severity", width: 10 },
      { header: "ID", width: 20 },
      { header: "Description", width: 30 },
      { header: "Location", width: 20 },
    ],
    security.vulnerabilities.map((v) => {
      const sevColor =
        v.severity === "critical" || v.severity === "high"
          ? chalk.red
          : v.severity === "medium"
            ? chalk.yellow
            : chalk.dim;
      return [
        sevColor(v.severity),
        v.id,
        v.description.length > 30
          ? `${v.description.slice(0, 27)}...`
          : v.description,
        v.file ? `${v.file}${v.line ? `:${v.line}` : ""}` : chalk.dim("—"),
      ];
    }),
  );
}
