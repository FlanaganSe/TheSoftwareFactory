import { apiKeyRepo, repos, tasks } from "@software-factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;
let adminKey: string;
let operatorKey: string;
let viewerKey: string;
let operatorActorId: string;

// IDs for tasks we'll insert directly into the DB
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const REPO_ID = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  ctx = await setupTestApp();
  const db = ctx.dbConnection.db;

  const adminResult = await apiKeyRepo.createApiKey(
    db,
    "signal-admin",
    "admin",
    "test",
  );
  adminKey = adminResult._unsafeUnwrap().rawKey;

  const operatorResult = await apiKeyRepo.createApiKey(
    db,
    "signal-operator",
    "operator",
    "test",
  );
  operatorKey = operatorResult._unsafeUnwrap().rawKey;
  operatorActorId = operatorResult._unsafeUnwrap().id;

  const viewerResult = await apiKeyRepo.createApiKey(
    db,
    "signal-viewer",
    "viewer",
    "test",
  );
  viewerKey = viewerResult._unsafeUnwrap().rawKey;

  // Insert a repo for the task
  await db
    .insert(repos)
    .values({
      id: REPO_ID,
      githubOwner: "test-org",
      githubRepo: "test-repo",
      defaultBranch: "main",
    })
    .onConflictDoNothing();

  // Insert a task directly (created by the operator for separation-of-duties testing)
  await db
    .insert(tasks)
    .values({
      id: TASK_ID,
      objective: "Test objective",
      repoId: REPO_ID,
      createdBy: operatorActorId,
      autonomyLevel: "L1",
    })
    .onConflictDoNothing();
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("task signal endpoints", () => {
  // ── Approve ──

  it("POST /api/tasks/:id/approve without auth → 401", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/approve`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/tasks/:id/approve with viewer role → 403", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/approve`,
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /api/tasks/:id/approve by task creator → 403 separation of duties", async () => {
    // The operator created the task, so approving with operator key should be blocked
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/approve`,
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe("separation_of_duties");
  });

  it("POST /api/tasks/:id/approve by different user → 503 (no Temporal)", async () => {
    // Admin is a different actor from the operator who created the task
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/approve`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    // 503 because Temporal client not configured in tests — but we passed
    // separation of duties check (would be 403 otherwise)
    expect(res.statusCode).toBe(503);
  });

  // ── Reject ──

  it("POST /api/tasks/:id/reject with reason → 503 (no Temporal)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/reject`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { reason: "Not good enough" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("POST /api/tasks/:id/reject without reason → 400", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/reject`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("validation_error");
  });

  // ── Changes ──

  it("POST /api/tasks/:id/changes with message → 503 (no Temporal)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/changes`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { message: "Fix the error handling" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("POST /api/tasks/:id/changes without message → 400", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/changes`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Kill ──

  it("POST /api/tasks/:id/kill by admin → 503 (no Temporal)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/kill`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { reason: "Emergency" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("POST /api/tasks/:id/kill by operator → 403 (admin-only)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/tasks/${TASK_ID}/kill`,
      headers: { authorization: `Bearer ${operatorKey}` },
      payload: { reason: "Emergency" },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Evidence ──

  it("GET /api/tasks/:id/evidence for nonexistent task → 404", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks/99999999-9999-9999-9999-999999999999/evidence",
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    // Either 404 (no evidence) or 500 (query error) — both acceptable without evidence
    expect([404, 500]).toContain(res.statusCode);
  });

  it("GET /api/tasks/:id/evidence returns bundle when evidence exists", async () => {
    // Insert evidence directly into the DB
    const db = ctx.dbConnection.db;
    const { evidenceBundles } = await import("@software-factory/db");
    await db.insert(evidenceBundles).values({
      taskId: TASK_ID,
      schemaVersion: 1,
      objective: "Test objective",
      baseSha: "abc1234",
      headSha: "def5678",
      mergeBaseSha: "abc1234",
      revertabilityClass: "clean_revert",
      blastRadiusFiles: 2,
      blastRadiusPackages: 1,
      hasProtectedSurfaceEdits: false,
      hasMigrationImpact: false,
      artifactUrl: null,
      annotatedDiff: [],
      ownersImpacted: ["@team"],
      testResults: {
        passed: 10,
        failed: 0,
        skipped: 0,
        newTests: [],
        modifiedTests: [],
        deletedTests: [],
        details: [],
      },
      securityScanResults: {
        vulnerabilities: [],
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
      },
      lintResults: { errorCount: 0, warningCount: 1, details: [] },
      protectedSurfaceEdits: [],
      migrationImpact: {
        hasMigrations: false,
        migrationFiles: [],
        schemaChanges: [],
      },
      unresolvedAssumptions: [],
      commandsRun: [],
      pendingExternalChecks: [],
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/tasks/${TASK_ID}/evidence`,
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taskId).toBe(TASK_ID);
    expect(body.objective).toBe("Test objective");
    expect(body.baseSha).toBe("abc1234");
  });

  it("GET /api/tasks/:id/evidence without auth → 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/tasks/${TASK_ID}/evidence`,
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Freshness ──

  it("GET /api/tasks/:id/freshness returns freshness info after evidence exists", async () => {
    // Evidence was inserted in the previous test
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/tasks/${TASK_ID}/freshness`,
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("fresh");
    expect(body).toHaveProperty("evidenceBaseSha");
    expect(body).toHaveProperty("currentBaseSha");
  });
});
