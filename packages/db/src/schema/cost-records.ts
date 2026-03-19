import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

export const costRecords = pgTable(
  "cost_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => tasks.id),
    modelId: text("model_id").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costCents: numeric("cost_cents", { precision: 10, scale: 4 }).notNull(),
    latencyMs: integer("latency_ms"),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("cost_records_task_id_idx").on(table.taskId),
    index("cost_records_timestamp_idx").on(table.timestamp),
    index("cost_records_model_id_idx").on(table.modelId),
  ],
);
