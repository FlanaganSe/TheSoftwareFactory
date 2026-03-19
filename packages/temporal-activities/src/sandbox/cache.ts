import { createHash } from "node:crypto";
import type { FactoryResult } from "@software-factory/core";
import type { SetupContract } from "@software-factory/core";
import type Docker from "dockerode";
import { err, ok } from "neverthrow";
import type { SecretBindings } from "./secrets.js";

export interface SandboxCacheConfig {
  readonly setupContract: SetupContract;
  readonly secrets: SecretBindings;
}

export function computeCacheKey(config: SandboxCacheConfig): string {
  const payload = JSON.stringify({
    image: config.setupContract.image,
    setup: config.setupContract.setup,
    maintenance: config.setupContract.maintenance,
    secretBindings: Object.keys(config.secrets.setupOnly).sort(),
    healthCheck: config.setupContract.health_check,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function safeSlug(repoSlug: string): string {
  return repoSlug.replaceAll("/", "-");
}

function cacheImageTag(repoSlug: string, cacheKey: string): string {
  return `factory-cache/${safeSlug(repoSlug)}:${cacheKey}`;
}

export async function getCachedImage(
  docker: Docker,
  cacheKey: string,
  repoSlug: string,
): Promise<FactoryResult<string | null>> {
  const tag = cacheImageTag(repoSlug, cacheKey);
  try {
    const image = docker.getImage(tag);
    await image.inspect();
    return ok(tag);
  } catch (error) {
    if (
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 404
    ) {
      return ok(null);
    }
    return err({
      code: "sandbox_failure" as const,
      message: `Failed to check cached image: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    });
  }
}

export async function cacheContainer(
  docker: Docker,
  containerId: string,
  cacheKey: string,
  repoSlug: string,
  secretNames?: readonly string[],
): Promise<FactoryResult<string>> {
  const slug = safeSlug(repoSlug);
  const repo = `factory-cache/${slug}`;
  try {
    const container = docker.getContainer(containerId);
    await container.pause();
    // Clear any env vars that might have leaked into the container layer
    // Belt-and-suspenders: exec-injected secrets shouldn't persist, but clear anyway
    const changes = (secretNames ?? []).map((name) => `ENV ${name}=`);
    try {
      await container.commit({
        repo,
        tag: cacheKey,
        comment: `Factory environment cache for ${repoSlug}`,
        changes,
      });
    } finally {
      await container.unpause();
    }
    return ok(`${repo}:${cacheKey}`);
  } catch (error) {
    return err({
      code: "sandbox_failure" as const,
      message: `Failed to cache container: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    });
  }
}

export async function invalidateCache(
  docker: Docker,
  repoSlug: string,
): Promise<FactoryResult<void>> {
  const slug = safeSlug(repoSlug);
  const prefix = `factory-cache/${slug}`;
  try {
    const images = await docker.listImages({
      filters: { reference: [prefix] },
    });
    for (const imageInfo of images) {
      const image = docker.getImage(imageInfo.Id);
      await image.remove({ force: true });
    }
    return ok(undefined);
  } catch (error) {
    return err({
      code: "sandbox_failure" as const,
      message: `Failed to invalidate cache: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    });
  }
}
