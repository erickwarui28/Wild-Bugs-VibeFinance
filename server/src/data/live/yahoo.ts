import type { Bar } from "@vibefinance/shared";

export interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
    }>;
  };
}

export function parseYahooChart(json: YahooChart, ticker: string): Bar[] {
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const times = result?.timestamp ?? [];
  if (!quote) return [];
  const bars: Bar[] = [];
  for (let i = 0; i < times.length; i++) {
    const close = quote.close?.[i];
    const ts = times[i];
    if (close == null || ts == null) continue;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    const day = new Date(ts * 1000).getUTCDay();
    if (day === 0 || day === 6) continue;
    bars.push({
      date,
      open: quote.open?.[i] ?? close,
      high: quote.high?.[i] ?? close,
      low: quote.low?.[i] ?? close,
      close,
      volume: quote.volume?.[i] ?? 0,
      spike: false,
      provenance: "LIVE",
    });
  }
  void ticker;
  return bars;
}
