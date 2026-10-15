import { SECTOR_BY_TICKER, type Profile } from "@vibefinance/shared";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../config.js";
import { buildMarket } from "../data/generator.js";
import { generateDocs } from "../data/filings.js";
import { chunkText } from "../rag/chunk.js";
import { embedLocal } from "../rag/embed.js";
import { migrate } from "./migrations.js";
import { upgradeSeedBars } from "./fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;
let seeding = false;

export function getDb(): Database.Database {
  if (db) return db;
  const cfg = getConfig();
  const dbPath = cfg.DB_PATH === ":memory:" ? ":memory:" : path.resolve(cfg.DB_PATH);
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  const schema = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
  try {
    migrate(instance, [
      { version: 1, name: "existing-schema-baseline", sql: schema },
      { version: 2, name: "owned-history-and-audit-indexes", sql: `
        CREATE INDEX IF NOT EXISTS idx_decisions_owner_id ON decisions(session_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_visitor_id ON admin_audit(visitor_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_created_id ON admin_audit(created_at, id DESC);
      ` },
    ]);
  } catch (error) {
    instance.close();
    throw error;
  }
  db = instance;
  const existing = instance.prepare(`SELECT COUNT(*) AS n FROM bars`).get() as { n: number };
  if (existing.n === 0 && !seeding) {
    seeding = true;
    try {
      seedDatabase();
    } finally {
      seeding = false;
    }
  }
  upgradeSeedBars(instance, cfg.SEED);
  return instance;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export const PROFILES: Profile[] = [
  {
    id: "conservative",
    name: "Asha",
    age: 58,
    riskTolerance: "conservative",
    maxVol: 0.22,
    holdings: [
      { ticker: "HDFCBANK", weight: 0.22 },
      { ticker: "ICICIBANK", weight: 0.2 },
      { ticker: "SBIN", weight: 0.18 },
      { ticker: "RELIANCE", weight: 0.1 },
      { ticker: "INFY", weight: 0.08 },
      { ticker: "ITC", weight: 0.08 },
      { ticker: "TCS", weight: 0.08 },
      { ticker: "LT", weight: 0.06 },
    ],
    behaviour: ["loss-averse", "panic-sells"],
  },
  {
    id: "moderate",
    name: "Rohan",
    age: 34,
    riskTolerance: "moderate",
    maxVol: 0.35,
    holdings: [
      { ticker: "RELIANCE", weight: 0.18 },
      { ticker: "TCS", weight: 0.16 },
      { ticker: "INFY", weight: 0.16 },
      { ticker: "HDFCBANK", weight: 0.18 },
      { ticker: "ITC", weight: 0.16 },
      { ticker: "LT", weight: 0.16 },
    ],
    behaviour: ["recency-bias"],
  },
  {
    id: "aggressive",
    name: "Meera",
    age: 26,
    riskTolerance: "aggressive",
    maxVol: 0.55,
    holdings: [
      { ticker: "INFY", weight: 0.45 },
      { ticker: "TCS", weight: 0.15 },
      { ticker: "RELIANCE", weight: 0.1 },
      { ticker: "HDFCBANK", weight: 0.1 },
      { ticker: "BHARTIARTL", weight: 0.1 },
      { ticker: "LT", weight: 0.1 },
    ],
    behaviour: ["overtrades", "chases-spikes"],
  },
];

export interface SeedCounts {
  tickers: number;
  bars: number;
  sectors: number;
  flowRows: number;
  docs: number;
  chunks: number;
  profiles: number;
}

export function seedDatabase(seed = getConfig().SEED): SeedCounts {
  const database = getDb();
  const market = buildMarket(seed);
  const docs = generateDocs(seed, market.dates, market.asOf);
  const insertBar = database.prepare(
    `INSERT INTO bars (ticker, date, open, high, low, close, volume, regime, spike, fwd_ret_30, provenance, origin)
     VALUES (@ticker, @date, @open, @high, @low, @close, @volume, @regime, @spike, @fwd, 'SYNTHETIC', 'synthetic')`,
  );
  const insertFlow = database.prepare(
    `INSERT INTO flows (date, sector, fii_net_cr, dii_net_cr, scope, provenance, origin)
     VALUES (@date, @sector, @fii, @dii, 'sector', 'SYNTHETIC', 'synthetic')`,
  );
  const insertDoc = database.prepare(
    `INSERT INTO docs (id, ticker, type, date, title, body, synthetic, provenance, source_url, fetched_at)
     VALUES (@id, @ticker, @type, @date, @title, @body, 1, 'SYNTHETIC', NULL, NULL)`,
  );
  const insertChunk = database.prepare(
    `INSERT INTO chunks (id, doc_id, ticker, text, vec) VALUES (@id, @docId, @ticker, @text, @vec)`,
  );
  const insertProfile = database.prepare(
    `INSERT INTO profiles (id, name, age, risk_tolerance, max_vol, holdings_json, behaviour_json)
     VALUES (@id, @name, @age, @risk, @maxVol, @holdings, @behaviour)`,
  );

  const tx = database.transaction(() => {
    database.exec(
      `DELETE FROM bars; DELETE FROM flows; DELETE FROM docs; DELETE FROM chunks; DELETE FROM profiles;`,
    );
    let barCount = 0;
    for (const ticker of Object.keys(market.bars)) {
      for (const bar of market.bars[ticker] ?? []) {
        insertBar.run({
          ticker: bar.ticker,
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          regime: bar.regime,
          spike: bar.spike ? 1 : 0,
          fwd: bar.fwdRet30,
        });
        barCount++;
      }
    }
    for (const flow of market.flows) {
      insertFlow.run({ date: flow.date, sector: flow.sector, fii: flow.fiiNet, dii: flow.diiNet });
    }
    let chunkCount = 0;
    for (const doc of docs) {
      insertDoc.run(doc);
      for (const chunk of chunkText(doc.id, doc.ticker, doc.body)) {
        insertChunk.run({ ...chunk, vec: JSON.stringify(embedLocal(chunk.text)) });
        chunkCount++;
      }
    }
    for (const profile of PROFILES) {
      insertProfile.run({
        id: profile.id,
        name: profile.name,
        age: profile.age,
        risk: profile.riskTolerance,
        maxVol: profile.maxVol,
        holdings: JSON.stringify(profile.holdings),
        behaviour: JSON.stringify(profile.behaviour),
      });
    }
    database
      .prepare(`INSERT INTO meta (key, value) VALUES ('seed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(String(seed));
    database
      .prepare(`INSERT INTO meta (key, value) VALUES ('as_of', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(market.asOf);
    return { barCount, chunkCount };
  });
  const { barCount, chunkCount } = tx();
  const sectors = new Set(market.flows.map((f) => f.sector));
  return {
    tickers: Object.keys(market.bars).length,
    bars: barCount / Object.keys(market.bars).length,
    sectors: sectors.size,
    flowRows: market.flows.length / sectors.size,
    docs: docs.length,
    chunks: chunkCount,
    profiles: PROFILES.length,
  };
}

export function ensureSeeded(): SeedCounts | null {
  const database = getDb();
  const row = database.prepare(`SELECT COUNT(*) AS n FROM bars`).get() as { n: number };
  if (row.n > 0) return null;
  return seedDatabase();
}

export function metaValue(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function listProfiles(): Profile[] {
  const rows = getDb().prepare(`SELECT * FROM profiles ORDER BY id`).all() as Array<{
    id: string;
    name: string;
    age: number;
    risk_tolerance: Profile["riskTolerance"];
    max_vol: number;
    holdings_json: string;
    behaviour_json: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    age: row.age,
    riskTolerance: row.risk_tolerance,
    maxVol: row.max_vol,
    holdings: JSON.parse(row.holdings_json) as Profile["holdings"],
    behaviour: JSON.parse(row.behaviour_json) as string[],
  }));
}

export function getProfile(id: string): Profile | null {
  return listProfiles().find((p) => p.id === id) ?? null;
}

export function sectorOf(ticker: string): string {
  return SECTOR_BY_TICKER[ticker as keyof typeof SECTOR_BY_TICKER] ?? "Other";
}
