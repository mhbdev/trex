import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptionKeyFileName, encryptionKeyFilePath, ensureEncryptionKey, resolveEncryptionKey } from "../packages/engine/src/adapters/security/encryption-key-file.ts";
import { generateEncryptionKey, parseEncryptionKey } from "../packages/engine/src/adapters/security/secret-vault.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDatabase(): Promise<{ directory: string; databaseUrl: string }> {
  const directory = await mkdtemp(join(tmpdir(), "trex-key-file-"));
  temporaryDirectories.push(directory);
  return { directory, databaseUrl: `file:${join(directory, "nested", "trex.sqlite")}` };
}

describe("automatic encryption key file", () => {
  test("creates a key file beside the database on first use and reuses it afterwards", async () => {
    const { directory, databaseUrl } = await temporaryDatabase();
    const expectedPath = join(directory, "nested", encryptionKeyFileName);
    expect(encryptionKeyFilePath(databaseUrl)).toBe(expectedPath);

    const first = resolveEncryptionKey({ databaseUrl, environment: {} });
    expect(first.source).toBe("file");
    expect(first.created).toBe(true);
    expect(first.path).toBe(expectedPath);
    expect(parseEncryptionKey(first.key).length).toBe(32);
    expect((await readFile(expectedPath, "utf8")).trim()).toBe(first.key);

    const second = resolveEncryptionKey({ databaseUrl, environment: {} });
    expect(second).toEqual({ key: first.key, source: "file", path: expectedPath, created: false });
  });

  test("an operator-supplied ENCRYPTION_KEY wins and nothing is written to disk", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const supplied = generateEncryptionKey();
    const resolved = resolveEncryptionKey({ databaseUrl, environment: { ENCRYPTION_KEY: supplied } });
    expect(resolved).toEqual({ key: supplied, source: "environment", created: false });
    expect(existsSync(encryptionKeyFilePath(databaseUrl) ?? "")).toBe(false);
    expect(() => resolveEncryptionKey({ databaseUrl, environment: { ENCRYPTION_KEY: "not-a-key" } })).toThrow(/ENCRYPTION_KEY/);
  });

  test("in-memory databases get a process-local key without touching the file system", () => {
    for (const databaseUrl of [":memory:", "file::memory:"]) {
      expect(encryptionKeyFilePath(databaseUrl)).toBeUndefined();
      const resolved = resolveEncryptionKey({ databaseUrl, environment: {} });
      expect(resolved.source).toBe("ephemeral");
      expect(resolved.path).toBeUndefined();
      expect(parseEncryptionKey(resolved.key).length).toBe(32);
    }
  });

  test("a corrupted key file is reported with its path instead of being silently replaced", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const path = encryptionKeyFilePath(databaseUrl) ?? "";
    resolveEncryptionKey({ databaseUrl, environment: {} });
    await writeFile(path, "damaged\n");
    expect(() => resolveEncryptionKey({ databaseUrl, environment: {} })).toThrow(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect((await readFile(path, "utf8")).trim()).toBe("damaged");
  });

  test("ensureEncryptionKey exposes the resolved key through the given environment", async () => {
    const { databaseUrl } = await temporaryDatabase();
    const environment: NodeJS.ProcessEnv = {};
    const resolved = ensureEncryptionKey(databaseUrl, environment);
    expect(environment.ENCRYPTION_KEY).toBe(resolved.key);
    expect(resolved.source).toBe("file");
    expect(resolveEncryptionKey({ databaseUrl, createIfMissing: false, environment: {} }).key).toBe(resolved.key);
  });

  test("refuses to invent a key when asked only to read an existing one", async () => {
    const { databaseUrl } = await temporaryDatabase();
    expect(() => resolveEncryptionKey({ databaseUrl, environment: {}, createIfMissing: false })).toThrow(/trex start/);
  });
});
