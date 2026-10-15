import { useEffect, useState } from "react";
import type { EvaluationReport, LatencyReport } from "@vibefinance/shared";
import { fetchEval, fetchHistory } from "../api";
import { useStore } from "../store";

const percent = (value: number | null | undefined) => value == null ? "Not evaluated" : `${(value * 100).toFixed(1)}%`;
export function Eval() {
  const store = useStore();
  const [backtest, setBacktest] = useState<EvaluationReport | null>(null);
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const [history, setHistory] = useState<{ ticker: string; action: string; size_pct: number; created_at: string }[]>([]);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (store.offline) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void fetchEval(controller.signal).then(body => { if (!controller.signal.aborted) { setBacktest(body.backtest); setLatency(body.latency); } })
      .catch(() => { if (!controller.signal.aborted) setError("Evaluation could not be loaded or validated. Any visible report is the last successfully loaded version."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void fetchHistory().then(body => { if (!controller.signal.aborted) setHistory(body.decisions); }).catch(() => {});
    return () => controller.abort();
  }, [store.offline, retry]);
  return <div className="space-y-4">
    <section className="bento-hero rounded-xl border border-[var(--border)] p-5">
      <h1 className="text-xl font-semibold">Evaluation</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{backtest?.note ?? "Reproducible synthetic benchmarks, not current Live performance or investment returns."}</p>
      <p className="mt-2 text-sm">Calibration is disabled. Confidence measures evidence strength and agreement, not the probability of profit.</p>
    </section>
    {store.offline ? <p role="status">Reconnect to load the published evaluation report.</p> : null}
    {loading ? <p role="status">Loading evaluation…</p> : null}
    {error ? <div role="alert"><p>{error}</p><button className="mt-2 rounded-md border border-[var(--border)] px-3 py-2" onClick={() => setRetry(value => value + 1)}>Retry evaluation</button></div> : null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[["Holdout hit rate", percent(backtest?.composite.hitRate)], ["Directional coverage", percent(backtest?.coverage)],
        ["Heuristic Brier", backtest?.composite.brier?.toFixed(3) ?? "Not evaluated"], ["Scored / eligible", backtest ? `${backtest.composite.n} / ${backtest.eligible}` : "—"]].map(([label, value]) =>
        <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="tabular mt-2 text-xl">{value}</div></div>)}
    </div>
    {backtest ? <section className="rounded-xl border border-[var(--border)] p-5 space-y-3">
      <h2 className="font-semibold">Same-sample baselines and methodology</h2>
      <p>Momentum-only: {percent(backtest.baselines.momentumOnly)} · always bullish: {percent(backtest.baselines.alwaysBullish)}. Neutral probability Brier: {backtest.baselines.neutralBrier?.toFixed(3) ?? "Not evaluated"}.</p>
      <p className="text-sm">{backtest.abstained} eligible observations were neutral or insufficient evidence. Bull-minus-bear forward-return spread: {backtest.composite.spread?.toFixed(4) ?? "Not evaluated"}; this is not strategy P&amp;L.</p>
      <p className="text-sm">Holdout {backtest.methodology.holdoutStart} to {backtest.methodology.holdoutEnd}. Development ends {backtest.methodology.developmentEnd}, followed by a {backtest.methodology.purgeTradingSessions}-session purge. Forward horizon {backtest.methodology.horizonTradingSessions} trading sessions; sampling stride {backtest.methodology.strideTradingSessions}. No fitted parameters or calibration.</p>
      <p className="text-sm text-[var(--text-muted)]">{backtest.methodology.scoring}</p>
      <p className="text-sm text-[var(--text-muted)]">{backtest.methodology.limitations}</p>
      <details><summary className="cursor-pointer">Reproduction manifest</summary><dl className="mt-3 space-y-2 text-sm break-words">
        <div><dt>Generated</dt><dd>{new Date(backtest.generatedAt).toLocaleString()}</dd></div>
        <div><dt>Configuration</dt><dd>Seed {backtest.seed}; synthetic data; mock provider</dd></div>
        <div><dt>Base revision</dt><dd className="mono break-all">{backtest.baseRevision} {backtest.workingTreeDirty ? "(working tree changed; source hash identifies evaluated code)" : ""}</dd></div>
        <div><dt>Source SHA-256</dt><dd className="mono break-all">{backtest.sourceHash}</dd></div>
        <div><dt>Observation SHA-256</dt><dd className="mono break-all">{backtest.inputHash}</dd></div>
      </dl></details>
    </section> : !loading && !error ? <p>Evaluation results have not been published yet.</p> : null}
    {backtest ? <section className="rounded-xl border border-[var(--border)] p-5 space-y-3">
      <h2 className="font-semibold">Retrieval grounding checks</h2><p className="text-sm text-[var(--text-muted)]">{backtest.retrieval.note}</p>
      <ul className="space-y-2 text-sm">{backtest.retrieval.checks.map(check => <li key={check.ticker}>{check.ticker}: {check.expected} · relevant passage {check.relevantPassageFound ? "found" : "not found"}; citations {check.allCitationsResolvable ? "resolve" : "failed"}; date cut-off {check.noFutureSources ? "respected" : "failed"}.</li>)}</ul>
      <p className="text-sm">Missing corpus: {backtest.retrieval.missingCorpusAbstains ? "retrieval correctly returns no evidence" : "check failed"}.</p>
    </section> : null}
    {latency ? <section className="rounded-xl border border-[var(--border)] p-5 space-y-3">
      <h2 className="font-semibold">Engine workload benchmark</h2><p className="text-sm text-[var(--text-muted)]">{latency.note}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="text-left mb-2">Batch elapsed milliseconds, {latency.repeats} warmed repetitions per configuration</caption><thead><tr><th className="p-2">Tickers / concurrency</th><th className="p-2">Shared median / p95</th><th className="p-2">Repeated median / p95</th></tr></thead><tbody>{latency.matrix.map(row => <tr key={`${row.tickers}-${row.concurrency}`} className="border-t border-[var(--border)]"><td className="p-2">{row.tickers} / {row.concurrency}</td><td className="p-2">{row.sharedPreparation.medianMs.toFixed(1)} / {row.sharedPreparation.p95Ms.toFixed(1)}</td><td className="p-2">{row.repeatedPreparation.medianMs.toFixed(1)} / {row.repeatedPreparation.p95Ms.toFixed(1)}</td></tr>)}</tbody></table></div>
    </section> : null}
    {history.length ? <section className="rounded-xl border border-[var(--border)] p-5"><h2 className="font-semibold mb-3">Recent decisions on this device</h2><ul className="space-y-2 text-sm">{history.slice(-25).reverse().map((decision, index) => <li key={`${decision.created_at}-${index}`}>{new Date(decision.created_at).toLocaleString()} · {decision.ticker} · {decision.action} · illustrative size {decision.size_pct}%</li>)}</ul>{history.length > 25 ? <p className="mt-3 text-sm">Showing the most recent 25 of {history.length} recorded decisions.</p> : null}</section> : null}
  </div>;
}
