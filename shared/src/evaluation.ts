import { z } from "zod";
const metric = z.number().finite().nullable();
export const EvaluationReport = z.object({
  version: z.literal(2), generatedAt: z.string().datetime(), baseRevision: z.string(), sourceHash: z.string(),
  workingTreeDirty: z.boolean(), seed: z.number(), provider: z.literal("mock"), dataMode: z.literal("synthetic"),
  inputHash: z.string(), note: z.string(), total: z.number().int().nonnegative(), eligible: z.number().int().nonnegative(),
  abstained: z.number().int().nonnegative(), coverage: z.number().min(0).max(1),
  composite: z.object({ hitRate: metric, spread: metric, brier: metric, n: z.number().int().nonnegative() }),
  baselines: z.object({ momentumOnly: metric, alwaysBullish: metric, neutralBrier: metric }),
  retrieval: z.object({ note: z.string(), missingCorpusAbstains: z.boolean(), checks: z.array(z.object({ ticker: z.string(), expected: z.string(),
    relevantPassageFound: z.boolean(), allCitationsResolvable: z.boolean(), noFutureSources: z.boolean() })).max(20) }),
  methodology: z.object({ holdoutStart: z.string(), holdoutEnd: z.string(), developmentEnd: z.string(),
    horizonTradingSessions: z.number(), strideTradingSessions: z.number(), purgeTradingSessions: z.number(),
    scoring: z.string(), limitations: z.string(), calibrated: z.literal(false), fittedParameters: z.literal(false) }),
});
export type EvaluationReport = z.infer<typeof EvaluationReport>;
const batch = z.object({ medianMs: z.number().nonnegative(), p95Ms: z.number().nonnegative() });
export const LatencyReport = z.object({ version: z.literal(2), generatedAt: z.string().datetime(), note: z.string(), repeats: z.number().int().positive(),
  matrix: z.array(z.object({ tickers: z.number(), concurrency: z.number(), sharedPreparation: batch, repeatedPreparation: batch })).max(30) });
export type LatencyReport = z.infer<typeof LatencyReport>;
