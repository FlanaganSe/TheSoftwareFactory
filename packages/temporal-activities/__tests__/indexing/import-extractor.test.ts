import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import {
  extractImports,
  resolveRelativeImport,
} from "../../src/indexing/import-extractor.js";
import type {
  ImportEdge,
  SupportedLanguage,
} from "../../src/indexing/types.js";

function assertDefined<T>(
  val: T | undefined | null,
  msg = "expected value to be defined",
): T {
  expect(val, msg).toBeDefined();
  return val as T;
}

const require = createRequire(import.meta.url);

const WASM_PATHS: Record<string, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
};

const languages = new Map<string, Language>();

beforeAll(async () => {
  await Parser.init();
  for (const [name, wasmPath] of Object.entries(WASM_PATHS)) {
    const lang = await Language.load(require.resolve(wasmPath));
    languages.set(name, lang);
  }
});

function parse(source: string, langName: string) {
  const lang = assertDefined(
    languages.get(langName),
    `language "${langName}" not loaded`,
  );
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = assertDefined(parser.parse(source), "parser returned null tree");
  const result = { rootNode: tree.rootNode, language: lang };
  parser.delete();
  return result;
}

function extract(
  source: string,
  lang: SupportedLanguage,
  filePath = "src/index.ts",
  repoRoot = "/tmp/test-repo",
): ImportEdge[] {
  const { rootNode, language } = parse(source, lang);
  return extractImports(rootNode, language, lang, filePath, repoRoot);
}

describe("extractImports", () => {
  describe("TypeScript", () => {
    it("extracts static import", () => {
      const edges = extract('import { x } from "./foo"', "typescript");
      expect(edges.length).toBeGreaterThanOrEqual(1);
      const imp = assertDefined(edges.find((e) => e.rawImportPath === "./foo"));
      expect(imp.importType).toBe("static");
    });

    it("extracts type-only import", () => {
      const edges = extract('import type { T } from "./types"', "typescript");
      const imp = assertDefined(
        edges.find((e) => e.rawImportPath === "./types"),
      );
      expect(imp.importType).toBe("type_only");
    });

    it("extracts dynamic import", () => {
      const edges = extract('const x = await import("./lazy")', "typescript");
      const imp = assertDefined(
        edges.find((e) => e.rawImportPath === "./lazy"),
      );
      expect(imp.importType).toBe("dynamic");
    });

    it("extracts re-exports", () => {
      const edges = extract('export { x } from "./other"', "typescript");
      const imp = edges.find((e) => e.rawImportPath === "./other");
      expect(imp).toBeDefined();
    });

    it("detects external packages (no dependency edge)", () => {
      const edges = extract('import lodash from "lodash"', "typescript");
      const imp = assertDefined(
        edges.find((e) => e.rawImportPath === "lodash"),
      );
      expect(imp.isExternal).toBe(true);
    });
  });

  describe("JavaScript", () => {
    it("extracts require()", () => {
      const edges = extract('const x = require("./module")', "javascript");
      const imp = assertDefined(
        edges.find((e) => e.rawImportPath === "./module"),
      );
      expect(imp.importType).toBe("static");
    });
  });

  describe("Python", () => {
    it("extracts import statement", () => {
      const edges = extract("import os", "python", "src/main.py");
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });

    it("extracts from-import statement", () => {
      const edges = extract(
        "from os.path import join",
        "python",
        "src/main.py",
      );
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Go", () => {
    it("extracts single import", () => {
      const edges = extract(
        'package main\n\nimport "fmt"\n\nfunc main() {}',
        "go",
        "main.go",
      );
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });

    it("detects external packages", () => {
      const edges = extract(
        'package main\n\nimport "github.com/pkg/errors"\n\nfunc main() {}',
        "go",
        "main.go",
      );
      const imp = assertDefined(
        edges.find((e) => e.rawImportPath === "github.com/pkg/errors"),
      );
      expect(imp.isExternal).toBe(true);
    });
  });
});

describe("resolveRelativeImport", () => {
  const testRoot = join(tmpdir(), `import-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(testRoot, "src"), { recursive: true });
    mkdirSync(join(testRoot, "src", "utils"), { recursive: true });
    writeFileSync(join(testRoot, "src", "foo.ts"), "export const x = 1;");
    writeFileSync(join(testRoot, "src", "utils", "index.ts"), "export {};");
  });

  it("resolves ./foo → foo.ts", () => {
    const result = resolveRelativeImport("./foo", "src/index.ts", testRoot);
    expect(result).toBe("src/foo.ts");
  });

  it("resolves ./utils → utils/index.ts", () => {
    const result = resolveRelativeImport("./utils", "src/index.ts", testRoot);
    expect(result).toBe("src/utils/index.ts");
  });

  it("returns null for unresolvable imports", () => {
    const result = resolveRelativeImport(
      "./nonexistent",
      "src/index.ts",
      testRoot,
    );
    expect(result).toBeNull();
  });

  // Cleanup
  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });
});
