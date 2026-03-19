import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { policyConfigs } from "../schema/policy-configs.js";

type PolicyConfig = typeof policyConfigs.$inferSelect;
type NewPolicyConfig = Omit<
  typeof policyConfigs.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export async function createPolicy(
  db: DbInstance,
  input: NewPolicyConfig,
): Promise<FactoryResult<PolicyConfig>> {
  try {
    const [row] = await db.insert(policyConfigs).values(input).returning();
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create policy: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getPoliciesForRepo(
  db: DbInstance,
  repoId: string,
): Promise<FactoryResult<PolicyConfig[]>> {
  try {
    const rows = await db
      .select()
      .from(policyConfigs)
      .where(eq(policyConfigs.repoId, repoId));
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get policies: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function updatePolicy(
  db: DbInstance,
  policyId: string,
  updates: Partial<
    Pick<
      typeof policyConfigs.$inferInsert,
      | "name"
      | "policyType"
      | "protectionClass"
      | "pathPatterns"
      | "autonomyLevel"
      | "requiresApproval"
      | "approverRole"
      | "isActive"
    >
  >,
): Promise<FactoryResult<PolicyConfig>> {
  try {
    const [row] = await db
      .update(policyConfigs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(policyConfigs.id, policyId))
      .returning();
    if (!row) {
      return err(
        createFactoryError("unknown_internal", `Policy not found: ${policyId}`),
      );
    }
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to update policy: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
