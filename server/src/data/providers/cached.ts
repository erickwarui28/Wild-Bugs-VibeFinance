import type { Bar } from "@vibefinance/shared";
import { getConfig } from "../../config.js";
import { getDb } from "../../db/db.js";
import type { DataProvider, DocRow, FlowRow } from "./types.js";

export class CachedProvider implements DataProvider {
  mode = "cached" as const;
  constructor(private snapshotId: string) {}

  private hasRows(): boolean {
    if (!this.snapshotId) return false;
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM snapshot_bars WHERE snapshot_id = ?`)
      .get(this.snapshotId) as { n: number };
    return row.n > 0;
  }

  async bars(ticker: string, asOf: string): Promise<Bar[]> {
    if (!this.hasRows()) throw new Error("cached snapshot missing");
    const rows = getDb()
      .prepare(
        `SELECT date, open, high, low, close, volume, spike, provenance, origin, fetched_at, source_url FROM snapshot_bars
         WHERE snapshot_id = ? AND ticker = ? AND date <= ? ORDER BY date`,
      )
      .all(this.snapshotId, ticker, asOf) as Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      spike: number;
      provenance: Bar["provenance"];
      origin: string | null; fetched_at: string | null; source_url: string | null;
    }>;
    if (rows.length === 0) throw new Error("cached bars missing");
    return rows.map((r) => ({
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      spike: r.spike === 1,
      provenance: r.provenance === "LIVE" ? "CACHED" : r.provenance,
      origin:r.origin, fetchedAt:r.fetched_at, sourceUrl:r.source_url,
    }));
  }

  async flows(asOf: string): Promise<FlowRow[]> {
    if (!this.hasRows()) throw new Error("cached snapshot missing");
    const rows = getDb()
      .prepare(
        `SELECT date, sector, scope, fii_net_cr, dii_net_cr, provenance, origin, fetched_at
         FROM snapshot_flows WHERE snapshot_id = ? AND date <= ? ORDER BY date`,
      )
      .all(this.snapshotId, asOf) as Array<{
      date: string;
      sector: string;
      scope: "sector" | "market";
      fii_net_cr: number;
      dii_net_cr: number;
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
      provenance: r.provenance === "LIVE" ? "CACHED" : r.provenance,
      origin: r.origin,
      fetchedAt: r.fetched_at,
    }));
  }

  async docs(ticker: string, asOf: string): Promise<DocRow[]> {
    if (!this.hasRows()) throw new Error("cached snapshot missing");
    const rows = getDb()
      .prepare(
        `SELECT id, ticker, type, date, title, body, synthetic, provenance, source_url, fetched_at
         FROM snapshot_docs WHERE snapshot_id = ? AND ticker = ? AND date <= ? ORDER BY date`,
      )
      .all(this.snapshotId, ticker, asOf) as Array<{
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
      provenance: r.provenance === "LIVE" ? "CACHED" : r.provenance,
      sourceUrl: r.source_url,
      fetchedAt: r.fetched_at,
    }));
  }

  meta() {
    return {
      snapshotId: this.snapshotId,
      sources: [
        {
          source: "snapshot",
          ok: this.hasRows(),
          mode: "cached" as const,
          detail: this.snapshotId || "none",
        },
      ],
    };
  }
}

export function cachedSnapshotId(): string {
  const cfg = getConfig();
  if (cfg.SNAPSHOT_ID) return cfg.SNAPSHOT_ID;
  const row = getDb()
    .prepare(`SELECT snapshot_id FROM snapshot_bars ORDER BY snapshot_id DESC LIMIT 1`)
    .get() as { snapshot_id: string } | undefined;
  return row?.snapshot_id ?? "";
}
