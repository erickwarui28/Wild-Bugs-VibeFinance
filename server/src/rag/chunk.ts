import { wordCount } from "../math.js";

export interface Chunk {
  id: string;
  docId: string;
  ticker: string;
  text: string;
}

export function chunkText(docId: string, ticker: string, body: string, size = 120, overlap = 30): Chunk[] {
  const words = body.split(/\s+/).filter(Boolean);
  const step = Math.max(1, size - overlap);
  const chunks: Chunk[] = [];
  let n = 0;
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + size);
    if (slice.length < 40 && chunks.length > 0) break;
    chunks.push({
      id: `${docId}#c${n}`,
      docId,
      ticker,
      text: slice.join(" "),
    });
    n++;
    if (i + size >= words.length) break;
  }
  if (chunks.length === 0 && words.length > 0) {
    chunks.push({ id: `${docId}#c0`, docId, ticker, text: words.join(" ") });
  }
  return chunks.filter((c) => wordCount(c.text) > 0);
}
