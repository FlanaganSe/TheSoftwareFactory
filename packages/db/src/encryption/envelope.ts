import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedPayload {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
}

const IV_LENGTH = 12; // 96-bit IV for AES-256-GCM
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

export function encryptWithDek(
  plaintext: string,
  dek: Buffer,
): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: encrypted, iv, authTag };
}

export function decryptWithDek(payload: EncryptedPayload, dek: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, dek, payload.iv);
  decipher.setAuthTag(payload.authTag);
  const decrypted = Buffer.concat([
    decipher.update(payload.ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function serializePayload(payload: EncryptedPayload): Buffer {
  return Buffer.concat([payload.iv, payload.authTag, payload.ciphertext]);
}

export function deserializePayload(data: Buffer): EncryptedPayload {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  return { iv, authTag, ciphertext };
}
