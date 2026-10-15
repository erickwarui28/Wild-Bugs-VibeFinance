import type { AgentOutput } from "@vibefinance/shared";
import { sectorOf } from "../db/db.js";
import { mean, stdev, tanh } from "../math.js";
import { sumLast } from "../indicators.js";
import { confidenceFor, dataCite, fmtNum, labelFromScore } from "./common.js";
import { mapClaims, originFor, pause, speak } from "./momentum.js";
import type { AgentContext } from "./types.js";

export async function runVolume(ctx: AgentContext): Promise<AgentOutput> {
  const t0 = Date.now();
  await pause(70, ctx);
  const bars = ctx.market.bars;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const dayRet = last && prev && prev.close !== 0 ? last.close / prev.close - 1 : 0;
  const logs = bars.map((b) => Math.log(Math.max(1, b.volume)));
  const prior = logs.slice(-21, -1);
  const lastLog = logs[logs.length - 1] ?? 0;
  const sd = stdev(prior);
  const z = sd === 0 ? 0 : (lastLog - mean(prior)) / sd;
  const volScore = Math.abs(z) > 2 ? Math.sign(dayRet || (z > 0 ? 1 : -1)) * Math.min(1, (Math.abs(z) - 2) / 3) : 0;
  const sector = sectorOf(ctx.ticker);
  const sectorFlows = ctx.market.flows.filter((f) => f.scope === "sector" && f.sector === sector);
  const marketFlows = ctx.market.flows.filter((f) => f.scope === "market");
  const fii = sectorFlows.map((f) => f.fiiNet);
  const fii5 = sumLast(fii, 5) ?? 0;
  const dii5 = sumLast(sectorFlows.map((f) => f.diiNet), 5) ?? 0;
  const windows: number[] = [];
  for (let i = 5; i <= fii.length; i++) windows.push(fii.slice(i - 5, i).reduce((a, b) => a + b, 0));
  const trail = windows.slice(-60, -1);
  const fiiZ5 = stdev(trail) === 0 ? 0 : (fii5 - mean(trail)) / (stdev(trail) || 1);
  const flowScore = tanh(fiiZ5 / 2);
  const score = clampScore(0.7 * volScore + 0.3 * flowScore);
  const sectorProv = sectorFlows[sectorFlows.length - 1]?.provenance ?? "SYNTHETIC";
  const sectorOrigin = sectorFlows[sectorFlows.length - 1]?.origin ?? "synthetic";
  const citations = [
    dataCite({
      source: "volume",
      field: "volumeZ20",
      asOf: ctx.asOf,
      value: z,
      provenance: ctx.market.provenance,
      origin: originFor(ctx),
    }),
    dataCite({
      source: sectorFlows.length ? "flows" : "derived",
      field: sectorFlows.length ? `fii5.${sector}` : "sectorFlows.count",
      asOf: ctx.asOf,
      value: fii5,
      provenance: sectorFlows.length ? sectorProv : ctx.market.provenance,
      origin: sectorFlows.length ? sectorOrigin : "source-coverage",
    }),
  ];
  const market5 = sumLast(marketFlows.map((f) => f.fiiNet), 5);
  if (market5 != null && marketFlows.length > 0) {
    const sample = marketFlows[marketFlows.length - 1];
    citations.push(
      dataCite({
        source: "flows",
        field: "fii5.market",
        asOf: ctx.asOf,
        value: market5,
        provenance: sample?.provenance ?? "CACHED",
        origin: sample?.origin ?? "nse:fii_dii.csv",
        fetchedAt: sample?.fetchedAt ?? null,
      }),
    );
  }
  const lines = [
    Math.abs(z) > 2.5
      ? `Volume is unusual (z ${fmtNum(z, 2)} versus the prior 20 days).`
      : `Volume is inside its recent range (z ${fmtNum(z, 2)}).`,
    sectorFlows.length ? `Five-day ${sector} FII net flow is ${fmtNum(fii5, 0)} crore. That series is ${sectorProv === "SYNTHETIC" ? "synthetic" : sectorProv.toLowerCase()}.` : `Sector-level ${sector} FII flow data is unavailable; missing data is not a zero flow.`,
  ];
  if (market5 != null && marketFlows.length > 0) lines.push(`Market-wide FII net over five days is ${fmtNum(market5, 0)} crore.`);
  const generated = await speak(ctx, lines, citations, [[0], [1], [2]]);
  const claims = mapClaims(generated.data, citations, lines[0] ?? "Volume computed.");
  return {
    agent: "volume",
    ticker: ctx.ticker,
    asOf: ctx.asOf,
    label: labelFromScore(score),
    score,
    confidence: confidenceFor(score, ctx.dataQuality),
    claims,
    features: { volumeZ: z, volScore, fii5, dii5, fiiZ5, flowScore, ...(market5 != null ? { fiiMarket5: market5 } : {}) },
    degraded: generated.degraded,
    latencyMs: Date.now() - t0,
    mode: generated.mode === "llm" ? "llm" : "mock",
  };
}

function clampScore(n: number): number {
  return Math.max(-1, Math.min(1, n));
}
