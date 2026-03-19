export interface RateLimitInfo {
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
  readonly used: number;
  readonly resource: string;
}

export interface ThrottleDecision {
  readonly throttle: boolean;
  readonly waitMs?: number;
}

type ResponseHeaders = Record<string, string | undefined>;

const DEFAULT_THRESHOLD = 0.2; // Warn and throttle when remaining < 20% of limit

export function parseRateLimitHeaders(
  headers: ResponseHeaders,
): RateLimitInfo | null {
  const limit = headers["x-ratelimit-limit"];
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];
  const used = headers["x-ratelimit-used"];
  const resource = headers["x-ratelimit-resource"];

  if (!limit || !remaining || !reset) {
    return null;
  }

  return {
    limit: Number(limit),
    remaining: Number(remaining),
    reset: Number(reset),
    used: Number(used ?? "0"),
    resource: resource ?? "core",
  };
}

export function shouldThrottle(
  headers: ResponseHeaders,
  threshold: number = DEFAULT_THRESHOLD,
): ThrottleDecision {
  // Check for secondary rate limit (429 with retry-after)
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    return { throttle: true, waitMs: Number(retryAfter) * 1000 };
  }

  const info = parseRateLimitHeaders(headers);
  if (!info) {
    return { throttle: false };
  }

  if (info.remaining < info.limit * threshold) {
    // Calculate wait time until reset
    const resetMs = info.reset * 1000 - Date.now();
    const waitMs = Math.max(resetMs, 1000);
    return { throttle: true, waitMs };
  }

  return { throttle: false };
}

/**
 * Enforces 1-second serialization between mutation API calls
 * per GitHub best practices.
 */
export class MutationSerializer {
  private lastMutationAt = 0;

  async waitForSlot(): Promise<void> {
    const elapsed = Date.now() - this.lastMutationAt;
    if (elapsed < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
    }
    this.lastMutationAt = Date.now();
  }
}
