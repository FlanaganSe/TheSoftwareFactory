import type {
  ContainerPhase,
  FactoryResult,
  SetupContract,
} from "@software-factory/core";
import type Docker from "dockerode";
import { err, ok } from "neverthrow";
import { cacheContainer, computeCacheKey, getCachedImage } from "./cache.js";
import {
  cleanupOrphans as cleanupOrphanContainers,
  destroyContainer,
} from "./cleanup.js";
import { execInContainer } from "./exec.js";
import type { ExecOptions, ExecResult } from "./exec.js";
import { createNetworkManager } from "./network.js";
import type { SecretBindings } from "./secrets.js";
import { buildExecEnv, buildToolExecEnv } from "./secrets.js";

export interface SandboxConfig {
  readonly repoPath: string;
  readonly setupContract: SetupContract;
  readonly taskId: string;
  readonly repoSlug: string;
  readonly secrets: SecretBindings;
  readonly resourceLimits?: Partial<ResourceLimits>;
  readonly dockerSocketPath?: string;
}

export interface ResourceLimits {
  readonly memoryBytes: number;
  readonly nanoCpus: number;
  readonly pidsLimit: number;
  readonly tmpSizeMb: number;
  readonly cacheSizeMb: number;
}

const DEFAULT_LIMITS: ResourceLimits = {
  memoryBytes: 4 * 1024 * 1024 * 1024, // 4 GB
  nanoCpus: 2e9, // 2 CPUs
  pidsLimit: 256,
  tmpSizeMb: 512,
  cacheSizeMb: 1024, // 1 GB
};

export interface SandboxInstance {
  readonly containerId: string;
  readonly phase: ContainerPhase;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ResolvedEnvironment {
  readonly config: SandboxConfig;
  readonly cacheKey: string;
  readonly cachedImage: string | null;
  readonly limits: ResourceLimits;
}

function buildLabels(
  taskId: string,
  phase: ContainerPhase,
  repoSlug: string,
): Record<string, string> {
  return {
    "com.factory.task-id": taskId,
    "com.factory.phase": phase,
    "com.factory.repo": repoSlug,
    "com.factory.created-at": new Date().toISOString(),
  };
}

function buildHostConfig(
  repoPath: string,
  limits: ResourceLimits,
  phase: "setup" | "execution",
): Record<string, unknown> {
  return {
    CapDrop: ["ALL"],
    CapAdd:
      phase === "setup"
        ? ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"]
        : [],
    SecurityOpt: ["no-new-privileges:true"],
    ReadonlyRootfs: true,
    Tmpfs: {
      "/tmp": `rw,noexec,nosuid,size=${limits.tmpSizeMb}m`,
      "/run": "rw,noexec,nosuid,size=64m",
      "/home/agent/.cache": `rw,noexec,nosuid,size=${limits.cacheSizeMb}m`,
    },
    Memory: limits.memoryBytes,
    NanoCpus: limits.nanoCpus,
    PidsLimit: limits.pidsLimit,
    NetworkMode: phase === "setup" ? "bridge" : "none",
    Binds: [`${repoPath}:/workspace:rw`],
  };
}

export function createSandboxSupervisor(docker: Docker) {
  const networkManager = createNetworkManager(docker);

  async function resolveEnvironment(
    config: SandboxConfig,
  ): Promise<FactoryResult<ResolvedEnvironment>> {
    const limits = { ...DEFAULT_LIMITS, ...config.resourceLimits };
    const cacheKey = computeCacheKey({
      setupContract: config.setupContract,
      secrets: config.secrets,
    });

    const cachedResult = await getCachedImage(
      docker,
      cacheKey,
      config.repoSlug,
    );
    if (cachedResult.isErr()) return err(cachedResult.error);

    return ok({
      config,
      cacheKey,
      cachedImage: cachedResult.value,
      limits,
    });
  }

  async function createContainer(
    resolved: ResolvedEnvironment,
  ): Promise<FactoryResult<SandboxInstance>> {
    const { config, cachedImage, limits } = resolved;
    const image = cachedImage ?? config.setupContract.image;
    const phase: ContainerPhase = cachedImage ? "maintenance" : "setup";
    // Both setup and maintenance phases need bridge network for outbound access
    const hostPhase = "setup" as const;

    try {
      // Pull image if not cached
      if (!cachedImage) {
        await new Promise<void>((resolve, reject) => {
          docker.pull(
            image,
            (pullErr: Error | null, stream: NodeJS.ReadableStream) => {
              if (pullErr) return reject(pullErr);
              docker.modem.followProgress(
                stream,
                (progressErr: Error | null) => {
                  if (progressErr) return reject(progressErr);
                  resolve();
                },
              );
            },
          );
        });
      }

      const labels = buildLabels(config.taskId, phase, config.repoSlug);
      const hostConfig = buildHostConfig(config.repoPath, limits, hostPhase);

      const container = await docker.createContainer({
        Image: image,
        Cmd: ["sleep", "infinity"],
        Labels: labels,
        WorkingDir: "/workspace",
        User: "1000:1000",
        HostConfig: hostConfig as Docker.HostConfig,
      });

      await container.start();

      return ok({
        containerId: container.id,
        phase,
        labels,
      });
    } catch (error) {
      return err({
        code: "sandbox_failure" as const,
        message: `Failed to create container: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  async function runSetup(
    instance: SandboxInstance,
    config: SandboxConfig,
  ): Promise<FactoryResult<void>> {
    const secretEnv = buildExecEnv("setup", config.secrets);

    for (const cmd of config.setupContract.setup) {
      const result = await execInContainer(
        docker,
        instance.containerId,
        ["sh", "-c", cmd],
        { env: secretEnv },
      );
      if (result.isErr()) return err(result.error);
      if (result.value.exitCode !== 0) {
        return err({
          code: "sandbox_failure" as const,
          message: `Setup command failed (exit ${result.value.exitCode}): ${cmd}\n${result.value.stderr}`,
          retryable: false,
        });
      }
    }

    // Run health checks
    for (const check of config.setupContract.health_check) {
      const result = await execInContainer(
        docker,
        instance.containerId,
        ["sh", "-c", check],
        { env: secretEnv },
      );
      if (result.isErr()) return err(result.error);
      if (result.value.exitCode !== 0) {
        return err({
          code: "sandbox_failure" as const,
          message: `Health check failed (exit ${result.value.exitCode}): ${check}`,
          retryable: true,
        });
      }
    }

    // Cache the environment
    const cacheKey = computeCacheKey({
      setupContract: config.setupContract,
      secrets: config.secrets,
    });
    const allSecretNames = [
      ...Object.keys(config.secrets.setupOnly),
      ...Object.keys(config.secrets.runtime),
      ...Object.values(config.secrets.perTool).flatMap((t) => Object.keys(t)),
    ];
    const cacheResult = await cacheContainer(
      docker,
      instance.containerId,
      cacheKey,
      config.repoSlug,
      allSecretNames,
    );
    if (cacheResult.isErr()) return err(cacheResult.error);

    // Disconnect from bridge network
    const disconnectResult = await networkManager.disconnectFromBridge(
      instance.containerId,
    );
    if (disconnectResult.isErr()) return err(disconnectResult.error);

    return ok(undefined);
  }

  async function runMaintenance(
    instance: SandboxInstance,
    config: SandboxConfig,
  ): Promise<FactoryResult<void>> {
    const secretEnv = buildExecEnv("setup", config.secrets);

    for (const cmd of config.setupContract.maintenance) {
      const result = await execInContainer(
        docker,
        instance.containerId,
        ["sh", "-c", cmd],
        { env: secretEnv },
      );
      if (result.isErr()) return err(result.error);
      if (result.value.exitCode !== 0) {
        return err({
          code: "sandbox_failure" as const,
          message: `Maintenance command failed (exit ${result.value.exitCode}): ${cmd}\n${result.value.stderr}`,
          retryable: false,
        });
      }
    }

    // Run health checks
    for (const check of config.setupContract.health_check) {
      const result = await execInContainer(
        docker,
        instance.containerId,
        ["sh", "-c", check],
        { env: secretEnv },
      );
      if (result.isErr()) return err(result.error);
      if (result.value.exitCode !== 0) {
        return err({
          code: "sandbox_failure" as const,
          message: `Health check failed (exit ${result.value.exitCode}): ${check}`,
          retryable: true,
        });
      }
    }

    // Disconnect from bridge network
    const disconnectResult = await networkManager.disconnectFromBridge(
      instance.containerId,
    );
    if (disconnectResult.isErr()) return err(disconnectResult.error);

    return ok(undefined);
  }

  async function execCommand(
    instance: SandboxInstance,
    cmd: readonly string[],
    options?: ExecOptions,
  ): Promise<FactoryResult<ExecResult>> {
    return execInContainer(docker, instance.containerId, cmd, options ?? {});
  }

  async function execWithSecrets(
    instance: SandboxInstance,
    cmd: readonly string[],
    secrets: Readonly<Record<string, string>>,
  ): Promise<FactoryResult<ExecResult>> {
    const env = Object.entries(secrets).map(([k, v]) => `${k}=${v}`);
    return execInContainer(docker, instance.containerId, cmd, { env });
  }

  async function execWithToolSecrets(
    instance: SandboxInstance,
    cmd: readonly string[],
    toolName: string,
    bindings: SecretBindings,
  ): Promise<FactoryResult<ExecResult>> {
    const env = [
      ...buildExecEnv("runtime", bindings),
      ...buildToolExecEnv(toolName, bindings),
    ];
    return execInContainer(docker, instance.containerId, cmd, { env });
  }

  async function destroySandbox(
    instance: SandboxInstance,
  ): Promise<FactoryResult<void>> {
    return destroyContainer(docker, instance.containerId);
  }

  async function cleanupOrphans(
    maxAgeMinutes?: number,
  ): Promise<FactoryResult<number>> {
    return cleanupOrphanContainers(docker, maxAgeMinutes);
  }

  async function provisionSandbox(
    config: SandboxConfig,
  ): Promise<FactoryResult<SandboxInstance>> {
    // 1. Resolve environment
    const resolvedResult = await resolveEnvironment(config);
    if (resolvedResult.isErr()) return err(resolvedResult.error);

    // 2. Create container
    const containerResult = await createContainer(resolvedResult.value);
    if (containerResult.isErr()) return err(containerResult.error);

    const instance = containerResult.value;

    // 3/4. Setup or maintenance
    if (resolvedResult.value.cachedImage) {
      const maintenanceResult = await runMaintenance(instance, config);
      if (maintenanceResult.isErr()) {
        await destroySandbox(instance);
        return err(maintenanceResult.error);
      }
    } else {
      const setupResult = await runSetup(instance, config);
      if (setupResult.isErr()) {
        await destroySandbox(instance);
        return err(setupResult.error);
      }
    }

    return ok({
      ...instance,
      phase: "execution" as const,
    });
  }

  return {
    provisionSandbox,
    resolveEnvironment,
    createContainer,
    runSetup,
    runMaintenance,
    execCommand,
    execWithSecrets,
    execWithToolSecrets,
    destroySandbox,
    cleanupOrphans,
  };
}

export type SandboxSupervisor = ReturnType<typeof createSandboxSupervisor>;
