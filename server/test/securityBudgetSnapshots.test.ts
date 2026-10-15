import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { issueIdentity, verifyIdentity } from "../src/identity.js";
import { getConfig, resetConfigForTests } from "../src/config.js";
import { getDb } from "../src/db/db.js";
import { analyze, compare } from "../src/orchestrator.js";
import { readSnapshot, saveSnapshot, snapshotDoc } from "../src/snapshots.js";
import { budgetSnapshot, finishOpenAiCall, reserveOpenAiCall, resetUsage, runWithVisitor, UsageLimitError } from "../src/usage.js";

afterEach(() => { delete process.env.OPENAI_BUDGET_USD; resetConfigForTests(); });

describe("anonymous identity and immutable evidence", () => {
  const app = createApp();
  it("issues signed identities, rejects tampering and requires the capability", async () => {
    const issued = await request(app).post("/api/visitor");
    expect(issued.status).toBe(200);
    expect(verifyIdentity(issued.body.token)).toBe(issued.body.visitorId);
    expect(verifyIdentity(issued.body.token + "x")).toBeNull();
    expect(verifyIdentity("visitor_00000000-0000-0000-0000-000000000000.fake")).toBeNull();
    expect((await request(app).get("/api/metrics").set("x-vf-session", "forged")).status).toBe(401);
    expect((await request(app).get("/api/metrics").set("x-vf-visitor", issued.body.token)).status).toBe(200);
  });

  it("uses signed ownership, preserves chart/doc evidence, and hides traces from other visitors", async () => {
    const owner = issueIdentity(), other = issueIdentity();
    const response = await request(app).post("/api/analyze").set("x-vf-visitor", owner.token)
      .send({ ticker: "INFY", profileId: "moderate", sessionId: other.visitorId, mode: "demo" });
    expect(response.status).toBe(200);
    const id = response.body.snapshotId;
    const snapshot = readSnapshot(id, owner.visitorId)!;
    expect(snapshot).not.toBeNull();
    expect(readSnapshot(id, other.visitorId)).toBeNull();
    expect(response.body.summary[0].citations[0].snapshotId).toBe(id);
    expect((await request(app).get(`/api/trace/${id}`).set("x-vf-visitor", other.token)).status).toBe(404);
    expect((await request(app).get(`/api/trace/${id}`).set("x-vf-visitor", owner.token)).status).toBe(200);
    const chart = await request(app).get(`/api/snapshots/${id}/market`).set("x-vf-visitor", owner.token);
    expect(chart.body.bars).toEqual(snapshot.market.bars);
    expect((await request(app).get(`/api/snapshots/${id}/market`).set("x-vf-visitor", other.token)).status).toBe(404);
    expect(() => saveSnapshot(snapshot, owner.visitorId)).toThrow();
    const doc = snapshot.market.docs[0]!;
    const frozen = snapshotDoc(snapshot, doc.id)!;
    snapshot.market.bars[0]!.close = -1;
    snapshot.market.docs[0]!.body = "changed in memory";
    expect(readSnapshot(id, owner.visitorId)!.market.bars[0]!.close).not.toBe(-1);
    const detail = await request(app).get(`/api/docs/${encodeURIComponent(doc.id)}`).query({ snapshotId: id }).set("x-vf-visitor", owner.token);
    expect(detail.body.body).toBe(frozen.body);
    expect(detail.body.chunks).toEqual(frozen.chunks);
    const metrics = await request(app).get("/api/metrics").query({ sessionId: owner.visitorId }).set("x-vf-visitor", other.token);
    expect(metrics.body.accuracy.n).toBe(0);
  });

  it("shares one frozen snapshot across all comparison profiles", async () => {
    const result = await compare({ ticker: "TCS", sessionId: "snapshot-comparison", mode: "demo" });
    expect(new Set(result.results.map((r) => r.snapshotId)).size).toBe(1);
    expect(result.results[0]!.snapshotId).toBe(result.runId);
    const snapshot = readSnapshot(result.runId, "snapshot-comparison")!;
    expect(snapshot.version).toBe(1);
    expect(snapshot.indexReturns.length).toBeGreaterThan(0);
  });
});

describe("atomic spending and network guards", () => {
  it("keeps network protection independent of visitor and global resets", () => {
    resetUsage("global");
    const network = "test-shared-network";
    for (let i = 0; i < 300; i++) {
      const id = runWithVisitor(`network-visitor-${i}`, reserveOpenAiCall, network);
      finishOpenAiCall(id, { prompt_tokens: 0, completion_tokens: 0 });
    }
    resetUsage("global");
    expect(() => runWithVisitor("new-browser", reserveOpenAiCall, network)).toThrow(/network/);
  });

  it("reserves parallel spending, settles cached token cost, and retains unknown failures", () => {
    const db = getDb();
    const last = (db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM openai_attempts").get() as { id: number }).id;
    db.prepare("INSERT OR REPLACE INTO spending_reset (id,last_attempt_id,reset_at) VALUES (1,?,?)").run(last, new Date().toISOString());
    process.env.OPENAI_BUDGET_USD = "0.0005"; resetConfigForTests();
    const cfg = getConfig();
    const options = { model: cfg.OPENAI_MODEL, inputBound: 1000, outputBound: 400 };
    const first = runWithVisitor("budget-first", () => reserveOpenAiCall(options));
    expect(budgetSnapshot().heldUsd).toBeCloseTo(0.000325);
    expect(() => runWithVisitor("budget-second", () => reserveOpenAiCall(options))).toThrow(UsageLimitError);
    finishOpenAiCall(first, { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 } });
    expect(budgetSnapshot().measuredUsd).toBeCloseTo(0.0000128);
    const second = runWithVisitor("budget-second", () => reserveOpenAiCall(options));
    expect(() => resetUsage("budget")).toThrow(/in-flight/);
    finishOpenAiCall(second, undefined, "aborted");
    expect(budgetSnapshot().heldUsd).toBeCloseTo(0.000325);
    resetUsage("visitor", "budget-second"); resetUsage("global");
    expect(budgetSnapshot().committedUsd).toBeCloseTo(0.0003378);
    const third = runWithVisitor("budget-third", () => reserveOpenAiCall({ ...options, inputBound: 1, outputBound: 1 }));
    finishOpenAiCall(third, { prompt_tokens: 1, completion_tokens: 1 });
    resetUsage("budget");
    expect(budgetSnapshot().committedUsd).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM openai_attempts WHERE id = ?").get(second)).toEqual({ n: 1 });
  });

  it("fails closed on unconfigured model prices", () => {
    expect(() => reserveOpenAiCall({ model: "unconfigured-model", inputBound: 100, outputBound: 400 })).toThrow(/pricing/);
  });
});
