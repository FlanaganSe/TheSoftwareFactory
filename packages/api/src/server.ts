import type { DbConnection } from "@software-factory/db";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { errorHandler } from "./middleware/error-handler.js";

export interface ServerOptions {
  readonly port: number;
  readonly host: string;
  readonly logger: boolean;
  readonly dbConnection: DbConnection;
  readonly webhookSecret: string;
  readonly redisUrl?: string;
  readonly temporalAddress?: string;
  readonly minioEndpoint?: string;
}

export function createServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger
      ? {
          level: "info",
          transport: undefined, // structured JSON by default (pino)
        }
      : false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  // Decorate with shared state
  app.decorate("db", options.dbConnection.db);
  app.decorate("dbPool", options.dbConnection.pool);
  app.decorate("webhookSecret", options.webhookSecret);
  app.decorate("redisUrl", options.redisUrl);
  app.decorate("temporalAddress", options.temporalAddress);
  app.decorate("minioEndpoint", options.minioEndpoint);

  return app;
}
