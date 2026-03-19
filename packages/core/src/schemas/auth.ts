import { z } from "zod";

export const ROLES = ["admin", "operator", "viewer"] as const;

export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const ACTOR_TYPES = ["system", "operator"] as const;

export const ActorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const ApiKeyCredentialSchema = z
  .object({
    keyHash: z.string().min(1),
    role: RoleSchema,
    createdBy: z.string().min(1),
    expiresAt: z.string().datetime().nullable(),
    lastUsedAt: z.string().datetime().nullable(),
  })
  .strict();

export type ApiKeyCredential = z.infer<typeof ApiKeyCredentialSchema>;

export const ActorIdentitySchema = z
  .object({
    actorId: z.string().min(1),
    actorType: ActorTypeSchema,
    role: RoleSchema,
  })
  .strict();

export type ActorIdentity = z.infer<typeof ActorIdentitySchema>;
