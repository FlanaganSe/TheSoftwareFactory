import picomatch from "picomatch";
import type {
  PolicyConfig,
  PolicyType,
  ProtectionClass,
} from "../schemas/policy.js";

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly protectionClass?: ProtectionClass;
  readonly requiresApproval: boolean;
}

export const DEFAULT_EXCLUSIONS: readonly string[] = [
  "secrets/**",
  ".env*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  ".git/**",
  "node_modules/**",
];

export function isGovernanceExcluded(
  path: string,
  exclusions: readonly string[] = DEFAULT_EXCLUSIONS,
): boolean {
  return exclusions.some((pattern) => picomatch.isMatch(path, pattern));
}

function findMatchingPolicy(
  path: string,
  operation: "read" | "write" | "index" | "search",
  policies: readonly PolicyConfig[],
): PolicyConfig | undefined {
  const activePolicies = policies.filter((p) => p.isActive);

  // Priority: read_exclusion > edit_deny > edit_protected > edit_allowed
  const priorityOrder: readonly PolicyType[] = [
    "read_exclusion",
    "edit_deny",
    "edit_protected",
    "edit_allowed",
  ];

  for (const policyType of priorityOrder) {
    for (const policy of activePolicies) {
      if (policy.policyType !== policyType) continue;

      const matches = policy.pathPatterns.some((pattern) =>
        picomatch.isMatch(path, pattern),
      );
      if (!matches) continue;

      // read_exclusion applies to read, index, and search operations
      if (policyType === "read_exclusion") {
        if (
          operation === "read" ||
          operation === "index" ||
          operation === "search"
        ) {
          return policy;
        }
        continue;
      }

      // edit policies apply to write operations
      if (operation === "write") {
        return policy;
      }
    }
  }

  return undefined;
}

export function evaluatePath(
  path: string,
  operation: "read" | "write" | "index" | "search",
  policies: readonly PolicyConfig[],
): PolicyDecision {
  // Check default governance exclusions first
  if (isGovernanceExcluded(path)) {
    return {
      allowed: false,
      reason: `Path "${path}" matches default governance exclusion`,
      requiresApproval: false,
    };
  }

  const policy = findMatchingPolicy(path, operation, policies);

  if (!policy) {
    return {
      allowed: true,
      reason: "No matching policy — default allow",
      requiresApproval: false,
    };
  }

  switch (policy.policyType) {
    case "read_exclusion":
      return {
        allowed: false,
        reason: `Read exclusion policy "${policy.name}" blocks ${operation} on "${path}"`,
        requiresApproval: false,
      };

    case "edit_deny":
      return {
        allowed: false,
        reason: `Edit deny policy "${policy.name}" blocks write on "${path}"`,
        protectionClass: policy.protectionClass ?? undefined,
        requiresApproval: false,
      };

    case "edit_protected":
      return {
        allowed: true,
        reason: `Edit protected policy "${policy.name}" allows write on "${path}" with approval`,
        protectionClass: policy.protectionClass ?? undefined,
        requiresApproval: policy.requiresApproval,
      };

    case "edit_allowed":
      return {
        allowed: true,
        reason: `Edit allowed policy "${policy.name}" allows write on "${path}"`,
        protectionClass: policy.protectionClass ?? undefined,
        requiresApproval: false,
      };
  }
}

export function evaluateChangedPaths(
  paths: readonly string[],
  policies: readonly PolicyConfig[],
): PolicyDecision[] {
  return paths.map((path) => evaluatePath(path, "write", policies));
}
