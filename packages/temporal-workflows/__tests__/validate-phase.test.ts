import type { TrustedBaseContext } from "@software-factory/core";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let testEnv: TestWorkflowEnvironment;

function makeTrustedContext(): TrustedBaseContext {
  return {
    baseSha: "abc123",
    setupContract: null,
    policySnapshot: [],
    behavioralControlFiles: {},
    validationCommandSources: ["npm test", "npx biome check ."],
    capturedAt: new Date().toISOString(),
  };
}

const baseInput = {
  taskId: "t1",
  repoId: "repo-1",
  containerId: "container-1",
  trustedContext: makeTrustedContext(),
  changedFiles: ["src/index.ts"],
  indexVersionId: "v1",
  policies: [],
};

const allPassActivities = {
  checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
  insertAuditEntry: async () => {},
  getChangedFiles: async () => ["src/index.ts"],
  runTests: async () => ({
    testResults: {
      passed: 5,
      failed: 0,
      skipped: 0,
      newTests: [],
      modifiedTests: [],
      deletedTests: [],
      details: [],
    },
    exitCode: 0,
    commandRecord: {
      command: "npm test",
      exitCode: 0,
      durationMs: 3000,
    },
  }),
  runLinter: async () => ({
    lintResults: { errorCount: 0, warningCount: 1, details: [] },
    exitCode: 0,
    commandRecord: {
      command: "npx biome check .",
      exitCode: 0,
      durationMs: 1000,
    },
  }),
  runSecurityScan: async () => ({
    securityScanResults: {
      vulnerabilities: [],
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
    },
    commandsRun: [],
  }),
  computeBlastRadius: async () => ({
    blastRadius: { files: 1, packages: 1 },
    filesChanged: ["src/index.ts"],
    packagesAffected: ["src"],
    protectedSurfaceEdits: [],
    migrationImpact: {
      hasMigrations: false,
      migrationFiles: [],
      schemaChanges: [],
    },
    revertabilityClass: "clean_revert" as const,
  }),
  checkValidatorBoundary: async () => [],
};

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("validatePhase", () => {
  it("all checks pass → result.passed = true", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-validate-pass",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: allPassActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("validatePhase", {
        taskQueue: "test-validate-pass",
        workflowId: "validate-pass-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.taskId).toBe("t1");
      expect(result.passed).toBe(true);
      expect(result.validationResult.testExitCode).toBe(0);
      expect(result.validationResult.lintExitCode).toBe(0);
      expect(result.validationResult.trustedContextUsed).toBe(true);
    });
  });

  it("test failure → result.passed = false", async () => {
    const failActivities = {
      ...allPassActivities,
      runTests: async () => ({
        testResults: {
          passed: 3,
          failed: 2,
          skipped: 0,
          newTests: [],
          modifiedTests: [],
          deletedTests: [],
          details: [
            { name: "test_a", status: "failed" as const, errorMessage: "oops" },
          ],
        },
        exitCode: 1,
        commandRecord: {
          command: "npm test",
          exitCode: 1,
          durationMs: 3000,
        },
      }),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-validate-fail",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: failActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("validatePhase", {
        taskQueue: "test-validate-fail",
        workflowId: "validate-fail-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.passed).toBe(false);
      expect(result.validationResult.testExitCode).toBe(1);
      expect(result.validationResult.testResults.failed).toBe(2);
    });
  });

  it("security vulnerability → result includes findings", async () => {
    const vulnActivities = {
      ...allPassActivities,
      runSecurityScan: async () => ({
        securityScanResults: {
          vulnerabilities: [
            {
              id: "CVE-2023-1234",
              severity: "critical" as const,
              description: "RCE",
            },
          ],
          totalFindings: 1,
          criticalCount: 1,
          highCount: 0,
        },
        commandsRun: [],
      }),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-validate-vuln",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: vulnActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("validatePhase", {
        taskQueue: "test-validate-vuln",
        workflowId: "validate-vuln-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.passed).toBe(false); // Critical vuln → fails
      expect(result.validationResult.criticalVulnerabilities).toBe(1);
    });
  });

  it("kill switch checked before validation starts", async () => {
    const killActivities = {
      ...allPassActivities,
      checkKillSwitch: async () => ({
        killed: true,
        scope: "global" as const,
      }),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-validate-kill",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: killActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("validatePhase", {
        taskQueue: "test-validate-kill",
        workflowId: "validate-kill-1",
        retry: { maximumAttempts: 1 },
        args: [baseInput],
      });

      try {
        await handle.result();
        expect.unreachable("should have thrown");
      } catch {
        // Kill switch properly prevented validation
      }
    });
  });

  it("validator boundary edits included in result", async () => {
    const boundaryActivities = {
      ...allPassActivities,
      checkValidatorBoundary: async () => [
        {
          path: "vitest.config.ts",
          baseRefHash: "aaa",
          workspaceHash: "bbb",
          category: "test_config" as const,
        },
      ],
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-validate-boundary",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: boundaryActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("validatePhase", {
        taskQueue: "test-validate-boundary",
        workflowId: "validate-boundary-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.validationResult.validatorControlFileEdits).toHaveLength(1);
      expect(result.validationResult.validatorControlFileEdits[0].path).toBe(
        "vitest.config.ts",
      );
    });
  });

  it("validation result contains expected summary", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-validate-summary",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: allPassActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("validatePhase", {
        taskQueue: "test-validate-summary",
        workflowId: "validate-summary-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.validationResult.summary).toContain("Tests:");
      expect(result.validationResult.summary).toContain("Lint:");
      expect(result.validationResult.summary).toContain("Security:");
      expect(result.validationResult.summary).toContain("Blast radius:");
    });
  });
});
