import type { Synthesis } from "@vibefinance/shared";
import { getDb } from "./db/db.js";
import { forwardReturn } from "./data/providers/synthetic.js";
import { hhi } from "./math.js";
import { quantile } from "./math.js";
import { readTrace } from "./trace.js";

export interface SessionMetrics {
  accuracy: { hitRate: number; n: number; spread: number };
  latency: { p50: number; p95: number; max: number };
  hhi: { before: number; after: number; effectiveHoldings: number };
  brier: number;
  coverage: number;
  uncitedDropped: number;
  disclaimer: string;
}

export function recordRun(sessionId: string, synthesis: Synthesis, uncitedDropped: number): void {
  const db = getDb();
  db.prepare(`INSERT INTO sessions (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`).run(sessionId, new Date().toISOString());
  db.prepare(
    `INSERT INTO runs (run_id, profile_id, ticker, as_of, session_id, synthesis_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, profile_id) DO UPDATE SET synthesis_json = excluded.synthesis_json, session_id = excluded.session_id, created_at = excluded.created_at`,
  ).run(
    synthesis.runId,
    synthesis.profileId,
    synthesis.ticker,
    synthesis.asOf,
    sessionId,
    JSON.stringify({ ...synthesis, uncitedDropped }),
    new Date().toISOString(),
  );
}

export function sessionMetrics(sessionId: string): SessionMetrics {
  const db = getDb();
  const rows = db.prepare(`SELECT synthesis_json FROM runs WHERE session_id = ?`).all(sessionId) as { synthesis_json: string }[];
  const syntheses = rows.map((r) => JSON.parse(r.synthesis_json) as Synthesis & { uncitedDropped?: number });
  const hits: number[] = [];
  const bull: number[] = [];
  const bear: number[] = [];
  const latencies: number[] = [];
  const brierTerms: number[] = [];
  let dropped = 0;
  let coverage = 0;
  for (const s of syntheses) {
    dropped += s.uncitedDropped ?? 0;
    const active = s.agents.filter((a) => a.label !== "insufficient_evidence").length;
    coverage += active / 4;
    const trace = readTrace(s.runId);
    const endToEnd = trace.length ? Math.max(...trace.map((t) => Date.parse(t.endedAt))) - Math.min(...trace.map((t) => Date.parse(t.startedAt))) : s.agents.reduce((m, a) => Math.max(m, a.latencyMs), 0);
    latencies.push(endToEnd);
    if (s.dataMode !== "synthetic") continue;
    const fwd = forwardReturn(s.ticker, s.asOf);
    if (fwd == null || s.compositeLabel === "neutral" || s.compositeLabel === "insufficient_evidence") continue;
    const hit = Math.sign(s.compositeScore) === Math.sign(fwd) ? 1 : 0;
    hits.push(hit);
    if (s.compositeScore > 0) bull.push(fwd);
    if (s.compositeScore < 0) bear.push(fwd);
    const p = 0.5 + 0.5 * s.confidence * Math.sign(s.compositeScore);
    brierTerms.push((p - (fwd > 0 ? 1 : 0)) ** 2);
  }
  const last = syntheses[syntheses.length - 1];
  const hhiBefore = last?.personalised.concentrationAlert?.hhiBefore ?? 0;
  const hhiAfter = last?.personalised.concentrationAlert?.hhiAfter ?? hhi(last ? [] : []);
  const sorted = [...latencies].sort((a, b) => a - b);
  const hitRate = hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : 0;
  const spread = (bull.length ? bull.reduce((a, b) => a + b, 0) / bull.length : 0) - (bear.length ? bear.reduce((a, b) => a + b, 0) / bear.length : 0);
  return {
    accuracy: { hitRate, n: hits.length, spread },
    latency: {
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      max: sorted[sorted.length - 1] ?? 0,
    },
    hhi: {
      before: hhiBefore,
      after: hhiAfter,
      effectiveHoldings: hhiAfter > 0 ? 1 / hhiAfter : 0,
    },
    brier: brierTerms.length ? brierTerms.reduce((a, b) => a + b, 0) / brierTerms.length : 0,
    coverage: syntheses.length ? coverage / syntheses.length : 0,
    uncitedDropped: dropped,
    disclaimer: "Not financial advice. Demonstration only.",
  };
}

export interface CalBin {
  lo: number;
  hi: number;
  observed: number;
  predicted: number;
}

export function readCalibration(): { bins: CalBin[] } | null {
  const rows = getDb().prepare(`SELECT bin, predicted, observed, lo, hi FROM calibration ORDER BY bin`).all() as Array<{
    bin: number;
    predicted: number;
    observed: number;
    lo: number;
    hi: number;
  }>;
  if (rows.length === 0) return null;
  return {
    bins: rows.map((r) => ({
      lo: r.lo,
      hi: r.hi,
      observed: r.observed,
      predicted: r.predicted,
    })),
  };
}

export function saveCalibration(bins: { predicted: number; observed: number; lo: number; hi: number }[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO calibration (bin, predicted, observed, lo, hi) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(bin) DO UPDATE SET predicted = excluded.predicted, observed = excluded.observed, lo = excluded.lo, hi = excluded.hi`,
  );
  const tx = db.transaction(() => {
    db.exec(`DELETE FROM calibration`);
    bins.forEach((b, i) => stmt.run(i, b.predicted, b.observed, b.lo, b.hi));
  });
  tx();
}
