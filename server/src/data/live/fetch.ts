import fs from "node:fs";
import { getDb } from "../../db/db.js";
import type { Bar } from "@vibefinance/shared";
import { TICKERS } from "@vibefinance/shared";
import { getConfig } from "../../config.js";
import { parseFiiCsv } from "./fiiCsv.js";
import { parseGdelt } from "./gdelt.js";
import { parseNseRss } from "./nseRss.js";
import { parseYahooChart, type YahooChart } from "./yahoo.js";
import { setLiveLoader, type LiveBundle } from "../providers/live.js";
import type { DocRow, FlowRow, SourceStatus } from "../providers/types.js";
import { CircuitBreaker, CoalescedTasks, ConcurrencyGate } from "../../reliability.js";

const TTL_MS = 5 * 60 * 1000;

const barsCache = new Map<string, { at: number; bars: Bar[] }>();
let flowCache: { at: number; flows: FlowRow[] } | null = null;
let rssCache: { at: number; docs: DocRow[] } | null = null;
const gdeltCache = new Map<string, { at: number; docs: DocRow[] }>();
const sourceTasks = new CoalescedTasks<string>();
let sourceGate: ConcurrencyGate | null = null;
let sourceBreaker: CircuitBreaker | null = null;
let runtimeKey = "";

function runtime() {
  const cfg = getConfig();
  const key = JSON.stringify([cfg.SOURCE_MAX_ACTIVE, cfg.SOURCE_MAX_QUEUED, cfg.SOURCE_FAILURE_THRESHOLD, cfg.SOURCE_COOLDOWN_MS]);
  if (!sourceGate || !sourceBreaker || (runtimeKey !== key && sourceGate.snapshot().active === 0 && sourceGate.snapshot().queued === 0)) {
    sourceGate = new ConcurrencyGate({ active: cfg.SOURCE_MAX_ACTIVE, queued: cfg.SOURCE_MAX_QUEUED, waitMs: 8000 });
    sourceBreaker = new CircuitBreaker(cfg.SOURCE_FAILURE_THRESHOLD, cfg.SOURCE_COOLDOWN_MS); runtimeKey = key;
  }
  return { gate: sourceGate, breaker: sourceBreaker };
}

export function sourceRuntimeStatus() { const current = runtime(); return { ...current.gate.snapshot(), circuits: current.breaker.snapshot() }; }
export function resetLiveCachesForTests() {
  barsCache.clear(); flowCache = null; rssCache = null; gdeltCache.clear();
  sourceGate = null; sourceBreaker = null; runtimeKey = "";
}

async function getText(url: string, source: string, signal?: AbortSignal, validate?: (text: string) => void): Promise<string> {
  return sourceTasks.run(url, signal, async (sharedSignal) => {
  const current = runtime();
  return current.gate.run(source, sharedSignal, () => current.breaker.run(source, sharedSignal, async () => {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; VibeFinance/1.0; +https://erickwarui28.github.io/vibefinance/)",
      accept: "application/json, application/rss+xml, text/xml",
    },
    signal: AbortSignal.any([sharedSignal, AbortSignal.timeout(8000)]),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text(); validate?.(text); return text;
  }));
  });
}

async function yahooBars(ticker: string, signal?: AbortSignal): Promise<Bar[]> {
  signal?.throwIfAborted();
  const hit = barsCache.get(ticker);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bars;
  const cfg = getConfig();
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - cfg.LIVE_HISTORY_MONTHS * 31 * 24 * 3600;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.NS?interval=1d&period1=${period1}&period2=${period2}`;
  const json = JSON.parse(await getText(url, "yahoo", signal, (text) => {
    if (!parseYahooChart(JSON.parse(text) as YahooChart, ticker).length) throw new Error(`yahoo empty ${ticker}`);
  })) as YahooChart;
  const retrievedAt = new Date().toISOString();
  const bars = parseYahooChart(json, ticker).map(bar=>({ ...bar, origin:`yahoo:${ticker}.NS`, fetchedAt:retrievedAt, sourceUrl:url }));
  if (bars.length === 0) throw new Error(`yahoo empty ${ticker}`);
  barsCache.set(ticker, { at: Date.now(), bars });
  return bars;
}

async function marketFlows(): Promise<FlowRow[]> {
  if (flowCache && Date.now() - flowCache.at < TTL_MS) return flowCache.flows;
  const cfg = getConfig();
  if (!fs.existsSync(cfg.FII_CSV_PATH)) {
    flowCache = { at: Date.now(), flows: [] };
    return [];
  }
  const flows = parseFiiCsv(fs.readFileSync(cfg.FII_CSV_PATH, "utf8"), null);
  flowCache = { at: Date.now(), flows };
  return flows;
}

async function rssDocs(signal?: AbortSignal): Promise<DocRow[]> {
  signal?.throwIfAborted();
  if (rssCache && Date.now() - rssCache.at < TTL_MS) return rssCache.docs;
  const fetchedAt = new Date().toISOString();
  try {
    const xml = await getText("https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml", "nse-rss", signal,
      (text) => { parseNseRss(text, [...TICKERS], fetchedAt); });
    const docs = parseNseRss(xml, [...TICKERS], fetchedAt);
    rssCache = { at: Date.now(), docs };
    return docs;
  } catch {
    signal?.throwIfAborted();
    rssCache = null;
    return [];
  }
}

async function gdeltDocs(ticker: string, signal?: AbortSignal): Promise<DocRow[]> {
  signal?.throwIfAborted();
  if (getConfig().GDELT_ENABLED !== "true" || ticker === "*") return [];
  const hit = gdeltCache.get(ticker);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.docs;
  const fetchedAt = new Date().toISOString();
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${ticker} India`)}&mode=artlist&maxrecords=5&format=json`;
    const json = JSON.parse(await getText(url, "gdelt", signal, (text) => { JSON.parse(text); })) as { articles?: { title?: string; url?: string; seendate?: string }[] };
    const docs = parseGdelt(json, ticker, fetchedAt);
    gdeltCache.set(ticker, { at: Date.now(), docs });
    return docs;
  } catch {
    signal?.throwIfAborted();
    gdeltCache.delete(ticker);
    return [];
  }
}

export async function liveDocs(ticker: string, signal?: AbortSignal): Promise<DocRow[]> {
  const [rss, headlines] = await Promise.all([rssDocs(signal), gdeltDocs(ticker, signal)]);
  signal?.throwIfAborted();
  const docs = [...rss.filter((doc) => ticker === "*" || doc.ticker === ticker), ...headlines];
  const insert = getDb().prepare("INSERT INTO live_documents (id, payload_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json");
  getDb().transaction(() => docs.forEach((doc) => insert.run(doc.id, JSON.stringify(doc))))();
  return docs;
}

export function cachedLiveBars(): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const [ticker, row] of barsCache) out.set(ticker, row.bars);
  return out;
}

export function searchLiveDocs(query: string, ticker: string | null) {
  const q = query.toLowerCase();
  const docs = [...(rssCache?.docs ?? []), ...[...gdeltCache.values()].flatMap((row) => row.docs)].filter((doc) => !ticker || doc.ticker === ticker);
  return docs
    .filter((doc) => `${doc.title} ${doc.body}`.toLowerCase().includes(q))
    .slice(0, 8)
    .map((doc) => ({
      docId: doc.id,
      date: doc.date,
      sourceUrl: doc.sourceUrl,
      fetchedAt: doc.fetchedAt,
      chunkId: `${doc.id}#c0`,
      title: doc.title,
      snippet: doc.body.slice(0, 280),
      score: 1,
      provenance: doc.provenance,
    }));
}

export function getLiveDoc(id: string) {
  const cached = [...(rssCache?.docs ?? []), ...[...gdeltCache.values()].flatMap((row) => row.docs)].find((row) => row.id === id);
  const row = cached ? undefined : getDb().prepare("SELECT payload_json FROM live_documents WHERE id = ?").get(id) as { payload_json: string } | undefined;
  const doc = cached ?? (row ? JSON.parse(row.payload_json) as DocRow : null);
  if (!doc) return null;
  return { ...doc, sourceUrl: doc.sourceUrl, synthetic: false, chunks: [{ id: `${doc.id}#c0`, text: doc.body }] };
}

export async function livePriceBars(ticker: string, asOf: string, signal?: AbortSignal): Promise<Bar[]> {
  const bars = await yahooBars(ticker, signal);
  return bars.filter((bar) => bar.date <= asOf && bar.provenance !== "SYNTHETIC");
}

export function installLiveLoader(): void {
  setLiveLoader(async (ticker, _asOf, signal): Promise<LiveBundle> => {
    const fetchedAt = new Date().toISOString();
    const [flows, docs, bars] = await Promise.all([
      marketFlows(),
      liveDocs(ticker, signal),
      ticker === "*" ? Promise.resolve([]) : yahooBars(ticker, signal),
    ]);
    const sources: SourceStatus[] = [
      { source: "yahoo", ok: bars.length > 0 || ticker === "*", mode: "live", detail: ticker },
      { source: "fii", ok: flows.length > 0, mode: "live", detail: "market-wide csv" },
      { source: "filings", ok: docs.length > 0, mode: "live", detail: "rss and headlines" },
    ];
    return { bars, flows, docs, sources, fetchedAt };
  });
}
