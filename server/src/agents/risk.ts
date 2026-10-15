import type { AgentOutput } from "@vibefinance/shared";
import { beta, dailyReturns, maxDrawdown, realisedVol } from "../indicators.js";
import { clamp } from "../math.js";
import { confidenceFor, dataCite, fmtPct, labelFromScore } from "./common.js";
import { mapClaims, originFor, pause, speak } from "./momentum.js";
import type { AgentContext } from "./types.js";

export async function runRisk(ctx: AgentContext): Promise<AgentOutput> {
  const t0 = Date.now();
  await pause(50, ctx);
  const closes = ctx.market.bars.map((b) => b.close);
  const vol = realisedVol(closes) ?? 0.25;
  const dd = maxDrawdown(closes.slice(-60)) ?? 0;
  const stockRets = dailyReturns(closes).slice(-60);
  const b = beta(stockRets, ctx.market.indexReturns.slice(-60)) ?? 1;
  const inner = clamp((vol - 0.25) / 0.25, -1, 1);
  const score = clamp(-inner, -1, 1);
  const citations = [
    dataCite({ source: "derived", field: "vol20", asOf: ctx.asOf, value: vol, provenance: ctx.market.provenance, origin: originFor(ctx) }),
    dataCite({ source: "derived", field: "maxDrawdown60", asOf: ctx.asOf, value: dd, provenance: ctx.market.provenance, origin: originFor(ctx) }),
    dataCite({ source: "derived", field: "beta60", asOf: ctx.asOf, value: b, provenance: ctx.market.provenance, origin: originFor(ctx) }),
  ];
  const lines = [
    `Annualised 20-day volatility is ${fmtPct(vol)}.`,
    `The 60-day drawdown is ${fmtPct(dd)} and beta versus the equal-weight basket is ${b.toFixed(2)}.`,
  ];
  const generated = await speak(ctx, lines, citations, [[0], [1, 2]]);
  const claims = mapClaims(generated.data, citations, lines[0] ?? "Risk computed.");
  return {
    agent: "risk",
    ticker: ctx.ticker,
    asOf: ctx.asOf,
    label: labelFromScore(score),
    score,
    confidence: confidenceFor(score, ctx.dataQuality),
    claims,
    features: { vol20: vol, maxDrawdown60: dd, beta60: b },
    degraded: generated.degraded,
    latencyMs: Date.now() - t0,
    mode: generated.mode === "llm" ? "llm" : "mock",
  };
}
