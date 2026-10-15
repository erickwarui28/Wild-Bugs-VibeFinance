import type { Bar, Provenance } from "@vibefinance/shared";
import type { DataProvider, DocRow, FlowRow, SourceStatus } from "./types.js";

export interface LiveBundle {
  bars: Bar[];
  flows: FlowRow[];
  docs: DocRow[];
  sources: SourceStatus[];
  fetchedAt: string;
}

export type LiveLoader = (ticker: string, asOf: string, signal?: AbortSignal) => Promise<LiveBundle>;

let loader: LiveLoader = async () => {
  throw new Error("live fetch unavailable");
};

export function setLiveLoader(next: LiveLoader): void {
  loader = next;
}

export function resetLiveLoader(): void {
  loader = async () => {
    throw new Error("live fetch unavailable");
  };
}

export class LiveProvider implements DataProvider {
  mode = "live" as const;
  private lastSources: SourceStatus[] = [];
  private bundles = new Map<string, Promise<LiveBundle>>();
  private bundle(ticker: string, asOf: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const key = `${ticker}|${asOf}`;
    let pending = this.bundles.get(key);
    if (!pending) { pending = loader(ticker, asOf, signal); this.bundles.set(key, pending); }
    return pending;
  }

  async bars(ticker: string, asOf: string, signal?: AbortSignal): Promise<Bar[]> {
    const bundle = await this.bundle(ticker, asOf, signal);
    this.lastSources = bundle.sources;
    if (bundle.bars.length === 0) throw new Error("live bars empty");
    return bundle.bars.filter((b) => b.date <= asOf);
  }

  async flows(asOf: string, signal?: AbortSignal): Promise<FlowRow[]> {
    const bundle = await this.bundle("*", asOf, signal);
    return bundle.flows.filter((f) => f.date <= asOf);
  }

  async docs(ticker: string, asOf: string, signal?: AbortSignal): Promise<DocRow[]> {
    const bundle = await this.bundle(ticker, asOf, signal);
    return bundle.docs.filter((d) => d.date <= asOf);
  }

  meta() {
    return { fetchedAt: new Date().toISOString(), sources: this.lastSources };
  }
}

export function stampProvenance<T extends { provenance: Provenance }>(rows: T[], provenance: Provenance): T[] {
  return rows.map((row) => ({ ...row, provenance }));
}
