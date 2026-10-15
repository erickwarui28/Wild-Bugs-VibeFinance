import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resetConfigForTests } from "../src/config.js";
import { parseFiiCsv } from "../src/data/live/fiiCsv.js";
import { parseGdelt } from "../src/data/live/gdelt.js";
import { parseNseRss } from "../src/data/live/nseRss.js";
import { parseYahooChart } from "../src/data/live/yahoo.js";
import { loadMarket } from "../src/data/providers/index.js";
import { resetLiveLoader, setLiveLoader } from "../src/data/providers/live.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("provider", () => {
  it("falls back from live to synthetic when the network is off and stamps provenance", async () => {
    process.env.DATA_MODE = "live";
    resetConfigForTests();
    resetLiveLoader();
    setLiveLoader(async () => {
      throw new Error("network down");
    });
    const market = await loadMarket("INFY", "2026-08-19", []);
    expect(market.dataMode).toBe("synthetic");
    expect(market.bars.every((b) => b.provenance === "SYNTHETIC")).toBe(true);
    expect(market.bars.every((b) => b.date <= "2026-08-19")).toBe(true);
    process.env.DATA_MODE = "synthetic";
    resetConfigForTests();
  });

  it("does not substitute synthetic prices when the request is live", async () => {
    resetLiveLoader();
    setLiveLoader(async () => {
      throw new Error("network down");
    });
    await expect(loadMarket("INFY", "2026-10-14", [], "live")).rejects.toThrow(/unavailable/);
  });

  it("parses recorded fixtures into domain types", () => {
    const yahoo = parseYahooChart(JSON.parse(readFileSync(path.join(here, "fixtures/yahoo-chart.json"), "utf8")), "INFY");
    expect(yahoo[0]?.close).toBeTypeOf("number");
    const rss = parseNseRss(readFileSync(path.join(here, "fixtures/nse-rss.xml"), "utf8"), ["INFY", "TCS"], "2026-10-14T00:00:00Z");
    expect(rss.length).toBeGreaterThan(0);
    const flows = parseFiiCsv(readFileSync(path.join(here, "fixtures/fii.csv"), "utf8"), "2026-10-14T00:00:00Z");
    expect(flows[0]?.scope).toBe("market");
    expect(flows[0]?.origin).toBe("nse:fii_dii.csv");
    const news = parseGdelt(JSON.parse(readFileSync(path.join(here, "fixtures/gdelt.json"), "utf8")), "INFY", "2026-10-14T00:00:00Z");
    expect(news[0]?.ticker).toBe("INFY");
  });
});
