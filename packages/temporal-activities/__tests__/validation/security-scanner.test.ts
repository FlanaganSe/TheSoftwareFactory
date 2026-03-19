import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { ExecResult, SandboxSupervisor } from "../../src/sandbox/index.js";
import {
  parseGrypeJson,
  parseSarifFindings,
  parseSyftSpdxJson,
  runSecurityScan,
} from "../../src/validation/security-scanner.js";

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: "", stderr: "", durationMs: 50, ...overrides };
}

describe("parseSarifFindings", () => {
  it("parses SARIF 2.1.0 with findings", () => {
    const sarif = JSON.stringify({
      runs: [
        {
          results: [
            {
              ruleId: "python.lang.security.audit.eval-detected",
              level: "error",
              message: { text: "Detected eval usage" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "app/main.py" },
                    region: { startLine: 42 },
                  },
                },
              ],
            },
            {
              ruleId: "generic.secrets.security.detected-api-key",
              level: "warning",
              message: { text: "API key detected" },
            },
          ],
        },
      ],
    });

    const vulns = parseSarifFindings(sarif);
    expect(vulns).toHaveLength(2);
    expect(vulns[0].id).toBe("python.lang.security.audit.eval-detected");
    expect(vulns[0].severity).toBe("high");
    expect(vulns[0].file).toBe("app/main.py");
    expect(vulns[0].line).toBe(42);
    expect(vulns[1].severity).toBe("medium");
  });

  it("returns empty array for invalid SARIF", () => {
    expect(parseSarifFindings("not json")).toEqual([]);
  });
});

describe("parseSyftSpdxJson", () => {
  it("parses SPDX JSON for SBOM entries", () => {
    const spdx = JSON.stringify({
      packages: [
        { name: "lodash", versionInfo: "4.17.21" },
        { name: "@types/node", versionInfo: "20.0.0" },
        { name: "golang.org/x/crypto", version: "0.14.0" },
      ],
    });
    const entries = parseSyftSpdxJson(spdx);
    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("lodash");
    expect(entries[0].version).toBe("4.17.21");
    expect(entries[1].type).toBe("npm"); // starts with @
    expect(entries[2].type).toBe("go");
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseSyftSpdxJson("not json")).toEqual([]);
  });
});

describe("parseGrypeJson", () => {
  it("parses Grype JSON vulnerability output", () => {
    const json = JSON.stringify({
      matches: [
        {
          vulnerability: {
            id: "CVE-2023-1234",
            severity: "Critical",
            description: "RCE in package X",
          },
        },
        {
          vulnerability: {
            id: "CVE-2023-5678",
            severity: "Low",
            description: "Info disclosure",
          },
        },
      ],
    });
    const vulns = parseGrypeJson(json);
    expect(vulns).toHaveLength(2);
    expect(vulns[0].id).toBe("CVE-2023-1234");
    expect(vulns[0].severity).toBe("critical");
    expect(vulns[1].severity).toBe("low");
  });
});

describe("runSecurityScan", () => {
  it("semgrep not available → warning, not failure", async () => {
    const sandbox = {
      execCommand: vi.fn().mockResolvedValue(
        ok(makeExecResult({ exitCode: 1, stdout: "" })), // `which semgrep` fails
      ),
    } as unknown as SandboxSupervisor;

    const result = await runSecurityScan(
      {
        containerId: "c1",
        changedFiles: ["src/a.ts"],
        workingDir: "/workspace",
        timeoutMs: 300_000,
      },
      sandbox,
    );

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    // Should have warning commands for unavailable tools
    const skippedCommands = data.commandsRun.filter((c) =>
      c.command.includes("not available"),
    );
    expect(skippedCommands.length).toBeGreaterThanOrEqual(1);
  });

  it("only changed files are scanned (not whole repo)", async () => {
    let semgrepCmd = "";
    const sandbox = {
      execCommand: vi
        .fn()
        .mockImplementation(
          async (_instance: unknown, cmd: readonly string[]) => {
            const cmdStr = cmd.join(" ");
            if (cmdStr.includes("which semgrep")) {
              return ok(
                makeExecResult({ exitCode: 0, stdout: "/usr/bin/semgrep" }),
              );
            }
            if (
              cmdStr.includes("which syft") ||
              cmdStr.includes("which grype")
            ) {
              return ok(makeExecResult({ exitCode: 1 }));
            }
            if (cmdStr.includes("cat /tmp/semgrep.sarif")) {
              return ok(
                makeExecResult({
                  stdout: JSON.stringify({ runs: [{ results: [] }] }),
                }),
              );
            }
            if (cmd[0] === "sh" && (cmd[2] ?? "").includes("semgrep ")) {
              semgrepCmd = cmd[2] ?? "";
              return ok(makeExecResult());
            }
            return ok(makeExecResult());
          },
        ),
    } as unknown as SandboxSupervisor;

    const result = await runSecurityScan(
      {
        containerId: "c1",
        changedFiles: ["src/a.ts", "src/b.ts"],
        workingDir: "/workspace",
        timeoutMs: 300_000,
      },
      sandbox,
    );

    expect(result.isOk()).toBe(true);
    // The semgrep command should include the specific file names
    expect(semgrepCmd).toContain("src/a.ts");
    expect(semgrepCmd).toContain("src/b.ts");
  });

  it("scanner not available → skipped with warning", async () => {
    // All tools unavailable
    const sandbox = {
      execCommand: vi
        .fn()
        .mockResolvedValue(ok(makeExecResult({ exitCode: 1 }))),
    } as unknown as SandboxSupervisor;

    const result = await runSecurityScan(
      {
        containerId: "c1",
        changedFiles: ["src/a.ts"],
        workingDir: "/workspace",
        timeoutMs: 300_000,
      },
      sandbox,
    );

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    // All three scanners should be skipped
    expect(data.commandsRun.length).toBe(3);
    for (const cmd of data.commandsRun) {
      expect(cmd.command).toContain("not available");
    }
    // No vulnerabilities found since nothing ran
    expect(data.securityScanResults.totalFindings).toBe(0);
  });
});
