import type { FactoryResult } from "@software-factory/core";
import type Docker from "dockerode";
import { err, ok } from "neverthrow";
import { execInContainer } from "./exec.js";

export function createNetworkManager(docker: Docker) {
  return {
    async disconnectFromBridge(
      containerId: string,
    ): Promise<FactoryResult<void>> {
      try {
        const bridge = docker.getNetwork("bridge");
        await bridge.disconnect({ Container: containerId });
        return ok(undefined);
      } catch (error) {
        return err({
          code: "sandbox_failure" as const,
          message: `Failed to disconnect from bridge: ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        });
      }
    },

    async verifyNetworkIsolation(
      containerId: string,
    ): Promise<FactoryResult<boolean>> {
      try {
        const result = await execInContainer(
          docker,
          containerId,
          ["cat", "/proc/net/route"],
          {},
        );
        if (result.isErr()) return ok(false);

        const lines = result.value.stdout.trim().split("\n");
        // Header line + potentially only loopback = isolated
        // If there's only the header, no routes exist
        return ok(lines.length <= 1);
      } catch (error) {
        return err({
          code: "sandbox_failure" as const,
          message: `Failed to verify network isolation: ${error instanceof Error ? error.message : String(error)}`,
          retryable: false,
        });
      }
    },
  };
}
