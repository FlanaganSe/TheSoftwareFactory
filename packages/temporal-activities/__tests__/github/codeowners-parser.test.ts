import { describe, expect, it } from "vitest";
import {
  getOwners,
  parseCodeowners,
} from "../../src/github/codeowners-parser.js";

describe("parseCodeowners", () => {
  it("returns no entries for empty file", () => {
    const result = parseCodeowners("");
    expect(result.entries).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(0);
  });

  it("returns no entries for comment-only file", () => {
    const result = parseCodeowners("# This is a comment\n# Another comment\n");
    expect(result.entries).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(0);
  });

  it("parses single pattern with one owner", () => {
    const result = parseCodeowners("*.js @owner\n");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      pattern: "*.js",
      owners: ["@owner"],
      lineNumber: 1,
    });
  });

  it("parses multiple owners including email", () => {
    const result = parseCodeowners("*.ts @team1 @team2 user@email.com\n");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].owners).toEqual([
      "@team1",
      "@team2",
      "user@email.com",
    ]);
  });

  it("handles inline comments", () => {
    const result = parseCodeowners("*.go @team # Go files\n");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].pattern).toBe("*.go");
    expect(result.entries[0].owners).toEqual(["@team"]);
  });

  it("handles pattern with no owners (unowned)", () => {
    const result = parseCodeowners("/generated/\n");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].owners).toEqual([]);
  });

  it("reports invalid owner format as parse error", () => {
    const result = parseCodeowners("*.txt notanowner\n");
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.parseErrors[0]).toContain("invalid owner");
  });

  it("parses team owners (@org/team format)", () => {
    const result = parseCodeowners("docs/ @myorg/docs-team\n");
    expect(result.entries[0].owners).toEqual(["@myorg/docs-team"]);
  });

  it("tracks correct line numbers", () => {
    const content = "# comment\n\n*.js @jsowner\n\n*.ts @tsowner\n";
    const result = parseCodeowners(content);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].lineNumber).toBe(3);
    expect(result.entries[1].lineNumber).toBe(5);
  });

  it("handles patterns with leading slash", () => {
    const result = parseCodeowners("/build.sh @devops\n");
    expect(result.entries[0].pattern).toBe("/build.sh");
  });

  it("handles glob patterns with **", () => {
    const result = parseCodeowners("docs/**/*.md @docs-team\n");
    expect(result.entries[0].pattern).toBe("docs/**/*.md");
  });

  it("rejects files over 3 MB", () => {
    const content = "x".repeat(3 * 1024 * 1024 + 1);
    const result = parseCodeowners(content);
    expect(result.entries).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]).toContain("3 MB");
  });

  it("processes files at exactly 3 MB", () => {
    // A file at exactly 3 MB should be processed
    const line = "*.js @owner\n";
    const repeats = Math.floor((3 * 1024 * 1024) / line.length);
    const content = line.repeat(repeats);
    const result = parseCodeowners(content);
    expect(result.entries.length).toBe(repeats);
  });

  it("handles mixed valid and invalid lines", () => {
    const content = "*.js @valid\n*.ts badowner\n*.go @alsovalid\n";
    const result = parseCodeowners(content);
    expect(result.entries).toHaveLength(3);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  it("handles Windows-style line endings", () => {
    const content = "*.js @owner\r\n*.ts @other\r\n";
    const result = parseCodeowners(content);
    expect(result.entries).toHaveLength(2);
  });
});

describe("getOwners", () => {
  it("returns empty array for paths matching no patterns", () => {
    const entries = [{ pattern: "*.js", owners: ["@jsowner"], lineNumber: 1 }];
    const result = getOwners("README.md", entries);
    expect(result).toEqual([]);
  });

  it("applies last-match-wins semantics", () => {
    const entries = [
      { pattern: "*.js", owners: ["@first"], lineNumber: 1 },
      { pattern: "*.js", owners: ["@second"], lineNumber: 2 },
    ];
    const result = getOwners("app.js", entries);
    expect(result).toEqual(["@second"]);
  });

  it("matches nested pattern: docs/**/*.md", () => {
    const entries = [
      {
        pattern: "docs/**/*.md",
        owners: ["@docs-team"],
        lineNumber: 1,
      },
    ];
    const result = getOwners("docs/api/readme.md", entries);
    expect(result).toEqual(["@docs-team"]);
  });

  it("root pattern /build.sh matches build.sh but not scripts/build.sh", () => {
    const entries = [
      { pattern: "/build.sh", owners: ["@devops"], lineNumber: 1 },
    ];
    expect(getOwners("build.sh", entries)).toEqual(["@devops"]);
    expect(getOwners("scripts/build.sh", entries)).toEqual([]);
  });

  it("pattern without slash matches anywhere", () => {
    const entries = [{ pattern: "*.js", owners: ["@jsowner"], lineNumber: 1 }];
    expect(getOwners("src/app.js", entries)).toEqual(["@jsowner"]);
    expect(getOwners("app.js", entries)).toEqual(["@jsowner"]);
  });

  it("case-sensitive matching: README.md does NOT match readme.md", () => {
    const entries = [
      {
        pattern: "README.md",
        owners: ["@docs"],
        lineNumber: 1,
      },
    ];
    expect(getOwners("README.md", entries)).toEqual(["@docs"]);
    expect(getOwners("readme.md", entries)).toEqual([]);
  });

  it("negation patterns: ! prefix is not standard CODEOWNERS (gitignore edge case)", () => {
    // GitHub CODEOWNERS does not support ! negation patterns.
    // A pattern like "!vendor.js" will not match "vendor.js" — it negates.
    // The last matching non-negated pattern wins instead.
    const entries = [
      { pattern: "*.js", owners: ["@jsowner"], lineNumber: 1 },
      { pattern: "!vendor.js", owners: ["@nobody"], lineNumber: 2 },
    ];
    // !vendor.js negates and does NOT match vendor.js, so *.js @jsowner is the last match
    const result = getOwners("vendor.js", entries);
    expect(result).toEqual(["@jsowner"]);
  });

  it("handles leading slash in file path", () => {
    const entries = [{ pattern: "*.ts", owners: ["@tsowner"], lineNumber: 1 }];
    expect(getOwners("/src/index.ts", entries)).toEqual(["@tsowner"]);
  });

  it("unowned entry clears previous ownership", () => {
    const entries = [
      { pattern: "*", owners: ["@all"], lineNumber: 1 },
      { pattern: "vendor/", owners: [], lineNumber: 2 },
    ];
    expect(getOwners("vendor/lib.js", entries)).toEqual([]);
  });
});
