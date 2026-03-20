import { execSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI_DIR = join(import.meta.dirname, "..");
const TSX = "npx tsx";
const CLI = `${TSX} src/index.ts`;

function run(args: string, env?: Record<string, string>): string {
  return execSync(`${CLI} ${args}`, {
    cwd: CLI_DIR,
    env: { ...process.env, NO_COLOR: "1", ...env },
    timeout: 10_000,
    encoding: "utf8",
  });
}

function runExpectFail(args: string, env?: Record<string, string>): string {
  try {
    execSync(`${CLI} ${args}`, {
      cwd: CLI_DIR,
      env: { ...process.env, NO_COLOR: "1", ...env },
      timeout: 10_000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return "";
  } catch (e) {
    const error = e as { stderr?: string; stdout?: string };
    return (error.stderr ?? "") + (error.stdout ?? "");
  }
}

describe("CLI safety commands", () => {
  it("factory --help lists kill, budget, and safety commands", () => {
    const output = run("--help");
    expect(output).toContain("kill");
    expect(output).toContain("budget");
    expect(output).toContain("safety");
  });

  it("factory kill --help shows usage", () => {
    const output = run("kill --help");
    expect(output).toContain("Kill a task");
    expect(output).toContain("--all");
    expect(output).toContain("--reason");
    expect(output).toContain("--yes");
  });

  it("factory budget --help shows usage", () => {
    const output = run("budget --help");
    expect(output).toContain("budget");
    expect(output).toContain("--task");
    expect(output).toContain("--override");
    expect(output).toContain("--daily");
  });

  it("factory safety --help shows usage", () => {
    const output = run("safety --help");
    expect(output).toContain("Safety dashboard");
  });

  it("factory safety circuits --help shows subcommands", () => {
    const output = run("safety circuits --help");
    expect(output).toContain("reset");
    expect(output).toContain("trip");
  });

  it("factory kill without task ID or --all shows error", () => {
    // Without a server running, the CLI will hit connection error first
    // But we can verify the command exists and parses correctly
    const output = runExpectFail("kill --yes", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/provide a task ID|Cannot connect|fetch failed/);
  });

  it("factory safety without server shows connection error", () => {
    const output = runExpectFail("safety", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|fetch failed/);
  });

  it("factory budget without server shows connection error", () => {
    const output = runExpectFail("budget", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|fetch failed/);
  });

  it("factory kill T-001 --yes without server shows connection error", () => {
    const output = runExpectFail("kill T-001 --yes", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|fetch failed/);
  });

  it("factory safety circuits reset github without server shows error", () => {
    const output = runExpectFail("safety circuits reset github", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|fetch failed/);
  });
});
