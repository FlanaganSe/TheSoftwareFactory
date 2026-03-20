import { createFactoryError } from "@software-factory/core";
import type { FactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { CircuitBreaker } from "./circuit-breaker.js";

export async function withCircuitBreaker<T>(
  circuitBreaker: CircuitBreaker,
  service: string,
  fn: () => Promise<T>,
): Promise<Result<T, FactoryError>> {
  const allowed = await circuitBreaker.canExecute(service);
  if (!allowed) {
    return err(
      createFactoryError(
        "service_unavailable",
        `Circuit breaker open for ${service} — request rejected`,
        { service },
      ),
    );
  }

  try {
    const result = await fn();
    await circuitBreaker.recordSuccess(service);
    return ok(result);
  } catch (error) {
    await circuitBreaker.recordFailure(service);
    return err(
      createFactoryError(
        "service_unavailable",
        `Service ${service} call failed: ${error instanceof Error ? error.message : String(error)}`,
        { service, originalError: String(error) },
      ),
    );
  }
}
