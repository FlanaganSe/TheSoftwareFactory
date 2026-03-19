export { createArtifactStore } from "./artifact-store.js";
export type {
  ArtifactStore,
  ArtifactStoreConfig,
  ArtifactRef,
} from "./artifact-store.js";

export {
  generateAnnotatedDiff,
  classifyRisk,
} from "./diff-annotator.js";
export type {
  DiffAnnotatorConfig,
  AnnotatedDiffResult,
} from "./diff-annotator.js";

export { generateEvidence } from "./generator.js";
export type {
  EvidenceGeneratorConfig,
  ValidationData,
  AgentResultData,
  CapabilityData,
  GenerateEvidenceResult,
} from "./generator.js";

export {
  buildLocator,
  withOptionalArtifacts,
} from "./locator.js";
export type { EvidenceLocator } from "./locator.js";

export {
  createManifest,
  verifyManifest,
} from "./manifest.js";
export type {
  ManifestEntry,
  ManifestMeta,
  EvidenceManifest,
} from "./manifest.js";

export {
  redactSecrets,
  isContentSafe,
  sha256,
} from "./redaction.js";

export { categorizeRisks } from "./risk-summary.js";
export type { RiskCategorization } from "./risk-summary.js";

export { createEvidenceActivities } from "./activities.js";
export type { EvidenceActivityDeps } from "./activities.js";
