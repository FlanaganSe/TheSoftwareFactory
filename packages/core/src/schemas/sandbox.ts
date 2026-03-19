import { z } from "zod";

export const CONTAINER_PHASES = [
  "resolve",
  "create",
  "setup",
  "maintenance",
  "execution",
  "cleanup",
] as const;

export const ContainerPhaseSchema = z.enum(CONTAINER_PHASES);
export type ContainerPhase = z.infer<typeof ContainerPhaseSchema>;

export const SECRET_CLASSES = ["setup_only", "runtime", "per_tool"] as const;

export const SecretClassSchema = z.enum(SECRET_CLASSES);
export type SecretClass = z.infer<typeof SecretClassSchema>;

const PerToolSecretSchema = z
  .object({
    name: z.string().min(1),
    tools: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const SetupContractSchema = z
  .object({
    version: z.string().min(1),
    image: z.string().min(1),
    setup: z.array(z.string()),
    maintenance: z.array(z.string()),
    secrets: z
      .object({
        setup_only: z.array(z.string()),
        runtime: z.array(z.string()),
        per_tool: z.array(PerToolSecretSchema),
      })
      .strict(),
    health_check: z.array(z.string()),
  })
  .strict();

export type SetupContract = z.infer<typeof SetupContractSchema>;

export const HEALTH_STATUSES = ["healthy", "unhealthy", "unknown"] as const;

export const HealthStatusSchema = z.enum(HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const EnvironmentStateSchema = z
  .object({
    repoId: z.string().uuid(),
    imageRef: z.string().nullable(),
    setupContractHash: z.string().nullable(),
    cacheValid: z.boolean(),
    lastHealthCheck: z.string().datetime().nullable(),
    healthStatus: HealthStatusSchema,
  })
  .strict();

export type EnvironmentState = z.infer<typeof EnvironmentStateSchema>;
