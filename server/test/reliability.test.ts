import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { ConcurrencyGate, CircuitBreaker, CoalescedTasks, abortable, cancellableDelay, BusyError } from "../src/reliability.js";
import { analyze, compare } from "../src/orchestrator.js";
import { clearAnalysisCacheForTests, analysisRuntimeStatus } from "../src/analysisRuntime.js";
import { getDb } from "../src/db/db.js";
import { resetConfigForTests } from "../src/config.js";
import { readTrace } from "../src/trace.js";
import { issueIdentity } from "../src/identity.js";
import { createApp } from "../src/app.js";
import request from "supertest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetConfigForTests(); clearAnalysisCacheForTests(); });
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("bounded admission and cancellation", () => {
  it("rejects unsupported source keys before filling public source caches", async () => {
    const app = createApp();
    expect((await request(app).get("/api/market/UNKNOWN")).status).toBe(400);
    if (process.env.VF_ALL_FEATURES !== "0") {
      expect((await request(app).get("/api/search").query({ ticker: "UNKNOWN" })).status).toBe(400);
      expect((await request(app).get("/api/search").query({ q: "x".repeat(201) })).status).toBe(400);
    }
  });
  it("bounds a 20-job burst and rejects excess work without starting it", async () => {
    const gate = new ConcurrencyGate({ active: 3, queued: 12, waitMs: 1000, perOwner: 1 });
    let release!: () => void, active = 0, peak = 0, started = 0;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const results = Promise.allSettled(Array.from({ length: 20 }, (_, index) => gate.run(`burst-${index}`, undefined, async () => {
      active++; started++; peak = Math.max(peak, active); await held; active--; return index;
    })));
    expect(gate.snapshot()).toMatchObject({ active: 3, queued: 12 });
    release(); const done = await results;
    expect(peak).toBe(3); expect(started).toBe(15);
    expect(done.filter((result) => result.status === "rejected")).toHaveLength(5);
    expect(gate.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });
  it("bounds active and waiting work, removes cancelled jobs, and releases slots", async () => {
    const gate = new ConcurrencyGate({ active: 1, queued: 1, waitMs: 1000 });
    let release!: () => void;
    const first = gate.run("a", undefined, () => new Promise<void>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const job = vi.fn(async () => 2);
    const queued = gate.run("b", controller.signal, job);
    const cancelled = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await expect(gate.run("c", undefined, job)).rejects.toBeInstanceOf(BusyError);
    expect(gate.snapshot()).toMatchObject({ active: 1, queued: 1 });
    controller.abort(); await cancelled;
    expect(gate.snapshot().queued).toBe(0); expect(job).not.toHaveBeenCalled();
    release(); await first; expect(gate.snapshot().active).toBe(0);
    expect(await gate.run("b", undefined, job)).toBe(2);
  });

  it("expires bounded queues rather than waiting indefinitely", async () => {
    const gate = new ConcurrencyGate({ active: 1, queued: 1, waitMs: 10 });
    let release!: () => void;
    const first = gate.run("a", undefined, () => new Promise<void>((resolve) => { release = resolve; }));
    await expect(gate.run("b", undefined, async () => 2)).rejects.toThrow(/queue timed out/);
    release(); await first; expect(gate.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it("does not let one owner consume all active slots", async () => {
    const gate = new ConcurrencyGate({ active: 2, queued: 2, waitMs: 1000, perOwner: 1 });
    let release!: () => void;
    const first = gate.run("same", undefined, () => new Promise<void>((resolve) => { release = resolve; }));
    let secondStarted = false;
    const second = gate.run("same", undefined, async () => { secondStarted = true; });
    expect(await gate.run("other", undefined, async () => "served")).toBe("served");
    expect(secondStarted).toBe(false); release(); await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });

  it("shares source work without cancelling another subscriber", async () => {
    const tasks = new CoalescedTasks<number>();
    const one = new AbortController(), two = new AbortController();
    let complete!: (value: number) => void;
    let sharedSignal!: AbortSignal;
    const work = vi.fn((signal: AbortSignal) => { sharedSignal = signal; return new Promise<number>((resolve) => { complete = resolve; }); });
    const first = tasks.run("source", one.signal, work), second = tasks.run("source", two.signal, work);
    const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await turn(); one.abort(); await cancelled;
    expect(sharedSignal.aborted).toBe(false); complete(7);
    expect(await second).toBe(7); expect(work).toHaveBeenCalledTimes(1);
  });

  it("aborts shared source work after the last subscriber leaves", async () => {
    const tasks = new CoalescedTasks<number>(), controller = new AbortController();
    let signal!: AbortSignal;
    const first = tasks.run("source", controller.signal, (s) => { signal = s; return abortable(new Promise<number>(() => {}), s); });
    const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await turn(); controller.abort(); await cancelled; expect(signal.aborted).toBe(true);
  });

  it("does not persist a cancelled analysis or leave active work behind", async () => {
    const controller = new AbortController();
    const pending = analyze({ ticker: "INFY", profileId: "moderate", sessionId: "cancelled-run", mode: "demo", signal: controller.signal });
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await turn(); controller.abort(); await cancelled;
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM runs WHERE session_id = 'cancelled-run'").get()).toEqual({ n: 0 });
    expect(analysisRuntimeStatus().active).toBe(0);
  });

  it("propagates a real HTTP client disconnect into analysis cancellation", async () => {
    const server = createServer(createApp()); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address() as { port: number };
    const visitor = issueIdentity(), controller = new AbortController();
    try {
      const pending = fetch(`http://127.0.0.1:${address.port}/api/analyze`, { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", "x-vf-visitor": visitor.token },
        body: JSON.stringify({ ticker: "INFY", profileId: "moderate", sessionId: "ignored", mode: "demo", degrade: ["slowAgent"] }) });
      const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await cancellableDelay(40); controller.abort(); await cancelled;
      await cancellableDelay(80);
      expect(getDb().prepare("SELECT COUNT(*) AS n FROM runs WHERE session_id = ?").get(visitor.visitorId)).toEqual({ n: 0 });
      expect(analysisRuntimeStatus().active).toBe(0);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

describe("source circuit breaker", () => {
  it("opens after consecutive failures and permits one recovery probe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(1000);
    const breaker = new CircuitBreaker(2, 100);
    const bad = vi.fn(async () => { throw new Error("down"); });
    await expect(breaker.run("yahoo", undefined, bad)).rejects.toThrow("down");
    await expect(breaker.run("yahoo", undefined, bad)).rejects.toThrow("down");
    await expect(breaker.run("yahoo", undefined, bad)).rejects.toBeInstanceOf(BusyError);
    expect(bad).toHaveBeenCalledTimes(2);
    vi.setSystemTime(1200);
    let recover!: () => void;
    const probe = breaker.run("yahoo", undefined, () => new Promise<void>((resolve) => { recover = resolve; }));
    await expect(breaker.run("yahoo", undefined, async () => 1)).rejects.toBeInstanceOf(BusyError);
    recover(); await probe;
    expect(await breaker.run("yahoo", undefined, async () => "ok")).toBe("ok");
    expect(breaker.snapshot()[0]?.state).toBe("closed");
  });

  it("does not treat a visitor cancellation as a source failure", async () => {
    const breaker = new CircuitBreaker(1, 100), controller = new AbortController();
    const work = breaker.run("rss", controller.signal, () => cancellableDelay(1000, controller.signal));
    const cancelled = expect(work).rejects.toMatchObject({ name: "AbortError" }); controller.abort(); await cancelled;
    expect(breaker.snapshot()[0]?.failures).toBe(0);
  });
});

describe("private evidence-keyed agent cache", () => {
  it("reuses agents across Dashboard and Compare with fresh executions and honest trace latency", async () => {
    const first = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "cache-owner", mode: "demo" });
    const next = await compare({ ticker: "INFY", sessionId: "cache-owner", mode: "demo" });
    expect(next.results[0]!.agentCache).toMatchObject({ hit: true, sourceRunId: first.runId });
    expect(next.runId).not.toBe(first.runId); expect(next.results[0]!.agents.every((agent) => agent.latencyMs === 0)).toBe(true);
    expect(readTrace(next.runId).some((entry) => entry.name === "agent-cache")).toBe(true);
    const other = await compare({ ticker: "INFY", sessionId: "cache-other", mode: "demo" });
    expect(other.results[0]!.agentCache?.hit).toBe(false);
    const refreshed = await compare({ ticker: "INFY", sessionId: "cache-owner", mode: "demo", refresh: true });
    expect(refreshed.results[0]!.agentCache?.hit).toBe(false);
  });

  it("invalidates when source prices change or the cache expires", async () => {
    const first = await analyze({ ticker: "TCS", profileId: "moderate", sessionId: "cache-change", mode: "demo" });
    const db = getDb();
    const row = db.prepare("SELECT close FROM bars WHERE ticker = 'TCS' AND date = ?").get(first.asOf) as { close: number };
    try {
      db.prepare("UPDATE bars SET close = close + 1 WHERE ticker = 'TCS' AND date = ?").run(first.asOf);
      const changed = await analyze({ ticker: "TCS", profileId: "moderate", sessionId: "cache-change", mode: "demo" });
      expect(changed.agentCache?.hit).toBe(false);
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 300_001);
      const expired = await analyze({ ticker: "TCS", profileId: "moderate", sessionId: "cache-change", mode: "demo" });
      expect(expired.agentCache?.hit).toBe(false);
    } finally { db.prepare("UPDATE bars SET close = ? WHERE ticker = 'TCS' AND date = ?").run(row.close, first.asOf); }
  });
});
