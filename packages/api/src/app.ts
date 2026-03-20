import { createDb } from "@software-factory/db";
import { seedAdminKey } from "./bootstrap/seed-admin-key.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { repoRoutes } from "./routes/repos.js";
import { safetyRoutes } from "./routes/safety.js";
import { setupRoutes } from "./routes/setup.js";
import { taskRoutes } from "./routes/tasks.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { createServer } from "./server.js";

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
  readonly webhookSecret: string;
  readonly logger: boolean;
  readonly redisUrl?: string;
  readonly temporalAddress?: string;
  readonly minioEndpoint?: string;
  readonly githubAppId?: string;
  readonly githubPrivateKey?: string;
  readonly githubInstallationId?: number;
}

export async function startApp(config: AppConfig): Promise<void> {
  const dbConnection = createDb(config.databaseUrl);

  const server = await createServer({
    port: config.port,
    host: config.host,
    logger: config.logger,
    dbConnection,
    webhookSecret: config.webhookSecret,
    redisUrl: config.redisUrl,
    temporalAddress: config.temporalAddress,
    minioEndpoint: config.minioEndpoint,
    githubAppId: config.githubAppId,
    githubPrivateKey: config.githubPrivateKey,
    githubInstallationId: config.githubInstallationId,
  });

  // Connect Temporal client if address is provided
  if (config.temporalAddress) {
    try {
      const { Connection, Client } = await import("@temporalio/client");
      const connection = await Connection.connect({
        address: config.temporalAddress,
      });
      const client = new Client({ connection });
      server.decorate("temporalClient", client);
      server.addHook("onClose", async () => {
        await connection.close();
      });
      server.log.info(
        { address: config.temporalAddress },
        "Temporal client connected",
      );
    } catch (e) {
      server.log.warn(
        { error: e instanceof Error ? e.message : String(e) },
        "Failed to connect Temporal client — task endpoints will return 503",
      );
    }
  }

  // Register routes
  await server.register(healthRoutes);
  await server.register(metricsRoutes);
  await server.register(webhookRoutes);
  await server.register(apiKeyRoutes);
  await server.register(taskRoutes);
  await server.register(safetyRoutes);
  await server.register(setupRoutes);
  await server.register(repoRoutes);
  await server.register(eventRoutes);

  // Seed admin key on first run
  await seedAdminKey(dbConnection.db);

  // Start listening
  await server.listen({ port: config.port, host: config.host });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    await server.close();
    await dbConnection.pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Direct execution
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("WEBHOOK_SECRET environment variable is required");
    process.exit(1);
  }

  startApp({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    databaseUrl,
    webhookSecret,
    redisUrl: process.env.REDIS_URL,
    temporalAddress: process.env.TEMPORAL_ADDRESS,
    minioEndpoint: process.env.MINIO_ENDPOINT,
    githubAppId: process.env.GITHUB_APP_ID,
    githubPrivateKey: process.env.GITHUB_PRIVATE_KEY,
    githubInstallationId: process.env.GITHUB_INSTALLATION_ID
      ? Number(process.env.GITHUB_INSTALLATION_ID)
      : undefined,
    logger: true,
  }).catch((err) => {
    console.error("Failed to start app:", err);
    process.exit(1);
  });
}
