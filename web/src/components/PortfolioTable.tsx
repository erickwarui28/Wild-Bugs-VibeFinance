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

export function MetricsPanel({ synthesis, timing }: { synthesis: Synthesis; timing: { runId: string; requestMs: number; traceMs: number | null } | null }) {
  const current = timing?.runId === synthesis.runId ? timing : null;
  const tiles = [
    ["Browser request", current ? `${Math.round(current.requestMs)} ms` : "Not recorded", "This analysis request, including anonymous identity setup, network and server response; excludes initial page loading and later chart requests."],
    ["Server trace", current?.traceMs != null ? `${current.traceMs} ms` : "Not recorded", "Same run and span as Trace: server admission, ingestion and execution; not browser network time."],
    ["Evidence coverage", `${synthesis.agents.filter(a => a.label !== "insufficient_evidence").length} / ${synthesis.agents.length} agents`, "Available specialist dimensions, not a freshness guarantee."],
    ["HHI", synthesis.personalised.concentrationAlert?.hhiAfter.toFixed(3) ?? "Not recorded", "Illustrative portfolio concentration: sum of squared weights."],
  ];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-2 font-medium">Current analysis metrics</h2>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(([label, value, tip]) => (
          <div key={label} className="rounded-lg bg-[var(--surface-2)] p-3" title={tip}>
            <div className="text-xs text-[var(--text-muted)]">{label}</div>
            <div className="tabular mt-1 text-lg">{value}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">Timings belong to this run, not a session average. Browser time includes networking; parallel agent durations are not added together. Reused evidence does not mean the original agents ran again.</p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">A single session is not an accuracy benchmark. See Eval for the published synthetic holdout, baselines and limitations.</p>
    </div>
  );
}
