import { z } from "zod";
import { AutonomyLevelSchema } from "./autonomy.js";

export const POLICY_TYPES = [
  "read_exclusion",
  "edit_deny",
  "edit_protected",
  "edit_allowed",
] as const;

export const PolicyTypeSchema = z.enum(POLICY_TYPES);
export type PolicyType = z.infer<typeof PolicyTypeSchema>;

export const PROTECTION_CLASSES = [
  "hard_protected",
  "flagged",
  "light_protected",
] as const;

export const ProtectionClassSchema = z.enum(PROTECTION_CLASSES);
export type ProtectionClass = z.infer<typeof ProtectionClassSchema>;

export const PolicyConfigSchema = z
  .object({
    repoId: z.string().uuid(),
    name: z.string().min(1),
    policyType: PolicyTypeSchema,
    protectionClass: ProtectionClassSchema.nullable(),
    pathPatterns: z.array(z.string().min(1)).min(1),
    autonomyLevel: AutonomyLevelSchema,
    requiresApproval: z.boolean(),
    approverRole: z.enum(["admin", "operator"]).nullable(),
    isActive: z.boolean(),
  })
  .strict();

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
