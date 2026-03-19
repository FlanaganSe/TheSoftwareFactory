import type { PolicyConfig } from "@software-factory/core";
import { evaluatePath } from "@software-factory/core";
import { tool } from "ai";
import { z } from "zod";
import type { SandboxInstance, SandboxSupervisor } from "../sandbox/index.js";
import { applyEdit } from "./edit-format.js";

export interface FlaggedEdit {
  readonly path: string;
  readonly reason: string;
}

export interface AuditLogEntry {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result: string;
  readonly timestamp: string;
}

export interface ToolDeps {
  readonly sandbox: SandboxSupervisor;
  readonly instance: SandboxInstance;
  readonly policies: readonly PolicyConfig[];
  readonly flaggedEdits: FlaggedEdit[];
  readonly auditLog: AuditLogEntry[];
  readonly searchSymbols?: (
    query: string,
    kind?: string,
  ) => Promise<
    readonly {
      readonly name: string;
      readonly kind: string;
      readonly filePath: string;
      readonly line: number;
      readonly signature?: string;
    }[]
  >;
}

const ALLOWED_COMMANDS = new Set([
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "node",
  "tsx",
  "ts-node",
  "tsc",
  "biome",
  "eslint",
  "prettier",
  "vitest",
  "jest",
  "pytest",
  "go",
  "git",
  "cat",
  "head",
  "tail",
  "wc",
  "sort",
  "find",
  "ls",
  "tree",
  "grep",
  "rg",
  "make",
  "cargo",
  "rustc",
  "python",
  "python3",
  "pip",
]);

function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function logAudit(
  deps: ToolDeps,
  toolName: string,
  args: Record<string, unknown>,
  result: string,
): void {
  deps.auditLog.push({
    toolName,
    args,
    result: result.length > 500 ? `${result.substring(0, 500)}...` : result,
    timestamp: new Date().toISOString(),
  });
}

function filterResultsByGovernance(
  lines: string,
  policies: readonly PolicyConfig[],
): string {
  return lines
    .split("\n")
    .filter((line) => {
      const pathMatch = /^([^\s:]+)/.exec(line);
      if (!pathMatch?.[1]) return true;
      const decision = evaluatePath(pathMatch[1], "read", policies);
      return decision.allowed;
    })
    .join("\n");
}

export function createAgentTools(deps: ToolDeps) {
  return {
    file_read: tool({
      description: "Read the contents of a file",
      inputSchema: z.object({
        path: z.string().describe("File path relative to workspace root"),
      }),
      execute: async ({ path }) => {
        const decision = evaluatePath(path, "read", deps.policies);
        if (!decision.allowed) {
          const msg = `DENIED: ${decision.reason}`;
          logAudit(deps, "file_read", { path }, msg);
          return msg;
        }
        const result = await deps.sandbox.execCommand(deps.instance, [
          "cat",
          path,
        ]);
        const output = result.isOk()
          ? result.value.stdout
          : `ERROR: ${result.error.message}`;
        logAudit(deps, "file_read", { path }, output);
        return output;
      },
    }),

    file_write: tool({
      description: "Write content to a file (creates or overwrites)",
      inputSchema: z.object({
        path: z.string().describe("File path relative to workspace root"),
        content: z.string().describe("Content to write"),
      }),
      execute: async ({ path, content }) => {
        const decision = evaluatePath(path, "write", deps.policies);
        if (!decision.allowed) {
          const msg = `DENIED: ${decision.reason}`;
          logAudit(deps, "file_write", { path }, msg);
          return msg;
        }
        if (decision.requiresApproval) {
          deps.flaggedEdits.push({
            path,
            reason: decision.reason ?? "protected",
          });
        }

        const encoded = Buffer.from(content).toString("base64");
        const safePath = shellEscape(path);
        const result = await deps.sandbox.execCommand(deps.instance, [
          "sh",
          "-c",
          `mkdir -p "$(dirname '${safePath}')" && echo '${encoded}' | base64 -d > '${safePath}'`,
        ]);
        const output = result.isOk()
          ? `OK: wrote ${content.length} bytes to ${path}`
          : `ERROR: ${result.error.message}`;
        logAudit(deps, "file_write", { path }, output);
        return output;
      },
    }),

    file_edit: tool({
      description:
        "Edit a file using search/replace. Provide the exact text to find and the replacement.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to workspace root"),
        search: z.string().describe("Exact text to find in the file"),
        replace: z.string().describe("Text to replace it with"),
      }),
      execute: async ({ path, search, replace }) => {
        const decision = evaluatePath(path, "write", deps.policies);
        if (!decision.allowed) {
          const msg = `DENIED: ${decision.reason}`;
          logAudit(deps, "file_edit", { path, search, replace }, msg);
          return msg;
        }
        if (decision.requiresApproval) {
          deps.flaggedEdits.push({
            path,
            reason: decision.reason ?? "protected",
          });
        }

        const readResult = await deps.sandbox.execCommand(deps.instance, [
          "cat",
          path,
        ]);
        if (readResult.isErr()) {
          const msg = `ERROR: Could not read file: ${readResult.error.message}`;
          logAudit(deps, "file_edit", { path }, msg);
          return msg;
        }

        const editResult = applyEdit(readResult.value.stdout, search, replace);
        if (!editResult.success) {
          const msg = `EDIT_FAILED: ${editResult.error ?? "Unknown error"} (matchType: ${editResult.matchType})`;
          logAudit(deps, "file_edit", { path, search, replace }, msg);
          return msg;
        }

        const encoded = Buffer.from(editResult.newContent).toString("base64");
        const safePath = shellEscape(path);
        const writeResult = await deps.sandbox.execCommand(deps.instance, [
          "sh",
          "-c",
          `echo '${encoded}' | base64 -d > '${safePath}'`,
        ]);
        if (writeResult.isErr()) {
          const msg = `ERROR: Write failed: ${writeResult.error.message}`;
          logAudit(deps, "file_edit", { path }, msg);
          return msg;
        }

        const msg = `OK: Applied ${editResult.matchType} match at line ${editResult.matchLocation?.line ?? "?"}`;
        logAudit(deps, "file_edit", { path, search, replace }, msg);
        return msg;
      },
    }),

    search_codebase: tool({
      description: "Search the code index for symbols, types, or patterns",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        kind: z
          .enum([
            "function",
            "class",
            "interface",
            "type",
            "variable",
            "export",
          ])
          .optional()
          .describe("Symbol kind to filter by"),
      }),
      execute: async ({ query, kind }) => {
        if (!deps.searchSymbols) {
          logAudit(
            deps,
            "search_codebase",
            { query, kind },
            "Code index not available",
          );
          return "Code index not available";
        }

        const results = await deps.searchSymbols(query, kind);
        const filtered = results.filter((r) => {
          const decision = evaluatePath(r.filePath, "read", deps.policies);
          return decision.allowed;
        });

        const output =
          filtered.length === 0
            ? "No symbols found"
            : filtered
                .slice(0, 20)
                .map(
                  (r) =>
                    `${r.filePath}:${r.line} ${r.kind} ${r.name}${r.signature ? ` — ${r.signature}` : ""}`,
                )
                .join("\n");

        logAudit(deps, "search_codebase", { query, kind }, output);
        return output;
      },
    }),

    run_command: tool({
      description: "Run a shell command in the workspace",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        const firstToken = command.trim().split(/\s+/)[0] ?? "";
        if (!ALLOWED_COMMANDS.has(firstToken)) {
          const msg = `DENIED: Command '${firstToken}' is not in the allowlist`;
          logAudit(deps, "run_command", { command }, msg);
          return msg;
        }

        // Capture pre-execution state
        const preResult = await deps.sandbox.execCommand(deps.instance, [
          "git",
          "diff",
          "--name-only",
        ]);
        const prePaths = new Set(
          preResult.isOk()
            ? preResult.value.stdout
                .trim()
                .split("\n")
                .filter((p) => p.length > 0)
            : [],
        );

        // Execute
        const execResult = await deps.sandbox.execCommand(deps.instance, [
          "sh",
          "-c",
          command,
        ]);
        if (execResult.isErr()) {
          const msg = `ERROR: ${execResult.error.message}`;
          logAudit(deps, "run_command", { command }, msg);
          return msg;
        }

        // Post-execution diff check
        const postResult = await deps.sandbox.execCommand(deps.instance, [
          "git",
          "diff",
          "--name-only",
        ]);
        const postPaths = postResult.isOk()
          ? postResult.value.stdout
              .trim()
              .split("\n")
              .filter((p) => p.length > 0)
          : [];

        const newlyChanged = postPaths.filter((p) => !prePaths.has(p));

        // Check governance on changed paths
        for (const changedPath of newlyChanged) {
          const decision = evaluatePath(changedPath, "write", deps.policies);
          if (!decision.allowed) {
            // Revert changes
            await deps.sandbox.execCommand(deps.instance, [
              "git",
              "checkout",
              "--",
              ...newlyChanged,
            ]);
            const msg = `REVERTED: Command changed denied path '${changedPath}': ${decision.reason}`;
            logAudit(deps, "run_command", { command }, msg);
            return msg;
          }
        }

        const { stdout, stderr, exitCode } = execResult.value;
        const output = [
          `exit_code: ${exitCode}`,
          stdout ? `stdout: ${stdout}` : "",
          stderr ? `stderr: ${stderr}` : "",
          newlyChanged.length > 0
            ? `changed_files: ${newlyChanged.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        logAudit(deps, "run_command", { command }, output);
        return output;
      },
    }),

    list_files: tool({
      description: "List files in a directory",
      inputSchema: z.object({
        path: z.string().default(".").describe("Directory path"),
        recursive: z.boolean().default(false).describe("List recursively"),
      }),
      execute: async ({ path, recursive }) => {
        const cmd = recursive
          ? ["find", path, "-type", "f"]
          : ["ls", "-1", path];
        const result = await deps.sandbox.execCommand(deps.instance, cmd);
        if (result.isErr()) {
          const msg = `ERROR: ${result.error.message}`;
          logAudit(deps, "list_files", { path, recursive }, msg);
          return msg;
        }

        const output = filterResultsByGovernance(
          result.value.stdout,
          deps.policies,
        );
        logAudit(deps, "list_files", { path, recursive }, output);
        return output;
      },
    }),

    search_text: tool({
      description: "Search for text patterns in files (like grep/ripgrep)",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern"),
        path: z.string().default(".").describe("Directory to search in"),
        glob: z
          .string()
          .optional()
          .describe("File glob pattern (e.g., '*.ts')"),
      }),
      execute: async ({ pattern, path, glob }) => {
        const cmd = ["grep", "-rn", "--include", glob ?? "*", pattern, path];
        const result = await deps.sandbox.execCommand(deps.instance, cmd);
        if (result.isErr()) {
          const msg =
            result.error.message.includes("exit code") ||
            result.error.message.includes("1")
              ? "No matches found"
              : `ERROR: ${result.error.message}`;
          logAudit(deps, "search_text", { pattern, path, glob }, msg);
          return msg;
        }

        const output = filterResultsByGovernance(
          result.value.stdout,
          deps.policies,
        );
        logAudit(deps, "search_text", { pattern, path, glob }, output);
        return output;
      },
    }),
  };
}
