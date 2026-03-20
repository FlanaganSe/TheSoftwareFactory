import { capabilitySnapshotRepo, repoRepo } from "@software-factory/db";
import { scanRepository } from "@software-factory/temporal-activities";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/require-role.js";

const ScanBodySchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  })
  .strict();

export async function repoRoutes(app: FastifyInstance): Promise<void> {
  // ── List repos ──

  app.get(
    "/api/repos",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const result = await repoRepo.listRepos(app.db);
      if (result.isErr()) {
        reply.status(500).send({
          error: { code: "internal_error", message: result.error.message },
        });
        return;
      }

      const repos = result.value;
      const reposWithScanInfo = await Promise.all(
        repos.map(async (repo) => {
          const snapshotResult =
            await capabilitySnapshotRepo.getLatestCapabilitySnapshot(
              app.db,
              repo.id,
            );
          const snapshot = snapshotResult.isOk() ? snapshotResult.value : null;
          return {
            id: repo.id,
            githubOwner: repo.githubOwner,
            githubRepo: repo.githubRepo,
            defaultBranch: repo.defaultBranch,
            repoClass: repo.repoClass,
            autonomyLevel: repo.autonomyLevel,
            lastScannedAt: snapshot?.capturedAt?.toISOString() ?? null,
          };
        }),
      );

      reply.send({ repos: reposWithScanInfo });
    },
  );

  // ── Get repo with latest snapshot ──

  app.get(
    "/api/repos/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const repoResult = await repoRepo.getRepo(app.db, id);
      if (repoResult.isErr()) {
        reply.status(404).send({
          error: { code: "not_found", message: `Repo not found: ${id}` },
        });
        return;
      }
      const repo = repoResult.value;

      const snapshotResult =
        await capabilitySnapshotRepo.getLatestCapabilitySnapshot(app.db, id);
      const snapshot = snapshotResult.isOk() ? snapshotResult.value : null;

      reply.send({
        repo: {
          id: repo.id,
          githubOwner: repo.githubOwner,
          githubRepo: repo.githubRepo,
          defaultBranch: repo.defaultBranch,
          repoClass: repo.repoClass,
          autonomyLevel: repo.autonomyLevel,
          lastScannedAt: snapshot?.capturedAt?.toISOString() ?? null,
        },
        latestSnapshot: snapshot?.snapshot ?? null,
        capturedAt: snapshot?.capturedAt?.toISOString() ?? null,
        sourceRevision: snapshot?.sourceRevision ?? null,
      });
    },
  );

  // ── Run capability scan ──

  app.post(
    "/api/repos/scan",
    { preHandler: [authMiddleware, requireRole("admin", "operator")] },
    async (request, reply) => {
      const parsed = ScanBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "validation_error", message: parsed.error.message },
        });
        return;
      }

      if (!app.credentialBroker || !app.githubInstallationId) {
        reply.status(503).send({
          error: {
            code: "github_not_configured",
            message:
              "GitHub App credentials not configured. Set GITHUB_APP_ID, GITHUB_PRIVATE_KEY, and GITHUB_INSTALLATION_ID.",
          },
        });
        return;
      }

      const { owner, repo } = parsed.data;

      // Get or create repo row
      const repoResult = await repoRepo.getOrCreateRepo(app.db, owner, repo);
      if (repoResult.isErr()) {
        reply.status(500).send({
          error: { code: "internal_error", message: repoResult.error.message },
        });
        return;
      }
      const repoRow = repoResult.value;

      // Run scan
      const scanResult = await scanRepository(
        owner,
        repo,
        app.credentialBroker,
        app.githubInstallationId,
      );
      if (scanResult.isErr()) {
        reply.status(502).send({
          error: {
            code: "scan_failed",
            message: `Capability scan failed: ${scanResult.error.message}`,
          },
        });
        return;
      }
      const snapshot = scanResult.value;

      // Persist snapshot
      const createResult =
        await capabilitySnapshotRepo.createCapabilitySnapshot(app.db, {
          repoId: repoRow.id,
          sourceRevision: snapshot.sourceRevision,
          snapshot,
        });
      if (createResult.isErr()) {
        reply.status(500).send({
          error: {
            code: "internal_error",
            message: createResult.error.message,
          },
        });
        return;
      }

      // Update repo row with scan-derived data
      await repoRepo.updateRepoFromScan(app.db, repoRow.id, {
        repoClass: snapshot.repoClass,
        defaultBranch: snapshot.defaultBranch,
      });

      reply.status(201).send({
        repo: {
          id: repoRow.id,
          githubOwner: repoRow.githubOwner,
          githubRepo: repoRow.githubRepo,
          defaultBranch: snapshot.defaultBranch,
          repoClass: snapshot.repoClass,
          autonomyLevel: repoRow.autonomyLevel,
        },
        snapshot,
        capturedAt: createResult.value.capturedAt.toISOString(),
      });
    },
  );
}
