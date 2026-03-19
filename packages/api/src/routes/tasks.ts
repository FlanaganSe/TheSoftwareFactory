import type { Client } from "@temporalio/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";

const TaskSubmitSchema = z
  .object({
    objective: z.string().min(1),
    repoOwner: z.string().min(1),
    repoName: z.string().min(1),
    autonomyLevel: z.enum(["L0", "L1", "L2"]).optional().default("L1"),
  })
  .strict();

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/tasks",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const parsed = TaskSubmitSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.message,
          },
        });
        return;
      }

      const temporalClient = (
        app as FastifyInstance & { temporalClient?: Client }
      ).temporalClient;

      if (!temporalClient) {
        reply.status(503).send({
          error: {
            code: "service_unavailable",
            message: "Temporal client not configured",
          },
        });
        return;
      }

      const { objective, repoOwner, repoName, autonomyLevel } = parsed.data;
      const taskId = crypto.randomUUID();
      const repoId = crypto.randomUUID();
      const workflowId = `task-${taskId}`;

      try {
        await temporalClient.workflow.start("taskOrchestrator", {
          taskQueue: "sf-orchestration",
          workflowId,
          args: [
            {
              taskId,
              repoId,
              repoOwner,
              repoName,
              objective,
              autonomyLevel,
              config: {
                reviewTimeoutMs: 14_400_000,
                costBudgetCents: 1000,
                maxImplementationAttempts: 3,
              },
            },
          ],
        });

        reply.status(201).send({
          taskId,
          workflowId,
          status: "started",
        });
      } catch (error) {
        reply.status(500).send({
          error: {
            code: "workflow_start_failed",
            message: `Failed to start workflow: ${String(error)}`,
          },
        });
      }
    },
  );

  app.get(
    "/api/tasks",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const temporalClient = (
        app as FastifyInstance & { temporalClient?: Client }
      ).temporalClient;

      if (!temporalClient) {
        reply.status(503).send({
          error: {
            code: "service_unavailable",
            message: "Temporal client not configured",
          },
        });
        return;
      }

      // For now, return a list from Temporal workflow queries
      // Full implementation would query the DB
      reply.status(200).send({ tasks: [] });
    },
  );

  app.get(
    "/api/tasks/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const temporalClient = (
        app as FastifyInstance & { temporalClient?: Client }
      ).temporalClient;

      if (!temporalClient) {
        reply.status(503).send({
          error: {
            code: "service_unavailable",
            message: "Temporal client not configured",
          },
        });
        return;
      }

      try {
        const handle = temporalClient.workflow.getHandle(`task-${id}`);
        const desc = await handle.describe();

        reply.status(200).send({
          taskId: id,
          workflowId: `task-${id}`,
          status: desc.status.name,
          startTime: desc.startTime?.toISOString(),
        });
      } catch {
        reply.status(404).send({
          error: {
            code: "not_found",
            message: `Task ${id} not found`,
          },
        });
      }
    },
  );
}
