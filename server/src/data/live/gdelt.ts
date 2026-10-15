import type { DocRow } from "../providers/types.js";

interface GdeltResponse {
  articles?: Array<{ title?: string; url?: string; seendate?: string; socialimage?: string }>;
}

export function parseGdelt(json: GdeltResponse, ticker: string, fetchedAt: string): DocRow[] {
  return (json.articles ?? []).slice(0, 8).map((article, i) => {
    const seen = article.seendate ?? "";
    const candidate = /^\d{8}/.test(seen) ? `${seen.slice(0, 4)}-${seen.slice(4, 6)}-${seen.slice(6, 8)}` : "";
    const parsed = Date.parse(`${candidate}T00:00:00Z`);
    const date = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10)===candidate ? candidate : "";
    const title = article.title ?? "Headline";
    return {
      id: `GDELT-${ticker}-${i}`,
      ticker,
      type: "news",
      date,
      title,
      body: `[LIVE DOCUMENT]\n\n${title}`,
      synthetic: false,
      provenance: "LIVE",
      sourceUrl: article.url ?? null,
      fetchedAt,
    };
  });
}
