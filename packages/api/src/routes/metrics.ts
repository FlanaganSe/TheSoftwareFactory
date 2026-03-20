import type { FastifyInstance } from "fastify";
import promClient from "prom-client";

// Collect default Node.js process metrics (memory, CPU, event loop, etc.)
promClient.collectDefaultMetrics({
  prefix: "factory_api_",
});

// Custom API-level metrics
export const httpRequestDuration = new promClient.Histogram({
  name: "factory_api_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const httpRequestTotal = new promClient.Counter({
  name: "factory_api_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
});

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  // Record request metrics on every response
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    // Skip metrics endpoint itself to avoid feedback loop
    if (route === "/metrics") return;
    const labels = {
      method: request.method,
      route,
      status_code: reply.statusCode.toString(),
    };
    httpRequestTotal.inc(labels);
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
  });

  // SECURITY: /metrics is unauthenticated per Prometheus convention.
  // Restrict to loopback/private IPs. In production, use network-level
  // controls (e.g., Kubernetes NetworkPolicy) to limit scraper access.
  app.get("/metrics", async (request, reply) => {
    const ip = request.ip;
    const isLocal =
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip?.startsWith("10.") ||
      ip?.startsWith("172.") ||
      ip?.startsWith("192.168.");

    if (!isLocal) {
      reply
        .status(403)
        .send({ error: "Metrics only available from internal network" });
      return;
    }

    reply
      .header("Content-Type", promClient.register.contentType)
      .send(await promClient.register.metrics());
  });
}
