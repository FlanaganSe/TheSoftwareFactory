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

describe("CLI commands", () => {
  it("factory --help lists all commands", () => {
    const output = run("--help");
    expect(output).toContain("factory");
    expect(output).toContain("status");
    expect(output).toContain("evidence");
    expect(output).toContain("approve");
    expect(output).toContain("reject");
    expect(output).toContain("changes");
    expect(output).toContain("review");
    expect(output).toContain("config");
    expect(output).toContain("health");
  });

  it("factory --version shows version", () => {
    const output = run("--version");
    expect(output.trim()).toBe("0.1.0");
  });

  it("factory config path prints a path", () => {
    const output = run("config path");
    expect(output.trim()).toContain("software-factory");
    expect(output.trim()).toContain("config.toml");
  });

  it("factory config show displays config", () => {
    const output = run("config show", {
      FACTORY_API_URL: "http://test:3000",
    });
    expect(output).toContain("http://test:3000");
    expect(output).toContain("API URL");
  });

  it("factory reject without --reason exits with error", () => {
    const output = runExpectFail("reject some-task-id");
    expect(output).toContain("required");
  });

  it("factory changes without --message exits with error", () => {
    const output = runExpectFail("changes some-task-id");
    expect(output).toContain("required");
  });

  it("factory health without server shows connection error", () => {
    const output = runExpectFail("health", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|factory running|fetch failed/);
  });

  it("factory status without server shows error", () => {
    const output = runExpectFail("status test-id", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|fetch failed/);
  });

  it("factory evidence without server shows error", () => {
    const output = runExpectFail("evidence test-id", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|fetch failed/);
  });

  it("factory approve without server shows error", () => {
    const output = runExpectFail("approve test-id --yes", {
      FACTORY_API_URL: "http://127.0.0.1:1",
    });
    expect(output).toMatch(/Cannot connect|fetch failed/);
  });
});
