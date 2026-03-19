import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeSideEffect,
  failSideEffect,
  getSideEffect,
  recordSideEffect,
} from "../src/repositories/side-effect-repository.js";
import { type TestContext, setupTestDb, teardownTestDb } from "./setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestDb();
}, 120_000);

afterAll(async () => {
  await teardownTestDb(ctx);
});

describe("side effect ledger", () => {
  it("record side effect, retrieve by idempotency key: found", async () => {
    await recordSideEffect(
      ctx.db,
      null,
      "github_pr_create",
      "key-001",
      "req-hash-1",
    );

    const result = await getSideEffect(ctx.db, "key-001");
    expect(result.isOk()).toBe(true);
    const effect = result._unsafeUnwrap();
    expect(effect).not.toBeNull();
    expect(effect?.effectType).toBe("github_pr_create");
    expect(effect?.status).toBe("pending");
  });

  it("duplicate idempotency key: fails (unique constraint)", async () => {
    await recordSideEffect(ctx.db, null, "github_pr_create", "key-dup", "h1");

    const result = await recordSideEffect(
      ctx.db,
      null,
      "github_pr_create",
      "key-dup",
      "h2",
    );
    expect(result.isErr()).toBe(true);
  });

  it("complete side effect: status changes to completed", async () => {
    await recordSideEffect(
      ctx.db,
      null,
      "github_comment",
      "key-complete",
      "h3",
    );

    await completeSideEffect(ctx.db, "key-complete", { prUrl: "https://..." });

    const result = await getSideEffect(ctx.db, "key-complete");
    const effect = result._unsafeUnwrap();
    expect(effect?.status).toBe("completed");
    expect(effect?.responsePayload).toEqual({ prUrl: "https://..." });
  });

  it("fail side effect: status changes to failed with error message", async () => {
    await recordSideEffect(ctx.db, null, "github_merge", "key-fail", "h4");

    await failSideEffect(ctx.db, "key-fail", "merge conflict");

    const result = await getSideEffect(ctx.db, "key-fail");
    const effect = result._unsafeUnwrap();
    expect(effect?.status).toBe("failed");
    expect(effect?.errorMessage).toBe("merge conflict");
  });
});
