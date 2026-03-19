/**
 * Validator boundary checker — detects agent modifications to control files.
 * Compares workspace files against TrustedBaseContext hashes.
 * This is the most critical security check in M13.
 */

import { createHash } from "node:crypto";
import type {
  FactoryResult,
  TrustedBaseContext,
  ValidatorControlFileEdit,
} from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import type { SandboxSupervisor } from "../sandbox/supervisor.js";

export interface ValidatorBoundaryConfig {
  readonly containerId: string;
  readonly trustedContext: TrustedBaseContext;
  readonly sandbox: SandboxSupervisor;
}

// ── Well-known control file patterns ─────────────────────────────────────────

interface WellKnownControlFile {
  readonly path: string;
  readonly category: ValidatorControlFileEdit["category"];
}

const WELL_KNOWN_CONTROL_FILES: readonly WellKnownControlFile[] = [
  // Factory
  { path: ".factory/setup.yml", category: "factory_config" },
  { path: ".factory/config.toml", category: "factory_config" },
  // Test config
  { path: "vitest.config.ts", category: "test_config" },
  { path: "vitest.config.js", category: "test_config" },
  { path: "vitest.config.mts", category: "test_config" },
  { path: "jest.config.ts", category: "test_config" },
  { path: "jest.config.js", category: "test_config" },
  { path: "jest.config.mjs", category: "test_config" },
  { path: "pytest.ini", category: "test_config" },
  { path: "setup.cfg", category: "test_config" },
  { path: "tox.ini", category: "test_config" },
  // Lint config
  { path: "biome.json", category: "lint_config" },
  { path: "biome.jsonc", category: "lint_config" },
  { path: ".eslintrc", category: "lint_config" },
  { path: ".eslintrc.js", category: "lint_config" },
  { path: ".eslintrc.json", category: "lint_config" },
  { path: ".prettierrc", category: "lint_config" },
  { path: ".prettierrc.json", category: "lint_config" },
  // Security config
  { path: ".semgrepignore", category: "security_config" },
  { path: ".semgrep.yml", category: "security_config" },
  { path: ".semgrep.yaml", category: "security_config" },
  // CI config
  { path: "Makefile", category: "ci_config" },
  { path: "Dockerfile", category: "ci_config" },
  { path: "docker-compose.yml", category: "ci_config" },
  { path: "docker-compose.yaml", category: "ci_config" },
];

// ── Category inference ──────────────────────────────────────────────────────

export function categorizeControlFile(
  path: string,
): ValidatorControlFileEdit["category"] {
  const knownFile = WELL_KNOWN_CONTROL_FILES.find((wk) => wk.path === path);
  if (knownFile) return knownFile.category;

  if (path.startsWith(".github/workflows/")) return "ci_config";
  if (path.startsWith(".factory/")) return "factory_config";
  if (/vitest|jest|pytest|mocha|karma/i.test(path)) return "test_config";
  if (/eslint|biome|prettier|stylelint/i.test(path)) return "lint_config";
  if (/semgrep/i.test(path)) return "security_config";

  return "factory_config";
}

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function checkValidatorBoundary(
  config: ValidatorBoundaryConfig,
): Promise<FactoryResult<ValidatorControlFileEdit[]>> {
  const { containerId, trustedContext, sandbox } = config;
  const instance = {
    containerId,
    phase: "execution" as const,
    labels: {},
  };

  const edits: ValidatorControlFileEdit[] = [];

  try {
    // 1. Check files in trustedContext.behavioralControlFiles
    for (const [path, baseContent] of Object.entries(
      trustedContext.behavioralControlFiles,
    )) {
      const baseHash = computeHash(baseContent);

      const catResult = await sandbox.execCommand(
        instance,
        ["cat", `/workspace/${path}`],
        { workingDir: "/workspace" },
      );

      if (catResult.isOk() && catResult.value.exitCode === 0) {
        const workspaceHash = computeHash(catResult.value.stdout);
        if (workspaceHash !== baseHash) {
          edits.push({
            path,
            baseRefHash: baseHash,
            workspaceHash,
            category: categorizeControlFile(path),
          });
        }
      }
      // File deleted in workspace = also a modification
      else if (catResult.isOk() && catResult.value.exitCode !== 0) {
        edits.push({
          path,
          baseRefHash: baseHash,
          workspaceHash: "DELETED",
          category: categorizeControlFile(path),
        });
      }
    }

    // 2. Check well-known paths not already in trusted context
    const trustedPaths = new Set(
      Object.keys(trustedContext.behavioralControlFiles),
    );

    for (const wellKnown of WELL_KNOWN_CONTROL_FILES) {
      if (trustedPaths.has(wellKnown.path)) continue;

      // Check if this file exists in the workspace
      const catResult = await sandbox.execCommand(
        instance,
        ["cat", `/workspace/${wellKnown.path}`],
        { workingDir: "/workspace" },
      );

      if (catResult.isOk() && catResult.value.exitCode === 0) {
        // File exists in workspace but wasn't in trusted context — possible new control file
        // Check via git if the file was modified in this branch
        const gitResult = await sandbox.execCommand(
          instance,
          [
            "git",
            "diff",
            "--name-only",
            trustedContext.baseSha,
            "--",
            wellKnown.path,
          ],
          { workingDir: "/workspace" },
        );

        if (
          gitResult.isOk() &&
          gitResult.value.stdout.trim().includes(wellKnown.path)
        ) {
          const workspaceHash = computeHash(catResult.value.stdout);
          edits.push({
            path: wellKnown.path,
            baseRefHash: "NOT_IN_TRUSTED_CONTEXT",
            workspaceHash,
            category: wellKnown.category,
          });
        }
      }
    }

    // 3. Check .github/workflows/ and .factory/ via git diff
    const controlDirs: readonly {
      dir: string;
      category: ValidatorControlFileEdit["category"];
    }[] = [
      { dir: ".github/workflows/", category: "ci_config" },
      { dir: ".factory/", category: "factory_config" },
    ];

    for (const { dir, category } of controlDirs) {
      const dirDiff = await sandbox.execCommand(
        instance,
        ["git", "diff", "--name-only", trustedContext.baseSha, "--", dir],
        { workingDir: "/workspace" },
      );

      if (dirDiff.isOk() && dirDiff.value.exitCode === 0) {
        const modifiedFiles = dirDiff.value.stdout
          .split("\n")
          .filter((p) => p.trim().length > 0);

        for (const filePath of modifiedFiles) {
          if (edits.some((e) => e.path === filePath)) continue;

          edits.push({
            path: filePath,
            baseRefHash: "NOT_IN_TRUSTED_CONTEXT",
            workspaceHash: "MODIFIED",
            category,
          });
        }
      }
    }

    return ok(edits);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Validator boundary check failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
