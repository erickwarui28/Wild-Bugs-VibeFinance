import type { Label } from "@vibefinance/shared";

export const AGENT_COLOR: Record<string, string> = {
  momentum: "var(--momentum)",
  volume: "var(--volume)",
  sentiment: "var(--sentiment)",
  risk: "var(--risk)",
  synthesizer: "var(--synth)",
  personaliser: "var(--personal)",
  ingest: "var(--text-muted)",
  "citation-enforcer": "var(--insufficient)",
  recommendation: "var(--brand)",
};

export const AGENT_LABEL: Record<string, string> = {
  momentum: "Momentum",
  volume: "Volume & Flows",
  sentiment: "Sentiment",
  risk: "Risk",
  synthesizer: "Synthesizer",
  personaliser: "Personaliser",
  ingest: "Ingest",
  "citation-enforcer": "Citation enforcer",
  recommendation: "Recommendation",
};

export function labelView(label: Label): { icon: string; text: string; color: string } {
  if (label === "bullish") return { icon: "▲", text: "Bullish", color: "var(--bull)" };
  if (label === "bearish") return { icon: "▼", text: "Bearish", color: "var(--bear)" };
  if (label === "insufficient_evidence") return { icon: "⚠", text: "Insufficient evidence", color: "var(--insufficient)" };
  return { icon: "●", text: "Neutral", color: "var(--neutral)" };
}

export function fmt(n: number, digits = 1): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
