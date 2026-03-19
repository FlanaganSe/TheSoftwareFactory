import { createCipheriv, createDecipheriv } from "node:crypto";
import type { KmsProvider } from "./kms-provider.js";

const WRAP_ALGORITHM = "aes-256-ecb";

export class LocalKmsProvider implements KmsProvider {
  readonly providerId = "local";
  private readonly masterKey: Buffer;

  constructor(masterKeyHex: string) {
    const key = Buffer.from(masterKeyHex, "hex");
    if (key.length !== 32) {
      throw new Error(
        "FACTORY_MASTER_KEY must be 64 hex characters (32 bytes)",
      );
    }
    this.masterKey = key;
  }

  async wrapDek(plaintextDek: Buffer, _kekId: string): Promise<Buffer> {
    // AES key wrap using ECB mode (RFC 3394 simplified — acceptable for local dev)
    const cipher = createCipheriv(WRAP_ALGORITHM, this.masterKey, null);
    return Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
  }

  async unwrapDek(wrappedDek: Buffer, _kekId: string): Promise<Buffer> {
    const decipher = createDecipheriv(WRAP_ALGORITHM, this.masterKey, null);
    return Buffer.concat([decipher.update(wrappedDek), decipher.final()]);
  }
}
