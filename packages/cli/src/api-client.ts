import type { CLIConfig } from "./config.js";

export interface TaskResponse {
  readonly taskId: string;
  readonly workflowId: string;
  readonly status: string;
  readonly startTime?: string;
  readonly objective?: string;
  readonly createdBy?: string;
  readonly state?: string;
  readonly currentPhase?: string;
}

export interface TaskListResponse {
  readonly tasks: readonly TaskResponse[];
}

export interface EvidenceResponse {
  readonly bundleId: string;
  readonly taskId: string;
  readonly version: number;
  readonly schemaVersion: number;
  readonly objective: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeBaseSha: string;
  readonly revertabilityClass: string;
  readonly blastRadiusFiles: number;
  readonly blastRadiusPackages: number;
  readonly annotatedDiff: readonly unknown[];
  readonly ownersImpacted: readonly string[];
  readonly testResults: unknown;
  readonly securityScanResults: unknown;
  readonly lintResults: unknown;
  readonly protectedSurfaceEdits: readonly unknown[];
  readonly migrationImpact: unknown;
  readonly unresolvedAssumptions: readonly string[];
  readonly commandsRun: readonly unknown[];
  readonly pendingExternalChecks: readonly string[];
  readonly createdAt: string;
}

export interface FreshnessResponse {
  readonly fresh: boolean;
  readonly evidenceBaseSha: string;
  readonly currentBaseSha: string;
}

export interface HealthResponse {
  readonly status: string;
  readonly checks?: Record<string, unknown>;
}

export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface ApiClient {
  getTask(taskId: string): Promise<TaskResponse>;
  listTasks(): Promise<TaskListResponse>;
  getEvidence(
    taskId: string,
    attemptNumber?: number,
  ): Promise<EvidenceResponse>;
  getFreshness(taskId: string): Promise<FreshnessResponse>;
  approveTask(taskId: string): Promise<void>;
  rejectTask(taskId: string, reason: string): Promise<void>;
  requestChanges(taskId: string, message: string): Promise<void>;
  killTask(taskId: string, reason?: string): Promise<void>;
  checkHealth(): Promise<HealthResponse>;
}

class ApiClientError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function handleResponse<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) {
    let body: ApiError | undefined;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      // Response wasn't JSON
    }

    const message =
      body?.error?.message ??
      `Request failed: ${response.status} ${response.statusText}`;
    throw new ApiClientError(message, response.status, body?.error?.code);
  }

  return (await response.json()) as T;
}

export function createApiClient(config: CLIConfig): ApiClient {
  const baseUrl = config.apiUrl.replace(/\/$/, "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return handleResponse<T>(response, url);
    } catch (e) {
      if (e instanceof ApiClientError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        throw new ApiClientError(
          `Cannot connect to factory API at ${baseUrl}. Is the factory running? Try: docker compose up -d`,
          0,
          "connection_failed",
        );
      }
      throw new ApiClientError(`Request failed: ${msg}`, 0);
    }
  }

  return {
    async getTask(taskId: string): Promise<TaskResponse> {
      return request<TaskResponse>("GET", `/api/tasks/${taskId}`);
    },

    async listTasks(): Promise<TaskListResponse> {
      return request<TaskListResponse>("GET", "/api/tasks");
    },

    async getEvidence(
      taskId: string,
      attemptNumber?: number,
    ): Promise<EvidenceResponse> {
      const query =
        attemptNumber !== undefined ? `?attempt=${attemptNumber}` : "";
      return request<EvidenceResponse>(
        "GET",
        `/api/tasks/${taskId}/evidence${query}`,
      );
    },

    async getFreshness(taskId: string): Promise<FreshnessResponse> {
      return request<FreshnessResponse>(
        "GET",
        `/api/tasks/${taskId}/freshness`,
      );
    },

    async approveTask(taskId: string): Promise<void> {
      await request<unknown>("POST", `/api/tasks/${taskId}/approve`);
    },

    async rejectTask(taskId: string, reason: string): Promise<void> {
      await request<unknown>("POST", `/api/tasks/${taskId}/reject`, { reason });
    },

    async requestChanges(taskId: string, message: string): Promise<void> {
      await request<unknown>("POST", `/api/tasks/${taskId}/changes`, {
        message,
      });
    },

    async killTask(taskId: string, reason?: string): Promise<void> {
      await request<unknown>("POST", `/api/tasks/${taskId}/kill`, { reason });
    },

    async checkHealth(): Promise<HealthResponse> {
      return request<HealthResponse>("GET", "/health/ready");
    },
  };
}

export { ApiClientError };
