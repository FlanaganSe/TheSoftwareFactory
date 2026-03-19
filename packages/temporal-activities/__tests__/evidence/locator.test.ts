import { describe, expect, it } from "vitest";
import {
  buildLocator,
  withOptionalArtifacts,
} from "../../src/evidence/locator.js";

describe("buildLocator", () => {
  it("produces correct key paths", () => {
    const locator = buildLocator("task-123", 1, "bundle-456");
    expect(locator.taskId).toBe("task-123");
    expect(locator.attemptNumber).toBe(1);
    expect(locator.bundleId).toBe("bundle-456");
    expect(locator.artifactPrefix).toBe("evidence/task-123/1/");
    expect(locator.evidenceJsonKey).toBe("evidence/task-123/1/evidence.json");
    expect(locator.manifestKey).toBe("evidence/task-123/1/manifest.json");
    expect(locator.diffPatchKey).toBe("evidence/task-123/1/diff.patch");
  });

  it("has all artifact keys under the same prefix", () => {
    const locator = buildLocator("task-abc", 2, "bundle-def");
    const prefix = locator.artifactPrefix;
    expect(locator.evidenceJsonKey.startsWith(prefix)).toBe(true);
    expect(locator.manifestKey.startsWith(prefix)).toBe(true);
    expect(locator.diffPatchKey.startsWith(prefix)).toBe(true);
  });

  it("is fully serializable (no functions or classes)", () => {
    const locator = buildLocator("task-xyz", 3, "bundle-uvw");
    const serialized = JSON.stringify(locator);
    const deserialized = JSON.parse(serialized);
    expect(deserialized.taskId).toBe("task-xyz");
    expect(deserialized.attemptNumber).toBe(3);
    expect(deserialized.bundleId).toBe("bundle-uvw");
    expect(deserialized.artifactPrefix).toBe("evidence/task-xyz/3/");
  });
});

describe("withOptionalArtifacts", () => {
  it("adds SARIF key when hasSarif is true", () => {
    const locator = buildLocator("task-1", 1, "b-1");
    const updated = withOptionalArtifacts(locator, { hasSarif: true });
    expect(updated.sarifKey).toBe("evidence/task-1/1/semgrep.sarif");
    expect(updated.sbomKey).toBeUndefined();
  });

  it("adds SBOM key when hasSbom is true", () => {
    const locator = buildLocator("task-1", 1, "b-1");
    const updated = withOptionalArtifacts(locator, { hasSbom: true });
    expect(updated.sbomKey).toBe("evidence/task-1/1/sbom.spdx.json");
  });

  it("adds test log key when hasTestLog is true", () => {
    const locator = buildLocator("task-1", 1, "b-1");
    const updated = withOptionalArtifacts(locator, { hasTestLog: true });
    expect(updated.testLogKey).toBe("evidence/task-1/1/test-output.log");
  });
});
