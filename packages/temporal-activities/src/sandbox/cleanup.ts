import type { FactoryResult } from "@software-factory/core";
import type Docker from "dockerode";
import { err, ok } from "neverthrow";

export async function destroyContainer(
  docker: Docker,
  containerId: string,
): Promise<FactoryResult<void>> {
  try {
    const container = docker.getContainer(containerId);
    try {
      await container.stop({ t: 10 });
    } catch (error) {
      // Container may already be stopped — that's fine
      const statusCode =
        error instanceof Error && "statusCode" in error
          ? (error as { statusCode: number }).statusCode
          : 0;
      if (statusCode !== 304 && statusCode !== 404) {
        throw error;
      }
    }
    await container.remove({ force: true, v: true });
    return ok(undefined);
  } catch (error) {
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 0;
    // Container already removed — treat as success
    if (statusCode === 404) return ok(undefined);

    return err({
      code: "sandbox_failure" as const,
      message: `Failed to destroy container: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    });
  }
}

export async function cleanupOrphans(
  docker: Docker,
  maxAgeMinutes = 60,
): Promise<FactoryResult<number>> {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: ["com.factory.task-id"],
      },
    });

    const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
    let removed = 0;

    for (const containerInfo of containers) {
      const createdAt = containerInfo.Labels["com.factory.created-at"];
      if (!createdAt) continue;

      const createdTime = new Date(createdAt).getTime();
      if (Number.isNaN(createdTime) || createdTime > cutoff) continue;

      const result = await destroyContainer(docker, containerInfo.Id);
      if (result.isOk()) removed++;
    }

    return ok(removed);
  } catch (error) {
    return err({
      code: "sandbox_failure" as const,
      message: `Failed to cleanup orphans: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    });
  }
}
