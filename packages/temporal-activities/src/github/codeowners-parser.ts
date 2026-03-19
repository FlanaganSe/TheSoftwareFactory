import type { CodeownersEntry } from "@software-factory/core";
import picomatch from "picomatch";

const MAX_CODEOWNERS_SIZE = 3 * 1024 * 1024; // 3 MB — GitHub's limit

export interface CodeownersParseResult {
  readonly entries: readonly CodeownersEntry[];
  readonly parseErrors: readonly string[];
}

/**
 * Parse a CODEOWNERS file content into structured entries.
 * Follows GitHub CODEOWNERS rules:
 * - gitignore-style pattern matching
 * - Last match wins (not first)
 * - Case-sensitive (unlike gitignore on macOS)
 * - Lines starting with # are comments
 * - Inline comments after owners (# ...) are stripped
 */
export function parseCodeowners(content: string): CodeownersParseResult {
  if (content.length > MAX_CODEOWNERS_SIZE) {
    return {
      entries: [],
      parseErrors: [
        `CODEOWNERS file exceeds 3 MB limit (${content.length} bytes)`,
      ],
    };
  }

  const entries: CodeownersEntry[] = [];
  const parseErrors: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip empty lines and full-line comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Strip inline comments: find first # preceded by whitespace that's
    // not part of a pattern or owner
    const withoutInlineComment = stripInlineComment(trimmed);
    const tokens = withoutInlineComment.split(/\s+/);

    if (tokens.length < 1) {
      continue;
    }

    const pattern = tokens[0];
    const owners = tokens.slice(1);

    if (owners.length === 0) {
      // Pattern with no owners — this is valid in CODEOWNERS
      // (it means "unowned" — clears previous ownership)
      entries.push({ pattern, owners: [], lineNumber });
      continue;
    }

    // Validate owners — should be @user, @org/team, or email
    const validOwners: string[] = [];
    for (const owner of owners) {
      if (
        owner.startsWith("@") ||
        owner.includes("@") // email addresses
      ) {
        validOwners.push(owner);
      } else {
        parseErrors.push(
          `Line ${lineNumber}: invalid owner "${owner}" — expected @user, @org/team, or email`,
        );
      }
    }

    entries.push({ pattern, owners: validOwners, lineNumber });
  }

  return { entries, parseErrors };
}

/**
 * Find owners for a given file path using CODEOWNERS entries.
 * Applies last-match-wins semantics.
 */
export function getOwners(
  filePath: string,
  entries: readonly CodeownersEntry[],
): readonly string[] {
  // Normalize: strip leading slash from filePath
  const normalizedPath = filePath.startsWith("/")
    ? filePath.slice(1)
    : filePath;

  let matchedOwners: readonly string[] = [];

  // Iterate all entries — last match wins
  for (const entry of entries) {
    if (matchesPattern(normalizedPath, entry.pattern)) {
      matchedOwners = entry.owners;
    }
  }

  return matchedOwners;
}

/**
 * Test whether a file path matches a CODEOWNERS pattern.
 * CODEOWNERS patterns follow gitignore rules with some differences:
 * - Patterns without / match anywhere in the path
 * - Patterns with / are relative to the repo root
 * - ** matches across directories
 * - Case-sensitive (unlike gitignore on macOS)
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Handle negation patterns
  if (pattern.startsWith("!")) {
    return !matchesPattern(filePath, pattern.slice(1));
  }

  let globPattern = pattern;

  // Patterns starting with / are anchored to root — remove leading /
  if (globPattern.startsWith("/")) {
    globPattern = globPattern.slice(1);
  } else if (!globPattern.includes("/")) {
    // Patterns without a slash match anywhere in the path
    // e.g., "*.js" matches "src/foo.js" and "foo.js"
    globPattern = `**/${globPattern}`;
  }

  // If pattern ends with /, it matches the directory and everything inside
  if (globPattern.endsWith("/")) {
    globPattern = `${globPattern}**`;
  }

  // CODEOWNERS: patterns without trailing / match exactly as globs.
  // Directory auto-expansion only happens with explicit trailing /.
  const matcher = picomatch(globPattern, { dot: true });
  return matcher(filePath);
}

/**
 * Strip inline comment from a CODEOWNERS line.
 * Inline comments start with # preceded by whitespace,
 * but only after the pattern + owners portion.
 */
function stripInlineComment(line: string): string {
  // Find # that's preceded by whitespace and not the first character
  // We need to be careful not to strip # from email addresses or patterns
  const parts = line.split(/\s+#\s/);
  return parts[0].trim();
}
