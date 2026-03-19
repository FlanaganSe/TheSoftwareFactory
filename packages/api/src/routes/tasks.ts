import { CreateTaskSchema } from "@software-factory/core";
import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/tasks",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const parsed = CreateTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.message,
          },
        });
        return;
      }

      reply.status(501).send({
        error: {
          code: "not_implemented",
          message: "Task creation not yet implemented",
        },
      });
    },
  );

  app.get(
    "/api/tasks",
    { preHandler: [authMiddleware] },
    async (_request, reply) => {
      reply.status(501).send({
        error: {
          code: "not_implemented",
          message: "Task listing not yet implemented",
        },
      });
    },
  );

  app.get(
    "/api/tasks/:id",
    { preHandler: [authMiddleware] },
    async (_request, reply) => {
      reply.status(501).send({
        error: {
          code: "not_implemented",
          message: "Task retrieval not yet implemented",
        },
      });
    },
  );
}
