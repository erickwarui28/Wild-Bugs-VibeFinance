import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { analyze } from "../src/orchestrator.js";
import { getDb } from "../src/db/db.js";
import { readTrace } from "../src/trace.js";
import { sessionMetrics } from "../src/metrics.js";
import { mapClaims } from "../src/agents/momentum.js";
import { SearchResponse, LlmClaimDraft } from "@vibefinance/shared";
import { liveDocs, searchLiveDocs, getLiveDoc } from "../src/data/live/fetch.js";
import { UsageLimitError, reserveOpenAiCall, resetUsage, runWithVisitor, usageSnapshot } from "../src/usage.js";
import { generateJSON } from "../src/llm/json.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("QA correctness regressions", () => {
  it("keeps identical analyses isolated between sessions and preserves trace timing", async () => {
    const first = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "qa-first", degrade: ["backtest"] });
    const second = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "qa-second", degrade: ["backtest"] });
    expect(first.runId).not.toBe(second.runId);
    const stored = getDb().prepare("SELECT session_id FROM runs WHERE run_id IN (?, ?) ORDER BY session_id").all(first.runId, second.runId);
    expect(stored).toEqual([{ session_id: "qa-first" }, { session_id: "qa-second" }]);
    const trace = readTrace(first.runId);
    const elapsed = Math.max(...trace.map((t) => Date.parse(t.endedAt))) - Math.min(...trace.map((t) => Date.parse(t.startedAt)));
    expect(sessionMetrics("qa-first").latency.max).toBe(elapsed);
  });

  it("binds factual claims to all required measurements and drops invalid references", async () => {
    const result = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "qa-grounding", mode: "demo", degrade: ["backtest"] });
    const momentum = result.agents.find((a) => a.agent === "momentum")!;
    expect(momentum.claims[1]!.citations.map((c) => c.type === "data" ? c.field : c.docId)).toEqual(["sma20", "sma50"]);
    const risk = result.agents.find((a) => a.agent === "risk")!;
    expect(risk.claims[1]!.citations.map((c) => c.type === "data" ? c.field : c.docId)).toEqual(["maxDrawdown60", "beta60"]);
    expect(mapClaims({ claims: [{ text: "Unsupported", citationIdx: [999] }] }, momentum.claims[0]!.citations, "fallback")).toEqual([]);
    expect(result.summary[0]!.citations.some((c) => c.type === "data" && c.field === "compositeScore")).toBe(true);
  });

  it("returns live search IDs that resolve to source summaries", async () => {
    const xml = readFileSync(new URL("./fixtures/nse-rss.xml", import.meta.url), "utf8");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200 })));
    await liveDocs("*");
    const response = SearchResponse.parse({ hits: searchLiveDocs("", null), disclaimer: "Not financial advice" });
    expect(response.hits.length).toBeGreaterThan(0);
    for (const hit of response.hits) {
      const doc = getLiveDoc(hit.docId);
      expect(doc?.chunks[0]?.id).toBe(hit.chunkId);
      expect(doc?.synthetic).toBe(false);
    }
  });

  it("enforces a rolling hour even across the old fixed-window boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
    resetUsage("global");
    const call = () => runWithVisitor("qa-rolling", reserveOpenAiCall);
    call();
    vi.setSystemTime(new Date("2026-10-14T00:59:00Z"));
    for (let i = 0; i < 99; i++) call();
    vi.setSystemTime(new Date("2026-10-14T01:01:00Z"));
    call();
    expect(call).toThrow(UsageLimitError);
    expect(usageSnapshot().visitors.find((v) => v.visitorId === "qa-rolling")?.hourCalls).toBe(100);
    resetUsage("visitor", "qa-rolling");
    expect(call).not.toThrow();
  });

  it("does not hide quota exhaustion as model fallback", async () => {
    await expect(generateJSON(LlmClaimDraft, "test", {
      timeoutMs: 100,
      mock: { claims: [{ text: "fallback", citationIdx: [0] }] },
      generate: async () => { throw new UsageLimitError("Quota reached"); },
    })).rejects.toThrow(UsageLimitError);
  });
});
