import { describe, expect, it } from "vitest";
import { TICKERS } from "@vibefinance/shared";
import { Synthesis } from "@vibefinance/shared";
import { analyze } from "../src/orchestrator.js";

describe("contracts", () => {
  it("parses a mock synthesis for every ticker", async () => {
    for (const ticker of TICKERS) {
      const result = await analyze({ ticker, profileId: "moderate", sessionId: "contracts", degrade: [] });
      expect(Synthesis.safeParse(result).success).toBe(true);
      expect(result.agents).toHaveLength(4);
      for (const agent of result.agents) {
        expect(agent.confidence).toBeGreaterThanOrEqual(0);
        expect(agent.confidence).toBeLessThanOrEqual(1);
        for (const claim of agent.claims) expect(claim.citations.length).toBeGreaterThanOrEqual(1);
      }
      if (ticker === "INFY") {
        const volume = result.agents.find((agent) => agent.agent === "volume");
        const cited = volume?.claims.flatMap((claim) => claim.citations) ?? [];
        expect(cited.some((citation) => citation.type === "data" && citation.source === "flows")).toBe(true);
      }
    }
  });
});
