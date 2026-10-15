import { describe, expect, it } from "vitest";
import { TICKERS } from "@vibefinance/shared";
import { compare } from "../src/orchestrator.js";

describe("profile divergence", () => {
  it("differs for at least 7 of 10 tickers and keeps conservative size at or under aggressive", async () => {
    let differ = 0;
    for (const ticker of TICKERS) {
      const result = await compare({ ticker, sessionId: "div" });
      const [asha, , meera] = result.results;
      expect(result.results.every((r) => r.runId === result.runId)).toBe(true);
      if (!asha || !meera) throw new Error("missing profiles");
      expect(asha.personalised.positionSizePct).toBeLessThanOrEqual(meera.personalised.positionSizePct + 0.05);
      if (asha.personalised.action !== meera.personalised.action || asha.personalised.positionSizePct !== meera.personalised.positionSizePct) {
        differ++;
      }
    }
    expect(differ).toBeGreaterThanOrEqual(7);
  });
});
