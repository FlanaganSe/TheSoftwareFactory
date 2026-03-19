import type { DbInstance } from "@software-factory/db";
import { auditRepo } from "@software-factory/db";
import { computeContentHash } from "@software-factory/db";
import { ApplicationFailure } from "@temporalio/activity";

export interface AuditEntryInput {
  readonly actor: string;
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly result: string;
  readonly taskId?: string;
  readonly content?: unknown;
  readonly contentHash: string;
}

export function createAuditActivities(db: DbInstance) {
  return {
    async insertAuditEntry(entry: AuditEntryInput): Promise<void> {
      const contentHash =
        entry.contentHash || computeContentHash(entry.content ?? {});
      const result = await auditRepo.insertAuditEntry(db, {
        actor: entry.actor,
        actionType: entry.actionType,
        targetType: entry.targetType,
        targetId: entry.targetId,
        result: entry.result,
        taskId: entry.taskId,
        content: entry.content,
        contentHash,
      });
      if (result.isErr()) {
        throw ApplicationFailure.nonRetryable(result.error.message);
      }
    },
  };
}
