import { describe, expect, it } from "vitest";
import { buildMarket } from "../src/data/generator.js";
import { analyze } from "../src/orchestrator.js";

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (["latencyMs", "runId", "snapshotId", "capturedAt", "startedAt", "endedAt"].includes(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

describe("determinism", () => {
  it("repeats the generator and the synthesis for one seed", async () => {
    const a = JSON.stringify(buildMarket(42));
    const b = JSON.stringify(buildMarket(42));
    expect(a).toBe(b);
    const first = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "det-a" });
    const second = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "det-b" });
    expect(strip(first)).toEqual(strip(second));
  });
});
