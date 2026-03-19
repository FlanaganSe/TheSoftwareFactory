import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { repos } from "./repos.js";

export const codeIndexVersions = pgTable(
  "code_index_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id),
    commitSha: text("commit_sha").notNull(),
    status: text("status").notNull(), // building | ready | stale
  },
  (table) => [
    uniqueIndex("code_index_versions_repo_sha_idx").on(
      table.repoId,
      table.commitSha,
    ),
  ],
);

export const codeSymbols = pgTable(
  "code_symbols",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    indexVersionId: uuid("index_version_id")
      .notNull()
      .references(() => codeIndexVersions.id),
    filePath: text("file_path"),
    symbolName: text("symbol_name"),
    symbolKind: text("symbol_kind"), // function | class | interface | type | variable | export
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    parentSymbol: text("parent_symbol"),
    signature: text("signature"),
    isExported: boolean("is_exported"),
    // searchVector is a GENERATED column — added via custom migration SQL
  },
  (table) => [
    index("code_symbols_symbol_name_idx").on(table.symbolName),
    index("code_symbols_file_path_idx").on(table.filePath),
  ],
);

export const codeDependencies = pgTable(
  "code_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    indexVersionId: uuid("index_version_id")
      .notNull()
      .references(() => codeIndexVersions.id),
    sourceFile: text("source_file").notNull(),
    targetFile: text("target_file").notNull(),
    importType: text("import_type"), // static | dynamic | type_only
  },
  (table) => [
    index("code_dependencies_source_idx").on(table.sourceFile),
    index("code_dependencies_target_idx").on(table.targetFile),
  ],
);

export const codeFiles = pgTable("code_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  indexVersionId: uuid("index_version_id")
    .notNull()
    .references(() => codeIndexVersions.id),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash").notNull(),
  language: text("language"),
  lineCount: integer("line_count"),
  isEntryPoint: boolean("is_entry_point"),
  moduleGroup: text("module_group"),
  governanceExcluded: boolean("governance_excluded").default(false),
});
