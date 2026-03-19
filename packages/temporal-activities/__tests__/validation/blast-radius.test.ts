import type { PolicyConfig } from "@software-factory/core";
import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { computeBlastRadius } from "../../src/validation/blast-radius.js";

// Mock the db module
vi.mock("@software-factory/db", () => ({
  indexRepo: {
    getFileDependents: vi.fn(),
  },
}));

import { indexRepo } from "@software-factory/db";

const mockGetDependents = vi.mocked(indexRepo.getFileDependents);

function makeDb(): unknown {
  return {};
}

function makePolicy(
  patterns: string[],
  type: "edit_protected" | "edit_deny" = "edit_protected",
): PolicyConfig {
  return {
    repoId: "test-repo",
    name: "test-policy",
    policyType: type,
    protectionClass: "flagged",
    pathPatterns: patterns,
    autonomyLevel: "L1",
    requiresApproval: true,
    approverRole: "admin",
    isActive: true,
  };
}

describe("computeBlastRadius", () => {
  it("single file change → correct file count", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["src/index.ts"],
      policies: [],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.blastRadius.files).toBe(1);
    expect(data.filesChanged).toEqual(["src/index.ts"]);
  });

  it("file with dependents → transitive packages counted", async () => {
    // Level 0: src/utils.ts changed
    // Level 1: src/api/handler.ts depends on src/utils.ts
    // Level 2: src/api/routes.ts depends on src/api/handler.ts
    mockGetDependents
      .mockResolvedValueOnce(
        ok([
          {
            id: "1",
            indexVersionId: "v1",
            sourceFile: "src/api/handler.ts",
            targetFile: "src/utils.ts",
            importType: "static",
          },
        ]),
      )
      .mockResolvedValueOnce(
        ok([
          {
            id: "2",
            indexVersionId: "v1",
            sourceFile: "src/api/routes.ts",
            targetFile: "src/api/handler.ts",
            importType: "static",
          },
        ]),
      )
      .mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["src/utils.ts"],
      policies: [],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    // 3 files: src/utils.ts + src/api/handler.ts + src/api/routes.ts
    expect(data.blastRadius.files).toBe(3);
    expect(data.packagesAffected.length).toBeGreaterThanOrEqual(1);
  });

  it("protected path changed → flagged in protectedSurfaceEdits", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["src/api.ts", ".factory/setup.yml"],
      policies: [],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.protectedSurfaceEdits).toContain(".factory/setup.yml");
  });

  it("policy-protected file → flagged", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["config/secrets.yml"],
      policies: [makePolicy(["config/**"], "edit_deny")],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.protectedSurfaceEdits).toContain("config/secrets.yml");
  });

  it("migration file in diff → hasMigrations true", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["migrations/001_create_users.sql"],
      policies: [],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.migrationImpact.hasMigrations).toBe(true);
    expect(data.migrationImpact.migrationFiles).toContain(
      "migrations/001_create_users.sql",
    );
  });

  it("no migration files → hasMigrations false", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["src/index.ts"],
      policies: [],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();
    expect(data.migrationImpact.hasMigrations).toBe(false);
  });

  it("revertability: no migrations → clean_revert", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["src/feature.ts"],
      policies: [],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().revertabilityClass).toBe("clean_revert");
  });

  it("revertability: has migrations → revert_with_migration", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["migrations/002_add_email.sql"],
      policies: [],
      db: makeDb() as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().revertabilityClass).toBe(
      "revert_with_migration",
    );
  });

  it("revertability: DROP TABLE in SQL → non_revertable", async () => {
    mockGetDependents.mockResolvedValue(ok([]));

    const result = await computeBlastRadius({
      indexVersionId: "v1",
      changedFiles: ["migrations/003_cleanup.sql"],
      policies: [],
      db: makeDb() as never,
      migrationFileContents: {
        "migrations/003_cleanup.sql": "DROP TABLE users;",
      },
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().revertabilityClass).toBe("non_revertable");
  });
});
