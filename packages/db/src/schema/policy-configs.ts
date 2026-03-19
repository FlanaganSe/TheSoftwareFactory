import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { policyTypeEnum, protectionClassEnum } from "./enums.js";
import { repos } from "./repos.js";

export const policyConfigs = pgTable(
  "policy_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id),
    name: text("name").notNull(),
    policyType: policyTypeEnum("policy_type").notNull(),
    protectionClass: protectionClassEnum("protection_class"),
    pathPatterns: jsonb("path_patterns").notNull().$type<string[]>(),
    autonomyLevel: text("autonomy_level"),
    requiresApproval: boolean("requires_approval").default(false),
    approverRole: text("approver_role"),
    isActive: boolean("is_active").default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("policy_configs_repo_id_idx").on(table.repoId),
    index("policy_configs_path_patterns_idx").using("gin", table.pathPatterns),
  ],
);
