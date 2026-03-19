import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  deliveryId: text("delivery_id").unique().notNull(),
  event: text("event").notNull(),
  action: text("action"),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull().default("received"), // received | processing | processed | failed
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
