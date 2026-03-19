import { z } from "zod";
import { PolicyConfigSchema } from "./schemas/policy.js";
import { SetupContractSchema } from "./schemas/sandbox.js";

/**
 * The TrustedBaseContext is captured at task intake and consumed by ALL downstream phases.
 * It pins behavioral control files to the base SHA so candidate-branch edits cannot
 * alter agent behavior or validation criteria (R-011).
 */
export const TrustedBaseContextSchema = z
  .object({
    baseSha: z.string().min(1),
    setupContract: SetupContractSchema.nullable(),
    policySnapshot: z.array(PolicyConfigSchema),
    behavioralControlFiles: z.record(z.string(), z.string()),
    validationCommandSources: z.array(z.string()),
    capturedAt: z.string().datetime(),
  })
  .strict();

export type TrustedBaseContext = z.infer<typeof TrustedBaseContextSchema>;
