import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_RETRY_POLICIES,
  getRetryPolicy,
} from "../src/errors/error-codes.js";
import { createFactoryError } from "../src/errors/factory-error.js";

describe("error codes", () => {
  it("defines exactly 11 error codes", () => {
    expect(ERROR_CODES).toHaveLength(11);
  });

  it("has a retry policy for every error code", () => {
    for (const code of ERROR_CODES) {
      const policy = ERROR_RETRY_POLICIES[code];
      expect(policy).toBeDefined();
      expect(typeof policy.retryable).toBe("boolean");
      expect(typeof policy.maxAttempts).toBe("number");
      expect(typeof policy.backoffMs).toBe("number");
    }
  });
});

describe("specific error policies", () => {
  it("policy_denied is not retryable", () => {
    const policy = getRetryPolicy("policy_denied");
    expect(policy.retryable).toBe(false);
    expect(policy.maxAttempts).toBe(1);
  });

  it("github_transient is retryable with 8 attempts", () => {
    const policy = getRetryPolicy("github_transient");
    expect(policy.retryable).toBe(true);
    expect(policy.maxAttempts).toBe(8);
  });

  it("sandbox_failure is retryable with 3 attempts", () => {
    const policy = getRetryPolicy("sandbox_failure");
    expect(policy.retryable).toBe(true);
    expect(policy.maxAttempts).toBe(3);
  });

  it("model_rate_limited is retryable with 6 attempts", () => {
    const policy = getRetryPolicy("model_rate_limited");
    expect(policy.retryable).toBe(true);
    expect(policy.maxAttempts).toBe(6);
  });

  it("evidence_invariant_fail is not retryable", () => {
    const policy = getRetryPolicy("evidence_invariant_fail");
    expect(policy.retryable).toBe(false);
    expect(policy.maxAttempts).toBe(1);
  });

  it("unknown_internal is not retryable", () => {
    const policy = getRetryPolicy("unknown_internal");
    expect(policy.retryable).toBe(false);
    expect(policy.maxAttempts).toBe(1);
  });
});

describe("createFactoryError", () => {
  it("creates error with context", () => {
    const error = createFactoryError(
      "policy_denied",
      "Cannot write to protected path",
      { path: ".github/workflows/ci.yml" },
    );
    expect(error.code).toBe("policy_denied");
    expect(error.message).toBe("Cannot write to protected path");
    expect(error.retryable).toBe(false);
    expect(error.context).toEqual({ path: ".github/workflows/ci.yml" });
  });

  it("creates error without context", () => {
    const error = createFactoryError("github_transient", "Rate limited");
    expect(error.code).toBe("github_transient");
    expect(error.retryable).toBe(true);
    expect(error.context).toBeUndefined();
  });

  it("derives retryable from error code, not manual override", () => {
    const error = createFactoryError("policy_denied", "blocked");
    expect(error.retryable).toBe(false);

    const error2 = createFactoryError("sandbox_failure", "OOM");
    expect(error2.retryable).toBe(true);
  });
});
