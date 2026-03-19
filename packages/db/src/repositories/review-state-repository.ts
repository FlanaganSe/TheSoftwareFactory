/**
 * Review state repository — tracks PR lifecycle state for M17's tracking phase.
 * Populates the review_states table from M4's schema.
 */

import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { reviewStates } from "../schema/review-states.js";

// ─── Types ───

type ReviewState = typeof reviewStates.$inferSelect;

export interface CreateReviewStateInput {
  readonly taskId: string;
  readonly evidenceBundleId: string;
  readonly prNumber: number;
  readonly prUrl: string;
  readonly prNodeId: string;
  readonly headSha: string;
}

export interface ReviewStateUpdates {
  readonly prNumber: number;
  readonly prUrl: string;
  readonly unresolvedThreads: number;
  readonly staleReviews: boolean;
  readonly mergeQueueStatus: string;
  readonly lastGithubSync: Date;
  readonly githubReconciliationData: Record<string, unknown>;
}

// ─── Repository Functions ───

export async function createReviewState(
  db: DbInstance,
  input: CreateReviewStateInput,
): Promise<FactoryResult<ReviewState>> {
  try {
    const [row] = await db
      .insert(reviewStates)
      .values({
        taskId: input.taskId,
        evidenceBundleId: input.evidenceBundleId,
        prNumber: input.prNumber,
        prUrl: input.prUrl,
        prNodeId: input.prNodeId,
        headSha: input.headSha,
        mergeQueueStatus: "none",
        lastGithubSync: new Date(),
      })
      .returning();

    if (!row) {
      return err(
        createFactoryError(
          "unknown_internal",
          "Failed to create review state: no row returned",
        ),
      );
    }

    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create review state: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function updateReviewState(
  db: DbInstance,
  taskId: string,
  updates: Partial<ReviewStateUpdates>,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(reviewStates)
      .set(updates)
      .where(eq(reviewStates.taskId, taskId));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to update review state: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getReviewState(
  db: DbInstance,
  taskId: string,
): Promise<FactoryResult<ReviewState | null>> {
  try {
    const row = await db.query.reviewStates.findFirst({
      where: eq(reviewStates.taskId, taskId),
    });
    return ok(row ?? null);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get review state: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
