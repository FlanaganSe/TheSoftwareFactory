import type { Result } from "neverthrow";
import { getRetryPolicy } from "./error-codes.js";
import type { ErrorCode } from "./error-codes.js";

export interface FactoryError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly context?: Readonly<Record<string, unknown>>;
}

export function createFactoryError(
  code: ErrorCode,
  message: string,
  context?: Record<string, unknown>,
): FactoryError {
  return { code, message, retryable: getRetryPolicy(code).retryable, context };
}

export type FactoryResult<T> = Result<T, FactoryError>;
