import { describe, expect, it } from "vitest";
import { evaluateRows, temporalWindows, type EvaluationRow } from "../src/evaluation.js";
import { saveCalibration } from "../src/metrics.js";
import { aggregate } from "../src/agents/synthesizer.js";
import { analyze } from "../src/orchestrator.js";
import { readFileSync } from "node:fs";
import { EvaluationReport, LatencyReport } from "@vibefinance/shared";

describe("submission evaluation", () => {
  it("compares identical samples, reports abstentions and does not invent empty results", () => {
    const row: EvaluationRow = { ticker: "INFY", asOf: "2026-01-01", score: 0.5, label: "bullish", confidence: 0.6, momentum: -1, fwd: 0.1 };
    const result = evaluateRows([row, { ...row, label: "neutral" }, { ...row, fwd: 0 }]);
    expect(result.composite.n).toBe(1); expect(result.eligible).toBe(2); expect(result.coverage).toBe(0.5);
    expect(result.composite.hitRate).toBe(1); expect(result.baselines.momentumOnly).toBe(0);
    expect(result.baselines.alwaysBullish).toBe(1); expect(evaluateRows([]).composite.hitRate).toBeNull();
    expect(evaluateRows([row]).composite.spread).toBeNull();
  });
  it("purges a full outcome horizon before chronological holdout", () => {
    const windows = temporalWindows(Array.from({ length: 100 }, (_, i) => String(i)));
    expect(windows.development.at(-1)).toBe("39"); expect(windows.holdout[0]).toBe("70");
    expect(windows.purged).toHaveLength(30);
  });
  it("never applies legacy upward-probability bins to evidence confidence", async () => {
    const result = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "calibration-regression", mode: "demo" });
    const before = aggregate(result.agents, result.asOf, result.provenance);
    saveCalibration([{ lo: 0, hi: 1, predicted: 0.5, observed: 0.99 }]);
    const after = aggregate(result.agents, result.asOf, result.provenance);
    expect(after.confidence).toBe(before.rawConfidence); expect(after.calibratedConfidence).toBeNull(); expect(after.uncertainty).toBeNull();
  });
  it("distinguishes intentional keyless Demo from a simulated model failure", async () => {
    const demo = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "intentional-demo", mode: "demo" });
    expect(demo.agents.every(agent => !agent.degraded.includes("llm_fallback"))).toBe(true);
    const failed = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "failed-model", mode: "demo", degrade: ["llmDown"] });
    expect(failed.degraded).toContain("llm_fallback");
  });
  it("publishes versioned reproducible manifests and grounded curated retrieval checks", () => {
    const report = EvaluationReport.parse(JSON.parse(readFileSync(new URL("../../docs/evaluation/backtest.json", import.meta.url), "utf8")));
    const latency = LatencyReport.parse(JSON.parse(readFileSync(new URL("../../docs/evaluation/latency.json", import.meta.url), "utf8")));
    expect(report.composite.n + report.abstained).toBe(report.eligible);
    expect(report.sourceHash).toMatch(/^[a-f0-9]{64}$/); expect(report.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.retrieval.checks.every(check => check.relevantPassageFound && check.allCitationsResolvable && check.noFutureSources)).toBe(true);
    expect(report.retrieval.missingCorpusAbstains).toBe(true); expect(latency.matrix).toHaveLength(9);
  });
});
