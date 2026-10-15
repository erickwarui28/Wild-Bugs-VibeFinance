import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { livePriceBars, resetLiveCachesForTests, sourceRuntimeStatus } from "../src/data/live/fetch.js";
import { resetConfigForTests } from "../src/config.js";
import { loadMarket } from "../src/data/providers/index.js";
import { setLiveLoader, resetLiveLoader } from "../src/data/providers/live.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetLiveCachesForTests(); resetLiveLoader(); resetConfigForTests(); });

describe("live source isolation and cancellation", () => {
  it("coalesces identical source fetches without sharing visitor cancellation", async () => {
    resetLiveCachesForTests();
    const fixture = readFileSync(new URL("./fixtures/yahoo-chart.json", import.meta.url), "utf8");
    let complete!: () => void; let underlyingSignal!: AbortSignal;
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      underlyingSignal = options.signal as AbortSignal;
      await new Promise<void>((resolve) => { complete = resolve; });
      return new Response(fixture, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const first = livePriceBars("INFY", "2026-10-14", controller.signal);
    const second = livePriceBars("INFY", "2026-10-14");
    const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(); await cancelled;
    expect(underlyingSignal.aborted).toBe(false); complete();
    expect((await second).length).toBeGreaterThan(0); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the source circuit after repeated HTTP failures and recovers", async () => {
    resetLiveCachesForTests();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(100_000);
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 3; index++) await expect(livePriceBars("INFY", "2026-10-14")).rejects.toThrow();
    await expect(livePriceBars("INFY", "2026-10-14")).rejects.toThrow(/temporarily unavailable/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sourceRuntimeStatus().circuits[0]?.state).toBe("open");
    vi.setSystemTime(131_000);
    const fixture = readFileSync(new URL("./fixtures/yahoo-chart.json", import.meta.url), "utf8");
    fetchMock.mockResolvedValue(new Response(fixture, { status: 200 }));
    expect((await livePriceBars("INFY", "2026-10-14")).length).toBeGreaterThan(0);
    expect(sourceRuntimeStatus().circuits[0]?.state).toBe("closed");
  });

  it("does not turn a cancelled live request into synthetic fallback", async () => {
    const controller = new AbortController();
    setLiveLoader(async (_ticker, _asOf, signal) => {
      expect(signal).toBe(controller.signal); controller.abort(); signal!.throwIfAborted();
      throw new Error("unreachable");
    });
    await expect(loadMarket("INFY", "2026-10-14", [], "live", false, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("counts invalid source payloads as failures rather than transport successes", async () => {
    resetLiveCachesForTests(); const fetchMock = vi.fn(async () => new Response("not JSON", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 3; index++) await expect(livePriceBars("INFY", "2026-10-14")).rejects.toThrow();
    await expect(livePriceBars("INFY", "2026-10-14")).rejects.toThrow(/temporarily unavailable/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
