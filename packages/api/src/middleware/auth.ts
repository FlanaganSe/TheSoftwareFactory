import type { ActorIdentity } from "@software-factory/core";
import { apiKeyRepo } from "@software-factory/db";
import type { DbInstance } from "@software-factory/db";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    actor: ActorIdentity;
  }
  interface FastifyInstance {
    db: DbInstance;
    dbPool: unknown;
    webhookSecret: string;
    redisUrl?: string;
    temporalAddress?: string;
    temporalClient?: import("@temporalio/client").Client;
    minioEndpoint?: string;
    // biome-ignore format: keep import on single line for declaration merging
    credentialBroker?: import("@software-factory/temporal-activities").CredentialBroker;
    githubInstallationId?: number;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.status(401).send({
      error: {
        code: "unauthorized",
        message: "Missing or invalid authorization header",
      },
    });
    return;
  }

  const rawKey = authHeader.slice(7);
  const result = await apiKeyRepo.validateApiKey(request.server.db, rawKey);

  if (result.isErr()) {
    reply.status(401).send({
      error: { code: "unauthorized", message: "Invalid API key" },
    });
    return;
  }

  const credential = result.value;

  request.actor = {
    actorId: credential.id,
    actorType: "operator",
    role: credential.role,
  };
}
