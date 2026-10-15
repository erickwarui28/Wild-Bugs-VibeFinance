import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getDb } from "./db/db.js";
import { getConfig } from "./config.js";
import { budgetSnapshot } from "./usage.js";

const Kind = z.enum(["activity", "attempts", "visitors"]);
type Kind = z.infer<typeof Kind>;
const querySchema = z.object({
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional().default("25"),
  cursor: z.string().max(2048).optional(),
  from: z.string().datetime().transform(value => new Date(value).toISOString()).optional(),
  to: z.string().datetime().transform(value => new Date(value).toISOString()).optional(),
  visitor: z.string().trim().min(1).max(128).optional(),
  endpoint: z.string().trim().startsWith("/api/").max(200).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  status: z.string().max(20).optional(),
}).strict();
type Query = z.infer<typeof querySchema>;
type Row = Record<string, string | number | null>;
class QueryError extends Error {}
const key = randomBytes(32); // Cursors expire on restart, never grant access or contain credentials.
const cursorSchema = z.object({ v: z.literal(1), kind: Kind, anchor: z.number().int().nonnegative().safe(),
  before: z.number().int().positive().safe(), expires: z.number().int(), digest: z.string(), capturedAt: z.string() }).strict();
type Cursor = z.infer<typeof cursorSchema>;
const tables: Record<Kind, string> = { activity: "activity_events", attempts: "openai_attempts", visitors: "api_usage_visitors" };
const summaries = new Map<string, { at: number; value: Row }>();
export function clearAdminSummaryCache(): void { summaries.clear(); }

function parse(kind: Kind, raw: unknown): Query {
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) throw new QueryError("Invalid filters or pagination parameters");
  const q = parsed.data;
  if (q.from && q.to && q.from >= q.to) throw new QueryError("From must precede the exclusive Until time");
  if (kind !== "activity" && (q.method || q.endpoint)) throw new QueryError("Method and endpoint apply only to API activity");
  if (q.status && (kind === "visitors" || (kind === "activity" ? !/^(?:[1-5]\d\d|[1-5]xx)$/.test(q.status) : !["pending", "succeeded", "failed", "unknown"].includes(q.status)))) {
    throw new QueryError("Invalid status for this table");
  }
  return q;
}
function digest(kind: Kind, q: Query): string {
  const { cursor: _cursor, ...filters } = q;
  return createHash("sha256").update(JSON.stringify({ kind, ...filters })).digest("hex");
}
function encode(cursor: Cursor): string {
  const body = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}
function decode(token: string, kind: Kind, q: Query): Cursor {
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) throw new Error();
    const expected = createHmac("sha256", key).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (cursor.kind !== kind || cursor.digest !== digest(kind, q) || cursor.expires < Date.now() || cursor.before > cursor.anchor + 1) throw new Error();
    return cursor;
  } catch { throw new QueryError("Invalid or expired cursor. Refresh this table to start again."); }
}
function where(kind: Kind, q: Query, anchor: number) {
  const id = kind === "visitors" ? "v.rowid" : "id";
  const date = kind === "visitors" ? "first_seen_at" : "created_at";
  const conditions = [`${id} <= ?`]; const values: Array<string | number> = [anchor];
  for (const [value, sql] of [[q.from, `${date} >= ?`], [q.to, `${date} < ?`], [q.visitor, "visitor_id = ?"]] as const) {
    if (value) { conditions.push(sql); values.push(value); }
  }
  if (q.endpoint) { conditions.push("path LIKE ? ESCAPE '\\'"); values.push(q.endpoint.replace(/[\\%_]/g, "\\$&") + "%"); }
  if (q.method) { conditions.push("method = ?"); values.push(q.method); }
  if (q.status) {
    if (kind === "activity" && q.status.endsWith("xx")) {
      conditions.push("status >= ? AND status < ?"); values.push(Number(q.status[0]) * 100, (Number(q.status[0]) + 1) * 100);
    } else { conditions.push("status = ?"); values.push(kind === "activity" ? Number(q.status) : q.status); }
  }
  return { sql: conditions.join(" AND "), values, id };
}
function rows(kind: Kind, q: Query, cursor: Cursor, limit: number): Row[] {
  const db = getDb(), w = where(kind, q, cursor.anchor);
  const projection = kind === "activity" ? "id, visitor_id AS visitorId, method, path, status, duration_ms AS durationMs, created_at AS createdAt"
    : kind === "attempts" ? `id, visitor_id AS visitorId, model, status, input_tokens AS inputTokens, cached_tokens AS cachedTokens,
      output_tokens AS outputTokens, reserved_usd AS reservedUsd, charged_usd AS chargedUsd, error_kind AS errorKind, created_at AS createdAt, finished_at AS finishedAt`
      : `v.rowid AS id, visitor_id AS visitorId, total_calls AS totalCalls, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt,
        (SELECT COUNT(*) FROM api_usage_events e WHERE e.visitor_id=v.visitor_id AND e.created_at > ?
          AND e.id > COALESCE((SELECT last_event_id FROM usage_reset_marks WHERE visitor_id=v.visitor_id),0)) AS hourCalls,
        (SELECT COALESCE(SUM(input_tokens),0) FROM openai_attempts a WHERE a.visitor_id=v.visitor_id) AS inputTokens,
        (SELECT COALESCE(SUM(output_tokens),0) FROM openai_attempts a WHERE a.visitor_id=v.visitor_id) AS outputTokens,
        (SELECT COALESCE(SUM(COALESCE(charged_usd,reserved_usd)),0) FROM openai_attempts a WHERE a.visitor_id=v.visitor_id) AS costUsd,
        (SELECT COUNT(*) FROM openai_attempts a WHERE a.visitor_id=v.visitor_id AND a.status='failed') AS failedAttempts`;
  const prefix = kind === "visitors" ? [new Date(Date.now() - 3600000).toISOString()] : [];
  return db.prepare(`SELECT ${projection} FROM ${tables[kind]}${kind === "visitors" ? " v" : ""}
    WHERE ${w.sql} AND ${w.id} < ? ORDER BY ${w.id} DESC LIMIT ?`).all(...prefix, ...w.values, cursor.before, limit) as Row[];
}
function summary(kind: Kind, q: Query, anchor: number): { values: Row; asOf: string } {
  const cacheKey = `${digest(kind, q)}:${anchor}`, cached = summaries.get(cacheKey);
  if (cached && Date.now() - cached.at < 15000) return { values: cached.value, asOf: new Date(cached.at).toISOString() };
  const w = where(kind, q, anchor);
  const projection = kind === "activity" ? `COUNT(*) AS total, COUNT(DISTINCT visitor_id) AS uniqueVisitors,
    COALESCE(SUM(status<400),0) AS successful, COALESCE(SUM(status>=400),0) AS failed, COALESCE(ROUND(AVG(duration_ms)),0) AS averageDurationMs`
    : kind === "attempts" ? `COUNT(*) AS total, COALESCE(SUM(status='succeeded'),0) AS succeeded,
      COALESCE(SUM(status='failed'),0) AS failed, COALESCE(SUM(status IN ('pending','unknown')),0) AS unsettled,
      COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens,
      COALESCE(SUM(COALESCE(charged_usd,reserved_usd)),0) AS costUsd` : "COUNT(*) AS total, COALESCE(SUM(total_calls),0) AS callsSinceReset";
  const value = getDb().prepare(`SELECT ${projection} FROM ${tables[kind]}${kind === "visitors" ? " v" : ""} WHERE ${w.sql}`).get(...w.values) as Row;
  const at = Date.now();
  summaries.delete(cacheKey); summaries.set(cacheKey, { at, value });
  if (summaries.size > 64) summaries.delete(summaries.keys().next().value!);
  return { values: value, asOf: new Date(at).toISOString() };
}
function context(kind: Kind, raw: unknown) {
  const q = parse(kind, raw);
  const cursor = q.cursor ? decode(q.cursor, kind, q) : (() => {
    const anchor = (getDb().prepare(`SELECT COALESCE(MAX(${kind === "visitors" ? "rowid" : "id"}),0) AS n FROM ${tables[kind]}`).get() as { n: number }).n;
    return { v: 1 as const, kind, anchor, before: anchor + 1, expires: Date.now() + 1800000, digest: digest(kind, q), capturedAt: new Date().toISOString() };
  })();
  return { q, cursor };
}
export function recordPage(kind: Kind, raw: unknown) {
  const { q, cursor } = context(kind, raw);
  const result = rows(kind, q, cursor, q.limit + 1);
  const hasMore = result.length > q.limit;
  const records = result.slice(0, q.limit);
  const totals = summary(kind, q, cursor.anchor);
  return { records, summary: totals.values, summaryAsOf: totals.asOf, capturedAt: cursor.capturedAt, anchor: cursor.anchor,
    snapshotCursor: encode({ ...cursor, before: cursor.anchor + 1 }),
    nextCursor: hasMore ? encode({ ...cursor, before: Number(records.at(-1)!.id) }) : null,
    limit: q.limit };
}
export function csvCell(value: string | number | null): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const columns: Record<Kind, string[]> = {
  activity: ["id", "createdAt", "visitorId", "method", "path", "status", "durationMs"],
  attempts: ["id", "createdAt", "visitorId", "model", "status", "inputTokens", "cachedTokens", "outputTokens", "reservedUsd", "chargedUsd", "errorKind", "finishedAt"],
  visitors: ["id", "visitorId", "firstSeenAt", "lastSeenAt", "totalCalls", "hourCalls", "inputTokens", "outputTokens", "costUsd", "failedAttempts"],
};
export function recordCsv(kind: Kind, raw: unknown): string {
  const { q, cursor } = context(kind, raw);
  // Export the whole filtered snapshot, not merely the current page; never silently truncate.
  const result = rows(kind, q, { ...cursor, before: cursor.anchor + 1 }, 10001);
  if (result.length > 10000) throw new QueryError("Export exceeds 10,000 rows. Narrow the filters and try again.");
  return '\uFEFF' + [columns[kind], ...result.map(row => columns[kind].map(column => row[column] ?? null))].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function adminRecords(req: Request, res: Response): void {
  const kind = Kind.safeParse(req.params.kind);
  if (!kind.success) { res.status(404).json({ error: "Unknown admin table" }); return; }
  try {
    if (req.path.startsWith("/api/admin/export/")) {
      const csv = recordCsv(kind.data, req.query);
      res.setHeader("Content-Disposition", `attachment; filename="vibefinance-${kind.data}.csv"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("text/csv; charset=utf-8").send(csv);
    } else res.json(recordPage(kind.data, req.query));
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    res.status(400).json({ error: error.message });
  }
}
export function adminOverview(_req: Request, res: Response): void {
  const cfg = getConfig(), db = getDb();
  const total = (db.prepare("SELECT total_calls FROM api_usage_global WHERE id=1").get() as { total_calls: number } | undefined)?.total_calls ?? 0;
  res.json({ budget: budgetSnapshot(), global: { totalCalls: total, limit: cfg.OPENAI_GLOBAL_LIMIT,
    remaining: Math.max(0, cfg.OPENAI_GLOBAL_LIMIT-total), visitorHourlyLimit: cfg.OPENAI_VISITOR_HOURLY_LIMIT },
    watermarks: Object.fromEntries(Object.entries(tables).map(([kind, table]) => [kind,
      (db.prepare(`SELECT COALESCE(MAX(${kind === "visitors" ? "rowid" : "id"}),0) AS n FROM ${table}`).get() as { n: number }).n])),
    audit: db.prepare("SELECT actor, scope, visitor_id, created_at FROM admin_audit ORDER BY id DESC LIMIT 25").all() });
}
