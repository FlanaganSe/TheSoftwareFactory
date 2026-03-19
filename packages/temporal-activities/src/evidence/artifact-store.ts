import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import { sha256 } from "./redaction.js";

export interface ArtifactStoreConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

export interface ArtifactRef {
  readonly key: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly uploadedAt: string;
}

export interface ArtifactStore {
  ensureBucket(): Promise<FactoryResult<void>>;
  uploadArtifact(
    key: string,
    content: Buffer | string,
    contentType: string,
  ): Promise<FactoryResult<ArtifactRef>>;
  downloadArtifact(key: string): Promise<FactoryResult<Buffer>>;
  verifyArtifact(ref: ArtifactRef): Promise<FactoryResult<boolean>>;
  getPresignedUrl(
    key: string,
    expiresInSeconds?: number,
  ): Promise<FactoryResult<string>>;
}

export function createArtifactStore(
  config: ArtifactStoreConfig,
): ArtifactStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async ensureBucket(): Promise<FactoryResult<void>> {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
        return ok(undefined);
      } catch (e: unknown) {
        const error = e as { $metadata?: { httpStatusCode?: number } };
        if (error.$metadata?.httpStatusCode === 404) {
          try {
            await client.send(
              new CreateBucketCommand({ Bucket: config.bucket }),
            );
            return ok(undefined);
          } catch (createErr) {
            return err(
              createFactoryError(
                "storage_unavailable",
                `Failed to create bucket: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
              ),
            );
          }
        }
        return err(
          createFactoryError(
            "storage_unavailable",
            `Failed to check bucket: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },

    async uploadArtifact(
      key: string,
      content: Buffer | string,
      contentType: string,
    ): Promise<FactoryResult<ArtifactRef>> {
      try {
        const buffer =
          typeof content === "string" ? Buffer.from(content) : content;
        const hash = sha256(buffer);

        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            Metadata: {
              "x-amz-checksum-sha256": hash,
            },
          }),
        );

        return ok({
          key,
          sha256: hash,
          sizeBytes: buffer.length,
          contentType,
          uploadedAt: new Date().toISOString(),
        });
      } catch (e) {
        return err(
          createFactoryError(
            "storage_unavailable",
            `Failed to upload artifact ${key}: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },

    async downloadArtifact(key: string): Promise<FactoryResult<Buffer>> {
      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
          }),
        );
        const bytes = await response.Body?.transformToByteArray();
        if (!bytes) {
          return err(
            createFactoryError(
              "storage_unavailable",
              `Empty response for ${key}`,
            ),
          );
        }
        return ok(Buffer.from(bytes));
      } catch (e) {
        return err(
          createFactoryError(
            "storage_unavailable",
            `Failed to download artifact ${key}: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },

    async verifyArtifact(ref: ArtifactRef): Promise<FactoryResult<boolean>> {
      const downloadResult = await this.downloadArtifact(ref.key);
      if (downloadResult.isErr()) {
        return err(downloadResult.error);
      }
      const recomputed = sha256(downloadResult.value);
      return ok(recomputed === ref.sha256);
    },

    async getPresignedUrl(
      key: string,
      expiresInSeconds = 3600,
    ): Promise<FactoryResult<string>> {
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
          }),
          { expiresIn: expiresInSeconds },
        );
        return ok(url);
      } catch (e) {
        return err(
          createFactoryError(
            "storage_unavailable",
            `Failed to generate presigned URL for ${key}: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },
  };
}
