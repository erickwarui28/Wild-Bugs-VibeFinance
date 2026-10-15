import { CompareResponse, Synthesis, TraceResponse } from "@vibefinance/shared";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/public/demo");

describe("demo fixtures", () => {
  it("match the contracts and carry the disclaimer", () => {
    expect(existsSync(path.join(dir, "demo-infy-moderate.json"))).toBe(true);
    const demo = Synthesis.parse(JSON.parse(readFileSync(path.join(dir, "demo-infy-moderate.json"), "utf8")));
    const compare = CompareResponse.parse(JSON.parse(readFileSync(path.join(dir, "compare-infy.json"), "utf8")));
    const trace = TraceResponse.parse(JSON.parse(readFileSync(path.join(dir, "trace-infy.json"), "utf8")));
    expect(demo.disclaimer).toContain("Not financial advice");
    expect(compare.results).toHaveLength(3);
    expect(trace.steps[0]?.name).toBe("ingest");
    expect(trace.steps[trace.steps.length - 1]?.name).toBe("recommendation");
  });
});
