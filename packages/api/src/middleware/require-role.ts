import type { Role } from "@software-factory/core";
import type { FastifyReply, FastifyRequest } from "fastify";

export function requireRole(
  ...roles: readonly Role[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (!request.actor || !roles.includes(request.actor.role)) {
      reply.status(403).send({
        error: { code: "forbidden", message: "Insufficient permissions" },
      });
      return;
    }
  };
}
