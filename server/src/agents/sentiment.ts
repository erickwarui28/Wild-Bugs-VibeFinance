import type { AgentOutput } from "@vibefinance/shared";
import { clamp } from "../math.js";
import { keywordBoost, lexiconScore } from "../rag/lexicon.js";
import { confidenceFor, dataCite, docCite, labelFromScore } from "./common.js";
import { mapClaims, pause, speak } from "./momentum.js";
import type { AgentContext } from "./types.js";

export async function runSentiment(ctx: AgentContext): Promise<AgentOutput> {
  const t0 = Date.now();
  const slow = ctx.degrade.includes("slowAgent");
  await pause(slow ? 9000 : 110, ctx, slow);
  const hits = ctx.hits;
  if (hits.length === 0) {
    const cite = dataCite({
      source: "derived",
      field: "datedDocumentChunks.count",
      asOf: ctx.asOf,
      value: 0,
      provenance: ctx.market.provenance,
      origin: "source-coverage",
    });
    return {
      agent: "sentiment",
      ticker: ctx.ticker,
      asOf: ctx.asOf,
      label: "insufficient_evidence",
      score: 0,
      confidence: confidenceFor(0, 0.6),
      claims: [{ text: "Insufficient evidence for this dimension.", citations: [cite] }],
      features: { chunks: 0 },
      degraded: ctx.degrade.includes("missingFiling") ? ["missing_filing"] : [],
      latencyMs: Date.now() - t0,
      mode: "rule",
    };
  }
  let num = 0;
  let den = 0;
  hits.forEach((hit, idx) => {
    const ageDays = Math.max(0, (Date.parse(ctx.asOf) - Date.parse(hit.date)) / 86_400_000);
    const recency = Math.exp(-ageDays / 90);
    const weight = (hit.score + keywordBoost(hit.snippet)) * recency * (1 - idx * 0.05);
    num += lexiconScore(hit.snippet) * weight;
    den += weight;
  });
  let score = den === 0 ? 0 : clamp(num / den, -1, 1);
  if (hits.some((h) => /guidance cut/i.test(`${h.title} ${h.snippet}`))) score = Math.min(score, -0.5);
  if (hits.some((h) => /strong-results/i.test(`${h.title} ${h.snippet}`))) score = Math.max(score, 0.45);
  if (ctx.degrade.includes("conflictingAgents")) {
    score = -score;
    if (Math.abs(score) < 0.35) score = score < 0 ? -0.55 : 0.55;
  }
  const quality = hits.length < 2 ? 0.6 : ctx.dataQuality;
  const citations = hits.map(docCite);
  const top = hits[0];
  const tone = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "mixed";
  const lines = [
    `Filings retrieved for ${ctx.ticker} read ${tone}. The closest passage is from ${top?.title ?? "a filing"}.`,
    hits.some((h) => /guidance cut/i.test(h.snippet))
      ? "A retrieved passage mentions a guidance cut."
      : "No guidance cut is in the retrieved passages.",
  ];
  const cutIndices = hits.flatMap((hit, i) => /guidance cut/i.test(hit.snippet) ? [i] : []);
  const generated = await speak(ctx, lines, citations, [citations.map((_, i) => i), cutIndices.length ? cutIndices : citations.map((_, i) => i)]);
  const claims = mapClaims(generated.data, citations, lines[0] ?? "Filings retrieved.");
  return {
    agent: "sentiment",
    ticker: ctx.ticker,
    asOf: ctx.asOf,
    label: labelFromScore(score),
    score,
    confidence: confidenceFor(score, quality),
    claims,
    features: { chunks: hits.length, lexicon: score },
    degraded: generated.degraded,
    latencyMs: Date.now() - t0,
    mode: generated.mode === "llm" ? "llm" : "mock",
  };
}
