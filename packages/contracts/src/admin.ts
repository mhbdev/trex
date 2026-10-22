import { z } from "zod";

export const ProviderSchema = z.enum(["openai", "anthropic", "google", "compatible", "boxapi", "liara"]);

export const ProfileSecretStateSchema = z.object({
  aiApiKey: z.boolean(),
  providerKeys: z.record(ProviderSchema, z.boolean()),
  wallexApiKey: z.boolean(),
  subAccountClientId: z.boolean(),
  tronscanApiKey: z.boolean().default(false),
  researchEndpoints: z.boolean().default(false),
  marketQuoteFallbacks: z.boolean().default(false),
});

export const EnvironmentProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  active: z.boolean(),
  settings: z.record(z.string(), z.string()),
  secrets: ProfileSecretStateSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const CreateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  copyFrom: z.string().optional(),
});

export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  settings: z.record(z.string(), z.string()).optional(),
  secrets: z.object({
    aiApiKey: z.string().optional(),
    providerKeys: z.partialRecord(ProviderSchema, z.string()).optional(),
    wallexApiKey: z.string().optional(),
    subAccountClientId: z.string().optional(),
    tronscanApiKey: z.string().optional(),
    researchEndpoints: z.string().optional(),
    marketQuoteFallbacks: z.string().optional(),
  }).optional(),
});

export const BacktestRunRequestSchema = z.object({
  mode: z.literal("backtest"),
  profileId: z.string().min(1),
  symbols: z.array(z.string().min(3).max(24)).min(1).max(32),
  strategyIds: z.array(z.string().min(1)).min(1).max(32),
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  overrides: z.record(z.string(), z.string()).default({}),
});

export const ShadowRunRequestSchema = z.object({
  mode: z.literal("shadow"),
  profileId: z.string().min(1),
  symbols: z.array(z.string().min(3).max(24)).min(1).max(32),
  strategyIds: z.array(z.string().min(1)).min(1).max(32),
  watch: z.boolean().default(false),
  intervalSeconds: z.number().int().min(10).max(86_400).default(60),
  overrides: z.record(z.string(), z.string()).default({}),
});

export const LiveRunRequestSchema = z.object({
  mode: z.literal("live"),
  profileId: z.string().min(1),
  symbol: z.string().min(3).max(24),
  strategyId: z.string().min(1),
  autoTrade: z.boolean().default(false),
  intervalSeconds: z.number().int().min(10).max(86_400).default(60),
  confirmed: z.literal(true),
  overrides: z.record(z.string(), z.string()).default({}),
});

export const StartRunRequestSchema = z.discriminatedUnion("mode", [
  BacktestRunRequestSchema,
  ShadowRunRequestSchema,
  LiveRunRequestSchema,
]);

export const StopRunRequestSchema = z.object({ reason: z.string().max(500).optional() });
export const DiagnosticsRequestSchema = z.object({ mode: z.enum(["backtest", "shadow", "live"]).default("shadow"), checkWallex: z.boolean().default(false) });
export const MarketListRequestSchema = z.object({ all: z.boolean().default(false) });
export const StrategyWriteSchema = z.object({ strategies: z.array(z.unknown()).max(100) });
export const RunListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(50) });
export const BenchmarkQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) });
export const DotenvImportSchema = z.object({ path: z.string().min(1).max(2048), name: z.string().trim().min(1).max(80), profileId: z.string().optional() });
export const OrderCancelSchema = z.object({ clientOrderId: z.string().min(1).max(160), confirmed: z.literal(true) });

export const RunStateSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["backtest", "shadow", "live"]),
  profileId: z.string().min(1),
  symbol: z.string().optional(),
  strategyId: z.string().optional(),
  state: z.enum(["starting", "running", "waiting", "stopping", "completed", "failed", "stopped"]),
  message: z.string(),
  startedAt: z.number().int(),
  updatedAt: z.number().int(),
  error: z.string().optional(),
});

export const DiagnosticSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "fail", "skip", "warning"]),
  detail: z.string(),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type EnvironmentProfile = z.infer<typeof EnvironmentProfileSchema>;
export type CreateProfile = z.infer<typeof CreateProfileSchema>;
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
