import { getDb } from "../db/db.js";
import { cosine, embedLocal, parseVec } from "./embed.js";
import { keywordBoost } from "./lexicon.js";

export interface SearchHit {
  docId: string;
  chunkId: string;
  ticker: string;
  title: string;
  snippet: string;
  score: number;
  provenance: string;
  date?: string;
}

let vecMode: "sqlite-vec" | "brute" = "brute";

export function vectorMode(): "sqlite-vec" | "brute" {
  return vecMode;
}

export function setVectorMode(mode: "sqlite-vec" | "brute"): void {
  vecMode = mode;
}

export function searchChunks(query: string, ticker: string | null, k = 5): SearchHit[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.doc_id, c.ticker, c.text, c.vec, d.title, d.provenance, d.date
       FROM chunks c JOIN docs d ON d.id = c.doc_id
       ${ticker ? "WHERE c.ticker = ?" : ""}`,
    )
    .all(...(ticker ? [ticker] : [])) as Array<{
    id: string;
    doc_id: string;
    ticker: string;
    text: string;
    vec: string;
    title: string;
    provenance: string;
    date: string;
  }>;
  const q = embedLocal(query);
  return rows
    .map((row) => ({
      docId: row.doc_id,
      chunkId: row.id,
      ticker: row.ticker,
      title: row.title,
      snippet: row.text.slice(0, 240),
      score: Math.round((cosine(q, parseVec(row.vec)) + keywordBoost(row.text)) * 1000) / 1000,
      provenance: row.provenance,
      date: row.date,
    }))
    .sort((a, b) => query.trim() ? b.score - a.score : b.date.localeCompare(a.date))
    .slice(0, k);
}

export async function tryLoadSqliteVec(): Promise<"sqlite-vec" | "brute"> {
  if (process.env.SQLITE_VEC === "0") {
    vecMode = "brute";
    return vecMode;
  }
  try {
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<{ load: (db: unknown) => void }>;
    const sqliteVec = await dynamicImport("sqlite-vec");
    sqliteVec.load(getDb());
    getDb().exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[512])`);
    vecMode = "sqlite-vec";
  } catch {
    vecMode = "brute";
  }
  return vecMode;
}
