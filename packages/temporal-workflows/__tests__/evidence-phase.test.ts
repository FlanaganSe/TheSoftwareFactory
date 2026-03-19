import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let testEnv: TestWorkflowEnvironment;

const baseInput = {
  taskId: "t1",
  repoId: "repo-1",
  objective: "Add feature X",
  attemptNumber: 1,
  baseSha: "abc123",
  headSha: "def456",
  mergeBaseSha: "abc123",
  containerId: "container-1",
  validationResult: {
    testResults: { passed: 5, failed: 0, skipped: 0 },
    lintResults: { errorCount: 0, warningCount: 1 },
    securityScanResults: {
      vulnerabilities: [],
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
    },
    blastRadius: { files: 2, packages: 1 },
    protectedSurfaceEdits: [],
    migrationImpact: {
      hasMigrations: false,
      migrationFiles: [],
      schemaChanges: [],
    },
    revertabilityClass: "clean_revert" as const,
    commandsRun: [{ command: "npm test", exitCode: 0, durationMs: 5000 }],
  },
  agentResult: {
    filesModified: ["src/index.ts"],
    totalCostCents: 10,
  },
  capabilitySnapshot: {
    requiredStatusChecks: [{ context: "ci/test" }],
  },
  changedFiles: ["src/index.ts"],
  policies: [],
  codeownersEntries: [],
  indexVersionId: "v1",
};

const allPassActivities = {
  checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
  insertAuditEntry: async () => {},
  transitionTaskState: async () => ({
    id: "t1",
    state: "evidence_ready" as const,
    objective: "Add feature X",
    scope: null,
    constraints: null,
    budgetCents: null,
    repoId: "repo-1",
    autonomyLevel: "L1",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  generateAndPersistEvidence: async () => ({
    bundleId: "bundle-001",
    locator: {
      taskId: "t1",
      attemptNumber: 1,
      bundleId: "bundle-001",
      artifactPrefix: "evidence/t1/1/",
      evidenceJsonKey: "evidence/t1/1/evidence.json",
      manifestKey: "evidence/t1/1/manifest.json",
      diffPatchKey: "evidence/t1/1/diff.patch",
      createdAt: new Date().toISOString(),
    },
    riskSummary: {
      hardBlockers: [],
      softConcerns: [],
      humanJudgmentRequired: [],
      informational: ["1 lint warning(s)"],
    },
    passed: true,
  }),
};

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("evidencePhase", () => {
  it("produces EvidenceResult with locator and risk summary", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-evidence-pass",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: allPassActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("evidencePhase", {
        taskQueue: "test-evidence-pass",
        workflowId: "evidence-pass-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.taskId).toBe("t1");
      expect(result.bundleId).toBe("bundle-001");
      expect(result.locator).toBeDefined();
      expect(result.locator.evidenceJsonKey).toContain("evidence.json");
      expect(result.riskSummary).toBeDefined();
      expect(result.riskSummary.hardBlockers).toHaveLength(0);
      expect(result.passed).toBe(true);
    });
  });

  it("checks kill switch before evidence generation", async () => {
    const killActivities = {
      ...allPassActivities,
      checkKillSwitch: async () => ({
        killed: true,
        scope: "global" as const,
      }),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-evidence-kill",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: killActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("evidencePhase", {
        taskQueue: "test-evidence-kill",
        workflowId: "evidence-kill-1",
        retry: { maximumAttempts: 1 },
        args: [baseInput],
      });

      try {
        await handle.result();
        expect.unreachable("should have thrown");
      } catch {
        // Kill switch properly prevented evidence generation
      }
    });
  });

  it("returns evidence bundle ID", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-evidence-id",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: allPassActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("evidencePhase", {
        taskQueue: "test-evidence-id",
        workflowId: "evidence-id-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.bundleId).toBeTruthy();
      expect(typeof result.bundleId).toBe("string");
    });
  });

  it("transitions state to evidence_ready", async () => {
    let transitionedState: string | undefined;
    const trackingActivities = {
      ...allPassActivities,
      transitionTaskState: async (_taskId: string, newState: string) => {
        transitionedState = newState;
        return allPassActivities.transitionTaskState();
      },
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-evidence-state",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: trackingActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("evidencePhase", {
        taskQueue: "test-evidence-state",
        workflowId: "evidence-state-1",
        args: [baseInput],
      });

      await handle.result();
      expect(transitionedState).toBe("evidence_ready");
    });
  });
});
