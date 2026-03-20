import { checkDatabaseHealth } from "@software-factory/db";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";

interface HealthCheck {
  readonly status: "healthy" | "unhealthy";
  readonly latencyMs?: number;
  readonly error?: string;
}

async function checkRedisHealth(redisUrl?: string): Promise<HealthCheck> {
  if (!redisUrl) {
    return { status: "unhealthy", error: "Redis URL not configured" };
  }
  const start = Date.now();
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5_000,
  });
  try {
    await client.connect();
    const result = await client.ping();
    const latencyMs = Date.now() - start;
    await client.quit();
    return result === "PONG"
      ? { status: "healthy", latencyMs }
      : { status: "unhealthy", error: `Unexpected ping response: ${result}` };
  } catch (e) {
    try {
      await client.quit();
    } catch {
      /* ignore cleanup errors */
    }
    return {
      status: "unhealthy",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkTemporalHealth(
  temporalAddress?: string,
): Promise<HealthCheck> {
  if (!temporalAddress) {
    return { status: "unhealthy", error: "Temporal address not configured" };
  }
  const start = Date.now();
  try {
    const { Connection } = await import("@temporalio/client");
    const conn = await Connection.connect({
      address: temporalAddress,
      connectTimeout: 5_000,
    });
    await conn.healthService.check({});
    const latencyMs = Date.now() - start;
    await conn.close();
    return { status: "healthy", latencyMs };
  } catch (e) {
    return {
      status: "unhealthy",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkMinIOHealth(minioEndpoint?: string): Promise<HealthCheck> {
  if (!minioEndpoint) {
    return { status: "unhealthy", error: "MinIO endpoint not configured" };
  }
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${minioEndpoint}/minio/health/live`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    return res.ok
      ? { status: "healthy", latencyMs }
      : { status: "unhealthy", error: `HTTP ${res.status}` };
  } catch (e) {
    return {
      status: "unhealthy",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    reply.send({ status: "ok", version: "0.1.0" });
  });

  app.get("/health/live", async (_request, reply) => {
    reply.send({ status: "ok" });
  });

  app.get("/health/ready", async (_request, reply) => {
    const [database, redis, temporal, minio] = await Promise.all([
      checkDatabaseHealth(app.dbPool as import("pg").Pool),
      checkRedisHealth(app.redisUrl),
      checkTemporalHealth(app.temporalAddress),
      checkMinIOHealth(app.minioEndpoint),
    ]);

    const checks = { database, redis, temporal, minio };
    const allHealthy = Object.values(checks).every(
      (c) => c.status === "healthy",
    );

    reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? "ok" : "degraded",
      version: "0.1.0",
      checks,
    });
  });
}
