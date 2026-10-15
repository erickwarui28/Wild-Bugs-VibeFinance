import type { Bar } from "@vibefinance/shared";
import { getDb, metaValue } from "../../db/db.js";
import type { DataProvider, DocRow, FlowRow, SourceStatus } from "./types.js";
import { notAfter } from "./types.js";

function mapBar(row: {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spike: number;
  provenance: Bar["provenance"];
}): Bar {
  return {
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    spike: row.spike === 1,
    provenance: row.provenance,
  };
}

export class SyntheticProvider implements DataProvider {
  mode = "synthetic" as const;

  async bars(ticker: string, asOf: string): Promise<Bar[]> {
    const rows = getDb()
      .prepare(
        `SELECT date, open, high, low, close, volume, spike, provenance FROM bars WHERE ticker = ? AND date <= ? ORDER BY date`,
      )
      .all(ticker, asOf) as Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      spike: number;
      provenance: Bar["provenance"];
    }>;
    return rows.filter((r) => notAfter(asOf, r.date)).map(mapBar);
  }

  async flows(asOf: string): Promise<FlowRow[]> {
    const rows = getDb()
      .prepare(
        `SELECT date, sector, fii_net_cr, dii_net_cr, scope, provenance, origin, fetched_at FROM flows WHERE date <= ? ORDER BY date, sector`,
      )
      .all(asOf) as Array<{
      date: string;
      sector: string;
      fii_net_cr: number;
      dii_net_cr: number;
      scope: "sector" | "market";
      provenance: FlowRow["provenance"];
      origin: string | null;
      fetched_at: string | null;
    }>;
    return rows.map((r) => ({
      date: r.date,
      sector: r.sector,
      fiiNet: r.fii_net_cr,
      diiNet: r.dii_net_cr,
      scope: r.scope,
      provenance: r.provenance,
      origin: r.origin,
      fetchedAt: r.fetched_at,
    }));
  }

  async docs(ticker: string, asOf: string): Promise<DocRow[]> {
    const rows = getDb()
      .prepare(`SELECT * FROM docs WHERE ticker = ? AND date <= ? ORDER BY date`)
      .all(ticker, asOf) as Array<{
      id: string;
      ticker: string;
      type: string;
      date: string;
      title: string;
      body: string;
      synthetic: number;
      provenance: DocRow["provenance"];
      source_url: string | null;
      fetched_at: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      type: r.type,
      date: r.date,
      title: r.title,
      body: r.body,
      synthetic: r.synthetic === 1,
      provenance: r.provenance,
      sourceUrl: r.source_url,
      fetchedAt: r.fetched_at,
    }));
  }

  meta(): { snapshotId?: string; fetchedAt?: string; sources: SourceStatus[] } {
    return {
      sources: [
        {
          source: "synthetic",
          ok: true,
          mode: "synthetic",
          detail: `seed ${metaValue("seed") ?? "42"} as-of ${metaValue("as_of") ?? ""}`,
        },
      ],
    };
  }
}

export function forwardReturn(ticker: string, asOf: string): number | null {
  const row = getDb()
    .prepare(`SELECT fwd_ret_30 FROM bars WHERE ticker = ? AND date = ?`)
    .get(ticker, asOf) as { fwd_ret_30: number | null } | undefined;
  return row?.fwd_ret_30 ?? null;
}
