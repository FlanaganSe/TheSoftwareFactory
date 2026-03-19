import { describe, expect, it } from "vitest";
import {
  type ManifestEntry,
  type ManifestMeta,
  createManifest,
  verifyManifest,
} from "../../src/evidence/manifest.js";

const meta: ManifestMeta = {
  taskId: "00000000-0000-0000-0000-000000000001",
  attemptNumber: 1,
};

function makeEntry(filename: string, hash: string): ManifestEntry {
  return {
    filename,
    sha256: hash,
    sizeBytes: 1024,
    contentType: "application/json",
  };
}

describe("createManifest", () => {
  it("creates a manifest with deterministic hash", () => {
    const entries = [
      makeEntry("evidence.json", "abc123"),
      makeEntry("diff.patch", "def456"),
    ];
    const manifest1 = createManifest(entries, meta);
    const manifest2 = createManifest(entries, meta);

    expect(manifest1.manifestHash).toBe(manifest2.manifestHash);
    expect(manifest1.schemaVersion).toBe(1);
    expect(manifest1.taskId).toBe(meta.taskId);
    expect(manifest1.attemptNumber).toBe(meta.attemptNumber);
  });

  it("produces same hash regardless of entry order (sorted by filename)", () => {
    const entries1 = [
      makeEntry("evidence.json", "abc123"),
      makeEntry("diff.patch", "def456"),
    ];
    const entries2 = [
      makeEntry("diff.patch", "def456"),
      makeEntry("evidence.json", "abc123"),
    ];

    const manifest1 = createManifest(entries1, meta);
    const manifest2 = createManifest(entries2, meta);

    expect(manifest1.manifestHash).toBe(manifest2.manifestHash);
  });

  it("handles empty entries", () => {
    const manifest = createManifest([], meta);
    expect(manifest.entries).toHaveLength(0);
    expect(manifest.manifestHash).toBeTruthy();
    expect(manifest.schemaVersion).toBe(1);
  });

  it("includes schema version", () => {
    const manifest = createManifest([makeEntry("file.txt", "hash")], meta);
    expect(manifest.schemaVersion).toBe(1);
  });
});

describe("verifyManifest", () => {
  it("returns true for untampered manifest", () => {
    const entries = [
      makeEntry("evidence.json", "abc123"),
      makeEntry("diff.patch", "def456"),
    ];
    const manifest = createManifest(entries, meta);
    expect(verifyManifest(manifest)).toBe(true);
  });

  it("returns false when entry is tampered", () => {
    const entries = [
      makeEntry("evidence.json", "abc123"),
      makeEntry("diff.patch", "def456"),
    ];
    const manifest = createManifest(entries, meta);

    // Tamper with the manifest by changing an entry hash
    const tampered = {
      ...manifest,
      entries: [
        { ...manifest.entries[0], sha256: "tampered_hash" },
        manifest.entries[1],
      ],
    };

    expect(verifyManifest(tampered)).toBe(false);
  });
});
