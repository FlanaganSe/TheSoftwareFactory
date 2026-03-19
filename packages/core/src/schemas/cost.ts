import { z } from "zod";

export const CostRecordSchema = z
  .object({
    taskId: z.string().uuid().nullable(),
    modelId: z.string().min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costCents: z.number().nonnegative(),
    latencyMs: z.number().nonnegative().nullable(),
    timestamp: z.string().datetime(),
  })
  .strict();

export type CostRecord = z.infer<typeof CostRecordSchema>;
