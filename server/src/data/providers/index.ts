import type { Bar, Provenance } from "@vibefinance/shared";
import { getConfig } from "../../config.js";
import { livePriceBars } from "../live/fetch.js";
import { cachedSnapshotId, CachedProvider } from "./cached.js";
import { LiveProvider } from "./live.js";
import { SyntheticProvider } from "./synthetic.js";
import type { DataProvider, DocRow, FlowRow, SourceStatus } from "./types.js";

export interface LoadedMarket {
  bars: Bar[];
  flows: FlowRow[];
  docs: DocRow[];
  provenance: Provenance;
  dataMode: "live" | "cached" | "synthetic";
  degraded: string[];
  sources: SourceStatus[];
  snapshotId: string | null;
}

async function tryKind<T>(fns: Array<() => Promise<T>>, signal?: AbortSignal): Promise<{ value: T; index: number }> {
  let last: unknown;
  for (let i = 0; i < fns.length; i++) {
    try {
      signal?.throwIfAborted();
      const value = await fns[i]!();
      signal?.throwIfAborted();
      return { value, index: i };
    } catch (err) {
      signal?.throwIfAborted();
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("no provider");
}

export async function loadMarket(
  ticker: string,
  asOf: string,
  degrade: string[],
  mode?: "live" | "demo",
  pricesOnly = false,
  signal?: AbortSignal,
): Promise<LoadedMarket> {
  signal?.throwIfAborted();
  const cfg = getConfig();
  const synthetic = new SyntheticProvider();
  const cached = new CachedProvider(cachedSnapshotId());
  const live = new LiveProvider();
  const feedDown = degrade.includes("feedDown");
  const strict = mode === "live";
  const order: DataProvider[] = strict
    ? feedDown
      ? [cached]
      : [live, cached]
    : mode === "demo" || cfg.DATA_MODE === "synthetic" || feedDown
      ? feedDown && mode !== "demo"
        ? [cached, synthetic]
        : [synthetic]
      : cfg.DATA_MODE === "cached"
        ? [cached, synthetic]
        : [live, cached, synthetic];

  const degraded: string[] = [];
  const unavailable = (kind: string) => Object.assign(new Error(`Live ${kind} are unavailable for ${ticker}.`), { status: 503 });
  if (strict && pricesOnly) {
    try {
      const bars = await livePriceBars(ticker, asOf, signal);
      if (bars.length === 0) throw unavailable("prices");
      const last = bars[bars.length - 1];
      return {
        bars,
        flows: [],
        docs: [],
        provenance: last?.provenance === "CACHED" ? "CACHED" : "LIVE",
        dataMode: "live",
        degraded,
        sources: [],
        snapshotId: null,
      };
    } catch (err) {
      signal?.throwIfAborted();
      if (err instanceof Error && err.message.includes("unavailable")) throw err;
      throw unavailable("prices");
    }
  }
  let barsAttempt: { value: Bar[]; index: number };
  try {
    barsAttempt = await tryKind(order.map((p) => () => p.bars(ticker, asOf, signal)), signal);
  } catch (err) {
    signal?.throwIfAborted();
    if (strict) throw unavailable("prices");
    throw err;
  }
  let flowsAttempt: { value: LoadedMarket["flows"]; index: number };
  try {
    flowsAttempt = await tryKind(order.map((p) => () => p.flows(asOf, signal)), signal);
  } catch (err) {
    signal?.throwIfAborted();
    if (!strict) throw err;
    flowsAttempt = { value: [], index: 0 };
  }
  let docsAttempt: { value: LoadedMarket["docs"]; index: number };
  if (pricesOnly) {
    docsAttempt = { value: [], index: 0 };
  } else {
    try {
      docsAttempt = await tryKind(order.map((p) => () => p.docs(ticker, asOf, signal)), signal);
    } catch (err) {
      signal?.throwIfAborted();
      if (!strict) throw err;
      docsAttempt = { value: [], index: 0 };
    }
  }

  const modeOf = (index: number): "live" | "cached" | "synthetic" => order[index]?.mode ?? "synthetic";
  let bars = barsAttempt.value;
  let flows = flowsAttempt.value;
  let docs = docsAttempt.value;
  if (strict) {
    bars = bars.filter((bar) => bar.provenance !== "SYNTHETIC");
    flows = flows.filter((flow) => flow.provenance !== "SYNTHETIC");
    docs = docs.filter((doc) => doc.provenance !== "SYNTHETIC" && !doc.synthetic);
    if (bars.length === 0) throw unavailable("prices");
  }
  const barMode = modeOf(barsAttempt.index);
  if (strict && barMode === "cached") degraded.push("live_unavailable");
  if (!strict && mode !== "demo" && cfg.DATA_MODE === "live" && barMode !== "live") degraded.push(barMode === "cached" ? "live_unavailable" : "synthetic_fallback");
  if (feedDown && !strict) degraded.push(barMode === "cached" ? "live_unavailable" : "synthetic_fallback");

  if (degrade.includes("missingFiling")) docs = [];

  const provenance: Provenance = barMode === "live" ? "LIVE" : barMode === "cached" ? "CACHED" : "SYNTHETIC";
  return {
    bars,
    flows,
    docs,
    provenance,
    dataMode: barMode,
    degraded: [...new Set(degraded)],
    sources: [...new Map([barsAttempt.index, flowsAttempt.index, docsAttempt.index]
      .flatMap((index) => order[index]?.meta().sources ?? []).map((source) => [source.source, source])).values()],
    snapshotId: barMode === "cached" ? cachedSnapshotId() || null : null,
  };
}

export function dominantProvenance(rows: { provenance: Provenance }[]): Provenance {
  if (rows.some((r) => r.provenance === "LIVE")) return "LIVE";
  if (rows.some((r) => r.provenance === "CACHED")) return "CACHED";
  return "SYNTHETIC";
}
