import { describe, expect, it } from "vitest";
import { analyze } from "../src/orchestrator.js";
import { listAlerts } from "../src/alerts.js";
import { featureOn } from "../src/config.js";

describe("alerts", () => {
  it("raises a concentration alert and a volume alert for Asha on ITC when x3 is on", async () => {
    const sessionId = "alerts-asha-itc";
    await analyze({ ticker: "ITC", profileId: "conservative", sessionId, degrade: ["backtest"] });
    const alerts = listAlerts(sessionId);
    if (!featureOn("x3")) {
      expect(alerts).toEqual([]);
      return;
    }
    expect(alerts.some((a) => a.kind === "concentration")).toBe(true);
    expect(alerts.some((a) => a.kind === "volume-anomaly")).toBe(true);
    expect(alerts.every((a) => Array.isArray(a.citations))).toBe(true);
  });
});
