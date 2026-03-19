import { z } from "zod";

/**
 * Autonomy levels per PRD R-009:
 * - L0: Human confirms every action (branch creation, file writes, PR, merge)
 * - L1: Agent produces diffs/plans; human approval BEFORE branch creation and
 *        file writes; human reviews evidence before PR. DEFAULT.
 * - L2: Agent can create branches, edit code, run tests, push autonomously;
 *        human approval only for PR creation, merge, hard-protected edits.
 *        Deferred to Phase 2.
 */
export const AUTONOMY_LEVELS = ["L0", "L1", "L2"] as const;

export const AutonomyLevelSchema = z.enum(AUTONOMY_LEVELS);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = "L1";
