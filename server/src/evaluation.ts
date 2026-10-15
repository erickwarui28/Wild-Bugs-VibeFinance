export interface EvaluationRow {
  ticker: string; asOf: string; score: number; label: string;
  confidence: number; momentum: number; fwd: number;
}
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Directional hits exclude flat returns; all paired baselines use identical rows. */
export function evaluateRows(rows: EvaluationRow[]) {
  const eligible = rows.filter(row => Number.isFinite(row.fwd) && row.fwd !== 0);
  const scored = eligible.filter(row => row.label !== "neutral" && row.label !== "insufficient_evidence" && row.score !== 0);
  const hits = (predictions: number[]) => average(predictions.map((prediction, i) =>
    prediction === 0 ? 0.5 : Number(Math.sign(prediction) === Math.sign(scored[i]!.fwd))));
  const bull = scored.filter(row => row.score > 0).map(row => row.fwd);
  const bear = scored.filter(row => row.score < 0).map(row => row.fwd);
  const bullMean = average(bull), bearMean = average(bear);
  return {
    total: rows.length, eligible: eligible.length, abstained: eligible.length - scored.length,
    coverage: eligible.length ? scored.length / eligible.length : 0,
    composite: {
      hitRate: hits(scored.map(row => row.score)), n: scored.length,
      spread: bullMean !== null && bearMean !== null ? bullMean - bearMean : null,
      brier: average(scored.map(row => (0.5 + 0.5 * row.confidence * Math.sign(row.score) - Number(row.fwd > 0)) ** 2)),
    },
    baselines: {
      momentumOnly: hits(scored.map(row => row.momentum)),
      alwaysBullish: hits(scored.map(() => 1)),
      neutralBrier: scored.length ? 0.25 : null,
    },
  };
}

export function temporalWindows(dates: string[]) {
  const cutoff = Math.floor(dates.length * 0.7);
  return { development: dates.filter((_, i) => i < cutoff - 30),
    purged: dates.filter((_, i) => i >= cutoff - 30 && i < cutoff), holdout: dates.slice(cutoff) };
}
