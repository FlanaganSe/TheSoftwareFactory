import { describe, expect, it } from "vitest";
import { createParser, detectLanguage } from "../../src/indexing/parser.js";

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    expect(detectLanguage("src/index.ts")).toBe("typescript");
    expect(detectLanguage("src/App.tsx")).toBe("typescript");
  });

  it("detects JavaScript", () => {
    expect(detectLanguage("src/index.js")).toBe("javascript");
    expect(detectLanguage("src/App.jsx")).toBe("javascript");
    expect(detectLanguage("src/util.mjs")).toBe("javascript");
    expect(detectLanguage("src/util.cjs")).toBe("javascript");
  });

  it("detects Python", () => {
    expect(detectLanguage("src/main.py")).toBe("python");
  });

  it("detects Go", () => {
    expect(detectLanguage("main.go")).toBe("go");
  });

  it("detects Rust", () => {
    expect(detectLanguage("src/main.rs")).toBe("rust");
  });

  it("detects Java", () => {
    expect(detectLanguage("Main.java")).toBe("java");
  });

  it("returns null for unsupported languages", () => {
    expect(detectLanguage("file.rb")).toBeNull();
    expect(detectLanguage("file.cpp")).toBeNull();
    expect(detectLanguage("file.md")).toBeNull();
    expect(detectLanguage("Makefile")).toBeNull();
  });
});

describe("createParser", () => {
  it("WASM parser loads and parses TypeScript correctly", async () => {
    const parser = await createParser();

    const result = await parser.parse(
      "function hello(): void { return; }",
      "typescript",
    );

    expect(result.hasError).toBe(false);
    expect(result.rootNode).toBeDefined();
    expect(result.tree).toBeDefined();

    parser.dispose();
  });

  it("parses JavaScript correctly", async () => {
    const parser = await createParser();

    const result = await parser.parse(
      'function hello() { return "world"; }',
      "javascript",
    );

    expect(result.hasError).toBe(false);
    parser.dispose();
  });

  it("parses Python correctly", async () => {
    const parser = await createParser();

    const result = await parser.parse("def hello():\n    return 42", "python");

    expect(result.hasError).toBe(false);
    parser.dispose();
  });

  it("returns supported languages", async () => {
    const parser = await createParser();
    const langs = parser.getSupportedLanguages();

    expect(langs).toContain("typescript");
    expect(langs).toContain("javascript");
    expect(langs).toContain("python");
    expect(langs).toContain("go");
    expect(langs).toContain("rust");
    expect(langs).toContain("java");

    parser.dispose();
  });

  it("handles parse errors without throwing", async () => {
    const parser = await createParser();

    // Malformed but parseable (tree-sitter is error-recovering)
    const result = await parser.parse("function {{{ invalid", "typescript");

    // tree-sitter will still produce an AST, but hasError will be true
    expect(result.rootNode).toBeDefined();
    expect(result.hasError).toBe(true);

    parser.dispose();
  });
});
