import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export type EncryptedEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  keyVersion: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function loadEncryptionKey(): Buffer {
  const encodedKey = process.env.GATEAWAY_DATA_ENCRYPTION_KEY;
  if (!encodedKey) {
    throw new Error("data_encryption_key_missing");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("data_encryption_key_invalid");
  }

  return key;
}

function keyVersion(): string {
  return process.env.GATEAWAY_DATA_ENCRYPTION_KEY_VERSION?.trim() || "v1";
}

export function encryptJson(value: unknown, additionalAuthenticatedData: string): EncryptedEnvelope {
  const key = loadEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  cipher.setAAD(Buffer.from(additionalAuthenticatedData, "utf8"));

  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: ALGORITHM,
    keyVersion: keyVersion(),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptJson<T>(
  envelope: EncryptedEnvelope,
  additionalAuthenticatedData: string
): T {
  if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM) {
    throw new Error("encrypted_payload_format_unsupported");
  }

  const key = loadEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(envelope.iv, "base64"),
    { authTagLength: AUTH_TAG_LENGTH_BYTES }
  );

  decipher.setAAD(Buffer.from(additionalAuthenticatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new Error("encrypted_payload_authentication_failed");
  }
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
