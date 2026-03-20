import { apiKeyRepo } from "@software-factory/db";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";

/**
 * SSE endpoint — multiplexes all real-time events through a single stream.
 * GET /api/events?token=<apiKey>
 * Auth via query parameter because EventSource cannot set headers.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/events", async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      reply.status(401).send({
        error: {
          code: "unauthorized",
          message: "Missing token query parameter",
        },
      });
      return;
    }

    // Validate API key
    const result = await apiKeyRepo.validateApiKey(request.server.db, token);
    if (result.isErr()) {
      reply.status(401).send({
        error: { code: "unauthorized", message: "Invalid API key" },
      });
      return;
    }

    const redisUrl = app.redisUrl;
    if (!redisUrl) {
      reply.status(503).send({
        error: { code: "service_unavailable", message: "Redis not configured" },
      });
      return;
    }

    // Set SSE headers — use raw response to bypass Fastify's serialization
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.hijack();

    // Each SSE client gets a dedicated Redis subscriber connection
    const subscriber = new Redis(redisUrl);
    await subscriber.subscribe("factory:tasks", "factory:system");

    subscriber.on("message", (channel: string, message: string) => {
      const eventType = channel.replace("factory:", "");
      reply.raw.write(`event: ${eventType}\ndata: ${message}\n\n`);
    });

    // Heartbeat every 30s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 30_000);

    // Cleanup on client disconnect
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      subscriber.unsubscribe().catch(() => {});
      subscriber.quit().catch(() => {});
    });
  });
}
