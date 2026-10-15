import type { Synthesis } from "@vibefinance/shared";
import { featureOn } from "./config.js";
import { getDb } from "./db/db.js";

export function behaviourCount(sessionId: string, profileId: string, kind: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM behaviour_events WHERE session_id = ? AND profile_id = ? AND kind = ?`)
    .get(sessionId, profileId, kind) as { n: number };
  return row.n;
}

export function persistSession(sessionId: string, synthesis: Synthesis): void {
  if (!featureOn("x6")) return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sessions (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`).run(sessionId, now);
  db.prepare(
    `INSERT INTO decisions (session_id, profile_id, ticker, as_of, action, size_pct, composite, confidence, data_mode, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    synthesis.profileId,
    synthesis.ticker,
    synthesis.asOf,
    synthesis.personalised.action,
    synthesis.personalised.positionSizePct,
    synthesis.compositeScore,
    synthesis.confidence,
    synthesis.dataMode,
    synthesis.runId,
    now,
  );
  const weights = synthesis.personalised.concentrationAlert
    ? { hhi: synthesis.personalised.concentrationAlert.hhiAfter }
    : {};
  db.prepare(
    `INSERT INTO portfolio_snapshots (session_id, profile_id, run_id, weights_json, hhi, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    synthesis.profileId,
    synthesis.runId,
    JSON.stringify(weights),
    synthesis.personalised.concentrationAlert?.hhiAfter ?? 0,
    now,
  );
  const volumeZ = synthesis.agents.find((a) => a.agent === "volume")?.features.volumeZ ?? 0;
  if (Math.abs(volumeZ) > 2 && (synthesis.personalised.action === "buy" || synthesis.personalised.action === "accumulate")) {
    db.prepare(`INSERT INTO behaviour_events (session_id, profile_id, kind, ticker, created_at) VALUES (?, ?, 'spike-chase', ?, ?)`).run(
      sessionId,
      synthesis.profileId,
      synthesis.ticker,
      now,
    );
  }
  db.prepare(`INSERT INTO behaviour_events (session_id, profile_id, kind, ticker, created_at) VALUES (?, ?, 'run', ?, ?)`).run(
    sessionId,
    synthesis.profileId,
    synthesis.ticker,
    now,
  );
}

export function sessionHistory(sessionId: string) {
  const db = getDb();
  const decisions = db
    .prepare(`SELECT * FROM decisions WHERE session_id = ? ORDER BY id`)
    .all(sessionId) as Array<Record<string, unknown>>;
  return decisions;
}
