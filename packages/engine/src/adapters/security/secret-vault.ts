import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { StoredSecretEnvelope } from "../../application/ports.ts";

const algorithm = "aes-256-gcm" as const;
const keyVersion = 1;
const nonceBytes = 12;

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64url");
}

export function parseEncryptionKey(value = process.env.ENCRYPTION_KEY): Buffer {
  if (!value) throw new Error("ENCRYPTION_KEY is required to read or save encrypted profile secrets. Set it in your OS or process secret manager; do not store it in SQLite or a dotenv file.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("ENCRYPTION_KEY must be a base64url-encoded 32-byte random key (43 characters). Generate one with `trex secrets generate-key`.");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) throw new Error("ENCRYPTION_KEY is not a valid canonical 32-byte base64url key.");
  return decoded;
}

function aad(profileId: string, secretKey: string): Buffer {
  return Buffer.from(`wallex-profile-secret:v${keyVersion}:${profileId}:${secretKey}`, "utf8");
}

export function encryptProfileSecret(profileId: string, secretKey: string, value: string, key = parseEncryptionKey()): StoredSecretEnvelope {
  if (!value) throw new Error("Secret values must not be empty.");
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv(algorithm, key, nonce);
  cipher.setAAD(aad(profileId, secretKey));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    key: secretKey,
    algorithm,
    keyVersion,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    updatedAt: Date.now(),
  };
}

export function decryptProfileSecret(profileId: string, envelope: StoredSecretEnvelope, key = parseEncryptionKey()): string {
  if (envelope.algorithm !== algorithm || envelope.keyVersion !== keyVersion) throw new Error(`Unsupported encryption format for profile secret '${envelope.key}'.`);
  try {
    const nonce = Buffer.from(envelope.nonce, "base64url");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
    const authTag = Buffer.from(envelope.authTag, "base64url");
    if (nonce.length !== nonceBytes || authTag.length !== 16) throw new Error("Invalid encrypted secret envelope.");
    const decipher = createDecipheriv(algorithm, key, nonce);
    decipher.setAAD(aad(profileId, envelope.key));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(`Could not decrypt profile secret '${envelope.key}'. Check ENCRYPTION_KEY and profile database integrity.`);
  }
}

/** Validate all stored envelopes with the old key before re-encrypting them. */
export function rotateProfileSecretEnvelopes(
  profiles: readonly { id: string }[],
  repository: { getConfigProfileSecrets(profileId: string): StoredSecretEnvelope[]; replaceConfigProfileSecretsBatch(profiles: Array<{ profileId: string; secrets: StoredSecretEnvelope[] }>): void },
  oldKey: Buffer,
  newKey = parseEncryptionKey(),
): number {
  const staged = profiles.map(({ id }) => ({
    id,
    secrets: repository.getConfigProfileSecrets(id).map((envelope) =>
      encryptProfileSecret(id, envelope.key, decryptProfileSecret(id, envelope, oldKey), newKey)),
  }));
  repository.replaceConfigProfileSecretsBatch(staged.map((profile) => ({ profileId: profile.id, secrets: profile.secrets })));
  return staged.reduce((count, profile) => count + profile.secrets.length, 0);
}
