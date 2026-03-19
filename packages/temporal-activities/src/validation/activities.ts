/**
 * Temporal activity wrapper for validation activities.
 * Converts Result<T, FactoryError> → ApplicationFailure for Temporal.
 */

import type {
  FactoryError,
  PolicyConfig,
  TrustedBaseContext,
  ValidatorControlFileEdit,
} from "@software-factory/core";
import type { DbInstance } from "@software-factory/db";
import { ApplicationFailure, heartbeat } from "@temporalio/activity";
import type Docker from "dockerode";
import { createSandboxSupervisor } from "../sandbox/supervisor.js";
import type {
  BlastRadiusResult,
  BlastRadiusConfig as InternalBlastRadiusConfig,
} from "./blast-radius.js";
import { computeBlastRadius } from "./blast-radius.js";
import type { LintRunResult, LintRunnerConfig } from "./lint-runner.js";
import { runLinter } from "./lint-runner.js";
import type {
  SecurityScanConfig,
  SecurityScanResult,
} from "./security-scanner.js";
import { runSecurityScan } from "./security-scanner.js";
import type { TestRunResult, TestRunnerConfig } from "./test-runner.js";
import { runTests } from "./test-runner.js";
import {
  type ValidatorBoundaryConfig,
  checkValidatorBoundary,
} from "./validator-boundary.js";

function toApplicationFailure(error: FactoryError): ApplicationFailure {
  return error.retryable
    ? ApplicationFailure.retryable(error.message, error.code)
    : ApplicationFailure.nonRetryable(error.message, error.code);
}

export interface ValidationActivityDeps {
  readonly docker: Docker;
  readonly db: DbInstance;
}

export function createValidationActivities(deps: ValidationActivityDeps) {
  const sandbox = createSandboxSupervisor(deps.docker);

  return {
    async runTests(config: TestRunnerConfig): Promise<TestRunResult> {
      heartbeat("running tests");
      const result = await runTests(config, sandbox);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async runLinter(config: LintRunnerConfig): Promise<LintRunResult> {
      heartbeat("running linter");
      const result = await runLinter(config, sandbox);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async runSecurityScan(
      config: SecurityScanConfig,
    ): Promise<SecurityScanResult> {
      heartbeat("running security scan");
      const result = await runSecurityScan(config, sandbox);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async computeBlastRadius(config: {
      indexVersionId: string;
      changedFiles: readonly string[];
      policies: readonly PolicyConfig[];
    }): Promise<BlastRadiusResult> {
      heartbeat("computing blast radius");
      const internalConfig: InternalBlastRadiusConfig = {
        ...config,
        db: deps.db,
      };
      const result = await computeBlastRadius(internalConfig);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async checkValidatorBoundary(config: {
      containerId: string;
      trustedContext: TrustedBaseContext;
    }): Promise<ValidatorControlFileEdit[]> {
      heartbeat("checking validator boundary");
      const internalConfig: ValidatorBoundaryConfig = {
        ...config,
        sandbox,
      };
      const result = await checkValidatorBoundary(internalConfig);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async getChangedFiles(
      containerId: string,
      baseSha: string,
    ): Promise<string[]> {
      const instance = {
        containerId,
        phase: "execution" as const,
        labels: {},
      };
      const result = await sandbox.execCommand(instance, [
        "git",
        "diff",
        "--name-only",
        `${baseSha}..HEAD`,
      ]);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value.stdout
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    },
  };
}
