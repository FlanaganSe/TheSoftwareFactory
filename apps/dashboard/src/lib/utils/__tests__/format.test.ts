import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, truncate } from "../format";

describe("formatCost", () => {
  it("formats cents as dollars", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(100)).toBe("$1.00");
    expect(formatCost(1234)).toBe("$12.34");
    expect(formatCost(50)).toBe("$0.50");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_700_000)).toBe("1h 1m");
  });
});

describe("truncate", () => {
  it("truncates long text", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello world foo", 10)).toBe("hello wor\u2026");
  });
});
