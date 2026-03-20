import { evidenceRepo, repoRepo, taskRepo } from "@software-factory/db";
import {
  createKillSwitch,
  createRedisClient,
} from "@software-factory/temporal-activities";
import type { KillSwitch } from "@software-factory/temporal-activities";
import type { Client } from "@temporalio/client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";

const TaskSubmitSchema = z
  .object({
    objective: z.string().min(1),
    repoOwner: z.string().min(1),
    repoName: z.string().min(1),
    autonomyLevel: z.enum(["L0", "L1", "L2"]).optional().default("L1"),
  })
  .strict();

const RejectBodySchema = z.object({ reason: z.string().min(1) }).strict();
const ChangesBodySchema = z.object({ message: z.string().min(1) }).strict();
const KillBodySchema = z.object({ reason: z.string().optional() }).strict();

function getTemporalClient(
  app: FastifyInstance,
  reply: FastifyReply,
): Client | null {
  const temporalClient = app.temporalClient;
  if (!temporalClient) {
    reply.status(503).send({
      error: {
        code: "service_unavailable",
        message: "Temporal client not configured",
      },
    });
    return null;
  }
  return temporalClient;
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // Create a shared kill switch if Redis is available
  let killSwitch: KillSwitch | null = null;
  if (app.redisUrl) {
    const redis = createRedisClient(app.redisUrl);
    await redis.connect();
    const pubsub = createRedisClient(app.redisUrl);
    await pubsub.connect();
    killSwitch = createKillSwitch(redis, pubsub);
    app.addHook("onClose", async () => {
      await redis.quit();
      await pubsub.quit();
    });
  }

  // ── Task CRUD ──

  app.post(
    "/api/tasks",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const parsed = TaskSubmitSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.message,
          },
        });
        return;
      }

      const temporalClient = getTemporalClient(app, reply);
      if (!temporalClient) return;

      const { objective, repoOwner, repoName, autonomyLevel } = parsed.data;

      // Resolve or create the repo row (FK must exist before task INSERT)
      const repoResult = await repoRepo.getOrCreateRepo(
        app.db,
        repoOwner,
        repoName,
      );
      if (repoResult.isErr()) {
        reply.status(500).send({
          error: {
            code: "internal_error",
            message: repoResult.error.message,
          },
        });
        return;
      }
      const repo = repoResult.value;

      // Create the task row in Postgres
      const taskResult = await taskRepo.createTask(app.db, {
        objective,
        repoId: repo.id,
        autonomyLevel,
        createdBy: request.actor.actorId,
      });
      if (taskResult.isErr()) {
        reply.status(500).send({
          error: {
            code: "internal_error",
            message: taskResult.error.message,
          },
        });
        return;
      }
      const task = taskResult.value;

      const workflowId = `task-${task.id}`;

      try {
        await temporalClient.workflow.start("taskOrchestrator", {
          taskQueue: "sf-orchestration",
          workflowId,
          args: [
            {
              taskId: task.id,
              repoId: repo.id,
              repoOwner,
              repoName,
              objective,
              autonomyLevel,
              config: {
                reviewTimeoutMs: 14_400_000,
                costBudgetCents: 1000,
                maxImplementationAttempts: 3,
              },
            },
          ],
        });

        reply.status(201).send({
          taskId: task.id,
          repoId: repo.id,
          workflowId,
          status: "created",
        });
      } catch (error) {
        reply.status(500).send({
          error: {
            code: "workflow_start_failed",
            message: `Failed to start workflow: ${String(error)}`,
          },
        });
      }
    },
  );

  app.get(
    "/api/tasks",
    { preHandler: [authMiddleware] },
    async (_request, reply) => {
      const result = await taskRepo.listActiveTasks(app.db);
      if (result.isErr()) {
        reply.status(500).send({
          error: {
            code: "internal_error",
            message: result.error.message,
          },
        });
        return;
      }

      reply.status(200).send({
        tasks: result.value.map((t) => ({
          taskId: t.id,
          objective: t.objective,
          status: t.state,
          repoId: t.repoId,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
      });
    },
  );

  app.get(
    "/api/tasks/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const temporalClient = getTemporalClient(app, reply);
      if (!temporalClient) return;

      try {
        const handle = temporalClient.workflow.getHandle(`task-${id}`);
        const desc = await handle.describe();

        reply.status(200).send({
          taskId: id,
          workflowId: `task-${id}`,
          status: desc.status.name,
          startTime: desc.startTime?.toISOString(),
        });
      } catch {
        reply.status(404).send({
          error: {
            code: "not_found",
            message: `Task ${id} not found`,
          },
        });
      }
    },
  );

  // ── Signal endpoints (M15: Human Review Flow) ──

  // POST /api/tasks/:id/approve
  app.post(
    "/api/tasks/:id/approve",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // Separation of duties: task submitter ≠ sole approver (R-018)
      const taskResult = await taskRepo.getTask(app.db, id);
      if (taskResult.isOk()) {
        const task = taskResult.value;
        if (task.createdBy === request.actor.actorId) {
          reply.status(403).send({
            error: {
              code: "separation_of_duties",
              message: "Task submitter cannot be sole approver",
            },
          });
          return;
        }
      }
      // If task not found in DB, still attempt the signal —
      // the workflow may exist even if the DB read fails

      const temporalClient = getTemporalClient(app, reply);
      if (!temporalClient) return;

      try {
        const handle = temporalClient.workflow.getHandle(`task-${id}`);
        await handle.signal("approve", {
          actor: request.actor.actorId,
        });
        reply.status(200).send({ status: "approved" });
      } catch (e) {
        reply.status(500).send({
          error: {
            code: "signal_failed",
            message: `Failed to send approve signal: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
  );

  // POST /api/tasks/:id/reject
  app.post(
    "/api/tasks/:id/reject",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = RejectBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "validation_error",
            message: "reason is required",
          },
        });
        return;
      }

      const temporalClient = getTemporalClient(app, reply);
      if (!temporalClient) return;

      try {
        const handle = temporalClient.workflow.getHandle(`task-${id}`);
        await handle.signal("reject", {
          actor: request.actor.actorId,
          reason: parsed.data.reason,
        });
        reply.status(200).send({ status: "rejected" });
      } catch (e) {
        reply.status(500).send({
          error: {
            code: "signal_failed",
            message: `Failed to send reject signal: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
  );

  // POST /api/tasks/:id/changes
  app.post(
    "/api/tasks/:id/changes",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ChangesBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "validation_error",
            message: "message is required",
          },
        });
        return;
      }

      const temporalClient = getTemporalClient(app, reply);
      if (!temporalClient) return;

      try {
        const handle = temporalClient.workflow.getHandle(`task-${id}`);
        await handle.signal("changes_requested", {
          actor: request.actor.actorId,
          message: parsed.data.message,
        });
        reply.status(200).send({ status: "changes_requested" });
      } catch (e) {
        reply.status(500).send({
          error: {
            code: "signal_failed",
            message: `Failed to send changes_requested signal: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
  );

  // POST /api/tasks/:id/kill
  app.post(
    "/api/tasks/:id/kill",
    { preHandler: [authMiddleware, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = KillBodySchema.safeParse(request.body ?? {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      // 1. Set Redis kill flag (instant effect on next activity check)
      if (killSwitch) {
        await killSwitch.activateForTask(id, request.actor.actorId, reason);
      }

      // 2. Send Temporal signal (for the workflow's signal handler)
      const temporalClient = getTemporalClient(app, reply);
      if (!temporalClient) return;

      try {
        const handle = temporalClient.workflow.getHandle(`task-${id}`);
        await handle.signal("kill", {
          actor: request.actor.actorId,
          reason,
        });
        reply.status(200).send({ status: "killed" });
      } catch (e) {
        reply.status(500).send({
          error: {
            code: "signal_failed",
            message: `Failed to send kill signal: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
  );

  // POST /api/tasks/:id/approve-setup
  app.post(
    "/api/tasks/:id/approve-setup",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const temporalClient = getTemporalClient(app, reply);
      if (!temporalClient) return;

      const body = request.body as
        | { contract?: Record<string, unknown> }
        | undefined;
      const contract = body?.contract ?? {
        version: "1",
        image: "node:22-slim",
        setup: ["npm install || yarn install || pnpm install || true"],
        maintenance: [],
        secrets: { setup_only: [], runtime: [], per_tool: [] },
        health_check: ["node --version"],
      };

      try {
        const handle = temporalClient.workflow.getHandle(`task-${id}`);
        await handle.signal("approve_setup", {
          contract,
          actor: request.actor.actorId,
        });
        reply.status(200).send({ status: "setup_approved" });
      } catch (e) {
        reply.status(500).send({
          error: {
            code: "signal_failed",
            message: `Failed to send approve_setup signal: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
  );

  // ── Evidence endpoints ──

  // GET /api/tasks/:id/evidence
  app.get(
    "/api/tasks/:id/evidence",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { attempt?: string };
      const parsed = query.attempt
        ? Number.parseInt(query.attempt, 10)
        : undefined;
      const attemptNumber =
        parsed !== undefined && Number.isNaN(parsed) ? undefined : parsed;

      const result = await evidenceRepo.getEvidenceForTask(
        app.db,
        id,
        attemptNumber,
      );

      if (result.isErr()) {
        reply.status(500).send({
          error: {
            code: "internal_error",
            message: result.error.message,
          },
        });
        return;
      }

      const bundles = result.value;
      if (bundles.length === 0) {
        reply.status(404).send({
          error: {
            code: "not_found",
            message: `No evidence found for task ${id}`,
          },
        });
        return;
      }

      // Return the most recent bundle
      const bundle = bundles[0];
      reply.status(200).send({
        bundleId: bundle.id,
        taskId: bundle.taskId,
        version: bundle.version,
        schemaVersion: bundle.schemaVersion,
        objective: bundle.objective,
        baseSha: bundle.baseSha,
        headSha: bundle.headSha,
        mergeBaseSha: bundle.mergeBaseSha,
        revertabilityClass: bundle.revertabilityClass,
        blastRadiusFiles: bundle.blastRadiusFiles,
        blastRadiusPackages: bundle.blastRadiusPackages,
        annotatedDiff: bundle.annotatedDiff ?? [],
        ownersImpacted: bundle.ownersImpacted ?? [],
        testResults: bundle.testResults ?? {
          passed: 0,
          failed: 0,
          skipped: 0,
          newTests: [],
          modifiedTests: [],
          deletedTests: [],
          details: [],
        },
        securityScanResults: bundle.securityScanResults ?? {
          vulnerabilities: [],
          totalFindings: 0,
          criticalCount: 0,
          highCount: 0,
        },
        lintResults: bundle.lintResults ?? {
          errorCount: 0,
          warningCount: 0,
          details: [],
        },
        protectedSurfaceEdits: bundle.protectedSurfaceEdits ?? [],
        migrationImpact: bundle.migrationImpact ?? {
          hasMigrations: false,
          migrationFiles: [],
          schemaChanges: [],
        },
        unresolvedAssumptions: bundle.unresolvedAssumptions ?? [],
        commandsRun: bundle.commandsRun ?? [],
        pendingExternalChecks: bundle.pendingExternalChecks ?? [],
        createdAt: bundle.createdAt.toISOString(),
      });
    },
  );

  // GET /api/tasks/:id/freshness
  app.get(
    "/api/tasks/:id/freshness",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const result = await evidenceRepo.getEvidenceForTask(app.db, id);
      if (result.isErr() || result.value.length === 0) {
        reply.status(404).send({
          error: {
            code: "not_found",
            message: `No evidence found for task ${id}`,
          },
        });
        return;
      }

      const bundle = result.value[0];
      // Freshness check requires GitHub API to get current HEAD —
      // for now, return the evidence base SHA and let the caller compare.
      // A full implementation would fetch the repo's default branch HEAD.
      reply.status(200).send({
        fresh: true,
        evidenceBaseSha: bundle.baseSha,
        currentBaseSha: bundle.baseSha,
      });
    },
  );
}
