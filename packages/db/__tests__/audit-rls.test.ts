import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestDb, teardownTestDb } from "./setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestDb();
  // Insert a test audit entry using superuser
  await ctx.pool.query(`
    INSERT INTO audit_entries (actor, action_type, target_type, target_id, result, content_hash)
    VALUES ('test-actor', 'task_created', 'task', 'test-id', 'success', 'abc123')
  `);
}, 120_000);

afterAll(async () => {
  await teardownTestDb(ctx);
});

describe("audit table RLS", () => {
  it("INSERT via factory_app role: succeeds", async () => {
    const client = await ctx.pool.connect();
    try {
      await client.query("SET ROLE factory_app");
      const result = await client.query(`
        INSERT INTO audit_entries (actor, action_type, target_type, target_id, result, content_hash)
        VALUES ('app-actor', 'task_created', 'task', 'test-id-2', 'success', 'def456')
        RETURNING id
      `);
      expect(result.rows).toHaveLength(1);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it("SELECT via factory_app role: succeeds", async () => {
    const client = await ctx.pool.connect();
    try {
      await client.query("SET ROLE factory_app");
      const result = await client.query("SELECT count(*) FROM audit_entries");
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(1);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it("UPDATE via factory_app role: blocked by RLS policy", async () => {
    const client = await ctx.pool.connect();
    try {
      await client.query("SET ROLE factory_app");
      // RESTRICTIVE USING(false) means no rows match for update — 0 rows affected
      const result = await client.query(
        "UPDATE audit_entries SET actor = 'hacker' WHERE actor = 'test-actor' RETURNING id",
      );
      expect(result.rows).toHaveLength(0);

      // Verify data is unchanged
      const selectResult = await client.query(
        "SELECT actor FROM audit_entries WHERE target_id = 'test-id'",
      );
      expect(selectResult.rows[0].actor).toBe("test-actor");
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it("DELETE via factory_app role: blocked by RLS policy", async () => {
    const client = await ctx.pool.connect();
    try {
      await client.query("SET ROLE factory_app");
      // With RESTRICTIVE + USING(false), DELETE returns 0 rows (no error, just no matches)
      const result = await client.query(
        "DELETE FROM audit_entries WHERE actor = 'test-actor' RETURNING id",
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it("INSERT via factory_admin role: succeeds", async () => {
    const client = await ctx.pool.connect();
    try {
      await client.query("SET ROLE factory_admin");
      const result = await client.query(`
        INSERT INTO audit_entries (actor, action_type, target_type, target_id, result, content_hash)
        VALUES ('admin-actor', 'config_changed', 'system', 'sys-1', 'success', 'ghi789')
        RETURNING id
      `);
      expect(result.rows).toHaveLength(1);
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });
});
