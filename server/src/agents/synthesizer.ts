import type { AgentOutput, Claim, Label, Provenance } from "@vibefinance/shared";
import { AGENT_WEIGHTS } from "@vibefinance/shared";
import { clamp, mean } from "../math.js";
import { claim, dataCite, labelFromScore } from "./common.js";

export interface Aggregate {
  compositeScore: number;
  compositeLabel: Label;
  agreement: number;
  confidence: number;
  rawConfidence: number;
  calibratedConfidence: number | null;
  uncertainty: number | null;
  weights: Record<string, number>;
  rows: { agent: string; w: number; conf: number; effW: number; score: number; contrib: number; excluded: boolean }[];
  disagreements: { agents: string[]; explanation: Claim }[];
  summary: Claim[];
}

function weightedStd(values: number[], weights: number[]): number {
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0 || values.length === 0) return 0;
  const m = values.reduce((s, v, i) => s + v * (weights[i] ?? 0), 0) / wsum;
  const variance = values.reduce((s, v, i) => s + (weights[i] ?? 0) * (v - m) ** 2, 0) / wsum;
  return Math.sqrt(variance);
}

export function aggregate(agents: AgentOutput[], asOf: string, provenance: Provenance, learnedWeights?: Partial<typeof AGENT_WEIGHTS>): Aggregate {
  const weights = { ...AGENT_WEIGHTS, ...learnedWeights };
  const rows = agents.map((agent) => {
    const excluded = agent.label === "insufficient_evidence";
    const w = weights[agent.agent];
    const effW = excluded ? 0 : w * agent.confidence;
    return { agent: agent.agent, w, conf: agent.confidence, effW, score: agent.score, contrib: effW * agent.score, excluded };
  });
  const effSum = rows.reduce((s, r) => s + r.effW, 0);
  const compositeScore = effSum === 0 ? 0 : rows.reduce((s, r) => s + r.contrib, 0) / effSum;
  const compositeLabel: Label = effSum < 0.25 ? "insufficient_evidence" : labelFromScore(compositeScore);
  const active = rows.filter((r) => !r.excluded);
  const agreement = clamp(1 - weightedStd(active.map((r) => r.score), active.map((r) => r.effW)), 0, 1);
  const coverage = active.length / 4;
  const confMean = effSum === 0 ? 0 : active.reduce((s, r) => s + r.conf * r.effW, 0) / effSum;
  const rawConfidence = clamp(confMean * (0.5 + 0.5 * agreement) * coverage, 0, 0.95);
  // Legacy bins describe P(return > 0), not evidence confidence. Never apply
  // them here, including on Live data. Preserve stored history without using it.
  const calibratedConfidence = null;
  const uncertainty = null;
  const confidence = rawConfidence;
  const disagreements = findDisagreements(agents, asOf, provenance);
  const summary = buildSummary(agents, compositeLabel, compositeScore, asOf, provenance, disagreements);
  return {
    compositeScore,
    compositeLabel,
    agreement,
    confidence,
    rawConfidence,
    calibratedConfidence,
    uncertainty,
    weights,
    rows,
    disagreements,
    summary,
  };
}

function findDisagreements(agents: AgentOutput[], asOf: string, provenance: Provenance) {
  const out: Aggregate["disagreements"] = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      if (!a || !b) continue;
      if (Math.sign(a.score) === 0 || Math.sign(b.score) === 0) continue;
      if (Math.sign(a.score) === Math.sign(b.score)) continue;
      if (Math.abs(a.score) <= 0.3 || Math.abs(b.score) <= 0.3) continue;
      const bull = a.score > 0 ? a : b;
      const bear = a.score > 0 ? b : a;
      const citations = [
        dataCite({ source: "derived", field: `${bull.agent}.score`, asOf, value: bull.score, provenance, origin: "orchestrator" }),
        dataCite({ source: "derived", field: `${bear.agent}.score`, asOf, value: bear.score, provenance, origin: "orchestrator" }),
      ];
      if (citations.length === 0) {
        citations.push(dataCite({ source: "derived", field: "disagreement", asOf, value: 1, provenance, origin: "synthetic" }));
      }
      const text = `${title(bull.agent)} is ${bull.label} (score ${bull.score.toFixed(2)}) while ${title(bear.agent)} is ${bear.label} (score ${bear.score.toFixed(2)}). Composite confidence is reduced while those signals conflict.`;
      out.push({ agents: [bull.agent, bear.agent], explanation: claim(text, citations) });
    }
  }
  return out;
}

function title(agent: string): string {
  if (agent === "volume") return "Volume and flows";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

function buildSummary(
  agents: AgentOutput[],
  label: Label,
  score: number,
  asOf: string,
  provenance: Provenance,
  disagreements: Aggregate["disagreements"],
): Claim[] {
  const sent = agents.find((a) => a.agent === "sentiment");
  const cites = [dataCite({ source: "derived", field: "compositeScore", asOf, value: score, provenance, origin: "confidence-weighted-agent-scores" })];
  if (cites.length === 0) {
    cites.push(dataCite({ source: "derived", field: "composite", asOf, value: score, provenance, origin: "synthetic" }));
  }
  const call = label === "bullish" ? "leans positive" : label === "bearish" ? "leans negative" : label === "insufficient_evidence" ? "does not have enough evidence" : "is mixed";
  const lines: Claim[] = [
    claim(`The combined read ${call} (score ${score.toFixed(2)}).`, cites),
  ];
  if (disagreements[0]) {
    lines.push(claim(`Not every agent agrees. ${disagreements[0].explanation.text}`, disagreements[0].explanation.citations));
  } else if (sent?.label === "insufficient_evidence") {
    lines.push(claim("Usable dated document evidence is missing, so the call does not lean on a document.", sent.claims[0]?.citations ?? cites));
  } else {
    lines.push(claim("No strong opposing signals were detected by the configured disagreement thresholds.", agents.map((agent) => dataCite({ source: "derived", field: `${agent.agent}.score`, asOf, value: agent.score, provenance, origin: "orchestrator" }))));
  }
  const actionHint =
    score > 0.15 ? "A higher-risk investor might add a small amount." : "There is not a strong case to add aggressively.";
  lines.push(claim(actionHint, cites));
  return lines.slice(0, 3);
}

export function meanNumber(xs: number[]): number {
  return mean(xs);
}
