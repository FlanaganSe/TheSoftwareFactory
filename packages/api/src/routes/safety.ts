import {
  createBudgetManager,
  createCircuitBreaker,
  createKillSwitch,
  createRedisClient,
} from "@software-factory/temporal-activities";
import type { Client } from "@temporalio/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";

const KillGlobalSchema = z.object({ reason: z.string().optional() }).strict();
const DailyBudgetSchema = z
  .object({ budgetCents: z.number().int().positive() })
  .strict();
const TaskBudgetSchema = z
  .object({ budgetCents: z.number().int().positive() })
  .strict();

export async function safetyRoutes(app: FastifyInstance): Promise<void> {
  const redisUrl = app.redisUrl;
  if (!redisUrl) {
    app.log.warn("Redis URL not configured — safety routes disabled");
    return;
  }

  const redis = createRedisClient(redisUrl);
  await redis.connect();
  const pubsubRedis = createRedisClient(redisUrl);
  await pubsubRedis.connect();

  const circuitBreaker = createCircuitBreaker(redis);
  const killSwitch = createKillSwitch(redis, pubsubRedis);
  const budgetManager = createBudgetManager(redis);

  app.addHook("onClose", async () => {
    await redis.quit();
    await pubsubRedis.quit();
  });

  // GET /api/safety/status — Overall safety dashboard
  app.get(
    "/api/safety/status",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (_request, reply) => {
      const [globalKill, activeKills, circuits, dailyCost] = await Promise.all([
        killSwitch.isGlobalActive(),
        killSwitch.getActiveKills(),
        circuitBreaker.getAllStatuses(),
        budgetManager.getDailyCost(),
      ]);

      reply.send({
        globalKill,
        activeKills,
        circuits,
        dailyCost,
      });
    },
  );

  // POST /api/safety/kill/global — Activate global kill switch
  app.post(
    "/api/safety/kill/global",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const parsed = KillGlobalSchema.safeParse(request.body ?? {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      await killSwitch.activateGlobal(request.actor.actorId, reason);

      // Signal all running workflows if Temporal is available
      let workflowsSignaled = 0;
      const temporalClient = (
        app as FastifyInstance & { temporalClient?: Client }
      ).temporalClient;
      if (temporalClient) {
        const workflows = temporalClient.workflow.list({
          query: 'ExecutionStatus="Running"',
        });
        for await (const wf of workflows) {
          try {
            const handle = temporalClient.workflow.getHandle(wf.workflowId);
            await handle.signal("kill", {
              actor: request.actor.actorId,
              reason: reason ?? "Global kill switch activated",
            });
            workflowsSignaled++;
          } catch {
            // Workflow may have completed between list and signal
          }
        }
      }

      reply.send({ status: "activated", workflowsSignaled });
    },
  );

  // DELETE /api/safety/kill/global — Deactivate global kill switch
  app.delete(
    "/api/safety/kill/global",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      await killSwitch.deactivateGlobal(request.actor.actorId);
      reply.send({ status: "deactivated" });
    },
  );

  // GET /api/safety/kill — List active kill switches
  app.get(
    "/api/safety/kill",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (_request, reply) => {
      const kills = await killSwitch.getActiveKills();
      reply.send({ kills });
    },
  );

  // GET /api/safety/circuits — Circuit breaker status
  app.get(
    "/api/safety/circuits",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (_request, reply) => {
      const circuits = await circuitBreaker.getAllStatuses();
      reply.send({ circuits });
    },
  );

  // POST /api/safety/circuits/:service/reset — Force-close a circuit breaker
  app.post(
    "/api/safety/circuits/:service/reset",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const { service } = request.params as { service: string };
      await circuitBreaker.forceClose(service);
      reply.send({ status: "reset", service });
    },
  );

  // POST /api/safety/circuits/:service/trip — Force-open a circuit breaker
  app.post(
    "/api/safety/circuits/:service/trip",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const { service } = request.params as { service: string };
      await circuitBreaker.forceOpen(service);
      reply.send({ status: "tripped", service });
    },
  );

  // GET /api/safety/costs/daily — Today's cost breakdown
  app.get(
    "/api/safety/costs/daily",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (_request, reply) => {
      const cost = await budgetManager.getDailyCost();
      reply.send(cost);
    },
  );

  // GET /api/safety/costs/daily/:date — Specific date's cost breakdown
  app.get(
    "/api/safety/costs/daily/:date",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { date } = request.params as { date: string };
      const cost = await budgetManager.getDailyCost(date);
      reply.send(cost);
    },
  );

  // POST /api/safety/budget/daily — Set daily budget
  app.post(
    "/api/safety/budget/daily",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const parsed = DailyBudgetSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "validation_error", message: parsed.error.message },
        });
        return;
      }
      await budgetManager.setDailyBudget(parsed.data.budgetCents);
      reply.send({ status: "set", budgetCents: parsed.data.budgetCents });
    },
  );

  // GET /api/safety/costs/task/:id — Task cost summary
  app.get(
    "/api/safety/costs/task/:id",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const cost = await budgetManager.getTaskCost(id);
      reply.send(cost);
    },
  );

  // POST /api/tasks/:id/budget — Override task budget
  app.post(
    "/api/tasks/:id/budget",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = TaskBudgetSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "validation_error", message: parsed.error.message },
        });
        return;
      }
      await budgetManager.overrideBudget(
        id,
        parsed.data.budgetCents,
        request.actor.actorId,
      );
      reply.send({
        status: "overridden",
        taskId: id,
        budgetCents: parsed.data.budgetCents,
      });
    },
  );
}
