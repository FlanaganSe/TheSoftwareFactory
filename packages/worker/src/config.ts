export interface WorkerConfig {
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

export function loadWorkerConfig(): WorkerConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required");
  }

  return {
    temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    databaseUrl,
    redisUrl,
  };
}
