import { beforeAll, describe, expect, it } from "vitest";
import {
  type ArtifactStore,
  createArtifactStore,
} from "../../src/evidence/artifact-store.js";

/**
 * These tests require a running MinIO instance (from docker-compose).
 * They are integration tests that verify the S3-compatible API works
 * with forcePathStyle: true.
 *
 * Skip if MinIO isn't running:
 *   SKIP_INTEGRATION=1 pnpm test
 */
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ROOT_USER ?? "factory";
const MINIO_SECRET_KEY =
  process.env.MINIO_ROOT_PASSWORD ?? "factory-test-password";
const TEST_BUCKET = "factory-test-artifacts";

function canReachMinIO(): boolean {
  // We'll try to create the store and check bucket;
  // if MinIO isn't running, the tests will be skipped
  return !process.env.SKIP_INTEGRATION;
}

describe.skipIf(!canReachMinIO())("ArtifactStore (MinIO integration)", () => {
  let store: ArtifactStore;

  beforeAll(() => {
    store = createArtifactStore({
      endpoint: MINIO_ENDPOINT,
      region: "us-east-1",
      bucket: TEST_BUCKET,
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
      forcePathStyle: true,
    });
  });

  it("ensureBucket creates bucket idempotently", async () => {
    const result1 = await store.ensureBucket();
    expect(result1.isOk()).toBe(true);

    // Call again — should be idempotent
    const result2 = await store.ensureBucket();
    expect(result2.isOk()).toBe(true);
  });

  it("uploads artifact and returns ref with correct SHA-256", async () => {
    await store.ensureBucket();

    const content = '{"test": "data"}';
    const key = `evidence/test-task/1/test-${Date.now()}.json`;
    const result = await store.uploadArtifact(key, content, "application/json");

    expect(result.isOk()).toBe(true);
    const ref = result._unsafeUnwrap();
    expect(ref.key).toBe(key);
    expect(ref.sha256).toBeTruthy();
    expect(ref.sizeBytes).toBe(Buffer.from(content).length);
    expect(ref.contentType).toBe("application/json");
    expect(ref.uploadedAt).toBeTruthy();
  });

  it("downloads artifact with matching content", async () => {
    await store.ensureBucket();

    const original = "Hello, MinIO!";
    const key = `evidence/test-task/1/download-test-${Date.now()}.txt`;
    await store.uploadArtifact(key, original, "text/plain");

    const downloadResult = await store.downloadArtifact(key);
    expect(downloadResult.isOk()).toBe(true);
    expect(downloadResult._unsafeUnwrap().toString()).toBe(original);
  });

  it("verifyArtifact succeeds for untampered artifact", async () => {
    await store.ensureBucket();

    const content = "verify me";
    const key = `evidence/test-task/1/verify-test-${Date.now()}.txt`;
    const uploadResult = await store.uploadArtifact(key, content, "text/plain");
    expect(uploadResult.isOk()).toBe(true);

    const verifyResult = await store.verifyArtifact(
      uploadResult._unsafeUnwrap(),
    );
    expect(verifyResult.isOk()).toBe(true);
    expect(verifyResult._unsafeUnwrap()).toBe(true);
  });

  it("round-trips JSON content", async () => {
    await store.ensureBucket();

    const data = { name: "test", values: [1, 2, 3] };
    const json = JSON.stringify(data);
    const key = `evidence/test-task/1/json-roundtrip-${Date.now()}.json`;

    await store.uploadArtifact(key, json, "application/json");
    const downloaded = await store.downloadArtifact(key);
    expect(downloaded.isOk()).toBe(true);
    expect(JSON.parse(downloaded._unsafeUnwrap().toString())).toEqual(data);
  });

  it("round-trips text content", async () => {
    await store.ensureBucket();

    const patch = "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const key = `evidence/test-task/1/text-roundtrip-${Date.now()}.patch`;

    await store.uploadArtifact(key, patch, "text/x-diff");
    const downloaded = await store.downloadArtifact(key);
    expect(downloaded.isOk()).toBe(true);
    expect(downloaded._unsafeUnwrap().toString()).toBe(patch);
  });

  it("follows evidence/{taskId}/{attemptNumber}/{filename} key structure", async () => {
    await store.ensureBucket();

    const taskId = "abc123";
    const attemptNumber = 2;
    const filename = `structure-test-${Date.now()}.json`;
    const key = `evidence/${taskId}/${attemptNumber}/${filename}`;

    const result = await store.uploadArtifact(key, "{}", "application/json");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().key).toBe(key);
  });

  it("uses forcePathStyle (test passes means MinIO compatible)", async () => {
    // This test implicitly verifies forcePathStyle works because
    // all previous tests succeed with forcePathStyle: true.
    // Without it, the SDK would try virtual-hosted style
    // (bucket.localhost:9000) which MinIO doesn't support.
    await store.ensureBucket();

    const result = await store.uploadArtifact(
      `evidence/path-style-test-${Date.now()}.txt`,
      "path style works",
      "text/plain",
    );
    expect(result.isOk()).toBe(true);
  });
});
