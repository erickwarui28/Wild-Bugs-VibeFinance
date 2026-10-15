import { describe, expect, it } from "vitest";
import { analyze } from "../src/orchestrator.js";
import { citationOk, enforceAgent } from "../src/citations.js";
import { getDb } from "../src/db/db.js";

describe("citations", () => {
  it("drops a fake citation index and an invented doc id", async () => {
    const result = await analyze({ ticker: "TCS", profileId: "moderate", sessionId: "cite" });
    const agent = structuredClone(result.agents[0]);
    if (!agent) throw new Error("no agent");
    agent.claims.push({
      text: "Invented filing.",
      citations: [
        {
          type: "doc",
          docId: "DOC-NOPE",
          chunkId: "DOC-NOPE#c0",
          snippet: "not in the store",
          score: 0.9,
          provenance: "SYNTHETIC",
          sourceUrl: null,
          fetchedAt: null,
        },
      ],
    });
    const chunks = new Map<string, string>();
    const row = getDb().prepare(`SELECT id, text FROM chunks LIMIT 1`).get() as { id: string; text: string };
    chunks.set(row.id, row.text);
    const cleaned = enforceAgent(agent, chunks, { n: 0 });
    expect(cleaned.claims.some((c) => c.text === "Invented filing.")).toBe(false);
    expect(citationOk(agent.claims[agent.claims.length - 1]!.citations[0]!, chunks)).toBe(false);
    for (const claim of result.agents.flatMap((a) => a.claims)) {
      expect(claim.citations.length).toBeGreaterThanOrEqual(1);
    }
  });
});
