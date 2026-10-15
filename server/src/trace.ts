import type { TraceStep } from "@vibefinance/shared";
import { getDb } from "./db/db.js";

export function saveTrace(runId: string, steps: TraceStep[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO trace_steps (run_id, seq, name, started_at, ended_at, latency_ms, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, seq) DO UPDATE SET name = excluded.name, started_at = excluded.started_at, ended_at = excluded.ended_at, latency_ms = excluded.latency_ms, payload_json = excluded.payload_json`,
  );
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM trace_steps WHERE run_id = ?`).run(runId);
    steps.forEach((step, seq) => stmt.run(runId, seq, step.name, step.startedAt, step.endedAt, step.latencyMs, JSON.stringify(step.payload)));
  });
  tx();
}

export function readTrace(runId: string): TraceStep[] {
  const rows = getDb()
    .prepare(`SELECT name, started_at, ended_at, latency_ms, payload_json FROM trace_steps WHERE run_id = ? ORDER BY seq`)
    .all(runId) as Array<{ name: string; started_at: string; ended_at: string; latency_ms: number; payload_json: string }>;
  return rows.map((row) => ({
    name: row.name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    latencyMs: row.latency_ms,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  }));
}

export function step(name: string, startedMs: number, endedMs: number, payload: Record<string, unknown>): TraceStep {
  return {
    name,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    latencyMs: Math.max(0, endedMs - startedMs),
    payload,
  };
}
