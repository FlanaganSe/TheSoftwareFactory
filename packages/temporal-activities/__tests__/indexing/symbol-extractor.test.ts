import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { extractSymbols } from "../../src/indexing/symbol-extractor.js";
import type { SupportedLanguage, Tag } from "../../src/indexing/types.js";

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
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
  java: "tree-sitter-java/tree-sitter-java.wasm",
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

function extract(source: string, lang: SupportedLanguage): Tag[] {
  const { rootNode, language } = parse(source, lang);
  return extractSymbols(rootNode, language, lang, "test.ts");
}

function findDef(tags: Tag[], name: string): Tag | undefined {
  return tags.find((t) => t.kind === "def" && t.name === name);
}

describe("extractSymbols", () => {
  describe("TypeScript", () => {
    it("extracts function declarations", () => {
      const tags = extract("function hello(): void {}", "typescript");
      const fn = assertDefined(findDef(tags, "hello"));
      expect(fn.symbolKind).toBe("function");
    });

    it("extracts class declarations", () => {
      const tags = extract("class MyClass {}", "typescript");
      const cls = assertDefined(findDef(tags, "MyClass"));
      expect(cls.symbolKind).toBe("class");
    });

    it("extracts interface declarations", () => {
      const tags = extract("interface MyInterface { x: number }", "typescript");
      const iface = assertDefined(findDef(tags, "MyInterface"));
      expect(iface.symbolKind).toBe("interface");
    });

    it("extracts type alias declarations", () => {
      const tags = extract("type MyType = string | number", "typescript");
      const typ = assertDefined(findDef(tags, "MyType"));
      expect(typ.symbolKind).toBe("type");
    });

    it("extracts exported const variables", () => {
      const tags = extract('export const FOO = "bar"', "typescript");
      const v = assertDefined(findDef(tags, "FOO"));
      expect(v.isExported).toBe(true);
    });

    it("extracts arrow function exports", () => {
      const tags = extract(
        "export const handler = (x: number) => x * 2",
        "typescript",
      );
      const fn = assertDefined(findDef(tags, "handler"));
      expect(fn.symbolKind).toBe("function");
      expect(fn.isExported).toBe(true);
    });

    it("extracts method definitions", () => {
      const tags = extract("class Foo { bar() {} }", "typescript");
      const method = assertDefined(findDef(tags, "bar"));
      expect(method.symbolKind).toBe("method");
    });

    it("detects export keyword", () => {
      const tags = extract(
        "export function foo() {}\nfunction bar() {}",
        "typescript",
      );
      const exported = assertDefined(findDef(tags, "foo"));
      const notExported = assertDefined(findDef(tags, "bar"));
      expect(exported.isExported).toBe(true);
      expect(notExported.isExported).toBe(false);
    });

    it("extracts line numbers correctly", () => {
      const source = "// comment\nfunction hello() {}\n// more\nclass Foo {}";
      const tags = extract(source, "typescript");
      const fn = assertDefined(findDef(tags, "hello"));
      const cls = assertDefined(findDef(tags, "Foo"));
      expect(fn.line).toBe(2); // 1-based
      expect(cls.line).toBe(4);
    });
  });

  describe("JavaScript", () => {
    it("extracts function and class", () => {
      const tags = extract(
        'function hello() {}\nclass Foo {}\nconst x = "y"',
        "javascript",
      );
      expect(findDef(tags, "hello")).toBeDefined();
      expect(findDef(tags, "Foo")).toBeDefined();
    });
  });

  describe("Python", () => {
    it("extracts function def and class def", () => {
      const tags = extract(
        "def hello():\n    pass\n\nclass Foo:\n    pass",
        "python",
      );
      const fn = assertDefined(findDef(tags, "hello"));
      const cls = assertDefined(findDef(tags, "Foo"));
      expect(fn.symbolKind).toBe("function");
      expect(cls.symbolKind).toBe("class");
    });

    it("extracts async def", () => {
      const tags = extract("async def fetch_data():\n    pass", "python");
      // async def is also a function_definition in tree-sitter-python
      const fn = findDef(tags, "fetch_data");
      expect(fn).toBeDefined();
    });
  });

  describe("Go", () => {
    it("extracts function declarations", () => {
      const tags = extract("package main\n\nfunc Hello() {}", "go");
      const fn = assertDefined(findDef(tags, "Hello"));
      expect(fn.symbolKind).toBe("function");
    });

    it("detects exported symbols via capitalization", () => {
      const tags = extract(
        "package main\n\nfunc Hello() {}\nfunc hello() {}",
        "go",
      );
      const exported = assertDefined(findDef(tags, "Hello"));
      const notExported = assertDefined(findDef(tags, "hello"));
      expect(exported.isExported).toBe(true);
      expect(notExported.isExported).toBe(false);
    });

    it("extracts type declarations", () => {
      const tags = extract("package main\n\ntype MyStruct struct {}", "go");
      const typ = assertDefined(findDef(tags, "MyStruct"));
      expect(typ.symbolKind).toBe("type");
    });
  });

  describe("error handling", () => {
    it("handles malformed files gracefully (returns empty or partial)", () => {
      // Severely malformed TypeScript — should not throw
      const tags = extract("function {{{ invalid syntax @@@ }", "typescript");
      // May extract some symbols from partial AST, or may be empty
      expect(Array.isArray(tags)).toBe(true);
    });
  });

  describe("references", () => {
    it("extracts call references in TypeScript", () => {
      const tags = extract("function foo() {}\nfoo()", "typescript");
      const refs = tags.filter((t) => t.kind === "ref" && t.name === "foo");
      expect(refs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
