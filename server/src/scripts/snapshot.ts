import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TICKERS } from "@vibefinance/shared";
import { getConfig } from "../config.js";
import { getDb } from "../db/db.js";
import { parseFiiCsv } from "../data/live/fiiCsv.js";
import { parseGdelt } from "../data/live/gdelt.js";
import { parseNseRss } from "../data/live/nseRss.js";
import { parseYahooChart, type YahooChart } from "../data/live/yahoo.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const id = new Date().toISOString().slice(0, 10);
const fetchedAt = new Date().toISOString();
const counts = { yahoo: 0, rss: 0, fii: 0, gdelt: 0, synthetic: 0 };

async function yahooBars(ticker: string) {
  const cfg = getConfig();
  const period1 = Math.floor(Date.now() / 1000) - cfg.LIVE_HISTORY_MONTHS * 31 * 24 * 3600;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.NS?interval=1d&period1=${period1}`;
  const res = await fetch(url, { headers: { "user-agent": "VibeFinance/1.0 research" } });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const json = (await res.json()) as YahooChart;
  return parseYahooChart(json, ticker);
}

async function rssDocs() {
  const url = "https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml";
  const res = await fetch(url, { headers: { "user-agent": "VibeFinance/1.0 research", accept: "application/rss+xml" } });
  if (!res.ok) throw new Error(`rss ${res.status}`);
  return parseNseRss(await res.text(), [...TICKERS], fetchedAt);
}

async function gdeltDocs(ticker: string) {
  const q = encodeURIComponent(ticker);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=5&format=json`;
  const res = await fetch(url, { headers: { "user-agent": "VibeFinance/1.0 research" } });
  if (!res.ok) throw new Error(`gdelt ${res.status}`);
  return parseGdelt((await res.json()) as { articles?: { title?: string; url?: string; seendate?: string }[] }, ticker, fetchedAt);
}

const db = getDb();
const insertBar = db.prepare(
  `INSERT OR REPLACE INTO snapshot_bars (snapshot_id, ticker, date, open, high, low, close, volume, spike, provenance, origin, fetched_at, source_url)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'LIVE', ?, ?, ?)`,
);
const insertFlow = db.prepare(
  `INSERT OR REPLACE INTO snapshot_flows (snapshot_id, date, sector, scope, fii_net_cr, dii_net_cr, provenance, origin, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, 'CACHED', ?, ?)`,
);
const insertDoc = db.prepare(
  `INSERT OR REPLACE INTO snapshot_docs (snapshot_id, id, ticker, type, date, title, body, synthetic, source_url, fetched_at, provenance)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LIVE')`,
);

for (const ticker of TICKERS) {
  try {
    const bars = await yahooBars(ticker);
    for (const bar of bars) {
      insertBar.run(id, ticker, bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume, `yahoo:${ticker}.NS`, fetchedAt, `https://finance.yahoo.com/quote/${ticker}.NS`);
    }
    counts.yahoo += bars.length;
  } catch (err) {
    console.log(`yahoo ${ticker} failed: ${(err as Error).message}`);
  }
}

try {
  const docs = await rssDocs();
  for (const doc of docs) insertDoc.run(id, doc.id, doc.ticker, doc.type, doc.date, doc.title, doc.body, 0, doc.sourceUrl, fetchedAt);
  counts.rss = docs.length;
} catch (err) {
  console.log(`rss failed: ${(err as Error).message}`);
}

const csvCandidates = [getConfig().FII_CSV_PATH, path.join(root, "docs/data/fii-dii-nse-2026-10-13.csv")];
const csvPath = csvCandidates.find((p) => fs.existsSync(p));
if (csvPath) {
  const flows = parseFiiCsv(fs.readFileSync(csvPath, "utf8"), fetchedAt);
  for (const flow of flows) insertFlow.run(id, flow.date, flow.sector, flow.scope, flow.fiiNet, flow.diiNet, flow.origin, fetchedAt);
  counts.fii = flows.length;
} else {
  console.log("fii csv missing");
}

if (getConfig().GDELT_ENABLED === "true") {
  for (const ticker of TICKERS) {
    try {
      const docs = await gdeltDocs(ticker);
      for (const doc of docs) insertDoc.run(id, doc.id, doc.ticker, doc.type, doc.date, doc.title, doc.body, 0, doc.sourceUrl, fetchedAt);
      counts.gdelt += docs.length;
    } catch (err) {
      console.log(`gdelt ${ticker} failed: ${(err as Error).message}`);
    }
  }
}

const snapDir = path.join(root, "data", "snapshots", id);
fs.mkdirSync(snapDir, { recursive: true });
fs.writeFileSync(path.join(snapDir, "meta.json"), JSON.stringify({ id, fetchedAt, counts }, null, 2));
console.log(`snapshot ${id} yahoo=${counts.yahoo} rss=${counts.rss} fii=${counts.fii} gdelt=${counts.gdelt} synthetic=${counts.synthetic}`);
process.exit(0);
