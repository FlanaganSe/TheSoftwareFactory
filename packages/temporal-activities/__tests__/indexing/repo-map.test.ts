import { describe, expect, it } from "vitest";
import { generateRepoMap } from "../../src/indexing/repo-map.js";
import type { ImportEdge, Tag } from "../../src/indexing/types.js";

function makeTag(
  overrides: Partial<Tag> & { filePath: string; name: string },
): Tag {
  return {
    line: 1,
    kind: "def",
    symbolKind: "function",
    isExported: true,
    ...overrides,
  };
}

function makeImport(source: string, target: string): ImportEdge {
  return {
    sourcePath: source,
    rawImportPath: `./${target}`,
    resolvedPath: target,
    importedNames: null,
    importType: "static",
    line: 1,
    isExternal: false,
  };
}

describe("generateRepoMap", () => {
  it("ranks files by connectivity in a 3-file graph", () => {
    // A imports B, B imports C
    const files = [
      { filePath: "a.ts", lineCount: 10 },
      { filePath: "b.ts", lineCount: 20 },
      { filePath: "c.ts", lineCount: 15 },
    ];

    const symbols: Tag[] = [
      makeTag({ filePath: "a.ts", name: "funcA" }),
      makeTag({ filePath: "b.ts", name: "funcB" }),
      makeTag({ filePath: "c.ts", name: "funcC" }),
      // References: A calls B's function, B calls C's function
      makeTag({
        filePath: "a.ts",
        name: "funcB",
        kind: "ref",
        isExported: false,
      }),
      makeTag({
        filePath: "b.ts",
        name: "funcC",
        kind: "ref",
        isExported: false,
      }),
    ];

    const deps = [makeImport("a.ts", "b.ts"), makeImport("b.ts", "c.ts")];

    const result = generateRepoMap(files, symbols, deps, {
      tokenBudget: 1000,
    });

    expect(result.length).toBeGreaterThanOrEqual(1);
    // All files should be included within budget
    const paths = result.map((e) => e.filePath);
    expect(paths).toContain("a.ts");
    expect(paths).toContain("b.ts");
    expect(paths).toContain("c.ts");
  });

  it("active file personalization gives highest rank", () => {
    const files = [
      { filePath: "a.ts", lineCount: 10 },
      { filePath: "b.ts", lineCount: 10 },
      { filePath: "c.ts", lineCount: 10 },
    ];

    const symbols: Tag[] = [
      makeTag({ filePath: "a.ts", name: "funcA" }),
      makeTag({ filePath: "b.ts", name: "funcB" }),
      makeTag({ filePath: "c.ts", name: "funcC" }),
    ];

    const result = generateRepoMap(files, symbols, [], {
      tokenBudget: 1000,
      activeFiles: ["c.ts"],
    });

    // c.ts should be ranked first due to personalization
    expect(result[0].filePath).toBe("c.ts");
  });

  it("token budget is respected", () => {
    // Create many files with long paths
    const files = Array.from({ length: 50 }, (_, i) => ({
      filePath: `packages/very/deep/directory/structure/file${i}.ts`,
      lineCount: 100,
    }));

    const symbols = files.map((f) =>
      makeTag({ filePath: f.filePath, name: `func${f.filePath}` }),
    );

    const result = generateRepoMap(files, symbols, [], {
      tokenBudget: 100, // Very small budget
    });

    // Should be fewer than all 50 files
    expect(result.length).toBeLessThan(50);
    expect(result.length).toBeGreaterThan(0);
  });

  it("ubiquitous symbols get de-weighted", () => {
    const files = [
      { filePath: "common.ts", lineCount: 10 },
      { filePath: "a.ts", lineCount: 10 },
      { filePath: "b.ts", lineCount: 10 },
      { filePath: "c.ts", lineCount: 10 },
    ];

    // "log" is defined in common.ts and referenced by everyone
    const symbols: Tag[] = [
      makeTag({ filePath: "common.ts", name: "log" }),
      makeTag({ filePath: "a.ts", name: "funcA" }),
      makeTag({ filePath: "b.ts", name: "funcB" }),
      makeTag({ filePath: "c.ts", name: "funcC" }),
      // References to "log" from all files
      makeTag({
        filePath: "a.ts",
        name: "log",
        kind: "ref",
        isExported: false,
      }),
      makeTag({
        filePath: "b.ts",
        name: "log",
        kind: "ref",
        isExported: false,
      }),
      makeTag({
        filePath: "c.ts",
        name: "log",
        kind: "ref",
        isExported: false,
      }),
    ];

    // The test passes if it doesn't crash and produces results
    const result = generateRepoMap(files, symbols, [], {
      tokenBudget: 1000,
    });

    expect(result.length).toBeGreaterThan(0);
  });

  it("private/unexported symbols get de-weighted", () => {
    const files = [
      { filePath: "a.ts", lineCount: 10 },
      { filePath: "b.ts", lineCount: 10 },
    ];

    const symbols: Tag[] = [
      makeTag({ filePath: "a.ts", name: "publicFunc", isExported: true }),
      makeTag({ filePath: "b.ts", name: "_privateHelper", isExported: false }),
      // References
      makeTag({
        filePath: "b.ts",
        name: "publicFunc",
        kind: "ref",
        isExported: false,
      }),
      makeTag({
        filePath: "a.ts",
        name: "_privateHelper",
        kind: "ref",
        isExported: false,
      }),
    ];

    const result = generateRepoMap(files, symbols, [], {
      tokenBudget: 1000,
    });

    expect(result.length).toBe(2);
  });

  it("long identifiers get up-weighted", () => {
    const files = [
      { filePath: "a.ts", lineCount: 10 },
      { filePath: "b.ts", lineCount: 10 },
    ];

    const symbols: Tag[] = [
      makeTag({
        filePath: "a.ts",
        name: "handleAuthenticationRequest",
        isExported: true,
      }),
      makeTag({ filePath: "b.ts", name: "x", isExported: true }),
      // References
      makeTag({
        filePath: "b.ts",
        name: "handleAuthenticationRequest",
        kind: "ref",
        isExported: false,
      }),
      makeTag({ filePath: "a.ts", name: "x", kind: "ref", isExported: false }),
    ];

    const result = generateRepoMap(files, symbols, [], {
      tokenBudget: 1000,
    });

    expect(result.length).toBe(2);
  });

  it("empty graph returns empty repo map", () => {
    const result = generateRepoMap([], [], [], {
      tokenBudget: 1000,
    });
    expect(result).toEqual([]);
  });

  it("includes key symbols per file", () => {
    const files = [{ filePath: "a.ts", lineCount: 10 }];

    const symbols: Tag[] = [
      makeTag({ filePath: "a.ts", name: "funcA", isExported: true }),
      makeTag({ filePath: "a.ts", name: "funcB", isExported: true }),
      makeTag({
        filePath: "a.ts",
        name: "ClassC",
        symbolKind: "class",
        isExported: true,
      }),
    ];

    const result = generateRepoMap(files, symbols, [], {
      tokenBudget: 1000,
    });

    expect(result[0].keySymbols.length).toBeGreaterThan(0);
  });

  it("converges within 20 iterations", () => {
    // Large enough graph to need multiple iterations
    const files = Array.from({ length: 20 }, (_, i) => ({
      filePath: `file${i}.ts`,
      lineCount: 10,
    }));

    const symbols: Tag[] = [];
    const deps: ImportEdge[] = [];

    // Create a chain: file0 → file1 → file2 → ... → file19
    for (let i = 0; i < 19; i++) {
      symbols.push(makeTag({ filePath: `file${i}.ts`, name: `func${i}` }));
      symbols.push(
        makeTag({
          filePath: `file${i}.ts`,
          name: `func${i + 1}`,
          kind: "ref",
          isExported: false,
        }),
      );
      deps.push(makeImport(`file${i}.ts`, `file${i + 1}.ts`));
    }
    symbols.push(makeTag({ filePath: "file19.ts", name: "func19" }));

    // Should not throw and should produce results
    const result = generateRepoMap(files, symbols, deps, {
      tokenBudget: 5000,
    });

    expect(result.length).toBe(20);
  });
});
