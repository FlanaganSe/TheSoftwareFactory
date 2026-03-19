import { randomBytes } from "node:crypto";
import {
  decryptWithDek,
  deserializePayload,
  encryptWithDek,
  serializePayload,
} from "./envelope.js";
import type { KmsProvider } from "./kms-provider.js";

const DEK_LENGTH = 32; // 256-bit DEK

export async function encryptSecret(
  plaintext: string,
  kmsProvider: KmsProvider,
  kekId: string,
): Promise<{ encryptedValue: Buffer; encryptedDek: Buffer }> {
  const dek = randomBytes(DEK_LENGTH);
  const payload = encryptWithDek(plaintext, dek);
  const encryptedValue = serializePayload(payload);
  const encryptedDek = await kmsProvider.wrapDek(dek, kekId);
  return { encryptedValue, encryptedDek };
}

export async function decryptSecret(
  encryptedValue: Buffer,
  encryptedDek: Buffer,
  kmsProvider: KmsProvider,
  kekId: string,
): Promise<string> {
  const dek = await kmsProvider.unwrapDek(encryptedDek, kekId);
  const payload = deserializePayload(encryptedValue);
  return decryptWithDek(payload, dek);
}
