import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

const USER_AGENT = "software-factory/0.1.0";
const API_VERSION = "2022-11-28";

export const RATE_LIMIT_HEADERS = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-used",
  "x-ratelimit-resource",
] as const;

export function createRestClient(token: string): Octokit {
  return new Octokit({
    auth: token,
    userAgent: USER_AGENT,
    request: {
      headers: {
        "X-GitHub-Api-Version": API_VERSION,
      },
    },
  });
}

export function createGraphQLClient(token: string): typeof graphql {
  return graphql.defaults({
    headers: {
      authorization: `token ${token}`,
      "user-agent": USER_AGENT,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
}
