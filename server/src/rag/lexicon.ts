const POS = new Set(["beat", "growth", "expansion", "upgrade", "record", "strong", "raise", "optimistic", "surplus", "outperform", "higher"]);
const NEG = new Set(["cut", "miss", "downgrade", "pledge", "decline", "weak", "weaker", "concern", "loss", "default", "investigation", "lower", "negative", "cautious"]);
const BOOST = ["guidance", "margin", "pledge", "downgrade", "beat", "miss", "cut", "growth"];

export function lexiconScore(text: string): number {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let p = 0;
  let n = 0;
  for (const t of tokens) {
    if (POS.has(t)) p++;
    if (NEG.has(t)) n++;
  }
  if (p + n === 0) return 0;
  return (p - n) / (p + n);
}

export function keywordBoost(text: string): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const term of BOOST) if (lower.includes(term)) hits++;
  return Math.min(0.25, hits * 0.04);
}
