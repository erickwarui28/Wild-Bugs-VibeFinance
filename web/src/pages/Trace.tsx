import type { TraceStep } from "@vibefinance/shared";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchTrace, loadDemo } from "../api";
import { AGENT_COLOR, AGENT_LABEL } from "../components/bits";
import { useStore } from "../store";

export function Trace() {
  const { runId = "" } = useParams();
  const store = useStore();
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const id = runId || store.synthesis?.runId || "";
    if (!id) { setSteps([]); return; }
    let cancelled = false;
    const controller = new AbortController();
    setSteps([]); setLoading(true); setError("");
    void (async () => {
      try {
        if (store.offline) {
          const demo = await loadDemo<{ steps: TraceStep[] }>("trace-infy.json");
          if (!cancelled) setSteps(demo.steps);
          return;
        }
        const result = await fetchTrace(id, controller.signal);
        if (!cancelled) setSteps(result);
      } catch {
        if (!cancelled) setError("This trace is unavailable. Open the trace from a completed analysis.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [runId, store.offline, store.synthesis?.runId]);
  const start = steps.length ? Math.min(...steps.map((s) => Date.parse(s.startedAt))) : 0;
  const end = steps.length ? Math.max(...steps.map((s) => Date.parse(s.endedAt))) : 1;
  const span = Math.max(1, end - start);
  const recommendation = steps.find(item => item.name === "recommendation")?.payload;
  const text = (key: string) => typeof recommendation?.[key] === "string" ? String(recommendation[key]) : "Not recorded in this trace";
  return (
    <div>
      <section className="bento-hero mb-4 rounded-xl border border-[var(--border)] p-5">
        <h1 className="text-xl font-semibold">Analysis trace</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Follow ingestion, parallel agents and synthesis for {runId || store.synthesis?.runId || "the current analysis"}.</p>
        {steps.length ? <p className="mt-2">Total elapsed: {span.toLocaleString()} ms · {steps.length} stages</p> : null}
      </section>
      {steps.length ? <section className="mb-4 rounded-xl border border-[var(--border)] p-5 space-y-3" aria-label="Reasoning overview">
        <h2 className="font-semibold">From evidence to an illustrative decision</h2>
        <p className="text-sm">Instrument: {text("ticker")} · profile: {text("profileId")} · data mode: {text("dataMode")}. Analysis cut-off: {text("asOf")}.</p>
        <p className="text-sm break-words">Captured: {text("capturedAt")} · decision: {text("action")} · classification: {text("label")}.</p>
        <p className="text-sm">Four specialists evaluate momentum, volume/flows, retrieved-document tone and historical risk in parallel. The synthesizer weights available signals by evidence confidence, exposes disagreements, then applies the example investor's risk and concentration rules.</p>
        <p className="text-sm text-[var(--text-muted)]">Signals and risk arithmetic are deterministic. Document tone uses retrieved passages and a financial lexicon. The optional language model returns verified factual sentences; unsupported changes are rejected. This is constrained decision support, not independent investment judgment. Confidence is not a calibrated probability of profit.</p>
        <p className="text-sm text-[var(--text-muted)]">Compare shares one frozen market snapshot across three profiles. Its stored execution trace shows the final profile's personalization; each comparison card displays its own decision.</p>
      </section> : null}
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {!steps.length ? <p role="status" className="text-sm text-[var(--text-muted)]">{loading || store.loading ? "Loading analysis trace…" : error || "No trace is available yet. Run an analysis from the dashboard to inspect its steps."}</p> : null}
        {steps.map((step) => {
          const width = Math.min(100, Math.max(2, (step.latencyMs / span) * 100));
          const left = Math.min(((Date.parse(step.startedAt) - start) / span) * 100, 100 - width);
          return (
            <div key={step.name}>
              <div className="mb-1 flex justify-between text-xs">
                <span>{AGENT_LABEL[step.name] ?? step.name}</span>
                <span className="tabular">{Math.round(step.latencyMs)} ms</span>
              </div>
              <div className="relative h-3 rounded bg-[var(--surface-2)]">
                <div className="absolute top-0 h-3 rounded" style={{ left: `${left}%`, width: `${width}%`, background: AGENT_COLOR[step.name] ?? "var(--brand)" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid items-start gap-3 md:grid-cols-2">
        {steps.map((step) => (
          <details key={`${step.name}-body`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <summary className="cursor-pointer">{AGENT_LABEL[step.name] ?? step.name}</summary>
            <pre className="mono mt-2 max-h-64 overflow-auto text-xs text-[var(--text-muted)]">{JSON.stringify(step.payload, null, 2)}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}
