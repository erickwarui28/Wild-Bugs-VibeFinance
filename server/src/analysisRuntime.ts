import { createHash } from "node:crypto";
import { getConfig } from "./config.js";
import { ConcurrencyGate } from "./reliability.js";

let gate: ConcurrencyGate | null = null;
let gateKey = "";
const entries = new Map<string, { at: number; value: unknown }>();
let hits = 0, misses = 0;

export function analysisGate(): ConcurrencyGate {
  const cfg = getConfig();
  const key = JSON.stringify([cfg.ANALYSIS_MAX_ACTIVE, cfg.ANALYSIS_MAX_QUEUED, cfg.ANALYSIS_QUEUE_TIMEOUT_MS]);
  if (!gate || (key !== gateKey && gate.snapshot().active === 0 && gate.snapshot().queued === 0)) {
    gate = new ConcurrencyGate({ active: cfg.ANALYSIS_MAX_ACTIVE, queued: cfg.ANALYSIS_MAX_QUEUED,
      waitMs: cfg.ANALYSIS_QUEUE_TIMEOUT_MS, perOwner: 1 }); gateKey = key;
  }
  return gate;
}

export function analysisKey(owner: string, evidence: unknown): string {
  const cfg = getConfig();
  return createHash("sha256").update(JSON.stringify([owner, cfg.SEED, cfg.LLM_PROVIDER, cfg.OPENAI_MODEL,
    cfg.GEMINI_MODEL, [...cfg.featureSet].sort(), evidence])).digest("hex");
}

function prune() {
  const cfg = getConfig();
  for (const [key, row] of entries) if (Date.now() - row.at >= cfg.ANALYSIS_CACHE_TTL_MS) entries.delete(key);
  while (entries.size > cfg.ANALYSIS_CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

export function cachedAnalysis<T>(key: string, refresh = false): { value: T; ageMs: number } | null {
  prune();
  const row = refresh ? undefined : entries.get(key);
  if (!row) { misses++; return null; }
  hits++; entries.delete(key); entries.set(key, row);
  return { value: structuredClone(row.value) as T, ageMs: Date.now() - row.at };
}

export function cacheAnalysis<T>(key: string, value: T): void {
  const cfg = getConfig();
  if (!cfg.ANALYSIS_CACHE_TTL_MS || !cfg.ANALYSIS_CACHE_MAX_ENTRIES) return;
  entries.delete(key); entries.set(key, { at: Date.now(), value: structuredClone(value) }); prune();
}

export function analysisRuntimeStatus() { prune(); return { ...analysisGate().snapshot(), cache: { entries: entries.size, hits, misses, ttlMs: getConfig().ANALYSIS_CACHE_TTL_MS } }; }
export function clearAnalysisCacheForTests() { entries.clear(); hits = 0; misses = 0; }
