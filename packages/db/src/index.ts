// Connection
export { createDb, checkDatabaseHealth } from "./connection.js";
export type { DbInstance, DbConnection } from "./connection.js";

// Schema
export * from "./schema/index.js";

// Repositories
export * as taskRepo from "./repositories/task-repository.js";
export * as auditRepo from "./repositories/audit-repository.js";
export * as repoRepo from "./repositories/repo-repository.js";
export * as policyRepo from "./repositories/policy-repository.js";
export * as webhookRepo from "./repositories/webhook-repository.js";
export * as sideEffectRepo from "./repositories/side-effect-repository.js";
export * as apiKeyRepo from "./repositories/api-key-repository.js";
export * as indexRepo from "./repositories/index-repository.js";
export * as evidenceRepo from "./repositories/evidence-repository.js";
export * as reviewStateRepo from "./repositories/review-state-repository.js";
export * as capabilitySnapshotRepo from "./repositories/capability-snapshot-repository.js";

// Encryption
export type { EncryptedPayload } from "./encryption/envelope.js";
export {
  encryptWithDek,
  decryptWithDek,
  serializePayload,
  deserializePayload,
} from "./encryption/envelope.js";
export type { KmsProvider } from "./encryption/kms-provider.js";
export { LocalKmsProvider } from "./encryption/local-kms.js";
export { encryptSecret, decryptSecret } from "./encryption/secret-manager.js";

// Utilities
export { computeContentHash } from "./utils/content-hash.js";
