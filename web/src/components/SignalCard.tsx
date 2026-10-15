import type { AgentOutput } from "@vibefinance/shared";
import { AGENT_COLOR, AGENT_LABEL } from "./bits";
import { CitationChip } from "./CitationChip";
import { ConfidenceBar, DivergingScoreBar, LabelChip, ProvenanceBadge } from "./LabelChip";

export function SignalCard({ agent, reveal }: { agent: AgentOutput; reveal?: boolean }) {
  const insufficient = agent.label === "insufficient_evidence";
  return (
    <article
      className={`rounded-xl border bg-[var(--surface)] p-4 ${reveal ? "animate-[fade_150ms_ease]" : ""} ${insufficient ? "border-dashed border-[var(--insufficient)]" : "border-[var(--border)]"}`}
      style={{ borderTopColor: AGENT_COLOR[agent.agent], borderTopWidth: 3 }}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: AGENT_COLOR[agent.agent] }} />
          {AGENT_LABEL[agent.agent]}
        </div>
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap text-xs text-[var(--text-muted)]">
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">{agent.mode === "llm" ? "LLM verified" : "Rules"}</span>
          <span className="tabular">{agent.latencyMs} ms</span>
          {agent.degraded.length > 0 ? <span className="text-[var(--insufficient)]">Limited evidence / fallback</span> : null}
        </div>
      </header>
      <div className="mb-3 flex items-center justify-between gap-2">
        <LabelChip label={agent.label} />
        <ProvenanceBadge provenance={agent.claims[0]?.citations[0]?.provenance ?? "SYNTHETIC"} />
      </div>
      {insufficient ? null : <DivergingScoreBar score={agent.score} />}
      <div className="mt-3">
        <ConfidenceBar value={agent.confidence} />
      </div>
      <ul className="mt-3 space-y-2 text-sm leading-6">
        {agent.claims.slice(0, 4).map((claim) => (
          <li key={claim.text}>
            {claim.text}{" "}
            {claim.citations.map((c, i) => (
              <CitationChip key={c.type === "doc" ? c.chunkId : `${c.field}-${i}`} citation={c} />
            ))}
          </li>
        ))}
      </ul>
      <details className="mt-3 text-xs text-[var(--text-muted)]">
        <summary>Features and execution details</summary>
        <p className="mono mt-1">{Object.entries(agent.features).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ")}</p>
        {agent.degraded.length ? <p className="mt-2">Recorded limitations: {agent.degraded.join(", ")}</p> : null}
      </details>
    </article>
  );
}

export function SignalSkeleton({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" style={{ borderTop: `3px solid ${AGENT_COLOR[name] ?? "var(--border)"}` }}>
      <div className="mb-2 font-medium">{AGENT_LABEL[name] ?? name}</div>
      <p className="text-xs text-[var(--text-muted)]">running…</p>
      <div className="mt-3 h-16 animate-pulse rounded bg-[var(--surface-2)]" />
    </div>
  );
}
