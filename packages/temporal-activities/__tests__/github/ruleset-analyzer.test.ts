import type { BranchProtection, Ruleset } from "@software-factory/core";
import { describe, expect, it } from "vitest";
import {
  getEffectiveRules,
  hasInheritedRulesets,
  parseRulesetResponse,
} from "../../src/github/ruleset-analyzer.js";
import type { GitHubRulesetResponse } from "../../src/github/ruleset-analyzer.js";

function makeRawRuleset(
  overrides: Partial<GitHubRulesetResponse> = {},
): GitHubRulesetResponse {
  return {
    id: 1,
    name: "test-ruleset",
    target: "branch",
    enforcement: "active",
    source_type: "Repository",
    source: "owner/repo",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["refs/heads/main"],
        exclude: [],
      },
    },
    rules: [],
    ...overrides,
  };
}

describe("parseRulesetResponse", () => {
  it("extracts pull_request rule fields", () => {
    const raw = makeRawRuleset({
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 2,
            dismiss_stale_reviews_on_push: true,
            require_code_owner_review: true,
            require_last_push_approval: false,
            required_review_thread_resolution: true,
          },
        },
      ],
    });

    const ruleset = parseRulesetResponse(raw);
    const prRule = ruleset.rules.find((r) => r.type === "pull_request");
    expect(prRule).toBeDefined();
    if (prRule?.type === "pull_request") {
      expect(prRule.requiredApprovingReviewCount).toBe(2);
      expect(prRule.dismissStaleReviewsOnPush).toBe(true);
      expect(prRule.requireCodeOwnerReview).toBe(true);
      expect(prRule.requireLastPushApproval).toBe(false);
      expect(prRule.requiredReviewThreadResolution).toBe(true);
    }
  });

  it("extracts required_status_checks contexts and app IDs", () => {
    const raw = makeRawRuleset({
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: "ci/build", integration_id: 123 },
              { context: "ci/test", integration_id: null },
            ],
          },
        },
      ],
    });

    const ruleset = parseRulesetResponse(raw);
    const checkRule = ruleset.rules.find(
      (r) => r.type === "required_status_checks",
    );
    expect(checkRule).toBeDefined();
    if (checkRule?.type === "required_status_checks") {
      expect(checkRule.requiredStatusChecks).toHaveLength(2);
      expect(checkRule.requiredStatusChecks[0].context).toBe("ci/build");
      expect(checkRule.requiredStatusChecks[0].integrationId).toBe(123);
      expect(checkRule.requiredStatusChecks[1].integrationId).toBe(null);
    }
  });

  it("identifies inherited org ruleset", () => {
    const raw = makeRawRuleset({
      source_type: "Organization",
      source: "my-org",
    });
    const ruleset = parseRulesetResponse(raw);
    expect(ruleset.sourceType).toBe("organization");
  });

  it("identifies repository ruleset", () => {
    const raw = makeRawRuleset({ source_type: "Repository" });
    const ruleset = parseRulesetResponse(raw);
    expect(ruleset.sourceType).toBe("repository");
  });

  it("extracts bypass actors with correct types and modes", () => {
    const raw = makeRawRuleset({
      bypass_actors: [
        { actor_id: 1, actor_type: "Team", bypass_mode: "always" },
        {
          actor_id: 2,
          actor_type: "Integration",
          bypass_mode: "pull_request_only",
        },
        {
          actor_id: 3,
          actor_type: "OrganizationAdmin",
          bypass_mode: "always",
        },
      ],
    });

    const ruleset = parseRulesetResponse(raw);
    expect(ruleset.bypassActors).toHaveLength(3);
    expect(ruleset.bypassActors[0]).toEqual({
      actorId: 1,
      actorType: "Team",
      bypassMode: "always",
    });
    expect(ruleset.bypassActors[1]).toEqual({
      actorId: 2,
      actorType: "App",
      bypassMode: "pull_request_only",
    });
    expect(ruleset.bypassActors[2].actorType).toBe("OrganizationAdmin");
  });

  it("parses merge_queue rule", () => {
    const raw = makeRawRuleset({
      rules: [
        {
          type: "merge_queue",
          parameters: {
            merge_method: "squash",
            min_entries_to_merge: 2,
            max_entries_to_merge: 10,
            grouping_strategy: "ALLGREEN",
            check_response_timeout_minutes: 1800,
          },
        },
      ],
    });

    const ruleset = parseRulesetResponse(raw);
    const mqRule = ruleset.rules.find((r) => r.type === "merge_queue");
    expect(mqRule).toBeDefined();
    if (mqRule?.type === "merge_queue") {
      expect(mqRule.mergeMethod).toBe("squash");
      expect(mqRule.minEntriesToMerge).toBe(2);
    }
  });

  it("parses required_signatures rule", () => {
    const raw = makeRawRuleset({
      rules: [{ type: "required_signatures" }],
    });
    const ruleset = parseRulesetResponse(raw);
    expect(ruleset.rules).toContainEqual({ type: "required_signatures" });
  });

  it("parses required_linear_history rule", () => {
    const raw = makeRawRuleset({
      rules: [{ type: "required_linear_history" }],
    });
    const ruleset = parseRulesetResponse(raw);
    expect(ruleset.rules).toContainEqual({ type: "required_linear_history" });
  });

  it("parses file_path_restriction rule", () => {
    const raw = makeRawRuleset({
      rules: [
        {
          type: "file_path_restriction",
          parameters: {
            restricted_file_paths: ["/secrets", "/.env"],
          },
        },
      ],
    });

    const ruleset = parseRulesetResponse(raw);
    const fpRule = ruleset.rules.find(
      (r) => r.type === "file_path_restriction",
    );
    expect(fpRule).toBeDefined();
    if (fpRule?.type === "file_path_restriction") {
      expect(fpRule.restrictedFilePaths).toEqual(["/secrets", "/.env"]);
    }
  });

  it("skips unknown rule types", () => {
    const raw = makeRawRuleset({
      rules: [{ type: "required_signatures" }, { type: "some_future_rule" }],
    });
    const ruleset = parseRulesetResponse(raw);
    expect(ruleset.rules).toHaveLength(1);
  });
});

describe("getEffectiveRules", () => {
  it("returns defaults for empty rulesets", () => {
    const effective = getEffectiveRules([]);
    expect(effective.requiresSignedCommits).toBe(false);
    expect(effective.requiresLinearHistory).toBe(false);
    expect(effective.requiredReviewCount).toBe(0);
    expect(effective.mergeQueue).toBe(null);
    expect(effective.pushRestrictions).toBe(null);
    expect(effective.bypassActors).toHaveLength(0);
  });

  it("stacks rulesets — takes highest review count", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        name: "r1",
        target: "branch",
        enforcement: "active",
        sourceType: "repository",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [{ type: "pull_request", requiredApprovingReviewCount: 1 }],
      },
      {
        id: 2,
        name: "r2",
        target: "branch",
        enforcement: "active",
        sourceType: "organization",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [{ type: "pull_request", requiredApprovingReviewCount: 3 }],
      },
    ];
    const effective = getEffectiveRules(rulesets);
    expect(effective.requiredReviewCount).toBe(3);
  });

  it("merges branch protection with rulesets", () => {
    const branchProtection: BranchProtection = {
      requiredReviewCount: 2,
      dismissesStaleReviews: true,
      requiresCodeOwnerReview: false,
      lastPusherCannotApprove: false,
      requiredStatusChecks: [{ context: "ci/legacy", appId: null }],
      enforceAdmins: false,
      requireLinearHistory: false,
      allowForcePushes: false,
      allowDeletions: false,
      requiredSignatures: true,
      requiresConversationResolution: false,
      restrictions: null,
    };

    const rulesets: Ruleset[] = [
      {
        id: 1,
        name: "r1",
        target: "branch",
        enforcement: "active",
        sourceType: "repository",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [
          { type: "required_linear_history" },
          {
            type: "required_status_checks",
            requiredStatusChecks: [{ context: "ci/new", integrationId: 42 }],
          },
        ],
      },
    ];

    const effective = getEffectiveRules(rulesets, branchProtection);
    expect(effective.requiresSignedCommits).toBe(true); // from branch protection
    expect(effective.requiresLinearHistory).toBe(true); // from ruleset
    expect(effective.requiredReviewCount).toBe(2); // from branch protection
    expect(effective.dismissesStaleReviews).toBe(true); // from branch protection
    expect(effective.requiredStatusChecks).toHaveLength(2); // combined
  });

  it("detects merge queue from ruleset", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        name: "mq",
        target: "branch",
        enforcement: "active",
        sourceType: "repository",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [
          {
            type: "merge_queue",
            mergeMethod: "squash",
            minEntriesToMerge: 2,
            maxEntriesToMerge: 10,
            groupingStrategy: "ALLGREEN",
            checkResponseTimeout: 1800,
          },
        ],
      },
    ];

    const effective = getEffectiveRules(rulesets);
    expect(effective.mergeQueue).not.toBe(null);
    expect(effective.mergeQueue?.enabled).toBe(true);
    expect(effective.mergeQueue?.mergeMethod).toBe("squash");
  });

  it("collects file path restrictions into pushRestrictions", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        name: "fp",
        target: "branch",
        enforcement: "active",
        sourceType: "repository",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [
          {
            type: "file_path_restriction",
            restrictedFilePaths: ["/secrets"],
          },
          {
            type: "max_file_path_length",
            maxFilePathLength: 200,
          },
        ],
      },
    ];

    const effective = getEffectiveRules(rulesets);
    expect(effective.pushRestrictions).not.toBe(null);
    expect(effective.pushRestrictions?.filePathRestrictions).toEqual([
      "/secrets",
    ]);
    expect(effective.pushRestrictions?.maxFilePathLength).toBe(200);
  });

  it("skips disabled rulesets", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        name: "disabled",
        target: "branch",
        enforcement: "disabled",
        sourceType: "repository",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [{ type: "required_signatures" }],
      },
    ];

    const effective = getEffectiveRules(rulesets);
    expect(effective.requiresSignedCommits).toBe(false);
  });
});

describe("hasInheritedRulesets", () => {
  it("returns false for empty array", () => {
    expect(hasInheritedRulesets([])).toBe(false);
  });

  it("returns false for repository-only rulesets", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        name: "r1",
        target: "branch",
        enforcement: "active",
        sourceType: "repository",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [],
      },
    ];
    expect(hasInheritedRulesets(rulesets)).toBe(false);
  });

  it("returns true when org rulesets are present", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        name: "org-rule",
        target: "branch",
        enforcement: "active",
        sourceType: "organization",
        bypassActors: [],
        conditions: { refName: { include: [], exclude: [] } },
        rules: [],
      },
    ];
    expect(hasInheritedRulesets(rulesets)).toBe(true);
  });
});
