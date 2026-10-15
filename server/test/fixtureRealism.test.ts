import { describe, expect, it } from "vitest";
import { buildMarket } from "../src/data/generator.js";
import { dailyReturns, realisedVol, rsi } from "../src/indicators.js";
import { getDb, getProfile, metaValue } from "../src/db/db.js";
import { upgradeSeedBars } from "../src/db/fixtures.js";
import { analyze } from "../src/orchestrator.js";
import { aggregate } from "../src/agents/synthesizer.js";
import { personalise } from "../src/agents/profile.js";

describe("versioned teaching fixtures", () => {
  it("explains and cites a moderate accumulation below the bullish label threshold", async () => {
    const result=await analyze({ticker:"INFY",profileId:"moderate",sessionId:"neutral-explanation",mode:"demo"});
    const combined={...aggregate(result.agents,result.asOf,"SYNTHETIC"),compositeScore:0.11,compositeLabel:"neutral" as const,confidence:0.4};
    const action=personalise(getProfile("moderate")!,combined,result.agents,result.asOf,"SYNTHETIC","INFY",null);
    expect(action.action).toBe("accumulate");
    expect(action.rationale[0]?.text).toContain("0.10 accumulation threshold");
    expect(action.rationale[0]?.citations.some(c=>c.type==='data'&&c.field==='compositeScore'&&c.value===0.11)).toBe(true);
  });
  it("has both up and down sessions, nonzero volatility and nonsaturated RSI", () => {
    const market = buildMarket(42);
    const closes = market.bars.INFY!.filter(bar => bar.date <= market.asOf).map(bar => bar.close);
    const returns = dailyReturns(closes).slice(-20);
    expect(returns.some(r => r < 0)).toBe(true); expect(returns.some(r => r > 0)).toBe(true);
    expect(realisedVol(closes)).toBeGreaterThan(0.05);
    expect(rsi(closes)!).toBeGreaterThan(50); expect(rsi(closes)!).toBeLessThan(95);
    for (const bar of market.bars.INFY!) { expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close)); expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close)); }
  });
  it("upgrades seed bars idempotently without touching Live bars, profiles or history", async () => {
    await analyze({ticker:"INFY",profileId:"moderate",sessionId:"fixture-history",mode:"demo"});
    const db=getDb(); const date=metaValue("as_of")!;
    db.prepare("INSERT INTO api_usage_global(id,total_calls,updated_at) VALUES(1,37,'fixture-test') ON CONFLICT(id) DO UPDATE SET total_calls=37").run();
    const preserved=["runs","analysis_snapshots","api_usage_global","openai_attempts","admin_audit"].map(table=>({table,rows:JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())}));
    const profiles=JSON.stringify(db.prepare("SELECT * FROM profiles ORDER BY id").all());
    db.prepare("UPDATE bars SET provenance='LIVE', origin='test-live', close=1234 WHERE ticker='TCS' AND date=?").run(date);
    db.prepare("UPDATE bars SET close=1 WHERE ticker='INFY' AND date=?").run(date);
    db.prepare("DELETE FROM meta WHERE key='fixture_version'").run();
    upgradeSeedBars(db,42);
    expect(db.prepare("SELECT close FROM bars WHERE ticker='TCS' AND date=?").get(date)).toEqual({close:1234});
    const first=db.prepare("SELECT close FROM bars WHERE ticker='INFY' AND date=?").get(date);
    expect(first).not.toEqual({close:1}); upgradeSeedBars(db,42);
    expect(db.prepare("SELECT close FROM bars WHERE ticker='INFY' AND date=?").get(date)).toEqual(first);
    expect(JSON.stringify(db.prepare("SELECT * FROM profiles ORDER BY id").all())).toBe(profiles);
    expect(metaValue("fixture_version")).toBe("2");
    for(const {table,rows} of preserved) expect(JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())).toBe(rows);
  });
});
