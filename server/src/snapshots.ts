import { createHash } from "node:crypto";
import type { DocHit } from "@vibefinance/shared";
import { getDb } from "./db/db.js";
import type { LoadedMarket } from "./data/providers/index.js";
import { chunkText } from "./rag/chunk.js";

export interface AnalysisSnapshot {
  version: 1;
  id: string;
  capturedAt: string;
  ticker: string;
  asOf: string;
  market: LoadedMarket;
  hits: DocHit[];
  indexReturns: number[];
}

export function saveSnapshot(snapshot: AnalysisSnapshot, owner: string): void {
  const payload = JSON.stringify(snapshot);
  getDb().prepare(`INSERT INTO analysis_snapshots (id, version, owner_id, captured_at, content_hash, payload_json)
    VALUES (?, 1, ?, ?, ?, ?)`).run(snapshot.id, owner, snapshot.capturedAt, createHash("sha256").update(payload).digest("hex"), payload);
}

export function readSnapshot(id: string, owner: string): AnalysisSnapshot | null {
  const row = getDb().prepare("SELECT payload_json FROM analysis_snapshots WHERE id = ? AND owner_id = ?")
    .get(id, owner) as { payload_json: string } | undefined;
  return row ? JSON.parse(row.payload_json) as AnalysisSnapshot : null;
}

export function snapshotDoc(snapshot: AnalysisSnapshot, id: string) {
  const doc = snapshot.market.docs.find((entry) => entry.id === id);
  if (!doc) return null;
  const chunks = chunkText(doc.id, doc.ticker, doc.body).map(({ id: chunkId, text }) => ({ id: chunkId, text }));
  return { ...doc, chunks: chunks.length ? chunks : [{ id: `${doc.id}#c0`, text: doc.body }], snapshotId: snapshot.id };
}
