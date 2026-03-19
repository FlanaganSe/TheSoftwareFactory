import { describe, expect, it } from "vitest";
import { isContentSafe, redactSecrets } from "../../src/evidence/redaction.js";

describe("redactSecrets", () => {
  it("redacts Bearer tokens", () => {
    const input =
      "Authorization: Bearer ghp_abc123def456ghi789jkl012mno345pqr678";
    const result = redactSecrets(input);
    expect(result).toContain("Bearer [REDACTED]");
    expect(result).not.toContain("ghp_abc123");
  });

  it("redacts GitHub personal access tokens (ghp_)", () => {
    const input = "token: ghp_abcdefghijklmnopqrstuvwxyz012345678901";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("ghp_abcdefg");
  });

  it("redacts GitHub OAuth tokens (gho_)", () => {
    const input = "auth: gho_abcdefghijklmnopqrstuvwxyz012345678901";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("gho_abcdefg");
  });

  it("redacts environment variable secrets", () => {
    const input = "NPM_TOKEN=secret123abcdef";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("secret123");
  });

  it("redacts API key patterns", () => {
    const input =
      'api_key: "sk-abc123def456ghi789jkl0123456789abcdef01234567890"';
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-abc123");
  });

  it("leaves normal code content unchanged", () => {
    const input = 'const x = 42;\nfunction hello() { return "world"; }';
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });

  it("applies custom patterns", () => {
    const input = "my-custom-secret-value-12345";
    const result = redactSecrets(input, ["my-custom-secret-value-\\d+"]);
    expect(result).toBe("[REDACTED]");
  });

  it("redacts multiple secrets in one string", () => {
    const input =
      "AUTH_TOKEN=secret123abc NPM_TOKEN=npmTokenValue123456 Bearer ghp_abcdefghijklmnopqrstuvwxyz01234567";
    const result = redactSecrets(input);
    expect(result).not.toContain("secret123abc");
    expect(result).not.toContain("npmTokenValue");
    expect(result).not.toContain("ghp_abcdef");
    // Should have multiple redactions
    expect((result.match(/\[REDACTED\]/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("redacts github_pat_ tokens", () => {
    const input = "token=github_pat_abcdefghijklmnopqrstuv1234";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("github_pat_abc");
  });
});

describe("isContentSafe", () => {
  it("returns safe=true for normal content", () => {
    const result = isContentSafe("const x = 42; console.log(x);");
    expect(result.safe).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("returns safe=false for content with Bearer tokens", () => {
    const result = isContentSafe(
      "Authorization: Bearer ghp_abc123def456ghi789jkl012mno345pqr678",
    );
    expect(result.safe).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("returns safe=false for content with GitHub tokens", () => {
    const result = isContentSafe("ghp_abcdefghijklmnopqrstuvwxyz012345678901");
    expect(result.safe).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
