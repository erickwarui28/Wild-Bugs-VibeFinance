import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env.VF_SKIP_ENV_FILES !== "1") {
  loadEnv({ path: path.resolve(here, "../.env") });
  loadEnv({ path: path.resolve(here, "../../.env") });
}

const Schema = z.object({
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("127.0.0.1"),
  SEED: z.coerce.number().default(42),
  LLM_PROVIDER: z.enum(["openai", "gemini", "mock"]).default("mock"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-6-luna"),
  OPENAI_EMBED_MODEL: z.string().default("text-embedding-3-small"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_EMBED_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDINGS: z.enum(["local", "openai", "gemini"]).default("local"),
  AGENT_TIMEOUT_MS: z.coerce.number().default(8000),
  ANALYSIS_MAX_ACTIVE: z.coerce.number().int().min(1).max(20).default(3),
  ANALYSIS_MAX_QUEUED: z.coerce.number().int().min(0).max(100).default(12),
  ANALYSIS_QUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  ANALYSIS_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  ANALYSIS_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(300_000),
  ANALYSIS_CACHE_MAX_ENTRIES: z.coerce.number().int().min(0).max(256).default(64),
  SOURCE_MAX_ACTIVE: z.coerce.number().int().min(1).max(20).default(6),
  SOURCE_MAX_QUEUED: z.coerce.number().int().min(0).max(100).default(24),
  SOURCE_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  SOURCE_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  DB_PATH: z.string().default("./data/vibefinance.db"),
  DATA_MODE: z.enum(["live", "cached", "synthetic"]).default("synthetic"),
  SNAPSHOT_ID: z.string().default(""),
  LIVE_HISTORY_MONTHS: z.coerce.number().default(12),
  FII_CSV_PATH: z.string().default("./data/live/fii_dii.csv"),
  GDELT_ENABLED: z.enum(["true", "false"]).default("true"),
  FEATURES: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
  OPENAI_VISITOR_HOURLY_LIMIT: z.coerce.number().int().positive().default(100),
  OPENAI_GLOBAL_LIMIT: z.coerce.number().int().positive().default(10_000),
  OPENAI_NETWORK_HOURLY_LIMIT: z.coerce.number().int().positive().default(300),
  OPENAI_BUDGET_USD: z.coerce.number().positive().default(5),
  // Standard GPT-6 Luna rates, USD per million tokens, verified 2026-10-14.
  OPENAI_PRICE_MODEL: z.string().default("gpt-6-luna"),
  OPENAI_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0.10),
  OPENAI_CACHED_USD_PER_MILLION: z.coerce.number().nonnegative().default(0.01),
  OPENAI_CACHE_WRITE_USD_PER_MILLION: z.coerce.number().nonnegative().default(0.125),
  OPENAI_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0.50),
  ADMIN_USERNAME: z.string().default(""),
  ADMIN_PASSWORD: z.string().default(""),
});

export type AppConfig = z.infer<typeof Schema> & { featureSet: Set<string>; version: string };

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = Schema.parse(process.env);
  cached = {
    ...parsed,
    featureSet: new Set(
      parsed.FEATURES.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    version: "1.0.0",
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}

export function featureOn(flag: string): boolean {
  return getConfig().featureSet.has(flag);
}
