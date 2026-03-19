import { describe, expect, it } from "vitest";
import { PHASE_PERMISSIONS } from "../src/github/credential-broker.js";
import type { TaskPhase } from "../src/github/credential-broker.js";

describe("PHASE_PERMISSIONS", () => {
  const ALL_PHASES: TaskPhase[] = [
    "capability_scan",
    "implementation",
    "pr_creation",
    "pr_tracking",
    "merge",
  ];

  it("has entries for all 5 phases", () => {
    for (const phase of ALL_PHASES) {
      expect(PHASE_PERMISSIONS[phase]).toBeDefined();
    }
  });

  it("capability_scan has read-only permissions", () => {
    const perms = PHASE_PERMISSIONS.capability_scan;
    expect(perms.contents).toBe("read");
    expect(perms.administration).toBe("read");
    expect(perms.checks).toBe("read");
    // Should not have write permissions
    expect(Object.values(perms).every((v) => v === "read")).toBe(true);
  });

  it("implementation has minimal write permissions", () => {
    const perms = PHASE_PERMISSIONS.implementation;
    expect(perms.contents).toBe("write");
    expect(perms.checks).toBe("write");
    // Should not have pull_requests permission
    expect(perms.pull_requests).toBeUndefined();
  });

  it("pr_creation has contents and pull_requests write", () => {
    const perms = PHASE_PERMISSIONS.pr_creation;
    expect(perms.contents).toBe("write");
    expect(perms.pull_requests).toBe("write");
  });

  it("pr_tracking has read-only permissions", () => {
    const perms = PHASE_PERMISSIONS.pr_tracking;
    expect(perms.pull_requests).toBe("read");
    expect(perms.checks).toBe("read");
    expect(perms.statuses).toBe("read");
    expect(Object.values(perms).every((v) => v === "read")).toBe(true);
  });

  it("merge has contents and pull_requests write", () => {
    const perms = PHASE_PERMISSIONS.merge;
    expect(perms.contents).toBe("write");
    expect(perms.pull_requests).toBe("write");
  });

  it("each phase has minimal permissions (no extras)", () => {
    // Verify each phase doesn't have unnecessary permissions
    expect(Object.keys(PHASE_PERMISSIONS.capability_scan).length).toBe(3);
    expect(Object.keys(PHASE_PERMISSIONS.implementation).length).toBe(2);
    expect(Object.keys(PHASE_PERMISSIONS.pr_creation).length).toBe(2);
    expect(Object.keys(PHASE_PERMISSIONS.pr_tracking).length).toBe(3);
    expect(Object.keys(PHASE_PERMISSIONS.merge).length).toBe(2);
  });
});
