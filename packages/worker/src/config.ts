export interface WorkerConfig {
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly dockerSocketPath?: string;
  readonly githubAppId?: string;
  readonly githubPrivateKey?: string;
  readonly githubInstallationId?: number;
  readonly openRouterApiKey?: string;
  readonly minioEndpoint?: string;
  readonly minioAccessKey?: string;
  readonly minioSecretKey?: string;
  readonly minioBucket?: string;
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
    dockerSocketPath: process.env.DOCKER_SOCKET_PATH,
    githubAppId: process.env.GITHUB_APP_ID,
    githubPrivateKey: process.env.GITHUB_PRIVATE_KEY,
    githubInstallationId: process.env.GITHUB_INSTALLATION_ID
      ? Number(process.env.GITHUB_INSTALLATION_ID)
      : undefined,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    minioEndpoint: process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
    minioAccessKey: process.env.MINIO_ROOT_USER ?? "factory",
    minioSecretKey: process.env.MINIO_ROOT_PASSWORD,
    minioBucket: process.env.MINIO_BUCKET ?? "factory-artifacts",
  };
}
