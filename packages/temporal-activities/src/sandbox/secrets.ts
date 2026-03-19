import type { FactoryResult } from "@software-factory/core";
import type Docker from "dockerode";
import { err, ok } from "neverthrow";

export interface SecretBindings {
  readonly setupOnly: Readonly<Record<string, string>>;
  readonly runtime: Readonly<Record<string, string>>;
  readonly perTool: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export function buildExecEnv(
  phase: "setup" | "runtime",
  bindings: SecretBindings,
): readonly string[] {
  const secrets = phase === "setup" ? bindings.setupOnly : bindings.runtime;
  return Object.entries(secrets).map(([k, v]) => `${k}=${v}`);
}

export function buildToolExecEnv(
  toolName: string,
  bindings: SecretBindings,
): readonly string[] {
  const toolSecrets = bindings.perTool[toolName];
  if (!toolSecrets) return [];
  return Object.entries(toolSecrets).map(([k, v]) => `${k}=${v}`);
}

export async function verifyNoSecretLeakage(
  containerId: string,
  docker: Docker,
  bindings: SecretBindings,
): Promise<FactoryResult<boolean>> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const containerEnv: readonly string[] = info.Config?.Env ?? [];

    const allSecretValues = [
      ...Object.values(bindings.setupOnly),
      ...Object.values(bindings.runtime),
      ...Object.values(bindings.perTool).flatMap((tool) => Object.values(tool)),
    ];

    const leaked = containerEnv.some((envVar) => {
      const value = envVar.split("=").slice(1).join("=");
      return allSecretValues.includes(value) && value.length > 0;
    });

    return ok(!leaked);
  } catch (error) {
    return err({
      code: "sandbox_failure" as const,
      message: `Failed to verify secret leakage: ${error instanceof Error ? error.message : String(error)}`,
      retryable: false,
    });
  }
}
