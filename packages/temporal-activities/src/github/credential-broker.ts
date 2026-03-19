import { createAppAuth } from "@octokit/auth-app";
import type { TaskState } from "@software-factory/core";

type TaskPhase =
  | "capability_scan"
  | "implementation"
  | "pr_creation"
  | "pr_tracking"
  | "merge";

type PermissionLevel = "read" | "write";

export const PHASE_PERMISSIONS: Readonly<
  Record<TaskPhase, Record<string, PermissionLevel>>
> = {
  capability_scan: {
    contents: "read",
    administration: "read",
    checks: "read",
  },
  implementation: { contents: "write", checks: "write" },
  pr_creation: { contents: "write", pull_requests: "write" },
  pr_tracking: {
    pull_requests: "read",
    checks: "read",
    statuses: "read",
  },
  merge: { contents: "write", pull_requests: "write" },
} as const;

/** Map task states to their corresponding permission phase */
const STATE_TO_PHASE: Partial<Record<TaskState, TaskPhase>> = {
  assigned: "capability_scan",
  in_progress: "implementation",
  pr_created: "pr_creation",
  external_checks_pending: "pr_tracking",
  merge_ready: "merge",
};

interface CachedToken {
  readonly token: string;
  readonly expiresAt: Date;
  readonly permissions: Record<string, PermissionLevel>;
}

const TOKEN_ROTATION_MS = 50 * 60 * 1000; // 50 minutes (10 min buffer before 60 min expiry)

/**
 * Mints installation tokens scoped to the minimum permissions
 * needed for the current task phase. Tokens are cached and
 * rotated at 50 minutes (tokens expire at 60 minutes, non-configurable).
 */
export class CredentialBroker {
  private readonly cache = new Map<string, CachedToken>();
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly installationId: number;

  constructor(appId: string, privateKey: string, installationId: number) {
    this.appId = appId;
    this.privateKey = privateKey;
    this.installationId = installationId;
  }

  async getToken(phase: TaskPhase): Promise<string> {
    const cached = this.cache.get(phase);

    if (cached && !this.isExpired(cached)) {
      return cached.token;
    }

    const permissions = PHASE_PERMISSIONS[phase];
    const auth = createAppAuth({
      appId: this.appId,
      privateKey: this.privateKey,
      installationId: this.installationId,
    });

    const result = await auth({
      type: "installation",
      installationId: this.installationId,
      permissions,
    });

    const token = result.token;
    const expiresAt = new Date(Date.now() + TOKEN_ROTATION_MS);

    this.cache.set(phase, { token, expiresAt, permissions });

    return token;
  }

  /** Get a token using a task state (maps to phase internally) */
  async getTokenForState(state: TaskState): Promise<string | null> {
    const phase = STATE_TO_PHASE[state];
    if (!phase) return null;
    return this.getToken(phase);
  }

  private isExpired(cached: CachedToken): boolean {
    return Date.now() >= cached.expiresAt.getTime();
  }
}

export type { TaskPhase };
