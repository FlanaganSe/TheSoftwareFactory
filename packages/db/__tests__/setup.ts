import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { DbInstance } from "../src/connection.js";
import * as schema from "../src/schema/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_0 = readFileSync(
  join(__dirname, "../drizzle/0000_wonderful_wallop.sql"),
  "utf8",
);
const MIGRATION_1 = readFileSync(
  join(__dirname, "../drizzle/0001_custom_triggers_rls_seeds.sql"),
  "utf8",
);

// init-db.sql creates roles and extensions
const INIT_SQL = readFileSync(
  join(__dirname, "../../..", "scripts/init-db.sql"),
  "utf8",
);

export interface TestContext {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  db: DbInstance;
  connectionString: string;
}

export async function setupTestDb(): Promise<TestContext> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("factory")
    .withUsername("factory")
    .withPassword("test_password")
    .start();

  const connectionString = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString });

  // Run init SQL to create roles and extensions
  // Filter out CREATE DATABASE statements (test DB already exists)
  const filteredInit = INIT_SQL.split("\n")
    .filter(
      (line) =>
        !line.trim().startsWith("CREATE DATABASE") &&
        !line.trim().startsWith("-- Create Temporal"),
    )
    .join("\n");
  await pool.query(filteredInit);

  // Apply Drizzle migrations
  // Split by --> statement-breakpoint and execute each statement
  for (const stmt of MIGRATION_0.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) {
      await pool.query(trimmed);
    }
  }

  // Custom migration uses regular SQL statements separated by semicolons
  // but we need to handle $$ blocks carefully
  await pool.query(MIGRATION_1);

  const db = drizzle(pool, { schema });
  return { container, pool, db, connectionString };
}

export async function teardownTestDb(ctx: TestContext): Promise<void> {
  await ctx.pool.end();
  await ctx.container.stop();
}
