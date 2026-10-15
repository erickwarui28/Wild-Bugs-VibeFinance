import { describe, expect, it } from "vitest";
import { loadMarket } from "../src/data/providers/index.js";
import { analyze } from "../src/orchestrator.js";

describe("backtest", () => {
  it("uses only rows on or before asOf", async () => {
    const asOf = "2026-03-02";
    const market = await loadMarket("SBIN", asOf, []);
    expect(market.bars.length).toBeGreaterThan(10);
    expect(market.bars.every((b) => b.date <= asOf)).toBe(true);
    expect(market.flows.every((f) => f.date <= asOf)).toBe(true);
    const synthesis = await analyze({ ticker: "SBIN", profileId: "moderate", sessionId: "bt", degrade: ["backtest"], asOf });
    expect(synthesis.asOf).toBe(asOf);
    expect(synthesis.agents.every((a) => a.asOf === asOf)).toBe(true);
  });
});
