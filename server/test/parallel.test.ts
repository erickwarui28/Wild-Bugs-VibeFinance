import { describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db/db.js";
import { resetConfigForTests } from "../src/config.js";
import { analyze } from "../src/orchestrator.js";
import { runParallel, withTimeout } from "../src/parallel.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("parallel", () => {
  it("finishes four 200ms tasks in under 400ms and does not block on a timeout", async () => {
    const t0 = Date.now();
    const settled = await runParallel([wait(200), wait(200), wait(200), wait(200)]);
    expect(Date.now() - t0).toBeLessThan(400);
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    const t1 = Date.now();
    const mixed = await runParallel([
      withTimeout(wait(50), 1000),
      withTimeout(wait(5000), 80).catch(() => "timeout"),
    ]);
    expect(Date.now() - t1).toBeLessThan(400);
    expect(mixed[1]?.status).toBe("fulfilled");
  });

  it("shared feature preparation avoids repeated index queries without changing results", async () => {
    const previous = process.env.FEATURES;
    const spy = vi.spyOn(getDb(), "prepare");
    try {
      process.env.FEATURES = "x7";
      resetConfigForTests();
      const first = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "shared-prep", mode: "demo", degrade: ["backtest"] });
      const countQueries = () => spy.mock.calls.filter(([sql]) => String(sql).includes("SELECT DISTINCT ticker FROM bars")).length;
      const shared = countQueries();
      spy.mockClear();
      process.env.FEATURES = "";
      resetConfigForTests();
      const second = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "repeated-prep", mode: "demo", degrade: ["backtest"] });
      expect(shared).toBe(1);
      expect(countQueries()).toBe(5);
      expect(first.compositeScore).toBe(second.compositeScore);
      expect(first.agents.map((agent) => agent.features)).toEqual(second.agents.map((agent) => agent.features));
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.FEATURES; else process.env.FEATURES = previous;
      resetConfigForTests();
    }
  });
});
