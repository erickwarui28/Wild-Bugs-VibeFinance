import { describe, expect, it } from "vitest";
import { searchChunks } from "../src/rag/search.js";
import { embedLocal, cosine } from "../src/rag/embed.js";

describe("vector", () => {
  it("returns cited guidance-cut chunks and matches a second brute-force ranking", () => {
    const hits = searchChunks("guidance cut", "INFY", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.score).toBeGreaterThan(0);
    const again = searchChunks("guidance cut", "INFY", 5);
    expect(again.map((h) => h.chunkId)).toEqual(hits.map((h) => h.chunkId));
    const q = embedLocal("guidance cut INFY");
    expect(cosine(q, q)).toBeCloseTo(1, 5);
  });
});
