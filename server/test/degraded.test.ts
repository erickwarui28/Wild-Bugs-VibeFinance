import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { issueIdentity } from "../src/identity.js";

const modes = ["feedDown", "missingFiling", "conflictingAgents", "llmDown"];

describe("degraded", () => {
  const app = createApp();
  for (const mode of modes) {
    it(`${mode} returns 200 with a degraded flag and cited claims`, async () => {
      const res = await request(app)
        .post("/api/analyze")
        .set("x-vf-visitor", issueIdentity().token)
        .send({ ticker: "INFY", profileId: "conservative", sessionId: "deg", degrade: [mode] });
      expect(res.status).toBe(200);
      expect(res.body.degraded.length).toBeGreaterThan(0);
      const claims = [
        ...res.body.agents.flatMap((a: { claims: { citations: unknown[] }[] }) => a.claims),
        ...res.body.summary,
      ];
      for (const claim of claims) expect(claim.citations.length).toBeGreaterThanOrEqual(1);
    });
  }
});
