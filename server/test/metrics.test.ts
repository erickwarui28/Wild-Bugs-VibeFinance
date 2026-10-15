import { describe, expect, it } from "vitest";
import { hhi } from "../src/math.js";

describe("metrics", () => {
  it("computes HHI of equal weights and a known Brier term", () => {
    const n = 4;
    const weights = Array.from({ length: n }, () => 1 / n);
    expect(hhi(weights)).toBeCloseTo(1 / n, 6);
    const p = 0.5;
    const outcome = 1;
    const brier = (p - outcome) ** 2;
    expect(brier).toBeCloseTo(0.25, 6);
  });
});
