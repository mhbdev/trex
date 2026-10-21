import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importDotenvFile } from "../apps/cli/src/admin-server.ts";
import { ConfigurationProfileService } from "../packages/engine/src/application/configuration-profiles.ts";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import { generateEncryptionKey } from "../packages/engine/src/adapters/security/secret-vault.ts";

const temporaryDirectories: string[] = [];
const previousEncryptionKey = process.env.ENCRYPTION_KEY;

afterEach(async () => {
  if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = previousEncryptionKey;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("one-time dotenv profile import", () => {
  test("validates settings, encrypts and verifies credentials, then scrubs configuration assignments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trex-profile-import-"));
    temporaryDirectories.push(directory);
    const path = join(directory, ".env.test");
    const apiKey = "profile-import-secret-value";
    const source = [
      "# Keep unrelated notes in the file.",
      "AI_PROVIDER=compatible",
      "AI_MODEL=fixture-model",
      "AI_BASE_URL=http://127.0.0.1:9999/v1",
      `AI_API_KEY="${apiKey}\nsecond-secret-line"`,
      `ENCRYPTION_KEY=${generateEncryptionKey()}`,
      "PAPER_INITIAL_CASH=250000",
      "",
    ].join("\n");
    await writeFile(path, source, { mode: 0o600 });
    process.env.ENCRYPTION_KEY = generateEncryptionKey();

    const repository = new SqliteRunRepository(":memory:");
    try {
      repository.migrate();
      const profiles = new ConfigurationProfileService(repository);
      const result = await importDotenvFile({ path, name: "Imported test" }, profiles, repository);
      const cleaned = await readFile(path, "utf8");
      const stored = repository.getConfigProfileSecrets(result.profile.id);

      expect(result.removedConfigurationAssignments).toBe(6);
      expect(cleaned).toBe("# Keep unrelated notes in the file.\n");
      expect(profiles.get(result.profile.id).settings.AI_PROVIDER).toBe("compatible");
      expect(cleaned).not.toContain("AI_API_KEY");
      expect(cleaned).not.toContain("ENCRYPTION_KEY");
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(apiKey);
      expect(profiles.resolve(result.profile.id).AI_API_KEY).toBe(`${apiKey}\nsecond-secret-line`);
      expect(profiles.effectiveConfig(result.profile.id).paperInitialCash).toBe("250000");
    } finally {
      repository.close();
    }
  });
});
