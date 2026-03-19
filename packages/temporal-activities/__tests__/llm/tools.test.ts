import type { PolicyConfig } from "@software-factory/core";
import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { type ToolDeps, createAgentTools } from "../../src/llm/tools.js";
import type {
  ExecResult,
  SandboxInstance,
  SandboxSupervisor,
} from "../../src/sandbox/index.js";

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: "", stderr: "", durationMs: 10, ...overrides };
}

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    sandbox: {
      execCommand: vi.fn().mockResolvedValue(ok(makeExecResult())),
    } as unknown as SandboxSupervisor,
    instance: {
      containerId: "test",
      phase: "execution",
      labels: {},
    } as SandboxInstance,
    policies: [],
    flaggedEdits: [],
    auditLog: [],
    ...overrides,
  };
}

function policy(
  type: "read_exclusion" | "edit_deny" | "edit_protected",
  pattern: string,
  extra: Partial<PolicyConfig> = {},
): PolicyConfig {
  return {
    repoId: "test",
    name: "test-policy",
    policyType: type,
    protectionClass: type === "edit_protected" ? "flagged" : null,
    pathPatterns: [pattern],
    autonomyLevel: "L1",
    requiresApproval: type === "edit_protected",
    approverRole: type === "edit_protected" ? "admin" : null,
    isActive: true,
    ...extra,
  };
}

async function run(
  tool: { execute?: unknown },
  args: Record<string, unknown>,
): Promise<string> {
  const fn = tool.execute as (
    input: Record<string, unknown>,
    opts: { toolCallId: string; messages: never[]; abortSignal: AbortSignal },
  ) => Promise<string>;
  if (!fn) throw new Error("No execute");
  return fn(args, {
    toolCallId: "t",
    messages: [] as never[],
    abortSignal: undefined as unknown as AbortSignal,
  });
}

describe("createAgentTools", () => {
  describe("file_read", () => {
    it("returns content on allowed path", async () => {
      const deps = makeDeps();
      (deps.sandbox.execCommand as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(makeExecResult({ stdout: "file content" })),
      );
      const result = await run(createAgentTools(deps).file_read, {
        path: "src/a.ts",
      });
      expect(result).toBe("file content");
      expect(deps.auditLog).toHaveLength(1);
    });

    it("returns DENIED on denied path", async () => {
      const deps = makeDeps({
        policies: [policy("read_exclusion", "secrets/**")],
      });
      const result = await run(createAgentTools(deps).file_read, {
        path: "secrets/api.key",
      });
      expect(result).toContain("DENIED");
    });
  });

  describe("file_write", () => {
    it("writes successfully on allowed path", async () => {
      const deps = makeDeps();
      const result = await run(createAgentTools(deps).file_write, {
        path: "src/new.ts",
        content: "const x = 1;",
      });
      expect(result).toContain("OK:");
    });

    it("returns DENIED on denied path", async () => {
      const deps = makeDeps({ policies: [policy("edit_deny", "*.lock")] });
      const result = await run(createAgentTools(deps).file_write, {
        path: "package.lock",
        content: "...",
      });
      expect(result).toContain("DENIED");
    });

    it("flags edit for evidence on protected path", async () => {
      const deps = makeDeps({
        policies: [policy("edit_protected", "config/**")],
      });
      await run(createAgentTools(deps).file_write, {
        path: "config/app.toml",
        content: "new config",
      });
      expect(deps.flaggedEdits).toHaveLength(1);
      expect(deps.flaggedEdits[0]?.path).toBe("config/app.toml");
    });
  });

  describe("file_edit", () => {
    it("applies exact match edit correctly", async () => {
      const deps = makeDeps();
      const mock = deps.sandbox.execCommand as ReturnType<typeof vi.fn>;
      mock
        .mockResolvedValueOnce(
          ok(makeExecResult({ stdout: "const x = 1;\nconst y = 2;" })),
        )
        .mockResolvedValueOnce(ok(makeExecResult()));
      const result = await run(createAgentTools(deps).file_edit, {
        path: "a.ts",
        search: "const x = 1;",
        replace: "const x = 42;",
      });
      expect(result).toContain("OK:");
      expect(result).toContain("exact");
    });

    it("progressive match: tries exact, then whitespace, then fuzzy", async () => {
      const deps = makeDeps();
      const mock = deps.sandbox.execCommand as ReturnType<typeof vi.fn>;
      // File with extra whitespace
      mock
        .mockResolvedValueOnce(
          ok(makeExecResult({ stdout: "  const x  =  1 ;" })),
        )
        .mockResolvedValueOnce(ok(makeExecResult()));
      const result = await run(createAgentTools(deps).file_edit, {
        path: "a.ts",
        search: "const x = 1 ;",
        replace: "const x = 42;",
      });
      expect(result).toContain("OK:");
    });
  });

  describe("search_codebase", () => {
    it("returns symbols, governance-filtered", async () => {
      const deps = makeDeps({
        policies: [policy("read_exclusion", "secrets/**")],
        searchSymbols: vi.fn().mockResolvedValue([
          { name: "pub", kind: "function", filePath: "src/api.ts", line: 10 },
          { name: "sec", kind: "function", filePath: "secrets/k.ts", line: 5 },
        ]),
      });
      const result = await run(createAgentTools(deps).search_codebase, {
        query: "fn",
      });
      expect(result).toContain("pub");
      expect(result).not.toContain("sec");
    });
  });

  describe("run_command", () => {
    it("executes allowed command", async () => {
      const deps = makeDeps();
      const mock = deps.sandbox.execCommand as ReturnType<typeof vi.fn>;
      mock
        .mockResolvedValueOnce(ok(makeExecResult({ stdout: "" })))
        .mockResolvedValueOnce(
          ok(makeExecResult({ stdout: "output", exitCode: 0 })),
        )
        .mockResolvedValueOnce(ok(makeExecResult({ stdout: "" })));
      const result = await run(createAgentTools(deps).run_command, {
        command: "npm test",
      });
      expect(result).toContain("exit_code: 0");
    });

    it("rejects disallowed command", async () => {
      const result = await run(createAgentTools(makeDeps()).run_command, {
        command: "rm -rf /",
      });
      expect(result).toContain("DENIED");
    });

    it("reverts changes on denied path modification", async () => {
      const deps = makeDeps({ policies: [policy("edit_deny", ".env*")] });
      const mock = deps.sandbox.execCommand as ReturnType<typeof vi.fn>;
      mock
        .mockResolvedValueOnce(ok(makeExecResult({ stdout: "" })))
        .mockResolvedValueOnce(ok(makeExecResult({ stdout: "done" })))
        .mockResolvedValueOnce(
          ok(makeExecResult({ stdout: ".env\nsrc/ok.ts" })),
        )
        .mockResolvedValueOnce(ok(makeExecResult()));
      const result = await run(createAgentTools(deps).run_command, {
        command: "node setup.js",
      });
      expect(result).toContain("REVERTED");
    });

    it("succeeds on allowed path changes", async () => {
      const deps = makeDeps();
      const mock = deps.sandbox.execCommand as ReturnType<typeof vi.fn>;
      mock
        .mockResolvedValueOnce(ok(makeExecResult({ stdout: "" })))
        .mockResolvedValueOnce(ok(makeExecResult({ stdout: "built" })))
        .mockResolvedValueOnce(ok(makeExecResult({ stdout: "dist/out.js" })));
      const result = await run(createAgentTools(deps).run_command, {
        command: "tsc",
      });
      expect(result).toContain("changed_files: dist/out.js");
    });
  });

  describe("list_files", () => {
    it("returns listing, governance-filtered", async () => {
      const deps = makeDeps({
        policies: [policy("read_exclusion", "secrets/**")],
      });
      (deps.sandbox.execCommand as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(
          makeExecResult({ stdout: "src/main.ts\nsecrets/key.pem\nREADME.md" }),
        ),
      );
      const result = await run(createAgentTools(deps).list_files, {
        path: ".",
        recursive: true,
      });
      expect(result).toContain("src/main.ts");
      expect(result).not.toContain("secrets/key.pem");
    });
  });

  describe("search_text", () => {
    it("returns matches, governance-filtered", async () => {
      const deps = makeDeps({
        policies: [policy("read_exclusion", "secrets/**")],
      });
      (deps.sandbox.execCommand as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(makeExecResult({ stdout: "src/a.ts:5:KEY\nsecrets/k.ts:1:SECRET" })),
      );
      const result = await run(createAgentTools(deps).search_text, {
        pattern: "KEY",
        path: ".",
        glob: "*.ts",
      });
      expect(result).toContain("src/a.ts");
      expect(result).not.toContain("secrets/k.ts");
    });
  });

  describe("audit logging", () => {
    it("all tools log audit entries", async () => {
      const deps = makeDeps();
      (deps.sandbox.execCommand as ReturnType<typeof vi.fn>).mockResolvedValue(
        ok(makeExecResult({ stdout: "x" })),
      );
      const tools = createAgentTools(deps);
      await run(tools.file_read, { path: "a.ts" });
      await run(tools.list_files, { path: ".", recursive: false });
      expect(deps.auditLog).toHaveLength(2);
      expect(deps.auditLog[0]?.toolName).toBe("file_read");
      expect(deps.auditLog[1]?.toolName).toBe("list_files");
      for (const e of deps.auditLog) expect(e.timestamp).toBeTruthy();
    });
  });
});
