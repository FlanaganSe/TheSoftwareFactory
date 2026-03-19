import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actor: text("actor").notNull(),
    actionType: text("action_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    result: text("result").notNull(),
    costCents: numeric("cost_cents", { precision: 10, scale: 0 }),
    taskId: uuid("task_id").references(() => tasks.id),
    content: jsonb("content"),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    index("audit_entries_task_id_idx").on(table.taskId),
    index("audit_entries_actor_idx").on(table.actor),
    index("audit_entries_action_type_idx").on(table.actionType),
  ],
);
