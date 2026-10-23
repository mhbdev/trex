import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { generateEncryptionKey, parseEncryptionKey } from "./secret-vault.ts";

/**
 * Where the profile-encryption key comes from.
 * - `environment`: ENCRYPTION_KEY was supplied by the operator (OS or service secret manager). Nothing is written to disk.
 * - `file`: the key is managed automatically in a key file stored next to the SQLite database.
 * - `ephemeral`: the database is in-memory, so a throwaway key is used for this process only.
 */
export type EncryptionKeySource = "environment" | "file" | "ephemeral";

export interface ResolvedEncryptionKey {
  readonly key: string;
  readonly source: EncryptionKeySource;
  /** Absolute key-file path when the key is file-managed. */
  readonly path?: string;
  /** True when this call generated a brand-new key. */
  readonly created: boolean;
}

export const encryptionKeyFileName = "trex-encryption.key";

function databaseFilePath(databaseUrl: string): string | undefined {
  const path = (databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : databaseUrl).trim();
  if (!path || path === ":memory:" || path.startsWith(":") || /[?&]mode=memory/.test(path)) return undefined;
  return resolve(path.split("?")[0] ?? path);
}

/** The key file lives beside the database it protects, so the two always travel together. */
export function encryptionKeyFilePath(databaseUrl: string): string | undefined {
  const database = databaseFilePath(databaseUrl);
  return database ? join(dirname(database), encryptionKeyFileName) : undefined;
}

export function readEncryptionKeyFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const value = readFileSync(path, "utf8").trim();
  try {
    parseEncryptionKey(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The encryption key file at ${path} is not a valid key (${reason}). Restore it from a backup. Moving it away starts a new key, which makes already-stored credentials unreadable.`);
  }
  return value;
}

/** Write the key atomically with owner-only permissions where the OS supports them. */
export function writeEncryptionKeyFile(path: string, key: string): void {
  parseEncryptionKey(key);
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.tmp-${process.pid}`;
  writeFileSync(staging, `${key}\n`, { mode: 0o600, flag: "w" });
  renameSync(staging, path);
  try { chmodSync(path, 0o600); } catch { /* permission bits are not applicable on this file system */ }
}

export function resolveEncryptionKey(options: { databaseUrl: string; environment?: NodeJS.ProcessEnv; createIfMissing?: boolean }): ResolvedEncryptionKey {
  const environment = options.environment ?? process.env;
  const fromEnvironment = environment.ENCRYPTION_KEY?.trim();
  if (fromEnvironment) {
    parseEncryptionKey(fromEnvironment);
    return { key: fromEnvironment, source: "environment", created: false };
  }
  const path = encryptionKeyFilePath(options.databaseUrl);
  if (!path) return { key: generateEncryptionKey(), source: "ephemeral", created: true };
  const existing = readEncryptionKeyFile(path);
  if (existing) return { key: existing, source: "file", path, created: false };
  if (options.createIfMissing === false) {
    throw new Error(`No encryption key is available: ENCRYPTION_KEY is not set and ${path} does not exist. Run \`trex start\` to create one.`);
  }
  const key = generateEncryptionKey();
  writeEncryptionKeyFile(path, key);
  return { key, source: "file", path, created: true };
}

/**
 * Resolve the key once and expose it through the process environment, so every code path that reads
 * ENCRYPTION_KEY (CLI commands, the admin server, profile services) works without manual setup.
 */
export function ensureEncryptionKey(databaseUrl: string, environment: NodeJS.ProcessEnv = process.env): ResolvedEncryptionKey {
  const resolved = resolveEncryptionKey({ databaseUrl, environment });
  environment.ENCRYPTION_KEY = resolved.key;
  return resolved;
}
