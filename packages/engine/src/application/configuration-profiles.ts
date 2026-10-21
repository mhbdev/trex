import { randomUUID } from "node:crypto";
import { engineEnvironmentKeys, loadConfig, type AiProviderId, type EngineEnvironmentKey } from "../domain/config.ts";
import type { RunRepository, StoredConfigProfile, StoredSecretEnvelope } from "./ports.ts";
import { decryptProfileSecret, encryptProfileSecret, parseEncryptionKey } from "../adapters/security/secret-vault.ts";

const secretEnvironmentKeys = new Set<EngineEnvironmentKey>([
  "AI_API_KEY", "WALLEX_API_KEY", "WALLEX_SUB_ACCOUNT_CLIENT_ID", "BOXAPI_API_KEY", "LIARA_API_KEY",
  "AI_PROVIDER_KEYS_JSON", "RESEARCH_ENDPOINTS_JSON", "MARKET_QUOTE_FALLBACKS_JSON",
]);
const supportedSecretKeys = new Set([
  "AI_API_KEY", "WALLEX_API_KEY", "WALLEX_SUB_ACCOUNT_CLIENT_ID", "BOXAPI_API_KEY", "LIARA_API_KEY",
  "RESEARCH_ENDPOINTS_JSON", "MARKET_QUOTE_FALLBACKS_JSON",
]);
const providerIds: AiProviderId[] = ["openai", "anthropic", "google", "compatible", "boxapi", "liara"];
const forbiddenProfileKeys = new Set(["ENCRYPTION_KEY"]);

export interface ConfigProfileSummary extends StoredConfigProfile {
  active: boolean;
  secretState: {
    aiApiKey: boolean;
    wallexApiKey: boolean;
    subAccountClientId: boolean;
    providerKeys: Partial<Record<AiProviderId, boolean>>;
    researchEndpoints: boolean;
    marketQuoteFallbacks: boolean;
  };
}

export interface ProfileUpdate {
  name?: string;
  settings?: Record<string, string>;
  secrets?: Record<string, string | null | undefined>;
}

export class ConfigurationProfileService {
  constructor(
    private readonly repository: RunRepository,
    private readonly now: () => number = Date.now,
    private readonly environment: () => NodeJS.ProcessEnv = () => process.env,
    private readonly encryptionKey: () => Buffer = () => parseEncryptionKey(),
  ) {}

  list(): ConfigProfileSummary[] {
    this.ensureDefault();
    const activeId = this.repository.getActiveConfigProfileId();
    return this.repository.listConfigProfiles().map((profile) => ({
      ...profile,
      active: profile.id === activeId,
      secretState: this.secretState(profile.id),
    }));
  }

  get(id: string): ConfigProfileSummary {
    this.ensureDefault();
    const profile = this.repository.getConfigProfile(id);
    if (!profile) throw new Error(`Configuration profile '${id}' was not found.`);
    return { ...profile, active: profile.id === this.repository.getActiveConfigProfileId(), secretState: this.secretState(id) };
  }

  activeId(): string {
    this.ensureDefault();
    return this.repository.getActiveConfigProfileId()!;
  }

  create(name: string, copyFrom?: string): ConfigProfileSummary {
    this.ensureDefault();
    const cleanName = this.validateName(name);
    if (this.repository.listConfigProfiles().some((profile) => profile.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      throw new Error(`A configuration profile named '${cleanName}' already exists.`);
    }
    const source = copyFrom ? this.repository.getConfigProfile(copyFrom) : null;
    if (copyFrom && !source) throw new Error(`Configuration profile '${copyFrom}' was not found.`);
    const id = randomUUID();
    const timestamp = this.now();
    const profile: StoredConfigProfile = { id, name: cleanName, settings: source ? { ...source.settings } : {}, createdAt: timestamp, updatedAt: timestamp };
    let secrets: StoredSecretEnvelope[] = [];
    if (source) {
      const sourceSecrets = this.repository.getConfigProfileSecrets(source.id);
      if (sourceSecrets.length > 0) {
        const key = this.encryptionKey();
        secrets = sourceSecrets.map((secret) =>
          encryptProfileSecret(id, secret.key, decryptProfileSecret(source.id, secret, key), key));
      }
    }
    this.repository.createConfigProfileWithSecrets(profile, secrets);
    return this.get(id);
  }

  update(id: string, update: ProfileUpdate): ConfigProfileSummary {
    const current = this.repository.getConfigProfile(id);
    if (!current) throw new Error(`Configuration profile '${id}' was not found.`);
    const name = update.name === undefined ? current.name : this.validateName(update.name);
    if (this.repository.listConfigProfiles().some((profile) => profile.id !== id && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error(`A configuration profile named '${name}' already exists.`);
    }
    const settings = { ...current.settings, ...(update.settings ?? {}) };
    for (const key of Object.keys(settings)) {
      if (!engineEnvironmentKeys.includes(key as EngineEnvironmentKey) || secretEnvironmentKeys.has(key as EngineEnvironmentKey) || forbiddenProfileKeys.has(key)) {
        throw new Error(`'${key}' is not a writable non-secret profile setting.`);
      }
    }
    const secretMap = new Map(this.repository.getConfigProfileSecrets(id).map((row) => [row.key, row]));
    let nextSecretRows: StoredSecretEnvelope[] | undefined;
    if (update.secrets && Object.keys(update.secrets).length > 0) {
      const newSecretValues = new Map<string, string>();
      for (const [secretKey, value] of Object.entries(update.secrets)) {
        if (!supportedSecretKeys.has(secretKey) && !secretKey.startsWith("AI_PROVIDER_KEY:")) throw new Error(`'${secretKey}' is not a supported profile secret.`);
        if (secretKey.startsWith("AI_PROVIDER_KEY:") && !providerIds.includes(secretKey.slice("AI_PROVIDER_KEY:".length) as AiProviderId)) {
          throw new Error(`Unknown AI provider in secret key '${secretKey}'.`);
        }
        if (value === null || value === "") secretMap.delete(secretKey);
        else if (value !== undefined) newSecretValues.set(secretKey, value);
      }
      const key = secretMap.size > 0 || newSecretValues.size > 0 ? this.encryptionKey() : undefined;
      const encryptedSecretMap = new Map(secretMap);
      if (key) for (const [secretKey, value] of newSecretValues) encryptedSecretMap.set(secretKey, encryptProfileSecret(id, secretKey, value, key));
      nextSecretRows = [...encryptedSecretMap.values()];
      // Validate the resulting configuration before storing any changes.
      const secretsEnv = key ? this.secretsToEnvironment(id, nextSecretRows, key) : {};
      const candidate = { ...settings, ...secretsEnv, ...this.processOverrides() };
      loadConfig(candidate as NodeJS.ProcessEnv);
    } else loadConfig({ ...settings, ...this.resolveSecrets(id), ...this.processOverrides() } as NodeJS.ProcessEnv);
    const updated: StoredConfigProfile = { ...current, name, settings, updatedAt: this.now() };
    this.repository.saveConfigProfile(updated, nextSecretRows);
    return this.get(id);
  }

  activate(id: string): ConfigProfileSummary {
    const profile = this.repository.getConfigProfile(id);
    if (!profile) throw new Error(`Configuration profile '${id}' was not found.`);
    const secrets = this.resolveSecrets(id);
    loadConfig({ ...profile.settings, ...secrets, ...this.processOverrides() } as NodeJS.ProcessEnv);
    this.repository.setActiveConfigProfileId(id);
    return this.get(id);
  }

  delete(id: string): void {
    if (this.repository.listConfigProfiles().length <= 1) throw new Error("The final configuration profile cannot be deleted.");
    this.repository.deleteConfigProfile(id);
  }

  resolve(id = this.activeId()): NodeJS.ProcessEnv {
    this.ensureDefault();
    const profile = this.repository.getConfigProfile(id);
    if (!profile) throw new Error(`Configuration profile '${id}' was not found.`);
    return { ...profile.settings, ...this.resolveSecrets(id), ...this.processOverrides() } as NodeJS.ProcessEnv;
  }

  effectiveConfig(id = this.activeId()) {
    return loadConfig(this.resolve(id));
  }

  replaceFromImportedEnvironment(name: string, env: Record<string, string>, profileId?: string): ConfigProfileSummary {
    const target = profileId ? this.repository.getConfigProfile(profileId) : undefined;
    if (profileId && !target) throw new Error(`Configuration profile '${profileId}' was not found.`);
    for (const key of Object.keys(env)) {
      if (forbiddenProfileKeys.has(key)) throw new Error("ENCRYPTION_KEY must be supplied by the process environment, not imported from a dotenv file.");
      if (!engineEnvironmentKeys.includes(key as EngineEnvironmentKey)) throw new Error(`Unknown configuration setting '${key}' in the import file.`);
    }
    const secretInput: Record<string, string> = {};
    const settings: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (key === "AI_PROVIDER_KEYS_JSON") {
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { throw new Error("AI_PROVIDER_KEYS_JSON must be valid JSON before import."); }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AI_PROVIDER_KEYS_JSON must be an object before import.");
        for (const [provider, secret] of Object.entries(parsed as Record<string, unknown>)) {
          if (!providerIds.includes(provider as AiProviderId) || typeof secret !== "string") throw new Error("AI_PROVIDER_KEYS_JSON contains an unsupported provider key.");
          secretInput[`AI_PROVIDER_KEY:${provider}`] = secret;
        }
      } else if (secretEnvironmentKeys.has(key as EngineEnvironmentKey)) secretInput[key] = value;
      else if (key !== "DATABASE_URL" && key !== "LOG_LEVEL") settings[key] = value;
    }
    const activeProfile = target ?? this.create(name);
    const existing = this.repository.getConfigProfile(activeProfile.id)!;
    for (const key of Object.keys(settings)) {
      if (!engineEnvironmentKeys.includes(key as EngineEnvironmentKey) || secretEnvironmentKeys.has(key as EngineEnvironmentKey) || forbiddenProfileKeys.has(key)) {
        throw new Error(`'${key}' is not a writable non-secret profile setting.`);
      }
    }
    const hasSecretValues = Object.values(secretInput).some(Boolean);
    const key = hasSecretValues ? this.encryptionKey() : undefined;
    const envelopes: StoredSecretEnvelope[] = [];
    const providerKeys: Partial<Record<AiProviderId, string>> = {};
    for (const [secretKey, value] of Object.entries(secretInput)) {
      if (secretKey.startsWith("AI_PROVIDER_KEY:")) providerKeys[secretKey.slice("AI_PROVIDER_KEY:".length) as AiProviderId] = value;
      else if (value) envelopes.push(encryptProfileSecret(activeProfile.id, secretKey, value, key));
    }
    for (const [provider, value] of Object.entries(providerKeys)) if (value) envelopes.push(encryptProfileSecret(activeProfile.id, `AI_PROVIDER_KEY:${provider}`, value, key));
    const candidateSecrets: Record<string, string> = {};
    for (const [secretKey, value] of Object.entries(secretInput)) {
      if (secretKey.startsWith("AI_PROVIDER_KEY:")) candidateSecrets.AI_PROVIDER_KEYS_JSON = JSON.stringify(providerKeys);
      else if (value) candidateSecrets[secretKey] = value;
    }
    loadConfig({ ...settings, ...candidateSecrets, ...this.processOverrides() } as NodeJS.ProcessEnv);
    this.repository.saveConfigProfile({ ...existing, settings, updatedAt: this.now() }, envelopes);
    return this.get(activeProfile.id);
  }

  private ensureDefault(): void {
    const profiles = this.repository.listConfigProfiles();
    if (profiles.length > 0) {
      if (!this.repository.getActiveConfigProfileId()) this.repository.setActiveConfigProfileId(profiles[0]!.id);
      return;
    }
    const timestamp = this.now();
    const profile = { id: randomUUID(), name: "Default", settings: {}, createdAt: timestamp, updatedAt: timestamp };
    this.repository.createConfigProfile(profile);
    this.repository.setActiveConfigProfileId(profile.id);
  }

  private validateName(name: string): string {
    const clean = name.trim();
    if (!clean || clean.length > 80) throw new Error("Profile name must contain 1–80 characters.");
    return clean;
  }

  private resolveSecrets(profileId: string): Record<string, string> {
    const rows = this.repository.getConfigProfileSecrets(profileId);
    if (rows.length === 0) return {};
    const key = this.encryptionKey();
    return this.secretsToEnvironment(profileId, rows, key);
  }

  private secretsToEnvironment(profileId: string, rows: StoredSecretEnvelope[], key: Buffer): Record<string, string> {
    const result: Record<string, string> = {};
    const providerKeys: Partial<Record<AiProviderId, string>> = {};
    for (const row of rows) {
      const value = decryptProfileSecret(profileId, row, key);
      if (row.key.startsWith("AI_PROVIDER_KEY:")) providerKeys[row.key.slice("AI_PROVIDER_KEY:".length) as AiProviderId] = value;
      else result[row.key] = value;
    }
    if (Object.keys(providerKeys).length > 0) result.AI_PROVIDER_KEYS_JSON = JSON.stringify(providerKeys);
    return result;
  }

  private secretState(profileId: string): ConfigProfileSummary["secretState"] {
    const keys = this.repository.getConfigProfileSecrets(profileId).map((secret) => secret.key);
    const providerKeys: Partial<Record<AiProviderId, boolean>> = {};
    for (const provider of providerIds) providerKeys[provider] = keys.includes(`AI_PROVIDER_KEY:${provider}`);
    return {
      aiApiKey: keys.includes("AI_API_KEY"), wallexApiKey: keys.includes("WALLEX_API_KEY"),
      subAccountClientId: keys.includes("WALLEX_SUB_ACCOUNT_CLIENT_ID"), providerKeys,
      researchEndpoints: keys.includes("RESEARCH_ENDPOINTS_JSON"), marketQuoteFallbacks: keys.includes("MARKET_QUOTE_FALLBACKS_JSON"),
    };
  }

  private processOverrides(): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {};
    const environment = this.environment();
    for (const key of engineEnvironmentKeys) if (environment[key] !== undefined) result[key] = environment[key];
    return result;
  }
}
