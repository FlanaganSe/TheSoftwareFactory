import type { FactoryError } from "@software-factory/core";
import { ApplicationFailure } from "@temporalio/activity";
import type Docker from "dockerode";
import type { ExecResult } from "./exec.js";
import { createSandboxSupervisor } from "./supervisor.js";
import type { SandboxConfig, SandboxInstance } from "./supervisor.js";

function toApplicationFailure(error: FactoryError): ApplicationFailure {
  return error.retryable
    ? ApplicationFailure.retryable(error.message, error.code)
    : ApplicationFailure.nonRetryable(error.message, error.code);
}

export function createSandboxActivities(docker: Docker) {
  const supervisor = createSandboxSupervisor(docker);

  return {
    async provisionSandbox(config: SandboxConfig): Promise<SandboxInstance> {
      const result = await supervisor.provisionSandbox(config);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async execInSandbox(
      containerId: string,
      cmd: string[],
      secrets?: Record<string, string>,
    ): Promise<ExecResult> {
      const instance: SandboxInstance = {
        containerId,
        phase: "execution",
        labels: {},
      };

      const result = secrets
        ? await supervisor.execWithSecrets(instance, cmd, secrets)
        : await supervisor.execCommand(instance, cmd);

      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async destroySandbox(containerId: string): Promise<void> {
      const instance: SandboxInstance = {
        containerId,
        phase: "cleanup",
        labels: {},
      };
      const result = await supervisor.destroySandbox(instance);
      if (result.isErr()) throw toApplicationFailure(result.error);
    },

    async cleanupOrphans(): Promise<number> {
      const result = await supervisor.cleanupOrphans();
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },
  };
}
