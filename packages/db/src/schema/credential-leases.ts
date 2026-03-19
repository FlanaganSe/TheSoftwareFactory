import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.js";

export const credentialLeases = pgTable(
  "credential_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    tokenType: text("token_type").notNull(),
    scope: jsonb("scope").notNull().$type<string[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("credential_leases_task_id_idx").on(table.taskId),
    index("credential_leases_expires_at_idx").on(table.expiresAt),
  ],
);
