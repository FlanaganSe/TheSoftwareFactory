import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { repos } from "./repos.js";

export const environmentStates = pgTable("environment_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoId: uuid("repo_id").references(() => repos.id),
  imageRef: text("image_ref"),
  setupContractHash: text("setup_contract_hash"),
  cacheValid: boolean("cache_valid").default(false),
  lastHealthCheck: timestamp("last_health_check", { withTimezone: true }),
  healthStatus: text("health_status"), // healthy | unhealthy | unknown
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
