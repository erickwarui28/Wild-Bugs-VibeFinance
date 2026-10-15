import { XMLParser } from "fast-xml-parser";
import type { DocRow } from "../providers/types.js";

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

export function parseNseRss(xml: string, symbols: string[], fetchedAt: string): DocRow[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const raw = parsed.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const docs: DocRow[] = [];
  for (const item of items) {
    const title = item.title ?? "";
    const symbol = symbols.find((s) => title.toUpperCase().includes(s));
    if (!symbol) continue;
    const published = item.pubDate ? Date.parse(item.pubDate) : NaN;
    const date = Number.isFinite(published) ? new Date(published).toISOString().slice(0, 10) : "";
    docs.push({
      id: `RSS-${symbol}-${date}-${docs.length}`,
      ticker: symbol,
      type: "announcement",
      date,
      title,
      body: `[LIVE DOCUMENT]\n\n${title}\n\n${item.description ?? ""}`,
      synthetic: false,
      provenance: "LIVE",
      sourceUrl: item.link ?? null,
      fetchedAt,
    });
  }
  return docs;
}
