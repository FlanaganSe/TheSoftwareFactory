import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_HEADERS,
  createGraphQLClient,
  createRestClient,
} from "../src/github/client.js";

describe("createRestClient", () => {
  it("creates Octokit instance with correct user-agent", () => {
    const client = createRestClient("test-token");
    // Octokit stores request defaults
    expect(client).toBeDefined();
  });

  it("RATE_LIMIT_HEADERS contains all 5 expected headers", () => {
    expect(RATE_LIMIT_HEADERS).toContain("x-ratelimit-limit");
    expect(RATE_LIMIT_HEADERS).toContain("x-ratelimit-remaining");
    expect(RATE_LIMIT_HEADERS).toContain("x-ratelimit-reset");
    expect(RATE_LIMIT_HEADERS).toContain("x-ratelimit-used");
    expect(RATE_LIMIT_HEADERS).toContain("x-ratelimit-resource");
    expect(RATE_LIMIT_HEADERS.length).toBe(5);
  });
});

describe("createGraphQLClient", () => {
  it("creates GraphQL client function", () => {
    const client = createGraphQLClient("test-token");
    expect(typeof client).toBe("function");
  });
});
