import type { TaskState } from "@software-factory/core";
import type { DbInstance } from "@software-factory/db";
import { taskRepo, type tasks } from "@software-factory/db";
import { ApplicationFailure } from "@temporalio/activity";

type Task = typeof tasks.$inferSelect;

export interface CreateTaskInput {
  readonly objective: string;
  readonly repoId: string;
  readonly createdBy: string;
  readonly autonomyLevel?: string;
  readonly scope?: Record<string, unknown> | null;
  readonly constraints?: Record<string, unknown> | null;
  readonly budgetCents?: string | null;
}

export function createTaskActivities(db: DbInstance) {
  return {
    async createTask(input: CreateTaskInput): Promise<Task> {
      const result = await taskRepo.createTask(db, {
        objective: input.objective,
        repoId: input.repoId,
        createdBy: input.createdBy,
        autonomyLevel: input.autonomyLevel ?? "L1",
      });
      if (result.isErr()) {
        throw ApplicationFailure.nonRetryable(result.error.message);
      }
      return result.value;
    },

    async transitionTaskState(
      taskId: string,
      newState: TaskState,
      actor: string,
      auditContent: unknown,
    ): Promise<Task> {
      const result = await taskRepo.transitionTaskState(
        db,
        taskId,
        newState,
        actor,
        auditContent as Record<string, unknown>,
      );
      if (result.isErr()) {
        if (
          result.error.code === "unknown_internal" &&
          result.error.retryable
        ) {
          throw ApplicationFailure.retryable(result.error.message);
        }
        throw ApplicationFailure.nonRetryable(result.error.message);
      }
      return result.value;
    },

    async getTask(taskId: string): Promise<Task> {
      const result = await taskRepo.getTask(db, taskId);
      if (result.isErr()) {
        throw ApplicationFailure.nonRetryable(result.error.message);
      }
      return result.value;
    },

    async listActiveTasks(repoId?: string): Promise<Task[]> {
      const result = await taskRepo.listActiveTasks(db, repoId);
      if (result.isErr()) {
        throw ApplicationFailure.nonRetryable(result.error.message);
      }
      return result.value;
    },
  };
}
