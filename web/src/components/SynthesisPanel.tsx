import type { Synthesis } from "@vibefinance/shared";
import { Link } from "react-router-dom";
import { CitationChip } from "./CitationChip";
import { LabelChip } from "./LabelChip";
import { GlossaryButton } from "./Glossary";

export function SynthesisPanel({ synthesis }: { synthesis: Synthesis }) {
  const alert = synthesis.personalised.concentrationAlert;
  return (
    <aside className="rounded-xl border border-[var(--brand)]/40 bg-[var(--surface)] p-4 ring-1 ring-white/5 lg:sticky lg:top-20">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Combined call</div>
      <div className="mt-1 text-[28px] font-bold leading-none">
        <LabelChip label={synthesis.compositeLabel} />
      </div>
      <div className="mt-4">
        <div className="mb-1 text-xs font-medium text-[var(--text-muted)]">Why</div>
        <ul className="space-y-2 text-sm leading-6">
          {synthesis.summary.map((claim) => (
            <li key={claim.text}>
              {claim.text}{" "}
              {claim.citations.map((c, i) => (
                <CitationChip key={`${claim.text}-${i}`} citation={c} />
              ))}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-sm tabular"><GlossaryButton term="confidence" label="Evidence confidence" /> {(synthesis.confidence * 100).toFixed(0)}%</p>
      <p className="text-xs text-[var(--text-muted)]">Agreement {(synthesis.agreement * 100).toFixed(0)}%</p>
      {synthesis.disagreements[0] ? (
        <div className="mt-3 rounded-lg border border-[var(--insufficient)]/50 bg-[var(--insufficient)]/10 p-3 text-sm">
          <div className="mb-1 font-medium">Disagreement</div>
          {synthesis.disagreements[0].explanation.text}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-[var(--text-muted)]">Action</div>
          <div className="text-2xl font-semibold uppercase whitespace-nowrap">{synthesis.personalised.action}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-[var(--text-muted)]">Illustrative allocation</div>
          <div className="tabular text-xl">{synthesis.personalised.positionSizePct.toFixed(1)}%</div>
        </div>
      </div>
      {alert?.alert ? (
        <p className="mt-3 rounded-lg border border-[var(--insufficient)] px-2 py-1 text-xs text-[var(--insufficient)]">
          Concentration alert. Sector weight {(alert.sectorPct * 100).toFixed(0)}%. HHI {alert.hhiBefore.toFixed(2)} → {alert.hhiAfter.toFixed(2)}.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-[var(--text-muted)]">The signal label describes shared market evidence; the action applies this example investor's thresholds and risk rules. They need not match.</p>
      <p className="mt-2 text-sm">{synthesis.personalised.rationale[0]?.text}{" "}{synthesis.personalised.rationale[0]?.citations.map((c, i) => <CitationChip key={`action-${i}`} citation={c} />)}</p>
      <p className="mt-3 text-xs text-[var(--text-muted)]">Score {synthesis.compositeScore.toFixed(2)} from confidence-weighted agent scores.</p>
      <Link className="mt-3 inline-block text-sm text-[var(--brand)]" to={`/trace/${synthesis.runId}`}>
        Open trace →
      </Link>
      <p className="mt-3 text-[11px] text-[var(--text-muted)]">{synthesis.disclaimer}</p>
    </aside>
  );
}
