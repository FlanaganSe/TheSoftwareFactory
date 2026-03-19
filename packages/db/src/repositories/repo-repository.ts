import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { and, eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { DbInstance } from "../connection.js";
import { repos } from "../schema/repos.js";

type Repo = typeof repos.$inferSelect;
type NewRepo = Omit<
  typeof repos.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export async function createRepo(
  db: DbInstance,
  input: NewRepo,
): Promise<FactoryResult<Repo>> {
  try {
    const [row] = await db.insert(repos).values(input).returning();
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to create repo: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getRepo(
  db: DbInstance,
  repoId: string,
): Promise<FactoryResult<Repo>> {
  try {
    const row = await db.query.repos.findFirst({
      where: eq(repos.id, repoId),
    });
    if (!row) {
      return err(
        createFactoryError("unknown_internal", `Repo not found: ${repoId}`),
      );
    }
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get repo: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function getRepoBySlug(
  db: DbInstance,
  owner: string,
  repo: string,
): Promise<FactoryResult<Repo>> {
  try {
    const row = await db.query.repos.findFirst({
      where: and(eq(repos.githubOwner, owner), eq(repos.githubRepo, repo)),
    });
    if (!row) {
      return err(
        createFactoryError(
          "unknown_internal",
          `Repo not found: ${owner}/${repo}`,
        ),
      );
    }
    return ok(row);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to get repo by slug: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export async function listRepos(
  db: DbInstance,
): Promise<FactoryResult<Repo[]>> {
  try {
    const rows = await db.select().from(repos);
    return ok(rows);
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Failed to list repos: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}
