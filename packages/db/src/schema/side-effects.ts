import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

export const sideEffects = pgTable("side_effects", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id),
  effectType: text("effect_type").notNull(),
  idempotencyKey: text("idempotency_key").unique().notNull(),
  targetRef: text("target_ref"),
  requestPayloadHash: text("request_payload_hash"),
  responsePayload: jsonb("response_payload"),
  status: text("status").notNull().default("pending"), // pending | completed | failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
