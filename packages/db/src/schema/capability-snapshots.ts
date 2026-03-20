import type { CapabilitySnapshot } from "@software-factory/core";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { repos } from "./repos.js";

export const capabilitySnapshots = pgTable(
  "capability_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceRevision: text("source_revision").notNull(),
    snapshot: jsonb("snapshot").$type<CapabilitySnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("capability_snapshots_repo_latest_idx").on(
      table.repoId,
      table.capturedAt,
    ),
  ],
);
