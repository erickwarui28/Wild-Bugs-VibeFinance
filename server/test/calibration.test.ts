import { describe, expect, it } from "vitest";
import { saveCalibration, readCalibration } from "../src/metrics.js";

describe("calibration", () => {
  it("preserves legacy bins without inventing statistical uncertainty intervals", () => {
    const bins = [
      { lo: 0, hi: 0.2, predicted: 0.1, observed: 0.2 },
      { lo: 0.2, hi: 0.4, predicted: 0.3, observed: 0.35 },
      { lo: 0.4, hi: 0.6, predicted: 0.5, observed: 0.55 },
      { lo: 0.6, hi: 0.8, predicted: 0.7, observed: 0.7 },
      { lo: 0.8, hi: 1, predicted: 0.9, observed: 0.85 },
    ];
    saveCalibration(bins);
    const map = readCalibration();
    expect(map?.bins.length).toBe(5);
    expect(map?.bins.map(bin => bin.observed)).toEqual(bins.map(bin => bin.observed));
    expect(map?.bins[0]).not.toHaveProperty("loObs");
    expect(map?.bins[0]).not.toHaveProperty("hiObs");
  });
});
