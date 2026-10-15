import type { DocHit, Provenance } from "@vibefinance/shared";
import { getDb } from "../db/db.js";
import type { DocRow } from "../data/providers/types.js";
import { chunkText } from "./chunk.js";
import { validDay } from "../evidenceCoverage.js";
import { cosine, embedLocal, parseVec } from "./embed.js";
import { keywordBoost } from "./lexicon.js";

export interface StoredChunk {
  id: string;
  docId: string;
  ticker: string;
  text: string;
  vec: number[];
  title: string;
  date: string;
  provenance: Provenance;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

const QUERY = "earnings guidance margin revenue outlook growth pledge risk beat miss";

export function retrieve(ticker: string, asOf: string, k = 4, minScore = 0.15): DocHit[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.doc_id, c.ticker, c.text, c.vec, d.title, d.date, d.provenance, d.source_url, d.fetched_at, d.type
       FROM chunks c JOIN docs d ON d.id = c.doc_id
       WHERE c.ticker = ? AND d.date <= ?`,
    )
    .all(ticker, asOf) as Array<{
    id: string;
    doc_id: string;
    ticker: string;
    text: string;
    vec: string;
    title: string;
    date: string;
    provenance: Provenance;
    source_url: string | null;
    fetched_at: string | null;
    type: string;
  }>;
  const q = embedLocal(`${QUERY} ${ticker}`);
  const ranked = rows
    .map((row) => {
      const vec = parseVec(row.vec);
      const score = cosine(q, vec) + keywordBoost(row.text) + (/guidance cut/i.test(row.text) ? 0.45 : 0);
      return { row, score };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return ranked.map(({ row, score }) => ({
    docId: row.doc_id,
    chunkId: row.id,
    title: row.title,
    date: row.date,
    snippet: row.text.slice(0, 240),
    score: Math.round(score * 1000) / 1000,
    provenance: row.provenance,
    sourceUrl: row.source_url,
    fetchedAt: row.fetched_at,
  }));
}

export function hitsFromDocs(docs: DocRow[], ticker: string, k = 4): { hits: DocHit[]; texts: Map<string, string> } {
  const q = embedLocal(`${QUERY} ${ticker}`);
  const texts = new Map<string, string>();
  const ranked: DocHit[] = [];
  for (const doc of docs) {
    if (doc.synthetic || doc.provenance === "SYNTHETIC" || !validDay(doc.date)) continue;
    const pieces = chunkText(doc.id, doc.ticker, doc.body);
    const chunks = pieces.length > 0 ? pieces : [{ id: `${doc.id}#c0`, docId: doc.id, ticker: doc.ticker, text: doc.body }];
    for (const chunk of chunks) {
      texts.set(chunk.id, chunk.text);
      const score = cosine(q, embedLocal(chunk.text)) + keywordBoost(chunk.text);
      ranked.push({
        docId: doc.id,
        chunkId: chunk.id,
        title: doc.title,
        date: doc.date,
        snippet: chunk.text.slice(0, 240),
        score: Math.round(score * 1000) / 1000,
        provenance: doc.provenance,
        sourceUrl: doc.sourceUrl,
        fetchedAt: doc.fetchedAt,
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return { hits: ranked.slice(0, k), texts };
}

export function chunkTextById(ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const db = getDb();
  const unique = [...new Set(ids)];
  const stmt = db.prepare(`SELECT id, text FROM chunks WHERE id = ?`);
  for (const id of unique) {
    const row = stmt.get(id) as { id: string; text: string } | undefined;
    if (row) map.set(row.id, row.text);
  }
  return map;
}

export function getDoc(docId: string): {
  id: string;
  ticker: string;
  type: string;
  date: string;
  title: string;
  body: string;
  synthetic: boolean;
  provenance: string;
  sourceUrl: string | null;
  chunks: { id: string; text: string }[];
} | null {
  const db = getDb();
  const doc = db.prepare(`SELECT * FROM docs WHERE id = ?`).get(docId) as
    | {
        id: string;
        ticker: string;
        type: string;
        date: string;
        title: string;
        body: string;
        synthetic: number;
        provenance: string;
        source_url: string | null;
      }
    | undefined;
  if (!doc) return null;
  const chunks = db.prepare(`SELECT id, text FROM chunks WHERE doc_id = ? ORDER BY id`).all(docId) as { id: string; text: string }[];
  return {
    id: doc.id,
    ticker: doc.ticker,
    type: doc.type,
    date: doc.date,
    title: doc.title,
    body: doc.body,
    synthetic: doc.synthetic === 1,
    provenance: doc.provenance,
    sourceUrl: doc.source_url,
    chunks,
  };
}
