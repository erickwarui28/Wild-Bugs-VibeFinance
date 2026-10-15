import type { ProfileRow } from "../api";
import type { Synthesis } from "@vibefinance/shared";
import { SECTOR_BY_TICKER } from "@vibefinance/shared";
import { GlossaryButton } from "./Glossary";

export function PortfolioTable({ profile, synthesis }: { profile: ProfileRow | undefined; synthesis: Synthesis | null }) {
  const holdings = profile?.holdings ?? [];
  const alert = synthesis?.personalised.concentrationAlert;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-2 font-medium">Example portfolio</h2>
      <p className="mb-2 text-xs text-[var(--text-muted)]">Illustrative profile holdings, not your actual investments. <GlossaryButton term="allocation" label="Allocation explained" /></p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--text-muted)]">
          <tr><th>Ticker</th><th>Sector</th><th>Weight</th></tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr key={h.ticker} className="border-t border-[var(--border)]">
              <td className="py-1">{h.ticker}</td>
              <td>{SECTOR_BY_TICKER[h.ticker as keyof typeof SECTOR_BY_TICKER] ?? ""}</td>
              <td className="tabular">{(h.weight * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        <GlossaryButton term="hhi" label="HHI" /> {alert ? `${alert.hhiBefore.toFixed(2)} → ${alert.hhiAfter.toFixed(2)}` : "—"} · effective holdings {alert && alert.hhiAfter > 0 ? (1 / alert.hhiAfter).toFixed(1) : "—"}
      </p>
      {alert?.alert ? <p className="mt-2 text-xs text-[var(--insufficient)]">Above the concentration threshold.</p> : null}
    </div>
  );
}

export function MetricsPanel({ metrics }: { metrics: { accuracy: { hitRate: number; n: number }; latency: { p50: number; p95: number }; hhi: { after: number }; brier: number; uncitedDropped: number } | null }) {
  const tiles = [
    ["Fixture accuracy vs 30d", metrics?.accuracy.n ? `${(metrics.accuracy.hitRate * 100).toFixed(0)}% · n ${metrics.accuracy.n}` : "Not evaluated", "Synthetic fixture outcomes only; live outcomes are not evaluated."],
    ["Latency p50/p95", metrics ? `${Math.round(metrics.latency.p50)} / ${Math.round(metrics.latency.p95)} ms` : "—", "End-to-end latency across runs in this session."],
    ["HHI", metrics ? metrics.hhi.after.toFixed(3) : "—", "Sum of squared portfolio weights. Effective holdings are 1/HHI."],
    ["Fixture Brier", metrics?.accuracy.n ? metrics.brier.toFixed(3) : "Not evaluated", "Synthetic fixture evaluation only."],
  ];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-2 font-medium">Session metrics</h2>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(([label, value, tip]) => (
          <div key={label} className="rounded-lg bg-[var(--surface-2)] p-3" title={tip}>
            <div className="text-xs text-[var(--text-muted)]">{label}</div>
            <div className="tabular mt-1 text-lg">{value}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">Uncited claims dropped: {metrics?.uncitedDropped ?? 0}</p>
    </div>
  );
}
