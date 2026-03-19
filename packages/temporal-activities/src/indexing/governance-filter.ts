/**
 * Governance filter — wraps PolicyDecisionService for indexing.
 *
 * This is the FIRST stage of the indexing pipeline (security boundary).
 * Applied at: index build time, index update time, AND query time.
 */

import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  DEFAULT_EXCLUSIONS,
  isGovernanceExcluded,
} from "@software-factory/core";
import type { PolicyConfig } from "@software-factory/core";
import picomatch from "picomatch";
import type { FilterResult } from "./types.js";

/**
 * Filter paths through governance exclusions and repo-specific policies.
 *
 * Resolves symlinks before filtering to prevent symlink escape.
 */
export function filterPaths(
  paths: readonly string[],
  policies: readonly PolicyConfig[],
  repoRoot: string,
): FilterResult {
  const included: string[] = [];
  const excluded: string[] = [];
  const exclusionReasons = new Map<string, string>();

  const normalizedRoot = resolve(repoRoot);

  // Precompile read_exclusion matchers from policies
  const readExclusionPolicies = policies.filter(
    (p) => p.isActive && p.policyType === "read_exclusion",
  );

  for (const filePath of paths) {
    const exclusionReason = checkExclusion(
      filePath,
      normalizedRoot,
      readExclusionPolicies,
    );

    if (exclusionReason !== null) {
      excluded.push(filePath);
      exclusionReasons.set(filePath, exclusionReason);
    } else {
      included.push(filePath);
    }
  }

  return { included, excluded, exclusionReasons };
}

function checkExclusion(
  filePath: string,
  repoRoot: string,
  readExclusionPolicies: readonly PolicyConfig[],
): string | null {
  // 1. Check default governance exclusions
  if (isGovernanceExcluded(filePath)) {
    return `Default exclusion: matches ${findMatchingPattern(filePath, DEFAULT_EXCLUSIONS)}`;
  }

  // 2. Resolve symlinks and verify path stays within repo
  const symResult = resolveAndCheckSymlink(filePath, repoRoot);
  if (symResult !== null) {
    return symResult;
  }

  // 3. Check repo-specific read_exclusion policies
  for (const policy of readExclusionPolicies) {
    if (
      policy.pathPatterns.some((pattern) =>
        picomatch.isMatch(filePath, pattern),
      )
    ) {
      return `Read exclusion policy "${policy.name}"`;
    }
  }

  return null;
}

function resolveAndCheckSymlink(
  filePath: string,
  repoRoot: string,
): string | null {
  try {
    const absolutePath = resolve(repoRoot, filePath);
    const realPath = realpathSync(absolutePath);
    const normalizedReal = resolve(realPath);

    if (!normalizedReal.startsWith(repoRoot)) {
      return `Symlink escape: "${filePath}" resolves to "${normalizedReal}" outside repo root`;
    }

    // Check the resolved path against exclusions too
    const resolvedRelative = relative(repoRoot, normalizedReal);
    if (
      resolvedRelative !== filePath &&
      isGovernanceExcluded(resolvedRelative)
    ) {
      return `Symlink target excluded: "${resolvedRelative}" matches governance exclusion`;
    }
  } catch {
    // File doesn't exist on disk (e.g., git ls-files at a different commit)
    // — skip symlink check, fall through to allow
  }

  return null;
}

function findMatchingPattern(
  path: string,
  patterns: readonly string[],
): string {
  for (const pattern of patterns) {
    if (picomatch.isMatch(path, pattern)) return pattern;
  }
  return "unknown";
}
