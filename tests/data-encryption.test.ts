import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptJson,
  encryptJson,
  sha256Hex,
  type EncryptedEnvelope,
} from "../server/security/dataEncryption";

const ORIGINAL_KEY = process.env.GATEAWAY_DATA_ENCRYPTION_KEY;
const ORIGINAL_VERSION = process.env.GATEAWAY_DATA_ENCRYPTION_KEY_VERSION;

beforeEach(() => {
  process.env.GATEAWAY_DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  process.env.GATEAWAY_DATA_ENCRYPTION_KEY_VERSION = "test-v1";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GATEAWAY_DATA_ENCRYPTION_KEY;
  else process.env.GATEAWAY_DATA_ENCRYPTION_KEY = ORIGINAL_KEY;

  if (ORIGINAL_VERSION === undefined) {
    delete process.env.GATEAWAY_DATA_ENCRYPTION_KEY_VERSION;
  } else {
    process.env.GATEAWAY_DATA_ENCRYPTION_KEY_VERSION = ORIGINAL_VERSION;
  }
});

describe("Authenticated data encryption", () => {
  it("encrypts and decrypts a JSON payload", () => {
    const payload = {
      event: "payment.success",
      request_id: "req_test_001",
      data: { id: "provider_001", amount: 500 },
    };

    const envelope = encryptJson(payload, "paysuite:req_test_001");
    const decrypted = decryptJson<typeof payload>(
      envelope,
      "paysuite:req_test_001"
    );

    expect(decrypted).toEqual(payload);
    expect(envelope.algorithm).toBe("aes-256-gcm");
    expect(envelope.keyVersion).toBe("test-v1");
    expect(JSON.stringify(envelope)).not.toContain("payment.success");
    expect(JSON.stringify(envelope)).not.toContain("provider_001");
  });

  it("uses a different IV and ciphertext for the same payload", () => {
    const payload = { secret: "same-value" };

    const first = encryptJson(payload, "context:1");
    const second = encryptJson(payload, "context:1");

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects a tampered ciphertext", () => {
    const envelope = encryptJson({ amount: 500 }, "paysuite:req_test_002");
    const tampered: EncryptedEnvelope = {
      ...envelope,
      ciphertext: Buffer.from("tampered").toString("base64"),
    };

    expect(() =>
      decryptJson(tampered, "paysuite:req_test_002")
    ).toThrow("encrypted_payload_authentication_failed");
  });

  it("rejects decryption under a different authenticated context", () => {
    const envelope = encryptJson({ amount: 500 }, "paysuite:req_original");

    expect(() =>
      decryptJson(envelope, "paysuite:req_attacker")
    ).toThrow("encrypted_payload_authentication_failed");
  });

  it("fails closed when the encryption key is missing", () => {
    delete process.env.GATEAWAY_DATA_ENCRYPTION_KEY;

    expect(() => encryptJson({ amount: 500 }, "context")).toThrow(
      "data_encryption_key_missing"
    );
  });

  it("rejects keys that are not exactly 256 bits", () => {
    process.env.GATEAWAY_DATA_ENCRYPTION_KEY = crypto.randomBytes(16).toString("base64");

    expect(() => encryptJson({ amount: 500 }, "context")).toThrow(
      "data_encryption_key_invalid"
    );
  });

  it("creates stable SHA-256 fingerprints without storing the original value", () => {
    const signature = "sha256=example-webhook-signature";
    const fingerprint = sha256Hex(signature);

    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).not.toContain(signature);
    expect(fingerprint).toBe(sha256Hex(signature));
  });
});
