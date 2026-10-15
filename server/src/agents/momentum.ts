import type { AgentOutput } from "@vibefinance/shared";
import { LlmClaimDraft } from "@vibefinance/shared";
import { clamp, tanh } from "../math.js";
import { macdHistSign, returnOver, rollingReturns, rsi, sma, zscoreLast } from "../indicators.js";
import { generateJSON } from "../llm/json.js";
import { claim, confidenceFor, dataCite, fmtNum, fmtPct, labelFromScore } from "./common.js";
import type { AgentContext } from "./types.js";
import { cancellableDelay } from "../reliability.js";

export async function runMomentum(ctx: AgentContext): Promise<AgentOutput> {
  const t0 = Date.now();
  await pause(40, ctx);
  const closes = ctx.market.bars.map((b) => b.close);
  const last = closes[closes.length - 1] ?? 0;
  const sma20 = sma(closes, 20) ?? last;
  const sma50 = sma(closes, 50) ?? last;
  const rsi14 = rsi(closes) ?? 50;
  const ret20 = returnOver(closes, 20) ?? 0;
  const retSeries = rollingReturns(closes, 20);
  const z = zscoreLast(retSeries) ?? 0;
  const macd = macdHistSign(closes);
  const cross = Math.sign(sma20 - sma50);
  const score = clamp(tanh(0.5 * z + 0.3 * cross + 0.2 * ((rsi14 - 50) / 20)), -1, 1);
  const citations = [
    dataCite({ source: "ohlcv", field: "ret20", asOf: ctx.asOf, value: ret20, provenance: ctx.market.provenance, origin: originFor(ctx) }),
    dataCite({ source: "derived", field: "rsi14", asOf: ctx.asOf, value: rsi14, provenance: ctx.market.provenance, origin: originFor(ctx) }),
    dataCite({ source: "ohlcv", field: "close", asOf: ctx.asOf, value: last, provenance: ctx.market.provenance, origin: originFor(ctx) }),
    dataCite({ source: "derived", field: "sma20", asOf: ctx.asOf, value: sma20, provenance: ctx.market.provenance, origin: originFor(ctx) }),
    dataCite({ source: "derived", field: "sma50", asOf: ctx.asOf, value: sma50, provenance: ctx.market.provenance, origin: originFor(ctx) }),
  ];
  const lines = [
    `The 20-day return is ${fmtPct(ret20)} and RSI is ${fmtNum(rsi14, 0)}.`,
    sma20 >= sma50
      ? `The 20-day average (${fmtNum(sma20, 1)}) is above the 50-day average (${fmtNum(sma50, 1)}).`
      : `The 20-day average (${fmtNum(sma20, 1)}) is below the 50-day average (${fmtNum(sma50, 1)}).`,
  ];
  const generated = await speak(ctx, lines, citations, [[0, 1], [3, 4]]);
  const claims = mapClaims(generated.data, citations, lines[0] ?? "Momentum computed from price.");
  return {
    agent: "momentum",
    ticker: ctx.ticker,
    asOf: ctx.asOf,
    label: labelFromScore(score),
    score,
    confidence: confidenceFor(score, ctx.dataQuality),
    claims,
    features: { ret20, rsi14, sma20, sma50, macd, zRet20: z },
    degraded: generated.degraded,
    latencyMs: Date.now() - t0,
    mode: generated.mode === "llm" ? "llm" : "mock",
  };
}

export function originFor(ctx: AgentContext): string {
  if (ctx.market.provenance === "SYNTHETIC") return "synthetic";
  return `yahoo:${ctx.ticker}.NS`;
}

export async function pause(ms: number, ctx: AgentContext, slow = false): Promise<void> {
  ctx.signal?.throwIfAborted();
  if (!slow && (process.env.VF_FAST === "1" || ctx.degrade.includes("backtest"))) return;
  await cancellableDelay(ms, ctx.signal);
}

export async function speak(ctx: AgentContext, lines: string[], citations: import("@vibefinance/shared").Citation[], evidenceGroups: number[][]) {
  const { getConfig } = await import("../config.js");
  const grounded = { claims: lines.map((text, i) => ({ text, citationIdx: evidenceGroups[i] ?? [] })) };
  ctx.signal?.throwIfAborted();
  const generated = await generateJSON(LlmClaimDraft,
    `Return these verified factual sentences unchanged with their specified citationIdx. Do not add, paraphrase, omit or infer facts.\n${JSON.stringify(grounded)}\nEvidence:\n${JSON.stringify(citations)}`, {
    timeoutMs: getConfig().AGENT_TIMEOUT_MS,
    mock: grounded,
    forceMock: ctx.forceMock,
    expectedMock: ctx.forceMock && !ctx.degrade.includes("llmDown"),
    signal: ctx.signal,
  });
  // Numeric agent facts must stay tied to their deterministic measurements.
  // An LLM's structurally valid JSON alone cannot establish semantic support.
  const valid = generated.data.claims.length === grounded.claims.length && generated.data.claims.every((item, i) =>
    item.text === grounded.claims[i]?.text && JSON.stringify(item.citationIdx) === JSON.stringify(grounded.claims[i]?.citationIdx));
  return valid ? generated : { ...generated, data: grounded, mode: "mock" as const, degraded: [...new Set([...generated.degraded, "llm_fallback", "unsupported_claim_rejected"])] };
}

export function mapClaims(
  draft: { claims: { text: string; citationIdx: number[] }[] },
  citations: import("@vibefinance/shared").Citation[],
  _fallback: string,
) {
  const claims = [];
  for (const item of draft.claims) {
    const picked = item.citationIdx.map((i) => citations[i]).filter((c): c is NonNullable<typeof c> => Boolean(c));
    const used = picked;
    if (used.length === 0 || !item.text.trim()) continue;
    claims.push(claim(item.text.trim(), used));
  }
  return claims;
}
