import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { evidenceCoverage } from "../src/evidenceCoverage.js";
import type { AnalysisSnapshot } from "../src/snapshots.js";
import { parseNseRss } from "../src/data/live/nseRss.js";
import { parseGdelt } from "../src/data/live/gdelt.js";
import { hitsFromDocs } from "../src/rag/retrieve.js";
import { livePriceBars, resetLiveCachesForTests } from "../src/data/live/fetch.js";

function snapshot():AnalysisSnapshot{return {version:1,id:"coverage-test",ticker:"INFY",asOf:"2026-10-15",capturedAt:"2026-10-15T10:00:00.000Z",
  market:{bars:[{date:"2026-10-12",open:1,high:1,low:1,close:1,volume:1,spike:false,provenance:"LIVE",fetchedAt:"2026-10-14T08:00:00.000Z",origin:"yahoo:INFY.NS",sourceUrl:"https://finance.yahoo.com/quote/INFY.NS/"}],
    docs:[],flows:[],dataMode:"live",provenance:"LIVE",degraded:[],sources:[],snapshotId:null},hits:[],indexReturns:[]};}
afterEach(()=>{vi.unstubAllGlobals();resetLiveCachesForTests();});
describe("frozen evidence source coverage",()=>{
  it("separates session, retrieval and capture dates without declaring data fresh",()=>{
    const input=snapshot(),result=evidenceCoverage(input),price=result.channels[0]!;
    expect(price.latestDate).toBe("2026-10-12");expect(price.calendarAgeDays).toBe(3);
    expect(price.retrievedThrough).toBe("2026-10-14T08:00:00.000Z");expect(result.capturedAt).toBe(input.capturedAt);
    expect(result.channels[1]!.count).toBe(0);expect(result.channels[1]!.dateBasis).toBe("source");
    input.capturedAt="2026-10-16T10:00:00.000Z";
    expect(evidenceCoverage(input).channels[0]!.calendarAgeDays).toBe(4);
    expect(evidenceCoverage(input).channels[0]!.retrievedThrough).toBe(price.retrievedThrough);
  });
  it("marks fixtures as simulated and does not present calendar age as market freshness",()=>{
    const input=snapshot();input.market.bars[0]!.provenance="SYNTHETIC";
    const price=evidenceCoverage(input).channels[0]!;
    expect(price.dateBasis).toBe("fixture");expect(price.syntheticCount).toBe(1);expect(price.calendarAgeDays).toBeNull();expect(price.retrievedThrough).toBeNull();
  });
  it("does not let newer synthetic dates conceal older real-source observations",()=>{
    const input=snapshot();input.market.bars.push({...input.market.bars[0]!,date:"2026-10-15",provenance:"SYNTHETIC"});
    const price=evidenceCoverage(input).channels[0]!;
    expect(price.latestDate).toBe("2026-10-12");expect(price.count).toBe(2);expect(price.syntheticCount).toBe(1);expect(price.notes.join(" ")).toContain("Mixed");
  });
  it("handles missing/invalid dates, future dates and unsafe source URLs without inventing metadata",()=>{
    const input=snapshot();input.market.bars[0]!.date="2026-02-30";input.market.bars[0]!.fetchedAt=null;input.market.bars[0]!.sourceUrl="javascript:alert(1)";
    let price=evidenceCoverage(input).channels[0]!;expect(price.latestDate).toBeNull();expect(price.undatedCount).toBe(1);expect(price.retrievalUnknownCount).toBe(1);expect(price.sources[0]!.url).toBeNull();
    input.market.bars[0]!.date="2026-10-16";price=evidenceCoverage(input).channels[0]!;
    expect(price.dateAheadOfCapture).toBe(true);expect(price.calendarAgeDays).toBeNull();
  });
  it("does not treat a local CSV load timestamp as a verified source download",()=>{
    const input=snapshot();input.market.flows=[{date:"2026-10-14",sector:"MARKET",scope:"market",fiiNet:1,diiNet:2,origin:"nse:fii_dii.csv",fetchedAt:input.capturedAt,provenance:"CACHED"}];
    const flow=evidenceCoverage(input).channels[2]!;expect(flow.retrievedThrough).toBeNull();expect(flow.retrievalUnknownCount).toBe(1);expect(flow.notes.join(" ")).toContain("download time is not verified");
  });
  it("keeps unknown source document dates unknown and excludes them from dated sentiment retrieval",()=>{
    const rss=parseNseRss('<rss><channel><item><title>INFY guidance</title></item></channel></rss>',["INFY"],"2026-10-15T10:00:00Z");
    const gdelt=parseGdelt({articles:[{title:"INFY news"}]},"INFY","2026-10-15T10:00:00Z");
    expect(rss[0]!.date).toBe("");expect(gdelt[0]!.date).toBe("");expect(hitsFromDocs([...rss,...gdelt],"INFY").hits).toEqual([]);
    expect(parseGdelt({articles:[{seendate:"20260230T000000Z"}]},"INFY","2026-10-15T10:00:00Z")[0]!.date).toBe("");
    expect(parseNseRss('<rss><channel><item><title>INFY</title><pubDate>invalid</pubDate></item></channel></rss>',["INFY"],"2026-10-15T10:00:00Z")[0]!.date).toBe("");
    const input=snapshot();input.market.docs=[...rss,...gdelt];const docs=evidenceCoverage(input).channels[1]!;expect(docs.count).toBe(2);expect(docs.undatedCount).toBe(2);expect(docs.latestDate).toBeNull();
  });
  it("retains the original Yahoo retrieval timestamp when a cached payload is reused",async()=>{
    const fixture=readFileSync(new URL("./fixtures/yahoo-chart.json",import.meta.url),"utf8");
    const fetch=vi.fn(async()=>new Response(fixture,{status:200}));vi.stubGlobal("fetch",fetch);
    const first=await livePriceBars("INFY","2026-10-15");const next=await livePriceBars("INFY","2026-10-15");
    expect(fetch).toHaveBeenCalledTimes(1);expect(first[0]!.fetchedAt).toBeTruthy();expect(next[0]!.fetchedAt).toBe(first[0]!.fetchedAt);
  });
});
