import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptWithDek,
  deserializePayload,
  encryptWithDek,
  serializePayload,
} from "../src/encryption/envelope.js";
import { LocalKmsProvider } from "../src/encryption/local-kms.js";
import {
  decryptSecret,
  encryptSecret,
} from "../src/encryption/secret-manager.js";

const TEST_DEK = randomBytes(32);

describe("envelope encryption", () => {
  it("encrypt then decrypt round-trip: plaintext matches", () => {
    const plaintext = "secret-value-12345";
    const payload = encryptWithDek(plaintext, TEST_DEK);
    const decrypted = decryptWithDek(payload, TEST_DEK);
    expect(decrypted).toBe(plaintext);
  });

  it("different plaintexts produce different ciphertexts (IV is random)", () => {
    const payload1 = encryptWithDek("same-text", TEST_DEK);
    const payload2 = encryptWithDek("same-text", TEST_DEK);
    expect(payload1.ciphertext).not.toEqual(payload2.ciphertext);
    expect(payload1.iv).not.toEqual(payload2.iv);
  });

  it("tampered ciphertext fails decryption (GCM auth tag verification)", () => {
    const payload = encryptWithDek("important-data", TEST_DEK);
    // Tamper with ciphertext
    const tampered = {
      ...payload,
      ciphertext: Buffer.from(payload.ciphertext),
    };
    tampered.ciphertext[0] ^= 0xff;

    expect(() => decryptWithDek(tampered, TEST_DEK)).toThrow();
  });

  it("serialize/deserialize payload round-trip works", () => {
    const payload = encryptWithDek("round-trip-test", TEST_DEK);
    const serialized = serializePayload(payload);
    const deserialized = deserializePayload(serialized);

    expect(deserialized.iv).toEqual(payload.iv);
    expect(deserialized.authTag).toEqual(payload.authTag);
    expect(deserialized.ciphertext).toEqual(payload.ciphertext);

    // Full round-trip
    const decrypted = decryptWithDek(deserialized, TEST_DEK);
    expect(decrypted).toBe("round-trip-test");
  });
});

describe("LocalKmsProvider", () => {
  it("wrap/unwrap DEK round-trip works", async () => {
    const masterKey = randomBytes(32).toString("hex");
    const kms = new LocalKmsProvider(masterKey);
    const dek = randomBytes(32);

    const wrapped = await kms.wrapDek(dek, "test-kek");
    const unwrapped = await kms.unwrapDek(wrapped, "test-kek");

    expect(unwrapped).toEqual(dek);
  });

  it("rejects invalid master key length", () => {
    expect(() => new LocalKmsProvider("tooshort")).toThrow(/64 hex characters/);
  });
});

describe("secret manager", () => {
  it("full flow: encryptSecret → decryptSecret returns original value", async () => {
    const masterKey = randomBytes(32).toString("hex");
    const kms = new LocalKmsProvider(masterKey);

    const plaintext = "my-github-token-abc123";
    const { encryptedValue, encryptedDek } = await encryptSecret(
      plaintext,
      kms,
      "local-kek",
    );

    const decrypted = await decryptSecret(
      encryptedValue,
      encryptedDek,
      kms,
      "local-kek",
    );
    expect(decrypted).toBe(plaintext);
  });
});
