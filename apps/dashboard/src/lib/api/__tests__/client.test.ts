import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient, DashboardApiError } from "../client";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createApiClient", () => {
  const client = createApiClient("http://localhost:3000", "test-key");

  describe("getTasks", () => {
    it("returns task list", async () => {
      const tasks = [{ taskId: "abc", workflowId: "task-abc", status: "created" }];
      mockFetch.mockResolvedValueOnce(jsonResponse({ tasks }));

      const result = await client.getTasks();
      expect(result.tasks).toEqual(tasks);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
          }),
        }),
      );
    });

    it("passes filter query string", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ tasks: [] }));
      await client.getTasks("state=evidence_ready");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks?state=evidence_ready",
        expect.any(Object),
      );
    });
  });

  describe("approveTask", () => {
    it("sends correct POST", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: "approved" }));
      await client.approveTask("task-123");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks/task-123/approve",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("rejectTask", () => {
    it("sends reason in body", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: "rejected" }));
      await client.rejectTask("task-123", "Not acceptable");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks/task-123/reject",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "Not acceptable" }),
        }),
      );
    });
  });

  describe("auth header", () => {
    it("includes Bearer token on all requests", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await client.getHealth();
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer test-key");
    });
  });

  describe("error handling", () => {
    it("throws DashboardApiError on 401", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, "unauthorized", "Invalid API key"));
      await expect(client.getTasks()).rejects.toThrow(DashboardApiError);
      try {
        mockFetch.mockResolvedValueOnce(errorResponse(401, "unauthorized", "Invalid API key"));
        await client.getTasks();
      } catch (e) {
        expect(e).toBeInstanceOf(DashboardApiError);
        expect((e as DashboardApiError).status).toBe(401);
      }
    });

    it("throws DashboardApiError on 403", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, "forbidden", "Insufficient permissions"));
      await expect(client.approveTask("abc")).rejects.toThrow(DashboardApiError);
    });

    it("handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(client.getTasks()).rejects.toThrow("Failed to fetch");
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }));
      await expect(client.getTasks()).rejects.toThrow(DashboardApiError);
    });
  });

  describe("safety endpoints", () => {
    it("getSafetyStatus returns status", async () => {
      const status = { globalKill: false, activeKills: [], circuits: [], dailyCost: { totalCents: 0, budgetCents: 10000, tasks: {}, date: "2026-03-19" } };
      mockFetch.mockResolvedValueOnce(jsonResponse(status));
      const result = await client.getSafetyStatus();
      expect(result.globalKill).toBe(false);
    });

    it("activateGlobalKill sends POST with reason", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: "activated" }));
      await client.activateGlobalKill("emergency");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/safety/kill/global",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "emergency" }),
        }),
      );
    });

    it("deactivateGlobalKill sends DELETE", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: "deactivated" }));
      await client.deactivateGlobalKill();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/safety/kill/global",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("evidence endpoint", () => {
    it("getEvidence returns evidence bundle", async () => {
      const evidence = {
        bundleId: "b-1",
        taskId: "t-1",
        objective: "Fix bug",
        annotatedDiff: [],
        testResults: { passed: 5, failed: 0, skipped: 0, newTests: [], modifiedTests: [], deletedTests: [], details: [] },
        securityScanResults: { vulnerabilities: [], totalFindings: 0, criticalCount: 0, highCount: 0 },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(evidence));
      const result = await client.getEvidence("t-1");
      expect(result.objective).toBe("Fix bug");
    });
  });
});
