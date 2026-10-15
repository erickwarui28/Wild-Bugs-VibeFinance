import { describe, expect, it } from "vitest";
import { analyze } from "../src/orchestrator.js";
import { featureOn } from "../src/config.js";
import { sessionHistory } from "../src/sessions.js";

describe("sessions", () => {
  it("keeps three decisions after three analyses when x6 is on", async () => {
    const sessionId = "sess-three";
    for (const ticker of ["TCS", "INFY", "RELIANCE"]) {
      await analyze({ ticker, profileId: "moderate", sessionId, degrade: ["backtest"] });
    }
    const rows = sessionHistory(sessionId);
    if (!featureOn("x6")) {
      expect(rows).toEqual([]);
      return;
    }
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
