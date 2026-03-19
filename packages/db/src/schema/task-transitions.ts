import { pgTable, primaryKey } from "drizzle-orm/pg-core";
import { taskStateEnum } from "./enums.js";

export const taskValidTransitions = pgTable(
  "task_valid_transitions",
  {
    fromState: taskStateEnum("from_state").notNull(),
    toState: taskStateEnum("to_state").notNull(),
  },
  (table) => [primaryKey({ columns: [table.fromState, table.toState] })],
);
