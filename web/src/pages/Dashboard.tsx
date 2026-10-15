import { useEffect, useRef, useState } from "react";
import { TICKERS } from "@vibefinance/shared";
import { Link } from "react-router-dom";
import { MetricsPanel, PortfolioTable } from "../components/PortfolioTable";
import { PriceChart } from "../components/PriceChart";
import { SignalCard, SignalSkeleton } from "../components/SignalCard";
import { SynthesisPanel } from "../components/SynthesisPanel";
import { LabelChip } from "../components/LabelChip";
import { useStore } from "../store";
import { saveResearch } from "../research";
import { toast } from "sonner";
import { EvidenceCoveragePanel } from "../components/EvidenceCoveragePanel";

export function Dashboard() {
  const store = useStore();
  const [saved, setSaved] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem("vf-watchlist") ?? "[]"); return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string" && (TICKERS as readonly string[]).includes(t)) : []; }
    catch { return []; }
  });
  function toggleSaved(ticker: string) {
    const next = saved.includes(ticker) ? saved.filter((t) => t !== ticker) : [...saved, ticker];
    setSaved(next);
    localStorage.setItem("vf-watchlist", JSON.stringify(next));
  }
  const lastInput = useRef("");
  const runRef = useRef(store.run);
  runRef.current = store.run;
  const cancelRef = useRef(store.cancelRun); cancelRef.current = store.cancelRun;
  useEffect(() => () => cancelRef.current(), []);
  useEffect(() => {
    if (!store.ready) return;
    const key = JSON.stringify([store.ticker, store.profileId, store.mode, store.degrade]);
    if (lastInput.current === key) return;
    if (store.synthesis?.ticker === store.ticker && store.synthesis.profileId === store.profileId) {
      lastInput.current = key;
      return;
    }
    const timer = setTimeout(() => { lastInput.current = key; void runRef.current(); }, 200);
    return () => clearTimeout(timer);
  }, [store.ready, store.ticker, store.profileId, store.mode, store.degrade, store.synthesis]);
  const profile = store.profiles.find((p) => p.id === store.profileId);
  const synthesis = store.synthesis?.ticker === store.ticker && store.synthesis.profileId === store.profileId ? store.synthesis : null;
  return (
    <div className="dashboard-bento space-y-4">
      <section className="bento-hero rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h1 className="max-w-3xl text-2xl font-semibold leading-snug">{store.ticker} research · {profile?.name ?? store.profileId}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Four specialist views, cited evidence and an illustrative risk-profile comparison.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-[var(--brand-fill)] px-4 py-2 font-medium text-white disabled:opacity-60"
            disabled={store.loading}
            onClick={() => void store.run({ refresh: true })}
          >
            {store.loading ? "Running…" : `${store.mode === "demo" ? "Run demo" : "Analyze"}: ${store.ticker} · ${store.profileId}`}
          </button>
          <Link className="rounded-lg border border-[var(--border)] px-4 py-2" to="/compare">Compare 3 investors</Link>
          {synthesis ? <button className="rounded-lg border border-[var(--border)] px-4 py-2" onClick={() => {
            try { saveResearch(synthesis); toast("Saved to your device's research journal."); }
            catch { toast("Could not save. Device storage may be unavailable or full."); }
          }}>Save research note</button> : null}
        </div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">Runs keyless · provenance on every chip · Not financial advice</p>
        {synthesis ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Analysis cut-off {synthesis.asOf} · {synthesis.agents.length} agents · mode {synthesis.dataMode}
            {synthesis.agentCache?.hit ? " · reused matching agent evidence" : ""}
          </p>
        ) : null}
      </section>
      {!synthesis && !store.loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {["momentum", "volume", "sentiment", "risk"].map((name) => (
            <div key={name} className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
              {name === "momentum" ? "Momentum: trend from the 20/50-day average and RSI" : name === "volume" ? "Volume & Flows: unusual volume and FII/DII" : name === "sentiment" ? "Sentiment: filings retrieved and cited" : "Risk: volatility, drawdown and beta"}
            </div>
          ))}
        </div>
      ) : null}
      {store.loading && synthesis ? <p role="status" className="text-sm text-[var(--text-muted)]">Refreshing analysis… The last completed result remains visible.</p> : null}
      {store.loading && !synthesis ? (
        <div className="grid gap-3 md:grid-cols-2">
          {["momentum", "volume", "sentiment", "risk"].map((name) => (
            <SignalSkeleton key={name} name={name} />
          ))}
        </div>
      ) : null}
      {synthesis ? (
        <div className="bento-layout">
          <div className="bento-column bento-summary">
            <SynthesisPanel synthesis={synthesis} />
            <MetricsPanel metrics={store.metrics} />
          </div>
          <div className="bento-column bento-main">
            <PriceChart ticker={synthesis.ticker} asOf={synthesis.asOf} snapshotId={synthesis.snapshotId} />
            <EvidenceCoveragePanel synthesis={synthesis} />
            <div className="bento-signals">
              {synthesis.agents.map((agent) => (
                <SignalCard key={agent.agent} agent={agent} reveal />
              ))}
            </div>
          </div>
          <div className="bento-column bento-sidebar">
          <div className="bento-watchlist rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <h2 className="mb-2 text-sm text-[var(--text-muted)]">Watchlist</h2>
            <p className="mb-2 text-xs text-[var(--text-muted)]">Star stocks to pin them here. Saved only on this device.</p>
            {[...store.tickers].sort((a, b) => Number(saved.includes(b.ticker)) - Number(saved.includes(a.ticker))).map((t) => (
              <div key={t.ticker} className="flex items-center gap-1">
              <button key={t.ticker} aria-pressed={synthesis.ticker === t.ticker} disabled={store.loading} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left disabled:opacity-60" onClick={() => store.setTicker(t.ticker)}>
                <span>{t.ticker}</span>
                {synthesis.ticker === t.ticker ? <LabelChip label={synthesis.compositeLabel} /> : <span className="text-xs text-[var(--text-muted)]">{t.sector}</span>}
              </button>
              <button className="shrink-0 rounded-md p-2 text-[var(--brand)]" aria-label={`${saved.includes(t.ticker) ? "Unpin" : "Pin"} ${t.ticker}`} aria-pressed={saved.includes(t.ticker)} onClick={() => toggleSaved(t.ticker)}>{saved.includes(t.ticker) ? "★" : "☆"}</button>
              </div>
            ))}
          </div>
          <PortfolioTable profile={profile} synthesis={synthesis} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
