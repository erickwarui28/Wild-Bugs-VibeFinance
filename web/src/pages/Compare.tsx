import type { Synthesis } from "@vibefinance/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { loadDemo, postCompare } from "../api";
import { CitationChip } from "../components/CitationChip";
import { useStore } from "../store";
import { EvidenceCoveragePanel } from "../components/EvidenceCoveragePanel";

export function Compare() {
  const store = useStore();
  const [rows, setRows] = useState<Synthesis[] | null>(null);
  const [runId, setRunId] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const lastAutoInput = useRef("");
  const active = useRef<AbortController | null>(null);
  const { ticker, degrade, mode, offline, loading } = store;

  const go = useCallback(async (refresh = true) => {
    const id = ++requestId.current;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true);
    try {
      if (offline) {
        if (mode === "live") {
          toast("Live data needs the API.");
          return;
        }
        const demo = await loadDemo<{ runId: string; results: Synthesis[] }>("compare-infy.json");
        if (id !== requestId.current) return;
        setRunId(demo.runId);
        setRows(demo.results);
        return;
      }
      const result = await postCompare(ticker, degrade, mode, { signal: controller.signal, refresh });
      if (id !== requestId.current) return;
      setRunId(result.runId);
      setRows(result.results);
    } catch (err) {
      if (id === requestId.current && !controller.signal.aborted) toast(err instanceof Error ? err.message : "Compare failed");
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [ticker, degrade, mode, offline]);

  useEffect(() => {
    if (loading) return;
    const input = JSON.stringify([ticker, degrade, mode, offline]);
    if (input === lastAutoInput.current) return;
    // Defer until after mount so StrictMode's effect replay cannot send two runs.
    const timer = setTimeout(() => {
      lastAutoInput.current = input;
      setRows(null);
      setRunId("");
      void go(false);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [loading, ticker, degrade, mode, offline, go]);

  useEffect(() => () => { requestId.current += 1; active.current?.abort(); }, [ticker, degrade, mode, offline]);

  const actions = rows?.map((r) => r.personalised.action) ?? [];
  const sizes = rows?.map((r) => r.personalised.positionSizePct) ?? [];
  return (
    <div>
      <div className="bento-hero mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-5">
        <div>
          <h1 className="text-xl font-semibold">Same input, three investors</h1>
          {runId ? <p className="mono mt-1 text-xs text-[var(--text-muted)]">Same snapshot · runId {runId} · {store.ticker}</p> : null}
          {rows?.[0]?.agentCache?.hit ? <p className="mt-1 text-xs text-[var(--text-muted)]">Reused matching agent evidence; personalisation recalculated for each investor. Compare again to refresh agents.</p> : null}
          {rows ? (
            <p className="mt-1 text-sm">{new Set(actions).size === 1 ? `All three profiles receive ${actions[0]?.toUpperCase()}` : `${new Set(actions).size} different actions`} · suggested allocation {Math.min(...sizes).toFixed(1)}% to {Math.max(...sizes).toFixed(1)}%. Concentration constraints can override risk appetite.</p>
          ) : null}
        </div>
        <button className="rounded-lg bg-[var(--brand-fill)] px-4 py-2 text-white" disabled={busy || loading} onClick={() => void go()}>{busy || loading ? "Running…" : "Compare"}</button>
      </div>
      {busy || loading ? <p role="status" className="mb-4 text-sm text-[var(--text-muted)]">Comparing the same input for all three investors…</p> : null}
      {rows?.[0]?<div className="mb-4"><EvidenceCoveragePanel synthesis={rows[0]} /></div>:null}
      <div className="grid gap-3 md:grid-cols-3">
        {(rows ?? []).map((row) => (
          <article key={row.profileId} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-sm text-[var(--text-muted)]">{({ conservative: "Asha · Conservative", moderate: "Rohan · Moderate", aggressive: "Meera · Aggressive" } as Record<string, string>)[row.profileId] ?? row.profileId}</div>
            <div className="mt-2 text-3xl font-bold uppercase">{row.personalised.action}</div>
            <p className="mt-2 text-sm leading-6">
              {row.personalised.rationale[0]?.text}{" "}
              {row.personalised.rationale[0]?.citations.map((c, i) => <CitationChip key={i} citation={c} />)}
            </p>
            <div className="mt-3 h-2 rounded-full bg-[var(--surface-2)]">
              <div className="h-2 rounded-full bg-[var(--personal)]" style={{ width: `${(row.personalised.positionSizePct / 25) * 100}%` }} />
            </div>
            <p className="mt-1 text-xs tabular">Illustrative allocation {row.personalised.positionSizePct.toFixed(1)}% · not a trade instruction</p>
            {row.personalised.concentrationAlert?.alert ? <p className="mt-2 text-xs text-[var(--insufficient)]">Concentration alert</p> : null}
            {row.personalised.behaviourNudges[0] ? <p className="mt-2 text-xs text-[var(--text-muted)]">{row.personalised.behaviourNudges[0].text}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
