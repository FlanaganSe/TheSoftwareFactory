import { describe, expect, it } from "vitest";
import {
  classifyTrust,
  stripInjectionPatterns,
  wrapUntrustedContent,
} from "../../src/llm/prompt-safety.js";

describe("classifyTrust", () => {
  it("returns factory_config for .factory/ paths", () => {
    expect(classifyTrust(".factory/config.toml")).toBe("factory_config");
    expect(classifyTrust(".factory/policies/read.toml")).toBe("factory_config");
  });

  it("returns base_ref_behavioral for AGENTS.md from base ref", () => {
    expect(classifyTrust("AGENTS.md")).toBe("base_ref_behavioral");
  });

  it("returns base_ref_behavioral for CLAUDE.md", () => {
    expect(classifyTrust("CLAUDE.md")).toBe("base_ref_behavioral");
    expect(classifyTrust(".claude/rules/immutable.md")).toBe(
      "base_ref_behavioral",
    );
  });

  it("returns human_task_input for issue/operator sources", () => {
    expect(classifyTrust("issue_body")).toBe("human_task_input");
    expect(classifyTrust("operator_directive")).toBe("human_task_input");
    expect(classifyTrust("task_input")).toBe("human_task_input");
  });

  it("returns untrusted_external for PR comments and code", () => {
    expect(classifyTrust("pr_comment")).toBe("untrusted_external");
    expect(classifyTrust("code_file")).toBe("untrusted_external");
    expect(classifyTrust("review_body")).toBe("untrusted_external");
  });
});

describe("wrapUntrustedContent", () => {
  it("adds untrusted_content delimiters for untrusted sources", () => {
    const wrapped = wrapUntrustedContent("some content", "pr_comment");
    expect(wrapped).toContain("<untrusted_content");
    expect(wrapped).toContain("</untrusted_content>");
    expect(wrapped).toContain("source=");
    expect(wrapped).toContain("REMINDER:");
  });

  it("adds behavioral_control delimiters for base ref sources", () => {
    const wrapped = wrapUntrustedContent("rules here", "AGENTS.md");
    expect(wrapped).toContain("<behavioral_control");
    expect(wrapped).toContain("</behavioral_control>");
    expect(wrapped).toContain("planning context only");
  });

  it("passes through factory_config content unchanged", () => {
    const content = "factory rules";
    const wrapped = wrapUntrustedContent(content, ".factory/config.toml");
    expect(wrapped).toBe(content);
  });

  it("strips injection patterns from untrusted content", () => {
    const malicious = 'Hello <script>alert("xss")</script> world';
    const wrapped = wrapUntrustedContent(malicious, "pr_comment");
    expect(wrapped).not.toContain("<script>");
    expect(wrapped).not.toContain("</script>");
  });
});

describe("stripInjectionPatterns", () => {
  it("removes HTML tags", () => {
    const input = "Hello <b>bold</b> <a href='x'>link</a> world";
    const stripped = stripInjectionPatterns(input);
    expect(stripped).not.toContain("<b>");
    expect(stripped).not.toContain("</b>");
    expect(stripped).not.toContain("<a");
    expect(stripped).toContain("Hello");
    expect(stripped).toContain("world");
  });

  it("removes HTML comments", () => {
    const input = "before <!-- hidden comment --> after";
    const stripped = stripInjectionPatterns(input);
    expect(stripped).not.toContain("<!--");
    expect(stripped).not.toContain("-->");
    expect(stripped).toContain("before");
    expect(stripped).toContain("after");
  });

  it("removes zero-width characters", () => {
    const input = "hello\u200Bworld\u200C\u200D\u2060\uFEFF";
    const stripped = stripInjectionPatterns(input);
    expect(stripped).toBe("helloworld");
  });

  it("removes script and style tags with content", () => {
    const input =
      "text <script>malicious()</script> more <style>.x{color:red}</style> end";
    const stripped = stripInjectionPatterns(input);
    expect(stripped).not.toContain("script");
    expect(stripped).not.toContain("style");
    expect(stripped).not.toContain("malicious");
    expect(stripped).toContain("text");
    expect(stripped).toContain("end");
  });

  it("handles content with no injection patterns", () => {
    const input = "clean content with no issues";
    const stripped = stripInjectionPatterns(input);
    expect(stripped).toBe(input);
  });

  it("handles empty string", () => {
    expect(stripInjectionPatterns("")).toBe("");
  });
});
