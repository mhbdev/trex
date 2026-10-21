import { describe, expect, test } from "bun:test";
import { ConfigurationProfileService } from "../packages/engine/src/application/configuration-profiles.ts";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import { generateEncryptionKey, parseEncryptionKey, rotateProfileSecretEnvelopes } from "../packages/engine/src/adapters/security/secret-vault.ts";

describe("encrypted configuration profiles", () => {
  test("stores secrets encrypted, fails closed on wrong keys, and rotates atomically", () => {
    const repository = new SqliteRunRepository(":memory:");
    try {
      repository.migrate();
      let key = parseEncryptionKey(generateEncryptionKey());
      const profiles = new ConfigurationProfileService(repository, Date.now, () => ({}), () => key);
      const profile = profiles.create("Test profile");
      const privateValue = "profile-secret-should-never-appear-in-sqlite";
      profiles.update(profile.id, {
        settings: {
          AI_PROVIDER: "compatible",
          AI_MODEL: "local-test-model",
          AI_BASE_URL: "http://localhost:1234/v1",
        },
        secrets: { AI_API_KEY: privateValue },
      });

      const stored = repository.getConfigProfileSecrets(profile.id);
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(privateValue);
      expect(profiles.resolve(profile.id).AI_API_KEY).toBe(privateValue);
      expect(profiles.get(profile.id).secretState.aiApiKey).toBe(true);

      const previousKey = key;
      key = parseEncryptionKey(generateEncryptionKey());
      expect(() => profiles.resolve(profile.id)).toThrow("Could not decrypt profile secret");
      const replacementKey = key;
      rotateProfileSecretEnvelopes([{ id: profile.id }], repository, previousKey, replacementKey);
      expect(profiles.resolve(profile.id).AI_API_KEY).toBe(privateValue);

      const unchanged = repository.getConfigProfile(profile.id);
      const unchangedSecrets = repository.getConfigProfileSecrets(profile.id);
      expect(() => profiles.update(profile.id, { settings: { WALLEX_ENABLE_LIVE_TRADING: "sometimes" } })).toThrow();
      expect(repository.getConfigProfile(profile.id)).toEqual(unchanged);
      expect(repository.getConfigProfileSecrets(profile.id)).toEqual(unchangedSecrets);
    } finally {
      repository.close();
    }
  });

  test("allows removing the final stored credential without an encryption key", () => {
    const repository = new SqliteRunRepository(":memory:");
    try {
      repository.migrate();
      let key: Buffer | undefined = parseEncryptionKey(generateEncryptionKey());
      const profiles = new ConfigurationProfileService(repository, Date.now, () => ({}), () => {
        if (!key) throw new Error("missing key");
        return key;
      });
      const profile = profiles.create("Credential removal");
      profiles.update(profile.id, { secrets: { AI_API_KEY: "remove-me" } });
      key = undefined;
      profiles.update(profile.id, { secrets: { AI_API_KEY: null } });
      expect(repository.getConfigProfileSecrets(profile.id)).toEqual([]);
      expect(profiles.get(profile.id).secretState.aiApiKey).toBe(false);
    } finally {
      repository.close();
    }
  });
});
