import { sha256 } from "./redaction.js";

export interface ManifestEntry {
  readonly filename: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: string;
}

export interface ManifestMeta {
  readonly taskId: string;
  readonly attemptNumber: number;
}

export interface EvidenceManifest {
  readonly schemaVersion: number;
  readonly taskId: string;
  readonly attemptNumber: number;
  readonly createdAt: string;
  readonly entries: readonly ManifestEntry[];
  readonly manifestHash: string;
}

/**
 * Compute a deterministic hash from manifest entries.
 * Entries are sorted by filename to ensure consistent ordering.
 */
function computeManifestHash(entries: readonly ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );
  const serialized = JSON.stringify(sorted);
  return sha256(serialized);
}

/**
 * Create an evidence manifest with a deterministic hash tree.
 */
export function createManifest(
  entries: readonly ManifestEntry[],
  meta: ManifestMeta,
): EvidenceManifest {
  const manifestHash = computeManifestHash(entries);
  return {
    schemaVersion: 1,
    taskId: meta.taskId,
    attemptNumber: meta.attemptNumber,
    createdAt: new Date().toISOString(),
    entries,
    manifestHash,
  };
}

/**
 * Verify a manifest's integrity by recomputing the hash from entries.
 */
export function verifyManifest(manifest: EvidenceManifest): boolean {
  const recomputed = computeManifestHash(manifest.entries);
  return recomputed === manifest.manifestHash;
}
