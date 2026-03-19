import { z } from "zod";
import { AutonomyLevelSchema } from "./autonomy.js";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000; // 14_400_000
const FOUR_GB = 4 * 1024 * 1024 * 1024;

export const FactoryConfigSchema = z
  .object({
    api: z
      .object({
        port: z.number().int().positive().default(3000),
        host: z.string().min(1).default("0.0.0.0"),
      })
      .strict(),
    database: z
      .object({
        connectionString: z.string().min(1),
        maxConnections: z.number().int().positive().default(20),
      })
      .strict(),
    redis: z
      .object({
        url: z.string().min(1),
      })
      .strict(),
    temporal: z
      .object({
        address: z.string().min(1).default("localhost:7233"),
        namespace: z.string().min(1).default("default"),
      })
      .strict(),
    objectStorage: z
      .object({
        endpoint: z.string().min(1),
        bucket: z.string().min(1).default("factory-artifacts"),
        accessKey: z.string().min(1),
        secretKey: z.string().min(1),
      })
      .strict(),
    github: z
      .object({
        appId: z.string().min(1),
        privateKeyPath: z.string().min(1),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        webhookSecret: z.string().min(1),
      })
      .strict(),
    llm: z
      .object({
        provider: z.string().min(1).default("openrouter"),
        apiKey: z.string().min(1),
        defaultModel: z.string().min(1),
        budgetPerTaskCents: z.number().int().nonnegative().default(1000),
        budgetDailyCents: z.number().int().nonnegative().default(10000),
      })
      .strict(),
    autonomy: z
      .object({
        defaultLevel: AutonomyLevelSchema.default("L1"),
        soloDevMode: z.boolean().default(false),
      })
      .strict(),
    review: z
      .object({
        timeoutMs: z.number().int().positive().default(FOUR_HOURS_MS),
        escalationEnabled: z.boolean().default(true),
      })
      .strict(),
    sandbox: z
      .object({
        memoryLimitBytes: z.number().int().positive().default(FOUR_GB),
        cpuLimit: z.number().positive().default(2),
        pidsLimit: z.number().int().positive().default(256),
        networkMode: z.string().min(1).default("none"),
      })
      .strict(),
  })
  .strict();

export type FactoryConfig = z.infer<typeof FactoryConfigSchema>;

export const REVIEW_TIMEOUT_MS_DEFAULT = FOUR_HOURS_MS;
