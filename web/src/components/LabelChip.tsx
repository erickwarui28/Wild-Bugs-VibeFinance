import type { Label } from "@vibefinance/shared";
import { labelView } from "./bits";

export function LabelChip({ label }: { label: Label }) {
  const view = labelView(label);
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ borderColor: view.color, color: view.color }}>
      <span aria-hidden>{view.icon}</span>
      {view.text}
    </span>
  );
}

export function ConfidenceBar({ value, raw, calibrated }: { value: number; raw?: number | null; calibrated?: number | null }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-[var(--text-muted)]">
        <span title="Coverage and agreement indicator, not the probability of a price increase.">Evidence confidence</span>
        <span className="tabular">
          {raw != null && calibrated != null ? `raw ${(raw * 100).toFixed(0)}% → cal ${(calibrated * 100).toFixed(0)}%` : `${(value * 100).toFixed(0)}%`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--surface-2)]">
        <div className="h-1.5 rounded-full bg-[var(--brand)]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

export function DivergingScoreBar({ score }: { score: number }) {
  const width = Math.min(50, Math.abs(score) * 50);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 flex-1 rounded-full bg-[var(--surface-2)]">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[var(--border)]" />
        <div
          className="absolute top-0 h-2 rounded-full"
          style={{
            width: `${width}%`,
            background: score >= 0 ? "var(--bull)" : "var(--bear)",
            left: score >= 0 ? "50%" : `${50 - width}%`,
          }}
        />
      </div>
      <span className="tabular w-12 text-right text-xs">{score.toFixed(2)}</span>
    </div>
  );
}

export function ProvenanceBadge({ provenance, dotOnly = false }: { provenance: string; dotOnly?: boolean }) {
  const color = provenance === "LIVE" ? "var(--bull)" : provenance === "CACHED" ? "var(--doc)" : "var(--insufficient)";
  if (dotOnly) {
    return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} role="img" aria-label={provenance === "SYNTHETIC" ? "Demo (synthetic data)" : provenance} title={provenance === "SYNTHETIC" ? "Demo (synthetic data)" : provenance} />;
  }
  return (
    <span className="rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide" style={{ color, borderColor: color }}>
      {provenance}
    </span>
  );
}
