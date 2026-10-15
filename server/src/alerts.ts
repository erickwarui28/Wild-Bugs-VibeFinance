import type { Synthesis } from "@vibefinance/shared";
import { featureOn } from "./config.js";
import { getDb } from "./db/db.js";
import { hashString } from "./math.js";

export function raiseAlerts(sessionId: string, synthesis: Synthesis): void {
  if (!featureOn("x3")) return;
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO alerts (id, session_id, ticker, kind, message, citations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET message = excluded.message, citations_json = excluded.citations_json, created_at = excluded.created_at`,
  );
  if (synthesis.personalised.concentrationAlert?.alert) {
    const id = `al_${Math.abs(hashString(`${sessionId}|${synthesis.ticker}|concentration`)).toString(16)}`;
    insert.run(
      id,
      sessionId,
      synthesis.ticker,
      "concentration",
      `Concentration alert for ${synthesis.ticker}: sector weight ${(synthesis.personalised.concentrationAlert.sectorPct * 100).toFixed(0)}%.`,
      JSON.stringify(synthesis.personalised.rationale[0]?.citations ?? []),
      now,
    );
  }
  const z = synthesis.agents.find((a) => a.agent === "volume")?.features.volumeZ ?? 0;
  if (Math.abs(z) > 2.5) {
    const id = `al_${Math.abs(hashString(`${sessionId}|${synthesis.ticker}|volume`)).toString(16)}`;
    const cite = synthesis.agents.find((a) => a.agent === "volume")?.claims[0]?.citations ?? [];
    insert.run(id, sessionId, synthesis.ticker, "volume-anomaly", `Volume anomaly on ${synthesis.ticker} (z ${z.toFixed(2)}).`, JSON.stringify(cite), now);
  }
}

export function listAlerts(sessionId: string) {
  if (!featureOn("x3")) return [];
  const rows = getDb().prepare(`SELECT * FROM alerts WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId) as Array<{
    id: string;
    session_id: string;
    ticker: string;
    kind: string;
    message: string;
    citations_json: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    ticker: row.ticker,
    kind: row.kind,
    message: row.message,
    citations: JSON.parse(row.citations_json) as unknown[],
    createdAt: row.created_at,
  }));
}
