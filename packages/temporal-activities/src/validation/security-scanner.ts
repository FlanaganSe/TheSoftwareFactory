/**
 * Security scanner — Semgrep (SAST), Syft (SBOM), Grype (vulnerability scan).
 * Scanners are optional in V1 — missing tools produce a warning, not a failure.
 * Semgrep config comes from TrustedBaseContext (strict boundary).
 * Only changed files are scanned.
 */

import type {
  CommandRecord,
  FactoryResult,
  SBOMEntry,
  SBOMResult,
  SecurityScanResults,
  Vulnerability,
} from "@software-factory/core";
import { ok } from "neverthrow";
import type { SandboxSupervisor } from "../sandbox/supervisor.js";

export interface SecurityScanConfig {
  readonly containerId: string;
  readonly changedFiles: readonly string[];
  readonly semgrepConfig?: string;
  readonly workingDir: string;
  readonly timeoutMs: number;
}

export interface SecurityScanResult {
  readonly securityScanResults: SecurityScanResults;
  readonly sarifOutput?: string;
  readonly sbom?: SBOMResult;
  readonly vulnerabilityScan?: SecurityScanResults;
  readonly commandsRun: readonly CommandRecord[];
}

// ─── SARIF parser ────────────────────────────────────────────────────────────

export function parseSarifFindings(sarifJson: string): Vulnerability[] {
  try {
    const sarif = JSON.parse(sarifJson);
    const vulnerabilities: Vulnerability[] = [];
    const runs = sarif?.runs;
    if (!Array.isArray(runs)) return [];

    for (const run of runs) {
      const results = (run as Record<string, unknown>).results;
      if (!Array.isArray(results)) continue;

      for (const result of results) {
        const r = result as Record<string, unknown>;
        const ruleId = String(r.ruleId ?? "unknown");
        const message =
          typeof r.message === "object" && r.message !== null
            ? String((r.message as Record<string, unknown>).text ?? "")
            : String(r.message ?? "");

        const level = String(r.level ?? "warning");
        const severity = sarifLevelToSeverity(level);

        // Extract location
        const locations = r.locations as unknown[];
        let file: string | undefined;
        let line: number | undefined;
        if (Array.isArray(locations) && locations.length > 0) {
          const loc = locations[0] as Record<string, unknown>;
          const physLoc = loc?.physicalLocation as
            | Record<string, unknown>
            | undefined;
          const artifact = physLoc?.artifactLocation as
            | Record<string, unknown>
            | undefined;
          file = artifact?.uri ? String(artifact.uri) : undefined;
          const region = physLoc?.region as Record<string, unknown> | undefined;
          line =
            region?.startLine !== undefined
              ? Number(region.startLine)
              : undefined;
        }

        vulnerabilities.push({
          id: ruleId,
          severity,
          description: message,
          file,
          line,
        });
      }
    }

    return vulnerabilities;
  } catch {
    return [];
  }
}

function sarifLevelToSeverity(
  level: string,
): "critical" | "high" | "medium" | "low" {
  switch (level) {
    case "error":
      return "high";
    case "warning":
      return "medium";
    case "note":
      return "low";
    default:
      return "medium";
  }
}

// ─── Grype parser ────────────────────────────────────────────────────────────

export function parseGrypeJson(jsonStr: string): Vulnerability[] {
  try {
    const data = JSON.parse(jsonStr);
    const matches = data?.matches;
    if (!Array.isArray(matches)) return [];

    return matches.map((m: Record<string, unknown>) => {
      const vuln = m.vulnerability as Record<string, unknown>;
      return {
        id: String(vuln?.id ?? "unknown"),
        severity: normalizeSeverity(String(vuln?.severity ?? "Unknown")),
        description: String(vuln?.description ?? m.matchDetails ?? ""),
        file: undefined,
        line: undefined,
      };
    });
  } catch {
    return [];
  }
}

function normalizeSeverity(s: string): "critical" | "high" | "medium" | "low" {
  switch (s.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
    case "negligible":
      return "low";
    default:
      return "medium";
  }
}

// ─── Syft parser ─────────────────────────────────────────────────────────────

export function parseSyftSpdxJson(jsonStr: string): SBOMEntry[] {
  try {
    const data = JSON.parse(jsonStr);
    const packages = data?.packages;
    if (!Array.isArray(packages)) return [];

    return packages.map((pkg: Record<string, unknown>) => ({
      name: String(pkg.name ?? "unknown"),
      version: String(pkg.versionInfo ?? pkg.version ?? "unknown"),
      type: detectPackageType(String(pkg.name ?? "")),
      license: extractLicense(pkg),
    }));
  } catch {
    return [];
  }
}

function detectPackageType(
  name: string,
): "npm" | "pip" | "go" | "cargo" | "maven" | "other" {
  if (name.includes("golang.org") || name.includes("github.com")) return "go";
  if (name.startsWith("@") || name.includes("/")) return "npm";
  return "other";
}

function extractLicense(pkg: Record<string, unknown>): string | undefined {
  if (typeof pkg.licenseConcluded === "string") return pkg.licenseConcluded;
  if (typeof pkg.licenseDeclared === "string") return pkg.licenseDeclared;
  return undefined;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

const ALLOWED_TOOLS = new Set(["semgrep", "syft", "grype"]);

async function isToolAvailable(
  sandbox: SandboxSupervisor,
  containerId: string,
  tool: string,
): Promise<boolean> {
  if (!ALLOWED_TOOLS.has(tool)) return false;

  const instance = {
    containerId,
    phase: "execution" as const,
    labels: {},
  };
  const result = await sandbox.execCommand(instance, ["which", tool]);
  return result.isOk() && result.value.exitCode === 0;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runSecurityScan(
  config: SecurityScanConfig,
  sandbox: SandboxSupervisor,
): Promise<FactoryResult<SecurityScanResult>> {
  const instance = {
    containerId: config.containerId,
    phase: "execution" as const,
    labels: {},
  };

  const commandsRun: CommandRecord[] = [];
  const allVulnerabilities: Vulnerability[] = [];
  let sarifOutput: string | undefined;
  let sbom: SBOMResult | undefined;
  let vulnerabilityScan: SecurityScanResults | undefined;

  // ── Semgrep SAST ──

  const semgrepAvailable = await isToolAvailable(
    sandbox,
    config.containerId,
    "semgrep",
  );

  if (semgrepAvailable && config.changedFiles.length > 0) {
    const semgrepConfigFlag = config.semgrepConfig
      ? `--config=${config.semgrepConfig}`
      : "--config=auto";
    const escapedFiles = config.changedFiles.map(
      (f) => `'${f.replace(/'/g, "'\\''")}'`,
    );
    const fileList = escapedFiles.join(" ");
    const semgrepCmd = `semgrep ${semgrepConfigFlag} --sarif --output=/tmp/semgrep.sarif -- ${fileList} 2>&1 || true`;

    const semgrepResult = await sandbox.execCommand(
      instance,
      ["sh", "-c", semgrepCmd],
      { workingDir: config.workingDir, timeoutMs: config.timeoutMs },
    );

    if (semgrepResult.isOk()) {
      commandsRun.push({
        command: `semgrep ${semgrepConfigFlag} --sarif ${config.changedFiles.length} files`,
        exitCode: semgrepResult.value.exitCode,
        durationMs: semgrepResult.value.durationMs,
        output: semgrepResult.value.stdout.slice(0, 5_000),
      });

      // Read SARIF output
      const sarifRead = await sandbox.execCommand(
        instance,
        ["cat", "/tmp/semgrep.sarif"],
        { workingDir: config.workingDir },
      );
      if (sarifRead.isOk() && sarifRead.value.exitCode === 0) {
        sarifOutput = sarifRead.value.stdout;
        const findings = parseSarifFindings(sarifOutput);
        allVulnerabilities.push(...findings);
      }
    }
  } else if (!semgrepAvailable) {
    commandsRun.push({
      command: "semgrep (not available — SAST scan skipped)",
      exitCode: -1,
      durationMs: 0,
    });
  }

  // ── Syft SBOM ──

  const syftAvailable = await isToolAvailable(
    sandbox,
    config.containerId,
    "syft",
  );

  if (syftAvailable) {
    const syftCmd = "syft /workspace -o spdx-json=/tmp/sbom.json 2>&1 || true";
    const syftResult = await sandbox.execCommand(
      instance,
      ["sh", "-c", syftCmd],
      { workingDir: config.workingDir, timeoutMs: config.timeoutMs },
    );

    if (syftResult.isOk()) {
      commandsRun.push({
        command: "syft /workspace -o spdx-json",
        exitCode: syftResult.value.exitCode,
        durationMs: syftResult.value.durationMs,
      });

      const sbomRead = await sandbox.execCommand(
        instance,
        ["cat", "/tmp/sbom.json"],
        { workingDir: config.workingDir },
      );
      if (sbomRead.isOk() && sbomRead.value.exitCode === 0) {
        const entries = parseSyftSpdxJson(sbomRead.value.stdout);
        sbom = {
          entries,
          format: "spdx",
          generatedAt: new Date().toISOString(),
        };
      }
    }
  } else {
    commandsRun.push({
      command: "syft (not available — SBOM generation skipped)",
      exitCode: -1,
      durationMs: 0,
    });
  }

  // ── Grype vulnerability scan ──

  const grypeAvailable = await isToolAvailable(
    sandbox,
    config.containerId,
    "grype",
  );

  if (grypeAvailable) {
    const grypeTarget = syftAvailable ? "/tmp/sbom.json" : "dir:/workspace";
    const grypeCmd = `grype ${grypeTarget} -o json 2>&1 || true`;
    const grypeResult = await sandbox.execCommand(
      instance,
      ["sh", "-c", grypeCmd],
      { workingDir: config.workingDir, timeoutMs: config.timeoutMs },
    );

    if (grypeResult.isOk()) {
      commandsRun.push({
        command: `grype ${grypeTarget} -o json`,
        exitCode: grypeResult.value.exitCode,
        durationMs: grypeResult.value.durationMs,
      });

      const grypeVulns = parseGrypeJson(grypeResult.value.stdout);
      vulnerabilityScan = {
        vulnerabilities: grypeVulns,
        totalFindings: grypeVulns.length,
        criticalCount: grypeVulns.filter((v) => v.severity === "critical")
          .length,
        highCount: grypeVulns.filter((v) => v.severity === "high").length,
      };
    }
  } else {
    commandsRun.push({
      command: "grype (not available — vulnerability scan skipped)",
      exitCode: -1,
      durationMs: 0,
    });
  }

  const securityScanResults: SecurityScanResults = {
    vulnerabilities: allVulnerabilities,
    totalFindings: allVulnerabilities.length,
    criticalCount: allVulnerabilities.filter((v) => v.severity === "critical")
      .length,
    highCount: allVulnerabilities.filter((v) => v.severity === "high").length,
  };

  return ok({
    securityScanResults,
    sarifOutput,
    sbom,
    vulnerabilityScan,
    commandsRun,
  });
}
