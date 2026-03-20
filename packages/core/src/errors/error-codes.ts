import { z } from "zod";

export const ERROR_CODES = [
  "policy_denied",
  "github_transient",
  "github_auth_expired",
  "workflow_timeout",
  "sandbox_failure",
  "model_rate_limited",
  "model_validation_fail",
  "evidence_invariant_fail",
  "storage_unavailable",
  "service_unavailable",
  "unknown_internal",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export interface ErrorRetryPolicy {
  readonly retryable: boolean;
  readonly maxAttempts: number;
  readonly backoffMs: number;
}

export const ERROR_RETRY_POLICIES: Readonly<
  Record<ErrorCode, ErrorRetryPolicy>
> = {
  policy_denied: { retryable: false, maxAttempts: 1, backoffMs: 0 },
  github_transient: { retryable: true, maxAttempts: 8, backoffMs: 15_000 },
  github_auth_expired: { retryable: true, maxAttempts: 3, backoffMs: 5_000 },
  workflow_timeout: { retryable: true, maxAttempts: 3, backoffMs: 30_000 },
  sandbox_failure: { retryable: true, maxAttempts: 3, backoffMs: 5_000 },
  model_rate_limited: { retryable: true, maxAttempts: 6, backoffMs: 10_000 },
  model_validation_fail: { retryable: true, maxAttempts: 2, backoffMs: 1_000 },
  evidence_invariant_fail: { retryable: false, maxAttempts: 1, backoffMs: 0 },
  storage_unavailable: { retryable: true, maxAttempts: 5, backoffMs: 30_000 },
  service_unavailable: { retryable: true, maxAttempts: 3, backoffMs: 10_000 },
  unknown_internal: { retryable: false, maxAttempts: 1, backoffMs: 0 },
};

export function getRetryPolicy(code: ErrorCode): ErrorRetryPolicy {
  return ERROR_RETRY_POLICIES[code];
}
