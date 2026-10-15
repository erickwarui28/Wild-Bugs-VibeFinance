import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchMarket } from "../api";
import { useStore } from "../store";
import { ProvenanceBadge } from "./LabelChip";

export function PriceChart({ ticker, asOf, snapshotId }: { ticker: string; asOf: string; snapshotId?: string }) {
  const mode = useStore().mode;
  const [rows, setRows] = useState<{ date: string; close: number; spike: boolean; provenance: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRows([]); setLoading(true); setError("");
    void fetchMarket(ticker, asOf, mode, snapshotId, controller.signal).then((m) => { if (!cancelled) setRows(m.bars); })
      .catch(() => { if (!cancelled) setError("Price history could not be loaded. Refresh the analysis to retry."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [ticker, asOf, mode, snapshotId]);
  const spikes = rows.filter((r) => r.spike);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label={`${ticker} closing price, ${rows.length} days, ${spikes.length} volume spikes marked`}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span>{ticker} close</span>
        {rows[0] ? <ProvenanceBadge provenance={rows[0].provenance} /> : <span>{loading ? "Loading…" : "Unavailable"}</span>}
      </div>
      {rows.length ? <p className="mb-3 text-xs text-[var(--text-muted)]">Last close ₹{rows[rows.length - 1].close.toLocaleString("en-IN", { maximumFractionDigits: 2 })} · observed {rows[rows.length - 1].date} · {rows[0].date}–{rows[rows.length - 1].date}</p> : null}
      {snapshotId ? <p className="mb-3 text-xs text-[var(--text-muted)]">Frozen evidence from this analysis · refresh analysis for newer data.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <XAxis dataKey="date" minTickGap={60} tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickFormatter={(date: string) => date.slice(5)} />
            <YAxis width={52} domain={["auto", "auto"]} tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickFormatter={(value: number) => `₹${Math.round(value)}`} />
            <Tooltip contentStyle={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} />
            <Line type="monotone" dataKey="close" stroke="var(--brand)" dot={false} strokeWidth={2} isAnimationActive={false} />
            {spikes.map((s) => (
              <ReferenceDot key={s.date} x={s.date} y={s.close} r={3} fill="var(--volume)" />
            ))}
            <ReferenceLine x={asOf} stroke="var(--text-muted)" strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {rows.length ? <details className="mt-3 text-xs"><summary className="cursor-pointer">View closing prices as a table</summary><div className="mt-2 max-h-52 overflow-auto"><table className="w-full text-left"><caption className="mb-2">Latest 30 sessions · closing price in INR</caption><thead><tr><th scope="col">Date</th><th scope="col">Close (₹)</th></tr></thead><tbody>{rows.slice(-30).reverse().map((row) => <tr key={row.date}><td className="py-1">{row.date}</td><td>{row.close.toFixed(2)}</td></tr>)}</tbody></table></div></details> : null}
    </div>
  );
}
