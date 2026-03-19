import type { FactoryError } from "@software-factory/core";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

const ERROR_STATUS_MAP: Record<string, number> = {
  policy_denied: 403,
  not_found: 404,
  github_transient: 502,
  github_auth_expired: 502,
  workflow_timeout: 504,
  sandbox_failure: 500,
  model_rate_limited: 503,
  model_validation_fail: 422,
  evidence_invariant_fail: 500,
  storage_unavailable: 503,
  unknown_internal: 500,
};

function isFactoryError(err: unknown): err is FactoryError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    "retryable" in err
  );
}

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (isFactoryError(error)) {
    const status = ERROR_STATUS_MAP[error.code] ?? 500;
    reply.status(status).send({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  // Fastify validation errors
  if ("validation" in error && (error as FastifyError).validation) {
    reply.status(400).send({
      error: { code: "validation_error", message: error.message },
    });
    return;
  }

  // Generic errors — never leak stack traces
  const status =
    "statusCode" in error ? ((error as FastifyError).statusCode ?? 500) : 500;
  reply.status(status).send({
    error: {
      code: "unknown_internal",
      message: status >= 500 ? "Internal server error" : error.message,
    },
  });
}
