import {
  customType,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { secretClassEnum } from "./enums.js";
import { repos } from "./repos.js";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const secretBindings = pgTable(
  "secret_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id),
    name: text("name").notNull(),
    secretClass: secretClassEnum("secret_class").notNull(),
    toolScope: text("tool_scope"),
    encryptedValue: bytea("encrypted_value").notNull(),
    encryptedDek: bytea("encrypted_dek").notNull(),
    kekId: text("kek_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("secret_bindings_repo_name_idx").on(table.repoId, table.name),
  ],
);
