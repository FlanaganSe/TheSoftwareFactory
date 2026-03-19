import { RoleSchema } from "@software-factory/core";
import { apiKeyRepo } from "@software-factory/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";

const CreateApiKeyBody = z
  .object({
    label: z.string().min(1),
    role: RoleSchema,
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/keys",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const parsed = CreateApiKeyBody.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.message,
          },
        });
        return;
      }

      const { label, role, expiresAt } = parsed.data;
      const result = await apiKeyRepo.createApiKey(
        app.db,
        label,
        role,
        request.actor.actorId,
        expiresAt ? new Date(expiresAt) : undefined,
      );

      if (result.isErr()) {
        reply.status(500).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
        return;
      }

      reply.status(201).send({
        id: result.value.id,
        key: result.value.rawKey,
        label,
        role,
      });
    },
  );

  app.get(
    "/api/keys",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (_request, reply) => {
      const result = await apiKeyRepo.listApiKeys(app.db);

      if (result.isErr()) {
        reply.status(500).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
        return;
      }

      reply.send(
        result.value.map((k) => ({
          id: k.id,
          label: k.label,
          role: k.role,
          createdBy: k.createdBy,
          isActive: k.isActive,
          expiresAt: k.expiresAt?.toISOString() ?? null,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        })),
      );
    },
  );

  app.delete(
    "/api/keys/:id",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const result = await apiKeyRepo.revokeApiKey(app.db, id);

      if (result.isErr()) {
        reply.status(500).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
        return;
      }

      reply.status(204).send();
    },
  );
}
