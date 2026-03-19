import { describe, expect, it } from "vitest";
import {
  BranchProtectionSchema,
  BypassActorSchema,
  CapabilitySnapshotSchema,
  CodeownersSchema,
  MergeQueueConfigSchema,
  PushRestrictionsSchema,
  RequiredStatusCheckSchema,
  RequiredWorkflowSchema,
  RulesetRuleSchema,
  RulesetSchema,
} from "../src/schemas/capability.js";

function makeValidSnapshot() {
  return {
    repoId: "550e8400-e29b-41d4-a716-446655440000",
    capturedAt: "2026-03-18T10:00:00.000Z",
    sourceRevision: "abc123def456",
    defaultBranch: "main",
    visibility: "public",
    isArchived: false,
    isFork: false,
    hasWiki: true,
    hasProjects: false,
    branchProtection: null,
    rulesets: [],
    hasInheritedRulesets: false,
    codeowners: null,
    mergeQueue: null,
    allowedMergeStrategies: ["merge", "squash"],
    requiredStatusChecks: [],
    requiredWorkflows: [],
    requiresSignedCommits: false,
    requiresLinearHistory: false,
    requiresConversationResolution: false,
    dismissesStaleReviews: false,
    requiredReviewCount: 0,
    requiresCodeOwnerReview: false,
    lastPusherCannotApprove: false,
    hasPullRequestTargetWorkflows: false,
    pullRequestTargetWorkflowPaths: [],
    pushRestrictions: null,
    bypassActors: [],
    environments: ["staging", "production"],
    repoClass: "A",
    supportedByFactory: true,
    unsupportedReasons: [],
    warnings: [],
  };
}

describe("CapabilitySnapshotSchema", () => {
  it("validates a complete valid snapshot", () => {
    const result = CapabilitySnapshotSchema.safeParse(makeValidSnapshot());
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = CapabilitySnapshotSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid repoClass enum value", () => {
    const snapshot = { ...makeValidSnapshot(), repoClass: "D" };
    const result = CapabilitySnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects invalid visibility enum value", () => {
    const snapshot = { ...makeValidSnapshot(), visibility: "secret" };
    const result = CapabilitySnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("strict mode rejects extra fields", () => {
    const snapshot = { ...makeValidSnapshot(), extraField: "nope" };
    const result = CapabilitySnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("validates snapshot with full branchProtection", () => {
    const snapshot = {
      ...makeValidSnapshot(),
      branchProtection: {
        requiredReviewCount: 2,
        dismissesStaleReviews: true,
        requiresCodeOwnerReview: true,
        lastPusherCannotApprove: true,
        requiredStatusChecks: [{ context: "ci/test", appId: null }],
        enforceAdmins: false,
        requireLinearHistory: true,
        allowForcePushes: false,
        allowDeletions: false,
        requiredSignatures: true,
        requiresConversationResolution: true,
        restrictions: { users: ["admin"], teams: ["core"], apps: ["bot"] },
      },
    };
    const result = CapabilitySnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it("validates snapshot with rulesets", () => {
    const snapshot = {
      ...makeValidSnapshot(),
      rulesets: [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
          sourceType: "repository",
          bypassActors: [
            {
              actorId: 42,
              actorType: "User",
              bypassMode: "always",
            },
          ],
          conditions: {
            refName: { include: ["refs/heads/main"], exclude: [] },
          },
          rules: [
            { type: "required_signatures" },
            { type: "required_linear_history" },
          ],
        },
      ],
      hasInheritedRulesets: false,
    };
    const result = CapabilitySnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it("validates snapshot with codeowners", () => {
    const snapshot = {
      ...makeValidSnapshot(),
      codeowners: {
        found: true,
        location: ".github/CODEOWNERS",
        entries: [{ pattern: "*.ts", owners: ["@team"], lineNumber: 1 }],
        parseErrors: [],
      },
    };
    const result = CapabilitySnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it("validates snapshot with merge queue", () => {
    const snapshot = {
      ...makeValidSnapshot(),
      mergeQueue: {
        enabled: true,
        mergeMethod: "squash",
        minEntriesToMerge: 1,
        maxEntriesToMerge: 5,
        groupingStrategy: "NONE",
        checkResponseTimeout: 3600,
      },
    };
    const result = CapabilitySnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });
});

describe("sub-schemas validate independently", () => {
  it("BypassActorSchema validates", () => {
    const result = BypassActorSchema.safeParse({
      actorId: 1,
      actorType: "Team",
      bypassMode: "pull_request_only",
    });
    expect(result.success).toBe(true);
  });

  it("BypassActorSchema rejects invalid actorType", () => {
    const result = BypassActorSchema.safeParse({
      actorId: 1,
      actorType: "Robot",
      bypassMode: "always",
    });
    expect(result.success).toBe(false);
  });

  it("RequiredStatusCheckSchema validates", () => {
    const result = RequiredStatusCheckSchema.safeParse({
      context: "ci/build",
      appId: 12345,
    });
    expect(result.success).toBe(true);
  });

  it("RequiredWorkflowSchema validates", () => {
    const result = RequiredWorkflowSchema.safeParse({
      path: ".github/workflows/required.yml",
      repositoryId: 999,
      fileSha: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("PushRestrictionsSchema validates", () => {
    const result = PushRestrictionsSchema.safeParse({
      filePathRestrictions: ["/secret"],
      maxFilePathLength: 256,
      fileExtensionRestrictions: [".exe"],
    });
    expect(result.success).toBe(true);
  });

  it("CodeownersSchema validates", () => {
    const result = CodeownersSchema.safeParse({
      found: true,
      location: "CODEOWNERS",
      entries: [{ pattern: "*", owners: ["@all"], lineNumber: 1 }],
      parseErrors: [],
    });
    expect(result.success).toBe(true);
  });

  it("MergeQueueConfigSchema validates", () => {
    const result = MergeQueueConfigSchema.safeParse({
      enabled: true,
      mergeMethod: "squash",
      minEntriesToMerge: 1,
      maxEntriesToMerge: 5,
      groupingStrategy: "NONE",
      checkResponseTimeout: 3600,
    });
    expect(result.success).toBe(true);
  });

  it("BranchProtectionSchema validates", () => {
    const result = BranchProtectionSchema.safeParse({
      requiredReviewCount: 1,
      dismissesStaleReviews: false,
      requiresCodeOwnerReview: false,
      lastPusherCannotApprove: false,
      requiredStatusChecks: [],
      enforceAdmins: false,
      requireLinearHistory: false,
      allowForcePushes: false,
      allowDeletions: false,
      requiredSignatures: false,
      requiresConversationResolution: false,
      restrictions: null,
    });
    expect(result.success).toBe(true);
  });

  it("RulesetRuleSchema validates pull_request rule", () => {
    const result = RulesetRuleSchema.safeParse({
      type: "pull_request",
      requiredApprovingReviewCount: 2,
      dismissStaleReviewsOnPush: true,
      requireCodeOwnerReview: true,
      requireLastPushApproval: false,
      requiredReviewThreadResolution: true,
    });
    expect(result.success).toBe(true);
  });

  it("RulesetRuleSchema validates required_status_checks rule", () => {
    const result = RulesetRuleSchema.safeParse({
      type: "required_status_checks",
      requiredStatusChecks: [{ context: "ci/build", integrationId: null }],
      strictRequiredStatusChecksPolicy: true,
    });
    expect(result.success).toBe(true);
  });

  it("RulesetRuleSchema validates pattern rule", () => {
    const result = RulesetRuleSchema.safeParse({
      type: "commit_message_pattern",
      parameters: {
        name: "conventional-commits",
        negate: false,
        operator: "regex",
        pattern: "^(feat|fix|chore): .+",
      },
    });
    expect(result.success).toBe(true);
  });

  it("RulesetSchema validates with all fields", () => {
    const result = RulesetSchema.safeParse({
      id: 1,
      name: "main-protection",
      target: "branch",
      enforcement: "active",
      sourceType: "organization",
      bypassActors: [],
      conditions: { refName: { include: ["refs/heads/main"], exclude: [] } },
      rules: [{ type: "creation" }, { type: "deletion" }],
    });
    expect(result.success).toBe(true);
  });
});
