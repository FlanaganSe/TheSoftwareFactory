import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiClientError, createApiClient } from "../src/api-client.js";

// Simple HTTP server that mocks the factory API
let mockServer: Server;
let mockPort: number;

function createMockHandler(): (
  req: {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
  },
  res: {
    writeHead: (code: number, headers?: Record<string, string>) => void;
    end: (body?: string) => void;
  },
) => void {
  return (req, res) => {
    const url = req.url ?? "";

    // Health endpoint
    if (url === "/health/ready" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          checks: { database: { status: "healthy" } },
        }),
      );
      return;
    }

    // Auth check
    const auth = req.headers.authorization;
    if (!auth || !auth.toString().startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "unauthorized", message: "Missing auth" },
        }),
      );
      return;
    }

    // GET /api/tasks/:id
    if (url.match(/^\/api\/tasks\/[^/]+$/) && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          taskId: "test-id",
          workflowId: "task-test-id",
          status: "RUNNING",
          startTime: "2026-03-19T10:00:00Z",
        }),
      );
      return;
    }

    // POST /api/tasks/:id/approve
    if (url.match(/^\/api\/tasks\/[^/]+\/approve$/) && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "approved" }));
      return;
    }

    // POST /api/tasks/:id/reject
    if (url.match(/^\/api\/tasks\/[^/]+\/reject$/) && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "rejected" }));
      return;
    }

    // POST /api/tasks/:id/changes
    if (url.match(/^\/api\/tasks\/[^/]+\/changes$/) && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "changes_requested" }));
      return;
    }

    // POST /api/tasks/:id/kill
    if (url.match(/^\/api\/tasks\/[^/]+\/kill$/) && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "killed" }));
      return;
    }

    // GET /api/tasks/:id/evidence
    if (url.match(/^\/api\/tasks\/[^/]+\/evidence/) && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          bundleId: "bundle-1",
          taskId: "test-id",
          version: 1,
          schemaVersion: 1,
          objective: "Test objective",
          baseSha: "abc1234",
          headSha: "def5678",
          mergeBaseSha: "abc1234",
          revertabilityClass: "clean_revert",
          blastRadiusFiles: 3,
          blastRadiusPackages: 1,
          annotatedDiff: [],
          ownersImpacted: [],
          testResults: { passed: 10, failed: 0, skipped: 0, details: [] },
          securityScanResults: {
            vulnerabilities: [],
            totalFindings: 0,
            criticalCount: 0,
            highCount: 0,
          },
          lintResults: { errorCount: 0, warningCount: 2, details: [] },
          protectedSurfaceEdits: [],
          migrationImpact: {
            hasMigrations: false,
            migrationFiles: [],
            schemaChanges: [],
          },
          unresolvedAssumptions: [],
          commandsRun: [],
          pendingExternalChecks: [],
          createdAt: "2026-03-19T10:00:00Z",
        }),
      );
      return;
    }

    // GET /api/tasks/:id/freshness
    if (url.match(/^\/api\/tasks\/[^/]+\/freshness$/) && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          fresh: true,
          evidenceBaseSha: "abc1234",
          currentBaseSha: "abc1234",
        }),
      );
      return;
    }

    // Server error simulation
    if (url === "/api/tasks/error-id" && req.method === "GET") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "internal", message: "Server error" },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  };
}

beforeAll(async () => {
  mockServer = createServer(createMockHandler());
  await new Promise<void>((resolve) => {
    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address();
      if (addr && typeof addr === "object") {
        mockPort = addr.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    mockServer.close(() => resolve());
  });
});

function makeClient(apiKey?: string) {
  return createApiClient({
    apiUrl: `http://127.0.0.1:${mockPort}`,
    apiKey: apiKey ?? "test-key",
    json: false,
  });
}

describe("ApiClient", () => {
  it("getTask calls correct endpoint with auth header", async () => {
    const client = makeClient();
    const task = await client.getTask("test-id");
    expect(task.taskId).toBe("test-id");
    expect(task.status).toBe("RUNNING");
  });

  it("approveTask sends POST to /api/tasks/:id/approve", async () => {
    const client = makeClient();
    await expect(client.approveTask("test-id")).resolves.toBeUndefined();
  });

  it("rejectTask sends POST with reason in body", async () => {
    const client = makeClient();
    await expect(
      client.rejectTask("test-id", "bad code"),
    ).resolves.toBeUndefined();
  });

  it("requestChanges sends POST with message", async () => {
    const client = makeClient();
    await expect(
      client.requestChanges("test-id", "fix the tests"),
    ).resolves.toBeUndefined();
  });

  it("killTask sends POST to /api/tasks/:id/kill", async () => {
    const client = makeClient();
    await expect(
      client.killTask("test-id", "emergency"),
    ).resolves.toBeUndefined();
  });

  it("getEvidence returns evidence bundle", async () => {
    const client = makeClient();
    const evidence = await client.getEvidence("test-id");
    expect(evidence.bundleId).toBe("bundle-1");
    expect(evidence.objective).toBe("Test objective");
  });

  it("checkHealth returns health response", async () => {
    const client = makeClient();
    const health = await client.checkHealth();
    expect(health.status).toBe("ok");
  });

  it("unauthorized (no API key) gives clear error", async () => {
    const client = createApiClient({
      apiUrl: `http://127.0.0.1:${mockPort}`,
      apiKey: undefined,
      json: false,
    });
    await expect(client.getTask("test-id")).rejects.toThrow("Missing auth");
  });

  it("connection refused gives clear error", async () => {
    const client = createApiClient({
      apiUrl: "http://127.0.0.1:1",
      apiKey: "test-key",
      json: false,
    });
    await expect(client.getTask("test-id")).rejects.toThrow(
      /Cannot connect|fetch failed/,
    );
  });
});
