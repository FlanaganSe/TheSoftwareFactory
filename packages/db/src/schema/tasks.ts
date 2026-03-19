import type { TaskState } from "@software-factory/core";
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { taskStateEnum } from "./enums.js";
import { repos } from "./repos.js";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: taskStateEnum("state").notNull().default("created"),
    objective: text("objective").notNull(),
    scope: jsonb("scope").$type<Record<string, unknown> | null>(),
    constraints: jsonb("constraints").$type<Record<string, unknown> | null>(),
    budgetCents: numeric("budget_cents", { precision: 10, scale: 0 }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id),
    autonomyLevel: text("autonomy_level").notNull().default("L1"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tasks_active_idx")
      .on(table.state)
      .where(sql`${table.state} NOT IN ('merged', 'failed', 'cancelled')`),
    index("tasks_repo_id_idx").on(table.repoId),
    index("tasks_created_at_idx").on(sql`${table.createdAt} DESC`),
  ],
);

// Re-export the TaskState type alias used by the state column
export type { TaskState };
