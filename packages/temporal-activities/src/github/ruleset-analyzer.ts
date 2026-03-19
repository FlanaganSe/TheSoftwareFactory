import type {
  BranchProtection,
  BypassActor,
  MergeQueueConfig,
  PushRestrictions,
  RequiredStatusCheck,
  RequiredWorkflow,
  Ruleset,
  RulesetRule,
} from "@software-factory/core";

/**
 * Effective rules: merged view combining rulesets + legacy branch protection.
 * Both must be satisfied when both exist — they stack, not override.
 */
export interface EffectiveRules {
  readonly requiresSignedCommits: boolean;
  readonly requiresLinearHistory: boolean;
  readonly requiresConversationResolution: boolean;
  readonly dismissesStaleReviews: boolean;
  readonly requiredReviewCount: number;
  readonly requiresCodeOwnerReview: boolean;
  readonly lastPusherCannotApprove: boolean;
  readonly requiredStatusChecks: readonly RequiredStatusCheck[];
  readonly requiredWorkflows: readonly RequiredWorkflow[];
  readonly mergeQueue: MergeQueueConfig | null;
  readonly pushRestrictions: PushRestrictions | null;
  readonly bypassActors: readonly BypassActor[];
  readonly warnings: readonly string[];
}

/**
 * Parse a raw GitHub API ruleset response into a typed Ruleset.
 */
export function parseRulesetResponse(raw: GitHubRulesetResponse): Ruleset {
  const sourceType =
    raw.source_type === "Organization" ? "organization" : "repository";

  const bypassActors: BypassActor[] = (raw.bypass_actors ?? []).map(
    (actor) => ({
      actorId: actor.actor_id,
      actorType: mapActorType(actor.actor_type),
      bypassMode:
        actor.bypass_mode === "always" ? "always" : "pull_request_only",
    }),
  );

  const conditions = {
    refName: {
      include: [...(raw.conditions?.ref_name?.include ?? [])],
      exclude: [...(raw.conditions?.ref_name?.exclude ?? [])],
    },
  };

  const rules: RulesetRule[] = (raw.rules ?? [])
    .map((rule) => parseRule(rule))
    .filter((r): r is RulesetRule => r !== null);

  return {
    id: raw.id,
    name: raw.name,
    target: raw.target === "tag" ? "tag" : "branch",
    enforcement: mapEnforcement(raw.enforcement),
    sourceType,
    bypassActors,
    conditions,
    rules,
  };
}

/**
 * Compute effective rules by merging rulesets and optional legacy branch protection.
 * When both exist, constraints stack — both must be satisfied.
 */
export function getEffectiveRules(
  rulesets: readonly Ruleset[],
  branchProtection?: BranchProtection | null,
): EffectiveRules {
  const warnings: string[] = [];

  // Start with legacy branch protection defaults (or empty)
  let requiresSignedCommits = branchProtection?.requiredSignatures ?? false;
  let requiresLinearHistory = branchProtection?.requireLinearHistory ?? false;
  let requiresConversationResolution =
    branchProtection?.requiresConversationResolution ?? false;
  let dismissesStaleReviews = branchProtection?.dismissesStaleReviews ?? false;
  let requiredReviewCount = branchProtection?.requiredReviewCount ?? 0;
  let requiresCodeOwnerReview =
    branchProtection?.requiresCodeOwnerReview ?? false;
  let lastPusherCannotApprove =
    branchProtection?.lastPusherCannotApprove ?? false;

  const allStatusChecks: RequiredStatusCheck[] = [
    ...(branchProtection?.requiredStatusChecks ?? []),
  ];
  const allRequiredWorkflows: RequiredWorkflow[] = [];
  let mergeQueue: MergeQueueConfig | null = null;
  const allBypassActors: BypassActor[] = [];
  const allFilePathRestrictions: string[] = [];
  const allFileExtensionRestrictions: string[] = [];
  let maxFilePathLength: number | null = null;

  // Merge rules from all active rulesets
  for (const ruleset of rulesets) {
    if (ruleset.enforcement !== "active") {
      continue;
    }

    allBypassActors.push(...ruleset.bypassActors);

    for (const rule of ruleset.rules) {
      switch (rule.type) {
        case "required_signatures":
          requiresSignedCommits = true;
          break;
        case "required_linear_history":
          requiresLinearHistory = true;
          break;
        case "pull_request":
          if (
            rule.requiredApprovingReviewCount !== undefined &&
            rule.requiredApprovingReviewCount > requiredReviewCount
          ) {
            requiredReviewCount = rule.requiredApprovingReviewCount;
          }
          if (rule.dismissStaleReviewsOnPush) {
            dismissesStaleReviews = true;
          }
          if (rule.requireCodeOwnerReview) {
            requiresCodeOwnerReview = true;
          }
          if (rule.requireLastPushApproval) {
            lastPusherCannotApprove = true;
          }
          if (rule.requiredReviewThreadResolution) {
            requiresConversationResolution = true;
          }
          break;
        case "required_status_checks":
          for (const check of rule.requiredStatusChecks ?? []) {
            // Deduplicate by context name
            if (!allStatusChecks.some((c) => c.context === check.context)) {
              allStatusChecks.push({
                context: check.context,
                appId: check.integrationId ?? null,
              });
            }
          }
          break;
        case "merge_queue":
          mergeQueue = {
            enabled: true,
            mergeMethod: rule.mergeMethod ?? "merge",
            minEntriesToMerge: rule.minEntriesToMerge ?? 1,
            maxEntriesToMerge: rule.maxEntriesToMerge ?? 5,
            groupingStrategy: rule.groupingStrategy ?? "NONE",
            checkResponseTimeout: rule.checkResponseTimeout ?? 3600,
          };
          break;
        case "file_path_restriction":
          allFilePathRestrictions.push(...rule.restrictedFilePaths);
          break;
        case "max_file_path_length":
          if (
            maxFilePathLength === null ||
            rule.maxFilePathLength < maxFilePathLength
          ) {
            maxFilePathLength = rule.maxFilePathLength;
          }
          break;
        case "file_extension_restriction":
          allFileExtensionRestrictions.push(...rule.restrictedFileExtensions);
          break;
        // Other rule types are captured but don't affect effective rules aggregation
        default:
          break;
      }
    }
  }

  const pushRestrictions: PushRestrictions | null =
    allFilePathRestrictions.length > 0 ||
    allFileExtensionRestrictions.length > 0 ||
    maxFilePathLength !== null
      ? {
          filePathRestrictions: allFilePathRestrictions,
          maxFilePathLength,
          fileExtensionRestrictions: allFileExtensionRestrictions,
        }
      : null;

  // Deduplicate bypass actors
  const uniqueBypass = deduplicateBypassActors(allBypassActors);

  return {
    requiresSignedCommits,
    requiresLinearHistory,
    requiresConversationResolution,
    dismissesStaleReviews,
    requiredReviewCount,
    requiresCodeOwnerReview,
    lastPusherCannotApprove,
    requiredStatusChecks: allStatusChecks,
    requiredWorkflows: allRequiredWorkflows,
    mergeQueue,
    pushRestrictions,
    bypassActors: uniqueBypass,
    warnings,
  };
}

/**
 * Check if any rulesets are inherited from the organization.
 */
export function hasInheritedRulesets(rulesets: readonly Ruleset[]): boolean {
  return rulesets.some((r) => r.sourceType === "organization");
}

// === Internal helpers ===

function parseRule(raw: GitHubRuleResponse): RulesetRule | null {
  const type = raw.type;

  switch (type) {
    case "creation":
      return { type: "creation" };
    case "update":
      return {
        type: "update",
        updateAllowsFetchAndMerge:
          raw.parameters?.update_allows_fetch_and_merge,
      };
    case "deletion":
      return { type: "deletion" };
    case "required_linear_history":
      return { type: "required_linear_history" };
    case "merge_queue":
      return {
        type: "merge_queue",
        mergeMethod: raw.parameters?.merge_method,
        minEntriesToMerge: raw.parameters?.min_entries_to_merge,
        maxEntriesToMerge: raw.parameters?.max_entries_to_merge,
        groupingStrategy: raw.parameters?.grouping_strategy,
        checkResponseTimeout: raw.parameters?.check_response_timeout_minutes,
      };
    case "required_deployments":
      return {
        type: "required_deployments",
        requiredDeploymentEnvironments:
          raw.parameters?.required_deployment_environments ?? [],
      };
    case "required_signatures":
      return { type: "required_signatures" };
    case "pull_request":
      return {
        type: "pull_request",
        requiredApprovingReviewCount:
          raw.parameters?.required_approving_review_count,
        dismissStaleReviewsOnPush:
          raw.parameters?.dismiss_stale_reviews_on_push,
        requireCodeOwnerReview: raw.parameters?.require_code_owner_review,
        requireLastPushApproval: raw.parameters?.require_last_push_approval,
        requiredReviewThreadResolution:
          raw.parameters?.required_review_thread_resolution,
      };
    case "required_status_checks":
      return {
        type: "required_status_checks",
        requiredStatusChecks: (
          raw.parameters?.required_status_checks ?? []
        ).map((c: { context: string; integration_id?: number | null }) => ({
          context: c.context,
          integrationId: c.integration_id ?? null,
        })),
        strictRequiredStatusChecksPolicy:
          raw.parameters?.strict_required_status_checks_policy,
      };
    case "non_fast_forward":
      return { type: "non_fast_forward" };
    case "commit_message_pattern":
    case "commit_author_email_pattern":
    case "committer_email_pattern":
    case "branch_name_pattern":
    case "tag_name_pattern":
      return {
        type,
        parameters: {
          name: raw.parameters?.name,
          negate: raw.parameters?.negate,
          operator: raw.parameters?.operator,
          pattern: raw.parameters?.pattern,
        },
      };
    case "file_path_restriction":
      return {
        type: "file_path_restriction",
        restrictedFilePaths: raw.parameters?.restricted_file_paths ?? [],
      };
    case "max_file_path_length":
      return {
        type: "max_file_path_length",
        maxFilePathLength: raw.parameters?.max_file_path_length ?? 256,
      };
    case "file_extension_restriction":
      return {
        type: "file_extension_restriction",
        restrictedFileExtensions:
          raw.parameters?.restricted_file_extensions ?? [],
      };
    default:
      // Unknown rule type — skip
      return null;
  }
}

function mapActorType(
  type: string,
): "User" | "Team" | "App" | "OrganizationAdmin" {
  switch (type) {
    case "Team":
      return "Team";
    case "Integration":
    case "App":
      return "App";
    case "OrganizationAdmin":
      return "OrganizationAdmin";
    default:
      return "User";
  }
}

function mapEnforcement(
  enforcement: string,
): "active" | "disabled" | "evaluate" {
  switch (enforcement) {
    case "active":
      return "active";
    case "evaluate":
      return "evaluate";
    default:
      return "disabled";
  }
}

function deduplicateBypassActors(
  actors: readonly BypassActor[],
): readonly BypassActor[] {
  const seen = new Set<string>();
  const unique: BypassActor[] = [];

  for (const actor of actors) {
    const key = `${actor.actorType}:${actor.actorId}:${actor.bypassMode}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(actor);
    }
  }

  return unique;
}

// === Raw GitHub API response types (internal) ===

export interface GitHubRulesetResponse {
  readonly id: number;
  readonly name: string;
  readonly target: string;
  readonly enforcement: string;
  readonly source_type: string;
  readonly source: string;
  readonly bypass_actors?: ReadonlyArray<{
    readonly actor_id: number;
    readonly actor_type: string;
    readonly bypass_mode: string;
  }>;
  readonly conditions?: {
    readonly ref_name?: {
      readonly include?: readonly string[];
      readonly exclude?: readonly string[];
    };
  };
  readonly rules?: readonly GitHubRuleResponse[];
}

interface GitHubRuleResponse {
  readonly type: string;
  // biome-ignore lint/suspicious/noExplicitAny: GitHub API parameters vary by rule type
  readonly parameters?: Record<string, any>;
}
