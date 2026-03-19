import { createHash, randomBytes } from "node:crypto";
import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { and, eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { apiKeys } from "../schema/api-keys.js";

type ApiKeyRow = typeof apiKeys.$inferSelect;

export interface ApiKeyCredential {
  readonly id: string;
  readonly role: ApiKeyRow["role"];
  readonly createdBy: string;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export async function createApiKey(
  db: DbInstance,
  label: string,
  role: ApiKeyRow["role"],
  createdBy: string,
  expiresAt?: Date,
): Promise<FactoryResult<{ rawKey: string; id: string }>> {
  try {
    const rawKey = `sf_${randomBytes(32).toString("hex")}`;
    const keyHash = hashKey(rawKey);

    const [row] = await db
      .insert(apiKeys)
      .values({ keyHash, label, role, createdBy, expiresAt })
      .returning({ id: apiKeys.id });

    return ok({ rawKey, id: row.id });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create API key: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function validateApiKey(
  db: DbInstance,
  rawKey: string,
): Promise<FactoryResult<ApiKeyCredential>> {
  try {
    const keyHash = hashKey(rawKey);
    const row = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)),
    });

    if (!row) {
      return err(
        createFactoryError("unknown_internal", "Invalid or inactive API key"),
      );
    }

    if (row.expiresAt && row.expiresAt < new Date()) {
      return err(createFactoryError("unknown_internal", "API key expired"));
    }

    // Update lastUsedAt
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id));

    return ok({
      id: row.id,
      role: row.role,
      createdBy: row.createdBy,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
    });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to validate API key: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function revokeApiKey(
  db: DbInstance,
  keyId: string,
): Promise<FactoryResult<void>> {
  try {
    await db
      .update(apiKeys)
      .set({ isActive: false })
      .where(eq(apiKeys.id, keyId));
    return ok(undefined);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to revoke API key: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
