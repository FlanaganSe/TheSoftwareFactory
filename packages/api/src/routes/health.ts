import { checkDatabaseHealth } from "@software-factory/db";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    reply.send({ status: "ok", version: "0.0.0" });
  });

  app.get("/health/live", async (_request, reply) => {
    reply.send({ status: "ok" });
  });

  app.get("/health/ready", async (_request, reply) => {
    const dbHealth = await checkDatabaseHealth(app.dbPool as import("pg").Pool);

    if (dbHealth.status === "unhealthy") {
      reply.status(503).send({
        status: "unavailable",
        checks: { database: dbHealth },
      });
      return;
    }

    reply.send({
      status: "ok",
      checks: { database: dbHealth },
    });
  });
}
