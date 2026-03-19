import { describe, expect, it } from "vitest";
import {
  MutationSerializer,
  parseRateLimitHeaders,
  shouldThrottle,
} from "../src/github/rate-limiter.js";

describe("parseRateLimitHeaders", () => {
  it("parses valid rate limit headers", () => {
    const headers = {
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4990",
      "x-ratelimit-reset": "1700000000",
      "x-ratelimit-used": "10",
      "x-ratelimit-resource": "core",
    };

    const info = parseRateLimitHeaders(headers);
    expect(info).not.toBeNull();
    expect(info?.limit).toBe(5000);
    expect(info?.remaining).toBe(4990);
    expect(info?.reset).toBe(1700000000);
    expect(info?.used).toBe(10);
    expect(info?.resource).toBe("core");
  });

  it("returns null when required headers are missing", () => {
    expect(parseRateLimitHeaders({})).toBeNull();
    expect(parseRateLimitHeaders({ "x-ratelimit-limit": "5000" })).toBeNull();
  });

  it("handles missing optional headers gracefully", () => {
    const info = parseRateLimitHeaders({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "100",
      "x-ratelimit-reset": "1700000000",
    });

    expect(info).not.toBeNull();
    expect(info?.used).toBe(0);
    expect(info?.resource).toBe("core");
  });
});

describe("shouldThrottle", () => {
  it("returns false when remaining is above threshold", () => {
    const result = shouldThrottle({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4000",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    });

    expect(result.throttle).toBe(false);
  });

  it("returns true when remaining is below threshold", () => {
    const result = shouldThrottle({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "500",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    });

    expect(result.throttle).toBe(true);
    expect(result.waitMs).toBeGreaterThan(0);
  });

  it("extracts retry-after from 429 response", () => {
    const result = shouldThrottle({
      "retry-after": "60",
    });

    expect(result.throttle).toBe(true);
    expect(result.waitMs).toBe(60000);
  });

  it("returns false with no headers", () => {
    expect(shouldThrottle({}).throttle).toBe(false);
  });
});

describe("MutationSerializer", () => {
  it("enforces 1-second gap between mutations", async () => {
    const serializer = new MutationSerializer();

    const start = Date.now();
    await serializer.waitForSlot();
    await serializer.waitForSlot();
    const elapsed = Date.now() - start;

    // Second call should have waited ~1 second
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});
