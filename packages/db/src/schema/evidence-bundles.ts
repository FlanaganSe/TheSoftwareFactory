import type {
  CommandRecord,
  DiffAnnotation,
  LintResults,
  MigrationImpact,
  ProtectedEdit,
  SecurityScanResults,
  TestResults,
} from "@software-factory/core";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { revertabilityClassEnum } from "./enums.js";
import { tasks } from "./tasks.js";

export const evidenceBundles = pgTable("evidence_bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  version: integer("version").notNull().default(1),
  schemaVersion: integer("schema_version").notNull(),
  objective: text("objective").notNull(),
  baseSha: text("base_sha").notNull(),
  headSha: text("head_sha").notNull(),
  mergeBaseSha: text("merge_base_sha").notNull(),
  revertabilityClass: revertabilityClassEnum("revertability_class").notNull(),
  blastRadiusFiles: integer("blast_radius_files").notNull(),
  blastRadiusPackages: integer("blast_radius_packages").notNull(),
  hasProtectedSurfaceEdits: boolean("has_protected_surface_edits").default(
    false,
  ),
  hasMigrationImpact: boolean("has_migration_impact").default(false),
  artifactUrl: text("artifact_url"),
  annotatedDiff: jsonb("annotated_diff").$type<DiffAnnotation[]>(),
  ownersImpacted: jsonb("owners_impacted").$type<string[]>(),
  testResults: jsonb("test_results").$type<TestResults>(),
  securityScanResults: jsonb(
    "security_scan_results",
  ).$type<SecurityScanResults>(),
  lintResults: jsonb("lint_results").$type<LintResults>(),
  protectedSurfaceEdits: jsonb("protected_surface_edits").$type<
    ProtectedEdit[]
  >(),
  migrationImpact: jsonb("migration_impact").$type<MigrationImpact>(),
  unresolvedAssumptions: jsonb("unresolved_assumptions").$type<string[]>(),
  commandsRun: jsonb("commands_run").$type<CommandRecord[]>(),
  pendingExternalChecks: jsonb("pending_external_checks").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
