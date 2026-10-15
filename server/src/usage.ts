import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { getConfig } from "./config.js";
import { getDb } from "./db/db.js";
import { networkId, verifyIdentity } from "./identity.js";

const HOUR_MS = 60 * 60 * 1000;
const requestContext = new AsyncLocalStorage<{ visitorId: string; networkId?: string }>();

export class UsageLimitError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "UsageLimitError";
  }
}

export function usageContext(req: Request, res: Response, next: NextFunction): void {
  const network = networkId(req.ip ?? "unknown");
  const authenticated = verifyIdentity(req.get("x-vf-visitor"));
  const visitorId = authenticated ?? `network_${network.slice(0, 16)}`;
  res.locals.visitorId = visitorId;
  res.locals.authenticatedVisitor = authenticated;
  requestContext.run({ visitorId, networkId: network }, next);
}

export function runWithVisitor<T>(visitorId: string, callback: () => T, network?: string): T {
  return requestContext.run({ visitorId, networkId: network }, callback);
}

export function recordActivity(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/") && !req.path.startsWith("/api/admin") && req.method !== "OPTIONS") {
    const startedAt = Date.now();
    res.once("finish", () => {
      getDb()
        .prepare("INSERT INTO activity_events (visitor_id, method, path, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(res.locals.visitorId ?? "visitor_unknown", req.method, req.path.slice(0, 200), res.statusCode, Date.now() - startedAt, new Date().toISOString());
    });
  }
  next();
}

/** Reserve a quota slot immediately before a real OpenAI HTTP call. */
export function reserveOpenAiCall(options?: { model: string; inputBound: number; outputBound: number }): number {
  const visitorId = requestContext.getStore()?.visitorId ?? "maintenance";
  const db = getDb();
  const cfg = getConfig();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const network = requestContext.getStore()?.networkId ?? null;
  if (options && options.model !== cfg.OPENAI_PRICE_MODEL) {
    throw new UsageLimitError("Model pricing has not been configured. An administrator must configure matching rates before OpenAI calls can run.");
  }
  const rates = { input: cfg.OPENAI_INPUT_USD_PER_MILLION, cached: cfg.OPENAI_CACHED_USD_PER_MILLION,
    write: cfg.OPENAI_CACHE_WRITE_USD_PER_MILLION, output: cfg.OPENAI_OUTPUT_USD_PER_MILLION };
  // Long-context rates are not assumed: reject oversized requests instead.
  if (options && options.inputBound > 100_000) throw new UsageLimitError("Request exceeds the configured short-context accounting limit.");
  const reservedUsd = options ? (options.inputBound * Math.max(rates.input, rates.cached, rates.write) + options.outputBound * rates.output) / 1_000_000 : 0;
  const reserve = db.transaction(() => {
    if (network) {
      const calls = (db.prepare("SELECT COUNT(*) AS n FROM openai_attempts WHERE network_id = ? AND created_at > ?")
        .get(network, new Date(now - HOUR_MS).toISOString()) as { n: number }).n;
      if (calls >= cfg.OPENAI_NETWORK_HOURLY_LIMIT) throw new UsageLimitError("This network's hourly OpenAI call limit has been reached. Please try again later.");
    }
    const spending = budgetSnapshot();
    if (spending.committedUsd + reservedUsd > cfg.OPENAI_BUDGET_USD || spending.committedUsd >= cfg.OPENAI_BUDGET_USD) {
      throw new UsageLimitError("The application's OpenAI spending budget has been reached. An administrator must reset the budget.");
    }
    const global = db.prepare("SELECT total_calls FROM api_usage_global WHERE id = 1").get() as { total_calls: number } | undefined;
    if ((global?.total_calls ?? 0) >= cfg.OPENAI_GLOBAL_LIMIT) {
      throw new UsageLimitError("The global OpenAI API-call limit has been reached. An administrator must reset it.");
    }
    const visitor = db
      .prepare("SELECT total_calls, window_calls, window_started_at FROM api_usage_visitors WHERE visitor_id = ?")
      .get(visitorId) as { total_calls: number; window_calls: number; window_started_at: number } | undefined;
    const freshWindow = !visitor || now - visitor.window_started_at >= HOUR_MS;
    const windowCalls = (db.prepare(`SELECT COUNT(*) AS n FROM api_usage_events
      WHERE visitor_id = ? AND created_at > ? AND id > COALESCE((SELECT last_event_id FROM usage_reset_marks WHERE visitor_id = ?), 0)`)
      .get(visitorId, new Date(now - HOUR_MS).toISOString(), visitorId) as { n: number }).n;
    if (windowCalls >= cfg.OPENAI_VISITOR_HOURLY_LIMIT) {
      throw new UsageLimitError("Your hourly OpenAI API-call limit has been reached. Please try again later.");
    }
    db.prepare("INSERT INTO api_usage_global (id, total_calls, updated_at) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET total_calls = total_calls + 1, updated_at = excluded.updated_at").run(nowIso);
    db.prepare(
      `INSERT INTO api_usage_visitors (visitor_id, total_calls, window_calls, window_started_at, first_seen_at, last_seen_at)
       VALUES (?, 1, 1, ?, ?, ?)
       ON CONFLICT(visitor_id) DO UPDATE SET
         total_calls = total_calls + 1,
         window_calls = ?,
         window_started_at = ?,
         last_seen_at = excluded.last_seen_at`,
    ).run(visitorId, now, nowIso, nowIso, windowCalls + 1, freshWindow ? now : visitor.window_started_at);
    db.prepare("INSERT INTO api_usage_events (visitor_id, created_at) VALUES (?, ?)").run(visitorId, nowIso);
    return Number(db.prepare(`INSERT INTO openai_attempts
      (visitor_id, network_id, model, reserved_usd, rates_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(visitorId, network, options?.model ?? "unpriced-legacy-test", reservedUsd, JSON.stringify(rates), nowIso).lastInsertRowid);
  });
  return reserve();
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

export function finishOpenAiCall(id: number, usage?: TokenUsage, errorKind?: string): void {
  const db = getDb();
  const row = db.prepare("SELECT rates_json, status FROM openai_attempts WHERE id = ?").get(id) as { rates_json: string; status: string } | undefined;
  if (!row || row.status !== "pending") return;
  const rates = JSON.parse(row.rates_json) as { input: number; cached: number; write: number; output: number };
  const valid = usage && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0
    && Number.isSafeInteger(usage.prompt_tokens_details?.cached_tokens ?? 0) && (usage.prompt_tokens_details?.cached_tokens ?? 0) >= 0
    && Number.isSafeInteger(usage.prompt_tokens_details?.cache_write_tokens ?? 0) && (usage.prompt_tokens_details?.cache_write_tokens ?? 0) >= 0;
  const cached = valid ? Math.min(usage.prompt_tokens, Math.max(0, usage.prompt_tokens_details?.cached_tokens ?? 0)) : 0;
  const writes = valid ? Math.min(usage.prompt_tokens - cached, Math.max(0, usage.prompt_tokens_details?.cache_write_tokens ?? 0)) : 0;
  const charged = valid ? ((usage.prompt_tokens - cached - writes) * rates.input + cached * rates.cached + writes * rates.write + usage.completion_tokens * rates.output) / 1_000_000 : null;
  // Unknown billing (timeouts, network failures, missing usage) retains its entire reservation.
  db.prepare(`UPDATE openai_attempts SET status = ?, input_tokens = ?, cached_tokens = ?, output_tokens = ?,
    charged_usd = ?, error_kind = ?, finished_at = ? WHERE id = ? AND status = 'pending'`)
    .run(errorKind ? "failed" : valid ? "succeeded" : "unknown", valid ? usage.prompt_tokens : null,
      valid ? cached : null, valid ? usage.completion_tokens : null, charged, errorKind ?? null, new Date().toISOString(), id);
}

export function budgetSnapshot() {
  const db = getDb();
  const row = db.prepare(`SELECT COALESCE(SUM(COALESCE(charged_usd, reserved_usd)), 0) AS committed,
    COALESCE(SUM(charged_usd), 0) AS measured, COALESCE(SUM(CASE WHEN charged_usd IS NULL THEN reserved_usd ELSE 0 END), 0) AS held
    FROM openai_attempts WHERE id > COALESCE((SELECT last_attempt_id FROM spending_reset WHERE id = 1), 0)`)
    .get() as { committed: number; measured: number; held: number };
  const totals = db.prepare(`SELECT COUNT(*) AS attempts, SUM(status = 'succeeded') AS succeeded,
    SUM(status = 'failed') AS failed, SUM(status IN ('pending', 'unknown')) AS unknown,
    COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output FROM openai_attempts`).get() as Record<string, number>;
  return { limitUsd: getConfig().OPENAI_BUDGET_USD, committedUsd: row.committed, measuredUsd: row.measured, heldUsd: row.held,
    remainingUsd: Math.max(0, getConfig().OPENAI_BUDGET_USD - row.committed), totals,
    networkHourlyLimit: getConfig().OPENAI_NETWORK_HOURLY_LIMIT, pricingModel: getConfig().OPENAI_PRICE_MODEL };
}

export interface UsageSnapshot {
  budget: ReturnType<typeof budgetSnapshot>;
  attempts: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  global: { totalCalls: number; limit: number; remaining: number; visitorHourlyLimit: number };
  visitors: Array<{ visitorId: string; totalCalls: number; hourCalls: number; firstSeenAt: string; lastSeenAt: string;
    inputTokens: number; outputTokens: number; costUsd: number; failedAttempts: number }>;
  activity: Array<{ visitorId: string; method: string; path: string; status: number; durationMs: number; createdAt: string }>;
  activityPage: { offset: number; limit: number; total: number };
  activitySummary: { uniqueVisitors: number; successful: number; failed: number; analyzeRequests: number; averageDurationMs: number };
}

export function usageSnapshot(offset = 0, limit = 25): UsageSnapshot {
  const db = getDb();
  const cfg = getConfig();
  if (!Number.isFinite(offset) || !Number.isFinite(limit)) throw new Error("Pagination parameters must be finite numbers");
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const global = db.prepare("SELECT total_calls FROM api_usage_global WHERE id = 1").get() as { total_calls: number } | undefined;
  const now = Date.now();
  const visitors = db
    .prepare("SELECT visitor_id, total_calls, window_calls, window_started_at, first_seen_at, last_seen_at FROM api_usage_visitors ORDER BY last_seen_at DESC")
    .all() as Array<{ visitor_id: string; total_calls: number; window_calls: number; window_started_at: number; first_seen_at: string; last_seen_at: string }>;
  const activity = db
    .prepare("SELECT visitor_id, method, path, status, duration_ms, created_at FROM activity_events ORDER BY id DESC LIMIT ? OFFSET ?")
    .all(safeLimit, safeOffset) as Array<{ visitor_id: string; method: string; path: string; status: number; duration_ms: number; created_at: string }>;
  const activityStats = db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT visitor_id) AS visitors,
        SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN method = 'POST' AND path = '/api/analyze' THEN 1 ELSE 0 END) AS analyses,
        AVG(duration_ms) AS average_duration
       FROM activity_events`,
    )
    .get() as { total: number; visitors: number; successful: number | null; failed: number | null; analyses: number | null; average_duration: number | null };
  return {
    budget: budgetSnapshot(),
    attempts: db.prepare(`SELECT id, visitor_id, model, status, input_tokens, cached_tokens, output_tokens,
      reserved_usd, charged_usd, error_kind, created_at FROM openai_attempts ORDER BY id DESC LIMIT 25`).all() as Array<Record<string, unknown>>,
    audit: db.prepare("SELECT actor, scope, visitor_id, created_at FROM admin_audit ORDER BY id DESC LIMIT 25").all() as Array<Record<string, unknown>>,
    global: {
      totalCalls: global?.total_calls ?? 0,
      limit: cfg.OPENAI_GLOBAL_LIMIT,
      remaining: Math.max(0, cfg.OPENAI_GLOBAL_LIMIT - (global?.total_calls ?? 0)),
      visitorHourlyLimit: cfg.OPENAI_VISITOR_HOURLY_LIMIT,
    },
    visitors: visitors.map((visitor) => ({
      visitorId: visitor.visitor_id,
      totalCalls: visitor.total_calls,
      hourCalls: (db.prepare(`SELECT COUNT(*) AS n FROM api_usage_events WHERE visitor_id = ? AND created_at > ?
        AND id > COALESCE((SELECT last_event_id FROM usage_reset_marks WHERE visitor_id = ?), 0)`)
        .get(visitor.visitor_id, new Date(now - HOUR_MS).toISOString(), visitor.visitor_id) as { n: number }).n,
      firstSeenAt: visitor.first_seen_at,
      lastSeenAt: visitor.last_seen_at,
      ...(db.prepare(`SELECT COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(COALESCE(charged_usd, reserved_usd)), 0) AS costUsd,
        COALESCE(SUM(status = 'failed'), 0) AS failedAttempts FROM openai_attempts WHERE visitor_id = ?`)
        .get(visitor.visitor_id) as { inputTokens: number; outputTokens: number; costUsd: number; failedAttempts: number }),
    })),
    activity: activity.map((event) => ({ visitorId: event.visitor_id, method: event.method, path: event.path, status: event.status, durationMs: event.duration_ms, createdAt: event.created_at })),
    activityPage: { offset: safeOffset, limit: safeLimit, total: activityStats.total },
    activitySummary: {
      uniqueVisitors: activityStats.visitors,
      successful: activityStats.successful ?? 0,
      failed: activityStats.failed ?? 0,
      analyzeRequests: activityStats.analyses ?? 0,
      averageDurationMs: Math.round(activityStats.average_duration ?? 0),
    },
  };
}

export function resetUsage(scope: "global" | "visitor" | "budget", visitorId?: string): void {
  const db = getDb();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const mark = (id: string) => db.prepare(`INSERT INTO usage_reset_marks (visitor_id, last_event_id)
    VALUES (?, COALESCE((SELECT MAX(id) FROM api_usage_events), 0))
    ON CONFLICT(visitor_id) DO UPDATE SET last_event_id = excluded.last_event_id`).run(id);
  const audit = () => db.prepare("INSERT INTO admin_audit (actor, scope, visitor_id, created_at) VALUES (?, ?, ?, ?)")
    .run(getConfig().ADMIN_USERNAME || "maintenance", scope, visitorId ?? null, nowIso);
  if (scope === "budget") {
    db.transaction(() => {
      // Do not let reset forgive requests still in flight or requests with unknown billing.
      const pending = db.prepare("SELECT COUNT(*) AS n FROM openai_attempts WHERE status = 'pending'").get() as { n: number };
      if (pending.n) throw new Error("Wait for in-flight OpenAI attempts to finish before resetting spending.");
      db.prepare(`INSERT INTO spending_reset (id, last_attempt_id, reset_at) VALUES (1, COALESCE((SELECT MAX(id) FROM openai_attempts), 0), ?)
        ON CONFLICT(id) DO UPDATE SET last_attempt_id = excluded.last_attempt_id, reset_at = excluded.reset_at`).run(nowIso);
      audit();
    })();
    return;
  }
  if (scope === "visitor") {
    if (!visitorId) throw new Error("visitorId is required");
    db.transaction(() => {
      mark(visitorId);
      db.prepare("UPDATE api_usage_visitors SET total_calls = 0, window_calls = 0, window_started_at = ? WHERE visitor_id = ?").run(now, visitorId);
      audit();
    })();
    return;
  }
  const reset = db.transaction(() => {
    db.prepare("INSERT INTO api_usage_global (id, total_calls, updated_at) VALUES (1, 0, ?) ON CONFLICT(id) DO UPDATE SET total_calls = 0, updated_at = excluded.updated_at").run(nowIso);
    const ids = db.prepare("SELECT visitor_id FROM api_usage_visitors").all() as { visitor_id: string }[];
    ids.forEach((row) => mark(row.visitor_id));
    db.prepare("UPDATE api_usage_visitors SET total_calls = 0, window_calls = 0, window_started_at = ?").run(now);
    audit();
  });
  reset();
}
