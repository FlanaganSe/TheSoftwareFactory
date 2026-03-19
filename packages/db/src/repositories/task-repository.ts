import type { FactoryResult, TaskState } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { and, eq, sql } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { auditEntries } from "../schema/audit-entries.js";
import { tasks } from "../schema/tasks.js";
import { computeContentHash } from "../utils/content-hash.js";

type Task = typeof tasks.$inferSelect;
type NewTask = typeof tasks.$inferInsert;

export async function createTask(
  db: DbInstance,
  input: Omit<NewTask, "id" | "state" | "createdAt" | "updatedAt">,
): Promise<FactoryResult<Task>> {
  try {
    const [row] = await db.insert(tasks).values(input).returning();
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create task: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getTask(
  db: DbInstance,
  taskId: string,
): Promise<FactoryResult<Task>> {
  try {
    const row = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });
    if (!row) {
      return err(
        createFactoryError("unknown_internal", `Task not found: ${taskId}`),
      );
    }
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get task: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function transitionTaskState(
  db: DbInstance,
  taskId: string,
  newState: TaskState,
  actor: string,
  auditContent?: Record<string, unknown>,
): Promise<FactoryResult<Task>> {
  try {
    return await db.transaction(async (tx) => {
      // Read current state before update for audit trail
      const [current] = await tx
        .select({ state: tasks.state })
        .from(tasks)
        .where(eq(tasks.id, taskId));

      if (!current) {
        return err(
          createFactoryError("unknown_internal", `Task not found: ${taskId}`),
        );
      }

      // Update state — trigger validates the transition
      const [updated] = await tx
        .update(tasks)
        .set({ state: newState })
        .where(eq(tasks.id, taskId))
        .returning();

      if (!updated) {
        return err(
          createFactoryError("unknown_internal", `Task not found: ${taskId}`),
        );
      }

      // Insert audit entry in same transaction
      const content = auditContent ?? {
        fromState: current.state,
        toState: newState,
      };
      const contentHash = computeContentHash(content);

      await tx.insert(auditEntries).values({
        actor,
        actionType: "task_state_change",
        targetType: "task",
        targetId: taskId,
        result: "success",
        taskId,
        content,
        contentHash,
      });

      return ok(updated);
    });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to transition task state: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function listActiveTasks(
  db: DbInstance,
  repoId?: string,
): Promise<FactoryResult<Task[]>> {
  try {
    const conditions = [
      sql`${tasks.state} NOT IN ('merged', 'failed', 'cancelled')`,
    ];
    if (repoId) {
      conditions.push(eq(tasks.repoId, repoId));
    }
    const rows = await db
      .select()
      .from(tasks)
      .where(and(...conditions));
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to list active tasks: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
