import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@software-factory/db";
import type { DbConnection } from "@software-factory/db";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { apiKeyRoutes } from "../src/routes/api-keys.js";
import { healthRoutes } from "../src/routes/health.js";
import { metricsRoutes } from "../src/routes/metrics.js";
import { setupRoutes } from "../src/routes/setup.js";
import { taskRoutes } from "../src/routes/tasks.js";
import { webhookRoutes } from "../src/routes/webhooks.js";
import { createServer } from "../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_0 = readFileSync(
  join(__dirname, "../../db/drizzle/0000_wonderful_wallop.sql"),
  "utf8",
);
const MIGRATION_1 = readFileSync(
  join(__dirname, "../../db/drizzle/0001_custom_triggers_rls_seeds.sql"),
  "utf8",
);
const MIGRATION_2 = readFileSync(
  join(__dirname, "../../db/drizzle/0002_last_argent.sql"),
  "utf8",
);

const INIT_SQL = readFileSync(
  join(__dirname, "../../..", "scripts/init-db.sql"),
  "utf8",
);

export interface TestContext {
  container: StartedPostgreSqlContainer;
  dbConnection: DbConnection;
  app: FastifyInstance;
}

export async function setupTestApp(): Promise<TestContext> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("factory")
    .withUsername("factory")
    .withPassword("test_password")
    .start();

  const connectionString = container.getConnectionUri();

  // Apply migrations using a temporary pool (before creating the Drizzle connection)
  const setupPool = new pg.Pool({ connectionString });

  const filteredInit = INIT_SQL.split("\n")
    .filter(
      (line) =>
        !line.trim().startsWith("CREATE DATABASE") &&
        !line.trim().startsWith("-- Create Temporal"),
    )
    .join("\n");
  await setupPool.query(filteredInit);

  for (const stmt of MIGRATION_0.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) {
      await setupPool.query(trimmed);
    }
  }
  await setupPool.query(MIGRATION_1);
  for (const stmt of MIGRATION_2.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    await setupPool.query(trimmed);
  }
  await setupPool.end();

  // Create the app's DB connection
  const dbConnection = createDb(connectionString);

  const app = await createServer({
    port: 0,
    host: "127.0.0.1",
    logger: false,
    dbConnection,
    webhookSecret: "test-webhook-secret",
  });

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(webhookRoutes);
  await app.register(apiKeyRoutes);
  await app.register(taskRoutes);
  await app.register(setupRoutes);
  await app.ready();

  return { container, dbConnection, app };
}

export async function teardownTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.dbConnection.pool.end();
  await ctx.container.stop();
}
