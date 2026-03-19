import { apiKeyRepo } from "@software-factory/db";
import type { DbInstance } from "@software-factory/db";

export async function seedAdminKey(db: DbInstance): Promise<void> {
  const countResult = await apiKeyRepo.countApiKeys(db);

  if (countResult.isErr()) {
    throw new Error(`Failed to check API keys: ${countResult.error.message}`);
  }

  if (countResult.value > 0) {
    return;
  }

  const createResult = await apiKeyRepo.createApiKey(
    db,
    "initial-admin",
    "admin",
    "system",
  );

  if (createResult.isErr()) {
    throw new Error(
      `Failed to create admin API key: ${createResult.error.message}`,
    );
  }

  const border = "=".repeat(60);
  console.log(`\n${border}`);
  console.log("  ADMIN API KEY (save this — it cannot be retrieved again):");
  console.log(`  ${createResult.value.rawKey}`);
  console.log(`${border}\n`);
}
