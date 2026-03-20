import { describe, expect, it } from "vitest";
import { STATE_COLORS, STATE_LABELS, RISK_COLORS, SEVERITY_COLORS, CIRCUIT_COLORS } from "../colors";
import { TASK_STATES } from "@software-factory/core";

describe("STATE_COLORS", () => {
  it("has a color class for every task state", () => {
    for (const state of TASK_STATES) {
      expect(STATE_COLORS[state]).toBeDefined();
      expect(STATE_COLORS[state].length).toBeGreaterThan(0);
    }
  });

  it("uses correct color for failed state", () => {
    expect(STATE_COLORS.failed).toContain("red");
  });

  it("uses correct color for approved state", () => {
    expect(STATE_COLORS.approved).toContain("green");
  });

  it("uses correct color for evidence_ready state", () => {
    expect(STATE_COLORS.evidence_ready).toContain("purple");
  });
});

describe("STATE_LABELS", () => {
  it("has a label for every task state", () => {
    for (const state of TASK_STATES) {
      expect(STATE_LABELS[state]).toBeDefined();
      expect(STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });

  it("uses human-readable labels", () => {
    expect(STATE_LABELS.evidence_ready).toBe("Awaiting Review");
    expect(STATE_LABELS.in_progress).toBe("In Progress");
    expect(STATE_LABELS.changes_requested).toBe("Changes Requested");
  });
});

describe("RISK_COLORS", () => {
  it("has colors for all risk levels", () => {
    expect(RISK_COLORS.low).toContain("green");
    expect(RISK_COLORS.medium).toContain("yellow");
    expect(RISK_COLORS.high).toContain("red");
  });
});

describe("SEVERITY_COLORS", () => {
  it("has colors for all severity levels", () => {
    expect(SEVERITY_COLORS.critical).toContain("red");
    expect(SEVERITY_COLORS.high).toContain("red");
    expect(SEVERITY_COLORS.medium).toContain("yellow");
    expect(SEVERITY_COLORS.low).toContain("gray");
  });
});

describe("CIRCUIT_COLORS", () => {
  it("has colors for all circuit states", () => {
    expect(CIRCUIT_COLORS.closed).toContain("green");
    expect(CIRCUIT_COLORS.open).toContain("red");
    expect(CIRCUIT_COLORS.half_open).toContain("yellow");
  });
});
