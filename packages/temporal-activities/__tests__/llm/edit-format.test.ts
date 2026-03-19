import { describe, expect, it } from "vitest";
import { applyEdit, applyEditSafe } from "../../src/llm/edit-format.js";

describe("applyEdit", () => {
  it("exact match: replaces found text correctly", () => {
    const content = "function hello() {\n  return 'world';\n}";
    const result = applyEdit(content, "return 'world'", "return 'universe'");
    expect(result.success).toBe(true);
    expect(result.matchType).toBe("exact");
    expect(result.newContent).toContain("return 'universe'");
    expect(result.matchLocation).toBeDefined();
    expect(result.matchLocation?.line).toBe(2);
  });

  it("exact match: not found returns error with closest match info", () => {
    const content = "function hello() {\n  return 'world';\n}";
    const result = applyEdit(content, "return 'xyz'", "return 'abc'");
    expect(result.success).toBe(false);
    expect(result.matchType).toBe("none");
    expect(result.error).toContain("No match found");
    expect(result.newContent).toBe(content);
  });

  it("whitespace-tolerant: trailing whitespace in file matches search without it", () => {
    const content = "hello world   \ngoodbye world   ";
    // Search without trailing whitespace — should match via whitespace normalization
    const result = applyEdit(content, "hello world\ngoodbye world", "replaced");
    expect(result.success).toBe(true);
    // May match exact or whitespace depending on normalization
    expect(["exact", "whitespace", "fuzzy"]).toContain(result.matchType);
  });

  it("whitespace-tolerant: different line endings (CRLF vs LF)", () => {
    const content = "line1\r\nline2\r\nline3";
    const result = applyEdit(content, "line1\nline2\nline3", "replaced");
    expect(result.success).toBe(true);
    expect(result.matchType).toBe("whitespace");
  });

  it("whitespace-tolerant: trailing whitespace differences", () => {
    const content = "hello   \nworld   ";
    const result = applyEdit(content, "hello\nworld", "bye\nworld");
    expect(result.success).toBe(true);
    expect(result.matchType).toBe("whitespace");
  });

  it("fuzzy match: >90% similarity matches with correct type", () => {
    const original =
      "function calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}";
    // Change a few characters to stay above 90% similarity
    const search =
      "function calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.cost, 0);\n}";
    const result = applyEdit(
      original,
      search,
      "function calculateTotal() { return 0; }",
    );
    expect(result.success).toBe(true);
    expect(result.matchType).toBe("fuzzy");
  });

  it("fuzzy match: <90% similarity does not match", () => {
    const content = "function hello() { return 'world'; }";
    const result = applyEdit(
      content,
      "completely different text that has nothing in common",
      "replacement",
    );
    expect(result.success).toBe(false);
    expect(result.matchType).toBe("none");
  });

  it("multiple occurrences: only first occurrence is replaced", () => {
    const content = "aaa\nbbb\naaa\nbbb";
    const result = applyEdit(content, "aaa", "ccc");
    expect(result.success).toBe(true);
    expect(result.matchType).toBe("exact");
    // Should replace first 'aaa' only
    expect(result.newContent).toBe("ccc\nbbb\naaa\nbbb");
  });

  it("empty search string returns error", () => {
    const result = applyEdit("some content", "", "replacement");
    expect(result.success).toBe(false);
    expect(result.matchType).toBe("none");
    expect(result.error).toContain("Search string cannot be empty");
  });

  it("whole content replacement works", () => {
    const content = "old content";
    const result = applyEdit(content, "old content", "new content");
    expect(result.success).toBe(true);
    expect(result.newContent).toBe("new content");
  });

  it("unicode content is handled correctly", () => {
    const content = "const greeting = '你好世界';\nconst emoji = '🚀';";
    const result = applyEdit(content, "'你好世界'", "'Hello World'");
    expect(result.success).toBe(true);
    expect(result.matchType).toBe("exact");
    expect(result.newContent).toContain("'Hello World'");
  });

  it("error message includes closest match and line numbers", () => {
    const content =
      "function longFunctionName(param1, param2) {\n  return param1 + param2;\n}";
    const result = applyEdit(
      content,
      "totally different content that has no overlap whatsoever with the file",
      "replaced",
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // The closest match info should reference similarity
    expect(result.error).toMatch(/similar/i);
  });

  it("preserves content before and after the match", () => {
    const content = "before\ntarget\nafter";
    const result = applyEdit(content, "target", "replaced");
    expect(result.success).toBe(true);
    expect(result.newContent).toBe("before\nreplaced\nafter");
  });
});

describe("applyEditSafe", () => {
  it("wraps successful edit in Ok result", () => {
    const result = applyEditSafe("hello world", "hello", "goodbye");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.success).toBe(true);
      expect(result.value.newContent).toBe("goodbye world");
    }
  });

  it("wraps failed match in Ok result (not Err)", () => {
    const result = applyEditSafe("hello world", "xyz", "abc");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.success).toBe(false);
    }
  });
});
