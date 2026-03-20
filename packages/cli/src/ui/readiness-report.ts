import chalk from "chalk";
import { formatTable } from "./table-display.js";

function section(title: string): string {
  return `\n${chalk.bold(`── ${title} ${"─".repeat(Math.max(0, 44 - title.length))}`)}`;
}

function yesNo(value: unknown): string {
  return value ? chalk.green("yes") : chalk.dim("no");
}

function supportBadge(supported: boolean): string {
  return supported ? chalk.green("Supported") : chalk.red("Not Supported");
}

function classBadge(repoClass: string): string {
  switch (repoClass) {
    case "A":
      return chalk.green("A (standard)");
    case "B":
      return chalk.yellow("B (protected)");
    case "C":
      return chalk.red("C (restricted)");
    default:
      return chalk.dim(repoClass);
  }
}

export function formatReadinessReport(
  snapshot: Record<string, unknown>,
): string {
  const lines: string[] = [];
  const c = chalk;

  // Header
  lines.push(c.dim("╭──────────────────────────────────────────────╮"));
  lines.push(
    `${c.dim("│")}  ${c.bold("Repository Readiness Report")}${" ".repeat(19)}${c.dim("│")}`,
  );
  lines.push(c.dim("╰──────────────────────────────────────────────╯"));

  // Section 1: Overview
  lines.push(section("Overview"));
  lines.push(`  Visibility:    ${String(snapshot.visibility ?? "unknown")}`);
  lines.push(`  Default Branch: ${String(snapshot.defaultBranch ?? "main")}`);
  lines.push(
    `  Repo Class:    ${classBadge(String(snapshot.repoClass ?? "A"))}`,
  );
  lines.push(
    `  Factory Support: ${supportBadge(snapshot.supportedByFactory as boolean)}`,
  );

  if (snapshot.isArchived) {
    lines.push(`  ${c.yellow("Archived repository")}`);
  }
  if (snapshot.isFork) {
    lines.push(`  ${c.yellow("Forked repository")}`);
  }

  const unsupportedReasons = snapshot.unsupportedReasons as
    | string[]
    | undefined;
  if (unsupportedReasons && unsupportedReasons.length > 0) {
    lines.push(`  ${c.red("Unsupported reasons:")}`);
    for (const reason of unsupportedReasons) {
      lines.push(`    ${c.red("•")} ${reason}`);
    }
  }

  // Section 2: Branch Protection
  lines.push(section("Branch Protection"));
  const bp = snapshot.branchProtection as Record<string, unknown> | null;
  if (bp) {
    lines.push(
      `  Required reviews:   ${String(snapshot.requiredReviewCount ?? bp.requiredReviewCount ?? 0)}`,
    );
    lines.push(
      `  Dismiss stale:      ${yesNo(snapshot.dismissesStaleReviews ?? bp.dismissStaleReviews)}`,
    );
    lines.push(
      `  Code owner review:  ${yesNo(snapshot.requiresCodeOwnerReview ?? bp.requireCodeOwnerReviews)}`,
    );
    lines.push(
      `  Signed commits:     ${yesNo(snapshot.requiresSignedCommits)}`,
    );
    lines.push(
      `  Linear history:     ${yesNo(snapshot.requiresLinearHistory)}`,
    );
    lines.push(
      `  Conversation resolution: ${yesNo(snapshot.requiresConversationResolution)}`,
    );
  } else {
    lines.push(`  ${c.dim("No branch protection configured")}`);
  }

  // Section 3: Rulesets
  lines.push(section("Rulesets"));
  const rulesets = snapshot.rulesets as
    | Array<Record<string, unknown>>
    | undefined;
  if (rulesets && rulesets.length > 0) {
    lines.push(
      `  ${rulesets.length} ruleset(s) ${snapshot.hasInheritedRulesets ? c.dim("(includes inherited)") : ""}`,
    );
    lines.push(
      formatTable(
        [
          { header: "Name", width: 24 },
          { header: "Enforcement", width: 12 },
          { header: "Source", width: 10 },
        ],
        rulesets.map((rs) => [
          String(rs.name ?? ""),
          String(rs.enforcement ?? ""),
          String(rs.sourceType ?? ""),
        ]),
      ),
    );
  } else {
    lines.push(`  ${c.dim("No rulesets configured")}`);
  }

  // Section 4: CODEOWNERS
  lines.push(section("CODEOWNERS"));
  const co = snapshot.codeowners as Record<string, unknown> | null;
  if (co?.found) {
    lines.push(`  Found:    ${c.green("yes")}`);
    lines.push(`  Location: ${String(co.location ?? "")}`);
    const entries = co.entries as unknown[] | undefined;
    lines.push(`  Entries:  ${entries?.length ?? 0}`);
    const parseErrors = co.parseErrors as string[] | undefined;
    if (parseErrors && parseErrors.length > 0) {
      lines.push(`  ${c.yellow(`Parse errors: ${parseErrors.length}`)}`);
    }
  } else {
    lines.push(`  ${c.dim("No CODEOWNERS file found")}`);
  }

  // Section 5: Merge Configuration
  lines.push(section("Merge Configuration"));
  const mq = snapshot.mergeQueue as Record<string, unknown> | null;
  lines.push(`  Merge queue: ${mq ? c.green("enabled") : c.dim("disabled")}`);

  const strategies = snapshot.allowedMergeStrategies as string[] | undefined;
  if (strategies && strategies.length > 0) {
    lines.push(`  Strategies:  ${strategies.join(", ")}`);
  }

  const checks = snapshot.requiredStatusChecks as
    | Array<Record<string, unknown>>
    | undefined;
  if (checks && checks.length > 0) {
    lines.push(`  Required checks: ${checks.length}`);
    for (const check of checks.slice(0, 10)) {
      lines.push(`    ${c.dim("•")} ${String(check.context ?? "")}`);
    }
    if (checks.length > 10) {
      lines.push(`    ${c.dim(`... and ${checks.length - 10} more`)}`);
    }
  }

  // Section 6: Security
  lines.push(section("Security"));
  if (snapshot.hasPullRequestTargetWorkflows) {
    const paths = snapshot.pullRequestTargetWorkflowPaths as string[];
    lines.push(
      `  ${c.red(`Dangerous workflows detected: ${paths?.length ?? 0}`)}`,
    );
    for (const p of paths ?? []) {
      lines.push(`    ${c.red("•")} ${p}`);
    }
  } else {
    lines.push(`  ${c.green("No dangerous workflow triggers detected")}`);
  }

  const envs = snapshot.environments as string[] | undefined;
  if (envs && envs.length > 0) {
    lines.push(`  Environments: ${envs.join(", ")}`);
  }

  // Section 7: Warnings
  const warnings = snapshot.warnings as string[] | undefined;
  if (warnings && warnings.length > 0) {
    lines.push(section("Warnings"));
    for (const w of warnings) {
      lines.push(`  ${c.yellow("⚠")} ${w}`);
    }
  }

  // Footer
  lines.push(`\n${c.dim("──────────────────────────────────────────────")}`);
  lines.push(c.bold("Next steps:"));
  lines.push(`  1. Ensure ${c.cyan(".factory/setup.yml")} exists in your repo`);
  lines.push(
    `  2. Submit a task: ${c.green("factory status <task-id>")} after API submission`,
  );

  return lines.join("\n");
}
