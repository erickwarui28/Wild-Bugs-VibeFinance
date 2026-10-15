import type { Citation, Claim, DocHit, Label, Provenance } from "@vibefinance/shared";
import { clamp } from "../math.js";

export function dataCite(args: {
  source: "ohlcv" | "volume" | "flows" | "derived";
  field: string;
  asOf: string;
  value: number;
  provenance: Provenance;
  origin?: string | null;
  fetchedAt?: string | null;
}): Citation {
  return {
    type: "data",
    source: args.source,
    field: args.field,
    asOf: args.asOf,
    value: Number(args.value.toFixed(4)),
    provenance: args.provenance,
    origin: args.origin ?? null,
    fetchedAt: args.fetchedAt ?? null,
  };
}

export function docCite(hit: DocHit): Citation {
  return {
    type: "doc",
    docId: hit.docId,
    chunkId: hit.chunkId,
    snippet: hit.snippet.slice(0, 300),
    score: hit.score,
    provenance: hit.provenance,
    sourceUrl: hit.sourceUrl,
    fetchedAt: hit.fetchedAt,
  };
}

export function claim(text: string, citations: Citation[]): Claim {
  return { text, citations };
}

export function labelFromScore(score: number): Label {
  if (score > 0.15) return "bullish";
  if (score < -0.15) return "bearish";
  return "neutral";
}

export function confidenceFor(score: number, dataQuality: number): number {
  return clamp(0.35 + 0.5 * Math.abs(score) * dataQuality, 0, 0.95);
}

export function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

export function fmtNum(n: number, digits = 1): string {
  return n.toFixed(digits);
}
