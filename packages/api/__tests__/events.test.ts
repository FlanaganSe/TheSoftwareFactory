import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@software-factory/db";
import type { DbConnection } from "@software-factory/db";
import { apiKeyRepo } from "@software-factory/db";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventRoutes } from "../src/routes/events.js";
import { healthRoutes } from "../src/routes/health.js";
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

let container: StartedPostgreSqlContainer;
let dbConnection: DbConnection;
let app: FastifyInstance;
let adminKey: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("factory")
    .withUsername("factory")
    .withPassword("test_password")
    .start();

  const connectionString = container.getConnectionUri();
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
    if (trimmed) await setupPool.query(trimmed);
  }
  await setupPool.query(MIGRATION_1);
  for (const stmt of MIGRATION_2.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    const fixed = trimmed.includes("SET DATA TYPE integer")
      ? trimmed.replace(
          "SET DATA TYPE integer",
          "SET DATA TYPE integer USING schema_version::integer",
        )
      : trimmed;
    await setupPool.query(fixed);
  }
  await setupPool.end();

  dbConnection = createDb(connectionString);
  app = await createServer({
    port: 0,
    host: "127.0.0.1",
    logger: false,
    dbConnection,
    webhookSecret: "test-webhook-secret",
    // No redisUrl — tests SSE without Redis
  });

  await app.register(healthRoutes);
  await app.register(eventRoutes);
  await app.ready();

  const result = await apiKeyRepo.createApiKey(
    dbConnection.db,
    "test-admin",
    "admin",
    "test",
  );
  if (result.isOk()) {
    adminKey = result.value.rawKey;
  }
}, 60_000);

afterAll(async () => {
  await app.close();
  await dbConnection.pool.end();
  await container.stop();
}, 30_000);

describe("SSE /api/events endpoint", () => {
  it("rejects requests without token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/events",
    });
    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects requests with invalid token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/events?token=invalid-key",
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns 503 when Redis is not configured", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/events?token=${encodeURIComponent(adminKey)}`,
    });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error.code).toBe("service_unavailable");
  });
});
