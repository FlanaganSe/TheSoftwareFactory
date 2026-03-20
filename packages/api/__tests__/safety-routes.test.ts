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
import { GenericContainer } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiKeyRoutes } from "../src/routes/api-keys.js";
import { healthRoutes } from "../src/routes/health.js";
import { safetyRoutes } from "../src/routes/safety.js";
import { taskRoutes } from "../src/routes/tasks.js";
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

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let dbConnection: DbConnection;
let app: FastifyInstance;
let adminKey: string;
let operatorKey: string;
let viewerKey: string;

beforeAll(async () => {
  // Start containers
  const [pgC, redisC] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("factory")
      .withUsername("factory")
      .withPassword("test_password")
      .start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
  pgContainer = pgC;
  redisContainer = redisC;

  const connectionString = pgContainer.getConnectionUri();
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  // Apply migrations
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
    await setupPool.query(trimmed);
  }
  await setupPool.end();

  dbConnection = createDb(connectionString);

  // Create server with Redis URL included
  app = await createServer({
    port: 0,
    host: "127.0.0.1",
    logger: false,
    dbConnection,
    webhookSecret: "test-webhook-secret",
    redisUrl,
  });

  await app.register(healthRoutes);
  await app.register(apiKeyRoutes);
  await app.register(taskRoutes);
  await app.register(safetyRoutes);
  await app.ready();

  const db = dbConnection.db;
  const adminResult = await apiKeyRepo.createApiKey(
    db,
    "safety-admin",
    "admin",
    "test",
  );
  adminKey = adminResult._unsafeUnwrap().rawKey;
  const operatorResult = await apiKeyRepo.createApiKey(
    db,
    "safety-operator",
    "operator",
    "test",
  );
  operatorKey = operatorResult._unsafeUnwrap().rawKey;
  const viewerResult = await apiKeyRepo.createApiKey(
    db,
    "safety-viewer",
    "viewer",
    "test",
  );
  viewerKey = viewerResult._unsafeUnwrap().rawKey;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await dbConnection?.pool.end();
  await pgContainer?.stop();
  await redisContainer?.stop();
});

describe("safety routes", () => {
  it("GET /api/safety/status returns safety dashboard for operator", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/safety/status",
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("globalKill");
    expect(body).toHaveProperty("circuits");
    expect(body).toHaveProperty("dailyCost");
    expect(body).toHaveProperty("activeKills");
  });

  it("GET /api/safety/status without auth → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/safety/status",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/safety/status with viewer → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/safety/status",
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /api/safety/kill/global activates kill (admin only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/safety/kill/global",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { reason: "test kill" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("activated");
  });

  it("POST /api/safety/kill/global by operator → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/safety/kill/global",
      headers: { authorization: `Bearer ${operatorKey}` },
      payload: { reason: "should fail" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /api/safety/kill/global deactivates kill", async () => {
    await app.inject({
      method: "POST",
      url: "/api/safety/kill/global",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {},
    });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/safety/kill/global",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("deactivated");
  });

  it("GET /api/safety/kill lists active kills", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/safety/kill",
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("kills");
  });

  it("GET /api/safety/circuits returns all circuit statuses", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/safety/circuits",
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.circuits.length).toBeGreaterThanOrEqual(3);
  });

  it("POST /api/safety/circuits/github/trip trips circuit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/safety/circuits/github/trip",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("tripped");
  });

  it("POST /api/safety/circuits/github/reset resets circuit", async () => {
    await app.inject({
      method: "POST",
      url: "/api/safety/circuits/github/trip",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/safety/circuits/github/reset",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("reset");
  });

  it("GET /api/safety/costs/daily returns daily cost", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/safety/costs/daily",
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("date");
    expect(body).toHaveProperty("totalCents");
    expect(body).toHaveProperty("budgetCents");
  });

  it("POST /api/safety/budget/daily sets daily budget", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/safety/budget/daily",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { budgetCents: 50000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().budgetCents).toBe(50000);
  });

  it("POST /api/tasks/:id/budget overrides task budget", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/test-task-1/budget",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { budgetCents: 2000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().budgetCents).toBe(2000);
  });

  it("viewer on mutation endpoints → 403", async () => {
    const endpoints = [
      { method: "POST" as const, url: "/api/safety/kill/global", payload: {} },
      { method: "DELETE" as const, url: "/api/safety/kill/global" },
      { method: "POST" as const, url: "/api/safety/circuits/github/reset" },
      {
        method: "POST" as const,
        url: "/api/safety/budget/daily",
        payload: { budgetCents: 100 },
      },
    ];
    for (const ep of endpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        headers: { authorization: `Bearer ${viewerKey}` },
        payload: ep.payload,
      });
      expect(res.statusCode).toBe(403);
    }
  });
});
