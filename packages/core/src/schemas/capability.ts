import { z } from "zod";

// === Sub-schemas ===

export const BypassActorSchema = z
  .object({
    actorId: z.number(),
    actorType: z.enum(["User", "Team", "App", "OrganizationAdmin"]),
    bypassMode: z.enum(["always", "pull_request_only"]),
  })
  .strict();

export type BypassActor = z.infer<typeof BypassActorSchema>;

export const RequiredStatusCheckSchema = z
  .object({
    context: z.string(),
    appId: z.number().nullable(),
  })
  .strict();

export type RequiredStatusCheck = z.infer<typeof RequiredStatusCheckSchema>;

export const RequiredWorkflowSchema = z
  .object({
    path: z.string(),
    repositoryId: z.number(),
    fileSha: z.string(),
  })
  .strict();

export type RequiredWorkflow = z.infer<typeof RequiredWorkflowSchema>;

export const PushRestrictionsSchema = z
  .object({
    filePathRestrictions: z.array(z.string()),
    maxFilePathLength: z.number().nullable(),
    fileExtensionRestrictions: z.array(z.string()),
  })
  .strict();

export type PushRestrictions = z.infer<typeof PushRestrictionsSchema>;

export const CodeownersEntrySchema = z
  .object({
    pattern: z.string(),
    owners: z.array(z.string()),
    lineNumber: z.number(),
  })
  .strict();

export type CodeownersEntry = z.infer<typeof CodeownersEntrySchema>;

export const CODEOWNERS_LOCATIONS = [
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
] as const;

export const CodeownersSchema = z
  .object({
    found: z.boolean(),
    location: z.string(),
    entries: z.array(CodeownersEntrySchema),
    parseErrors: z.array(z.string()),
  })
  .strict();

export type Codeowners = z.infer<typeof CodeownersSchema>;

export const MergeQueueConfigSchema = z
  .object({
    enabled: z.boolean(),
    mergeMethod: z.string(),
    minEntriesToMerge: z.number(),
    maxEntriesToMerge: z.number(),
    groupingStrategy: z.string(),
    checkResponseTimeout: z.number(),
  })
  .strict();

export type MergeQueueConfig = z.infer<typeof MergeQueueConfigSchema>;

// === Branch Protection (legacy API) ===

export const BranchProtectionSchema = z
  .object({
    requiredReviewCount: z.number(),
    dismissesStaleReviews: z.boolean(),
    requiresCodeOwnerReview: z.boolean(),
    lastPusherCannotApprove: z.boolean(),
    requiredStatusChecks: z.array(RequiredStatusCheckSchema),
    enforceAdmins: z.boolean(),
    requireLinearHistory: z.boolean(),
    allowForcePushes: z.boolean(),
    allowDeletions: z.boolean(),
    requiredSignatures: z.boolean(),
    requiresConversationResolution: z.boolean(),
    restrictions: z
      .object({
        users: z.array(z.string()),
        teams: z.array(z.string()),
        apps: z.array(z.string()),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type BranchProtection = z.infer<typeof BranchProtectionSchema>;

// === Ruleset Rules (18 types as discriminated union) ===

const PatternParamsSchema = z
  .object({
    name: z.string().optional(),
    negate: z.boolean().optional(),
    operator: z
      .enum(["starts_with", "ends_with", "contains", "regex"])
      .optional(),
    pattern: z.string().optional(),
  })
  .strict();

export const RulesetRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("creation") }).strict(),
  z
    .object({
      type: z.literal("update"),
      updateAllowsFetchAndMerge: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("deletion") }).strict(),
  z.object({ type: z.literal("required_linear_history") }).strict(),
  z
    .object({
      type: z.literal("merge_queue"),
      mergeMethod: z.string().optional(),
      minEntriesToMerge: z.number().optional(),
      maxEntriesToMerge: z.number().optional(),
      groupingStrategy: z.string().optional(),
      checkResponseTimeout: z.number().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("required_deployments"),
      requiredDeploymentEnvironments: z.array(z.string()),
    })
    .strict(),
  z.object({ type: z.literal("required_signatures") }).strict(),
  z
    .object({
      type: z.literal("pull_request"),
      requiredApprovingReviewCount: z.number().optional(),
      dismissStaleReviewsOnPush: z.boolean().optional(),
      requireCodeOwnerReview: z.boolean().optional(),
      requireLastPushApproval: z.boolean().optional(),
      requiredReviewThreadResolution: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("required_status_checks"),
      requiredStatusChecks: z.array(
        z
          .object({
            context: z.string(),
            integrationId: z.number().nullable().optional(),
          })
          .strict(),
      ),
      strictRequiredStatusChecksPolicy: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("non_fast_forward") }).strict(),
  z
    .object({
      type: z.literal("commit_message_pattern"),
      parameters: PatternParamsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("commit_author_email_pattern"),
      parameters: PatternParamsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("committer_email_pattern"),
      parameters: PatternParamsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("branch_name_pattern"),
      parameters: PatternParamsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("tag_name_pattern"),
      parameters: PatternParamsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("file_path_restriction"),
      restrictedFilePaths: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      type: z.literal("max_file_path_length"),
      maxFilePathLength: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal("file_extension_restriction"),
      restrictedFileExtensions: z.array(z.string()),
    })
    .strict(),
]);

export type RulesetRule = z.infer<typeof RulesetRuleSchema>;

export const RULESET_RULE_TYPES = [
  "creation",
  "update",
  "deletion",
  "required_linear_history",
  "merge_queue",
  "required_deployments",
  "required_signatures",
  "pull_request",
  "required_status_checks",
  "non_fast_forward",
  "commit_message_pattern",
  "commit_author_email_pattern",
  "committer_email_pattern",
  "branch_name_pattern",
  "tag_name_pattern",
  "file_path_restriction",
  "max_file_path_length",
  "file_extension_restriction",
] as const;

export type RulesetRuleType = (typeof RULESET_RULE_TYPES)[number];

export const RulesetSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    target: z.enum(["branch", "tag"]),
    enforcement: z.enum(["active", "disabled", "evaluate"]),
    sourceType: z.enum(["repository", "organization"]),
    bypassActors: z.array(BypassActorSchema),
    conditions: z
      .object({
        refName: z
          .object({
            include: z.array(z.string()),
            exclude: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    rules: z.array(RulesetRuleSchema),
  })
  .strict();

export type Ruleset = z.infer<typeof RulesetSchema>;

// === Dangerous Workflow Patterns ===

export const DANGEROUS_TRIGGERS = [
  "pull_request_target",
  "workflow_run",
] as const;

export type DangerousTrigger = (typeof DANGEROUS_TRIGGERS)[number];

export const DangerousWorkflowSchema = z
  .object({
    path: z.string(),
    triggers: z.array(z.enum(DANGEROUS_TRIGGERS)),
  })
  .strict();

export type DangerousWorkflow = z.infer<typeof DangerousWorkflowSchema>;

// === CapabilitySnapshot (main output) ===

export const CapabilitySnapshotSchema = z
  .object({
    // Metadata
    repoId: z.string().uuid(),
    capturedAt: z.string().datetime(),
    sourceRevision: z.string(),

    // Repository basics
    defaultBranch: z.string(),
    visibility: z.enum(["public", "private", "internal"]),
    isArchived: z.boolean(),
    isFork: z.boolean(),
    hasWiki: z.boolean(),
    hasProjects: z.boolean(),

    // Branch protection (legacy API — may coexist with rulesets)
    branchProtection: BranchProtectionSchema.nullable(),

    // Rulesets (modern — includes inherited from org)
    rulesets: z.array(RulesetSchema),
    hasInheritedRulesets: z.boolean(),

    // CODEOWNERS
    codeowners: CodeownersSchema.nullable(),

    // Merge configuration
    mergeQueue: MergeQueueConfigSchema.nullable(),
    allowedMergeStrategies: z.array(z.enum(["merge", "squash", "rebase"])),

    // Required checks
    requiredStatusChecks: z.array(RequiredStatusCheckSchema),
    requiredWorkflows: z.array(RequiredWorkflowSchema),

    // Signing
    requiresSignedCommits: z.boolean(),
    requiresLinearHistory: z.boolean(),

    // Conversation / review requirements
    requiresConversationResolution: z.boolean(),
    dismissesStaleReviews: z.boolean(),
    requiredReviewCount: z.number(),
    requiresCodeOwnerReview: z.boolean(),
    lastPusherCannotApprove: z.boolean(),

    // Dangerous patterns detected
    hasPullRequestTargetWorkflows: z.boolean(),
    pullRequestTargetWorkflowPaths: z.array(z.string()),

    // Push restrictions (from rulesets)
    pushRestrictions: PushRestrictionsSchema.nullable(),

    // Bypass actors (who can bypass rulesets)
    bypassActors: z.array(BypassActorSchema),

    // Environments (deployment gates)
    environments: z.array(z.string()),

    // Classification
    repoClass: z.enum(["A", "B", "C"]),
    supportedByFactory: z.boolean(),
    unsupportedReasons: z.array(z.string()),

    // Warnings
    warnings: z.array(z.string()),
  })
  .strict();

export type CapabilitySnapshot = z.infer<typeof CapabilitySnapshotSchema>;
