import { z } from "zod";
import { AutonomyLevelSchema } from "./autonomy.js";

export const REPO_CLASSES = ["A", "B", "C"] as const;

export const RepoClassSchema = z.enum(REPO_CLASSES);
export type RepoClass = z.infer<typeof RepoClassSchema>;

export const RepositorySchema = z
  .object({
    id: z.string().uuid(),
    githubOwner: z.string().min(1),
    githubRepo: z.string().min(1),
    defaultBranch: z.string().min(1),
    repoClass: RepoClassSchema,
    autonomyLevel: AutonomyLevelSchema,
    setupContractPath: z.string().nullable(),
  })
  .strict();

export type Repository = z.infer<typeof RepositorySchema>;
