import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubOwner: text("github_owner").notNull(),
    githubRepo: text("github_repo").notNull(),
    defaultBranch: text("default_branch").default("main"),
    repoClass: text("repo_class").default("A"),
    autonomyLevel: text("autonomy_level").default("L1"),
    setupContractPath: text("setup_contract_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("repos_owner_repo_idx").on(table.githubOwner, table.githubRepo),
  ],
);
