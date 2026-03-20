export class DashboardApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DashboardApiError";
  }
}

export function createApiClient(apiUrl: string, token: string) {
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new DashboardApiError(response.status, body?.error?.message ?? "Unknown error");
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  }

  return {
    // Tasks
    getTasks: (filters?: string) =>
      request<TaskListResponse>(`/api/tasks${filters ? `?${filters}` : ""}`),
    getTask: (id: string) => request<TaskDetailResponse>(`/api/tasks/${id}`),
    getEvidence: (id: string) => request<EvidenceResponse>(`/api/tasks/${id}/evidence`),
    getFreshness: (id: string) => request<FreshnessResponse>(`/api/tasks/${id}/freshness`),
    approveTask: (id: string) => request<SignalResponse>(`/api/tasks/${id}/approve`, { method: "POST" }),
    rejectTask: (id: string, reason: string) =>
      request<SignalResponse>(`/api/tasks/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    requestChanges: (id: string, message: string) =>
      request<SignalResponse>(`/api/tasks/${id}/changes`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    killTask: (id: string, reason?: string) =>
      request<SignalResponse>(`/api/tasks/${id}/kill`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    // Safety
    getSafetyStatus: () => request<SafetyStatusResponse>("/api/safety/status"),
    getCircuitBreakers: () => request<CircuitBreakersResponse>("/api/safety/circuits"),
    getDailyCost: () => request<DailyCostResponse>("/api/safety/costs/daily"),
    getTaskCost: (id: string) => request<TaskCostResponse>(`/api/safety/costs/task/${id}`),
    activateGlobalKill: (reason?: string) =>
      request<KillResponse>("/api/safety/kill/global", {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    deactivateGlobalKill: () =>
      request<KillResponse>("/api/safety/kill/global", { method: "DELETE" }),
    resetCircuitBreaker: (service: string) =>
      request<CircuitActionResponse>(`/api/safety/circuits/${service}/reset`, { method: "POST" }),
    tripCircuitBreaker: (service: string) =>
      request<CircuitActionResponse>(`/api/safety/circuits/${service}/trip`, { method: "POST" }),

    // Health
    getHealth: () => request<HealthResponse>("/health/ready"),

    // Repos
    getRepos: () => request<RepoListResponse>("/api/repos"),
    getRepo: (id: string) => request<RepoDetailResponse>(`/api/repos/${id}`),
  };
}

// Response types — derived from actual API responses
export interface TaskListResponse {
  tasks: TaskSummary[];
}

export interface TaskSummary {
  taskId: string;
  workflowId: string;
  status: string;
  startTime?: string;
  objective?: string;
  repoOwner?: string;
  repoName?: string;
}

export interface TaskDetailResponse {
  taskId: string;
  workflowId: string;
  status: string;
  startTime?: string;
}

export interface EvidenceResponse {
  bundleId: string;
  taskId: string;
  version: number;
  schemaVersion: number;
  objective: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  revertabilityClass: string;
  blastRadiusFiles: number;
  blastRadiusPackages: number;
  annotatedDiff: DiffAnnotationResponse[];
  ownersImpacted: string[];
  testResults: TestResultsResponse;
  securityScanResults: SecurityScanResponse;
  lintResults: LintResultsResponse;
  protectedSurfaceEdits: ProtectedEditResponse[];
  migrationImpact: MigrationImpactResponse;
  unresolvedAssumptions: string[];
  commandsRun: CommandRecordResponse[];
  pendingExternalChecks: string[];
  createdAt: string;
}

export interface DiffAnnotationResponse {
  file: string;
  hunkIndex: number;
  annotation: string;
  riskLevel: "low" | "medium" | "high";
  affectedConsumers: string[];
}

export interface TestResultsResponse {
  passed: number;
  failed: number;
  skipped: number;
  newTests: string[];
  modifiedTests: string[];
  deletedTests: string[];
  details: Array<{
    name: string;
    status: "passed" | "failed" | "skipped";
    durationMs?: number;
    errorMessage?: string;
  }>;
}

export interface SecurityScanResponse {
  vulnerabilities: Array<{
    id: string;
    severity: "critical" | "high" | "medium" | "low";
    description: string;
    file?: string;
    line?: number;
  }>;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
}

export interface LintResultsResponse {
  errorCount: number;
  warningCount: number;
  details: Array<{
    file: string;
    line: number;
    column: number;
    rule: string;
    severity: "error" | "warning";
    message: string;
  }>;
}

export interface ProtectedEditResponse {
  filePath: string;
  protectionClass: string;
  justification: string;
  beforeContent?: string;
  afterContent?: string;
}

export interface MigrationImpactResponse {
  hasMigrations: boolean;
  migrationFiles: string[];
  schemaChanges: string[];
}

export interface CommandRecordResponse {
  command: string;
  exitCode: number;
  durationMs: number;
  output?: string;
}

export interface FreshnessResponse {
  fresh: boolean;
  evidenceBaseSha: string;
  currentBaseSha: string;
}

export interface SignalResponse {
  status: string;
}

export interface SafetyStatusResponse {
  globalKill: boolean;
  activeKills: ActiveKill[];
  circuits: CircuitStatus[];
  dailyCost: DailyCostResponse;
}

export interface ActiveKill {
  taskId?: string;
  activatedBy: string;
  reason?: string;
  activatedAt: string;
}

export interface CircuitStatus {
  service: string;
  state: "closed" | "open" | "half_open";
  failureCount: number;
  lastFailure?: string;
  lastSuccess?: string;
}

export interface CircuitBreakersResponse {
  circuits: CircuitStatus[];
}

export interface DailyCostResponse {
  totalCents: number;
  budgetCents: number;
  tasks: Record<string, number>;
  date: string;
}

export interface TaskCostResponse {
  taskId: string;
  totalCents: number;
  budgetCents: number;
}

export interface KillResponse {
  status: string;
  workflowsSignaled?: number;
}

export interface CircuitActionResponse {
  status: string;
  service: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>;
}

export interface RepoSummary {
  id: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  repoClass: string;
  autonomyLevel: string;
  lastScannedAt: string | null;
}

export interface RepoListResponse {
  repos: RepoSummary[];
}

export interface RepoDetailResponse {
  repo: RepoSummary;
  latestSnapshot: Record<string, unknown> | null;
  capturedAt: string | null;
  sourceRevision: string | null;
}
