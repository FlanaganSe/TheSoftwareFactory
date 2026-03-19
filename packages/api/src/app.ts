import { createDb } from "@software-factory/db";
import { seedAdminKey } from "./bootstrap/seed-admin-key.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { healthRoutes } from "./routes/health.js";
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
}

export async function startApp(config: AppConfig): Promise<void> {
  const dbConnection = createDb(config.databaseUrl);

  const server = createServer({
    port: config.port,
    host: config.host,
    logger: config.logger,
    dbConnection,
    webhookSecret: config.webhookSecret,
  });

  // Register routes
  await server.register(healthRoutes);
  await server.register(webhookRoutes);
  await server.register(apiKeyRoutes);
  await server.register(taskRoutes);
  await server.register(setupRoutes);

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
    logger: true,
  }).catch((err) => {
    console.error("Failed to start app:", err);
    process.exit(1);
  });
}
