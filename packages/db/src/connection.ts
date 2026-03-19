import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

export interface DbConnection {
  readonly db: DbInstance;
  readonly pool: pg.Pool;
}

export function createDb(connectionString: string): DbConnection {
  const pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const db = drizzle(pool, { schema });

  return { db, pool };
}

export async function checkDatabaseHealth(
  pool: pg.Pool,
): Promise<{ status: "healthy" | "unhealthy"; latencyMs: number }> {
  const start = performance.now();
  try {
    await pool.query("SELECT 1");
    return { status: "healthy", latencyMs: performance.now() - start };
  } catch {
    return { status: "unhealthy", latencyMs: performance.now() - start };
  }
}
