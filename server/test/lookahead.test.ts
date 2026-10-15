import { describe, expect, it } from "vitest";
import { metaValue } from "../src/db/db.js";
import { loadMarket } from "../src/data/providers/index.js";
import { getDb } from "../src/db/db.js";

describe("lookahead", () => {
  it("never returns bars or flows after asOf", async () => {
    const asOf = metaValue("as_of") ?? "";
    const market = await loadMarket("INFY", asOf, []);
    expect(market.bars.every((b) => b.date <= asOf)).toBe(true);
    expect(market.flows.every((f) => f.date <= asOf)).toBe(true);
    expect(market.docs.every((d) => d.date <= asOf)).toBe(true);
    const future = getDb().prepare(`SELECT date FROM bars WHERE ticker = 'INFY' AND date > ? LIMIT 1`).get(asOf) as { date: string } | undefined;
    expect(future?.date > asOf).toBe(true);
    expect(market.bars.some((b) => b.date === future?.date)).toBe(false);
  });
});
