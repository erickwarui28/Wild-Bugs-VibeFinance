import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { featureOn, resetConfigForTests } from "../src/config.js";
import { issueIdentity } from "../src/identity.js";

const app = createApp();

describe("feature flags", () => {
  afterAll(() => {
    process.env.FEATURES = "x1,x2,x3,x4,x5,x6,x7";
    resetConfigForTests();
  });

  it("serves search, alerts, and history while the flags are on", async () => {
    expect(featureOn("x2")).toBe(process.env.VF_ALL_FEATURES !== "0");
    if (process.env.VF_ALL_FEATURES === "0") return;
    const search = await request(app).get("/api/search").query({ q: "guidance", ticker: "INFY" });
    expect(search.status).toBe(200);
    expect(Array.isArray(search.body.hits)).toBe(true);
    const token = issueIdentity().token;
    const alerts = await request(app).get("/api/alerts").set("x-vf-visitor", token);
    expect(alerts.status).toBe(200);
    expect(Array.isArray(alerts.body.alerts)).toBe(true);
    const history = await request(app).get("/api/sessions/flag-on/history").set("x-vf-visitor", token);
    expect(history.status).toBe(200);
  });

  it("returns 404 or an empty list when x2, x3, and x6 are off", async () => {
    process.env.FEATURES = "";
    resetConfigForTests();
    expect(featureOn("x2")).toBe(false);
    const search = await request(app).get("/api/search").query({ q: "guidance" });
    expect(search.status).toBe(404);
    const token = issueIdentity().token;
    const history = await request(app).get("/api/sessions/flag-off/history").set("x-vf-visitor", token);
    expect(history.status).toBe(404);
    const alerts = await request(app).get("/api/alerts").set("x-vf-visitor", token);
    expect(alerts.status).toBe(200);
    expect(alerts.body.alerts).toEqual([]);
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body.features).toEqual([]);
  });
});
