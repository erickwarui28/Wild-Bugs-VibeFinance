import type { Bar, Provenance } from "@vibefinance/shared";

export interface FlowRow {
  date: string;
  sector: string;
  fiiNet: number;
  diiNet: number;
  scope: "sector" | "market";
  provenance: Provenance;
  origin: string | null;
  fetchedAt: string | null;
}

export interface DocRow {
  id: string;
  ticker: string;
  type: string;
  date: string;
  title: string;
  body: string;
  synthetic: boolean;
  provenance: Provenance;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  mode: "live" | "cached" | "synthetic";
  detail: string;
}

export interface DataProvider {
  mode: "live" | "cached" | "synthetic";
  bars(ticker: string, asOf: string, signal?: AbortSignal): Promise<Bar[]>;
  flows(asOf: string, signal?: AbortSignal): Promise<FlowRow[]>;
  docs(ticker: string, asOf: string, signal?: AbortSignal): Promise<DocRow[]>;
  meta(): { snapshotId?: string; fetchedAt?: string; sources: SourceStatus[] };
}

export function notAfter(asOf: string, date: string): boolean {
  return date <= asOf;
}
