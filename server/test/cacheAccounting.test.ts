import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze, compare } from "../src/orchestrator.js";
import { resetConfigForTests } from "../src/config.js";
import { clearAnalysisCacheForTests } from "../src/analysisRuntime.js";
import { usageSnapshot, runWithVisitor } from "../src/usage.js";
import { loadMarket } from "../src/data/providers/index.js";

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  chat = { completions: { create: sdk.create } };
} }));
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); clearAnalysisCacheForTests(); sdk.create.mockReset(); });

describe("cache reuse and paid attempt accounting", () => {
  it("treats explicit Demo as intentional synthetic evidence on a Live-default server", async () => {
    vi.stubEnv("DATA_MODE", "live"); resetConfigForTests();
    const market = await loadMarket("INFY", "2026-10-14", [], "demo");
    expect(market.provenance).toBe("SYNTHETIC");
    expect(market.degraded).not.toContain("synthetic_fallback");
    const first = await runWithVisitor("demo-live-default", () => analyze({ ticker: "INFY", profileId: "moderate", sessionId: "demo-live-default", mode: "demo" }));
    expect(first.agentCache?.hit).toBe(false);
    const next = await runWithVisitor("demo-live-default", () => compare({ ticker: "INFY", sessionId: "demo-live-default", mode: "demo" }));
    expect(next.results[0]!.agentCache?.hit).toBe(true);
  });
  it("avoids additional reservations on reuse, but counts explicit refresh", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai"); vi.stubEnv("OPENAI_API_KEY", "local-test-only"); resetConfigForTests();
    sdk.create.mockImplementation(async (request: { messages: { content: string }[] }) => {
      const prompt = request.messages[1]!.content;
      const draft = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1, prompt.indexOf("\nEvidence:")));
      return { choices: [{ message: { content: JSON.stringify(draft) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
    });
    const first = await runWithVisitor("cache-billing", () => analyze({ ticker: "INFY", profileId: "moderate", sessionId: "cache-billing" }));
    expect(first.agentCache?.hit).toBe(false); expect(sdk.create).toHaveBeenCalledTimes(4);
    expect(usageSnapshot().global.totalCalls).toBe(4);
    const next = await runWithVisitor("cache-billing", () => compare({ ticker: "INFY", sessionId: "cache-billing" }));
    expect(next.results[0]!.agentCache?.hit).toBe(true); expect(sdk.create).toHaveBeenCalledTimes(4);
    expect(usageSnapshot().global.totalCalls).toBe(4);
    await runWithVisitor("cache-billing", () => compare({ ticker: "INFY", sessionId: "cache-billing", refresh: true }));
    expect(sdk.create).toHaveBeenCalledTimes(8); expect(usageSnapshot().global.totalCalls).toBe(8);
  });
});
