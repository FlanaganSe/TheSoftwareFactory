import { createHash } from "node:crypto";

/**
 * Default secret patterns for redaction.
 * Matches common token/key/secret patterns in text content.
 */
const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._\-/+=]{10,}/g,
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9]{36,}/g,
  /gho_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  // Generic API keys / secrets (key=value or key: "value" patterns)
  /(?:api[_-]?key|secret[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9._\-/+=]{8,}["']?/gi,
  // Environment variable secrets (FOO_TOKEN=value, FOO_SECRET=value, etc.)
  /(?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|API_KEY))\s*=\s*[^\s]{4,}/g,
  // AWS-style keys
  /AKIA[A-Z0-9]{16}/g,
  // Long hex strings that look like secrets (32+ chars following key/secret/token labels)
  /(?:key|secret|token|password)\s*[:=]\s*["']?[0-9a-fA-F]{32,}["']?/gi,
  // Base64-encoded secrets following common labels
  /(?:key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9+/]{40,}={0,2}["']?/gi,
];

const REDACTED = "[REDACTED]";

/**
 * Redact secrets from content before persisting to evidence artifacts.
 * Returns the redacted content string.
 */
export function redactSecrets(
  content: string,
  secretPatterns?: readonly string[],
): string {
  let result = content;

  // Apply default patterns
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    // Clone the regex to reset lastIndex (they use /g flag)
    const cloned = new RegExp(pattern.source, pattern.flags);
    result = result.replace(cloned, (match) => {
      // For patterns like KEY=value, preserve the key part
      const eqIdx = match.indexOf("=");
      const colonIdx = match.indexOf(":");
      const sepIdx =
        eqIdx >= 0 && colonIdx >= 0
          ? Math.min(eqIdx, colonIdx)
          : eqIdx >= 0
            ? eqIdx
            : colonIdx;

      if (sepIdx >= 0 && sepIdx < match.length - 1) {
        const prefix = match.slice(0, sepIdx + 1);
        // Preserve any whitespace/quote after separator
        const rest = match.slice(sepIdx + 1);
        const leadingWhitespaceOrQuote = rest.match(/^[\s"']*/)?.[0] ?? "";
        return `${prefix}${leadingWhitespaceOrQuote}${REDACTED}`;
      }

      // For standalone tokens (Bearer, ghp_, etc.), just replace the secret part
      if (match.startsWith("Bearer")) {
        return `Bearer ${REDACTED}`;
      }
      return REDACTED;
    });
  }

  // Apply custom patterns from config
  if (secretPatterns) {
    for (const patternStr of secretPatterns) {
      const pattern = new RegExp(patternStr, "g");
      result = result.replace(pattern, REDACTED);
    }
  }

  return result;
}

/**
 * Check whether content contains potential secrets.
 * Returns false if any secret patterns match.
 */
export function isContentSafe(content: string): {
  safe: boolean;
  findings: string[];
} {
  const findings: string[] = [];

  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    const cloned = new RegExp(pattern.source, pattern.flags);
    const matches = content.match(cloned);
    if (matches) {
      for (const match of matches) {
        // Mask the finding itself so we don't leak the secret
        const masked =
          match.length > 12
            ? `${match.slice(0, 6)}...${match.slice(-4)}`
            : `${match.slice(0, 3)}...`;
        findings.push(`Pattern ${pattern.source} matched: ${masked}`);
      }
    }
  }

  return { safe: findings.length === 0, findings };
}

/**
 * Compute SHA-256 hash of content.
 */
export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
