import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getDb } from "../src/db/db.js";
import { resetConfigForTests } from "../src/config.js";
import { clearAdminSummaryCache, csvCell, recordCsv, recordPage } from "../src/adminRecords.js";

const stamp = "2026-10-15T10:00:00.000Z";
function activity(visitor = "visitor_test", status = 200, endpoint = "/api/analyze") {
  getDb().prepare("INSERT INTO activity_events(visitor_id,method,path,status,duration_ms,created_at) VALUES(?,'POST',?,?,12,?)").run(visitor, endpoint, status, stamp);
}
function visitor(id: string) {
  getDb().prepare("INSERT INTO api_usage_visitors(visitor_id,total_calls,window_calls,window_started_at,first_seen_at,last_seen_at) VALUES(?,3,0,0,?,?)").run(id, stamp, stamp);
}
beforeEach(() => {
  vi.stubEnv("ADMIN_USERNAME", "qa-admin"); vi.stubEnv("ADMIN_PASSWORD", "local-test-only"); resetConfigForTests(); clearAdminSummaryCache();
  getDb().exec("DELETE FROM activity_events; DELETE FROM api_usage_visitors; DELETE FROM api_usage_events; DELETE FROM openai_attempts;");
});
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });
describe("private bounded admin records", () => {
  it("retains anchored keyset pages when new activity arrives and exports the whole snapshot", () => {
    for (let i=0; i<5; i++) activity(`old_${i}`);
    const first = recordPage("activity", { limit: "2" });
    activity("new_arrival");
    const second = recordPage("activity", { limit: "2", cursor: first.nextCursor! });
    expect(second.records.map(row=>row.visitorId)).toEqual(["old_2", "old_1"]);
    expect(recordPage("activity", { limit: "2", cursor: first.snapshotCursor }).records).toEqual(first.records);
    const csv = recordCsv("activity", { limit: "2", cursor: first.nextCursor! });
    expect(csv).toContain("old_4"); expect(csv).toContain("old_0"); expect(csv).not.toContain("new_arrival");
    expect(first.summary.total).toBe(5);
  });
  it("paginates metered visitors by stable registration rather than mutable last-seen time", () => {
    ["one", "two", "three"].forEach(visitor);
    const first = recordPage("visitors", { limit: "1" });
    getDb().prepare("UPDATE api_usage_visitors SET last_seen_at=? WHERE visitor_id='one'").run(new Date().toISOString());
    visitor("four");
    const second = recordPage("visitors", { limit: "1", cursor: first.nextCursor! });
    expect(first.records[0]!.visitorId).toBe("three"); expect(second.records[0]!.visitorId).toBe("two");
    expect(second.summary.total).toBe(3);
  });
  it("validates filters, status families, normalized UTC bounds and literal endpoint prefixes", () => {
    activity("chosen", 429, "/api/a_percent%"); activity("chosen", 200, "/api/a_percentX"); activity("another", 500);
    const filtered = recordPage("activity", { visitor: "chosen", endpoint: "/api/a_percent%", status: "4xx", method: "POST", from: "2026-10-15T10:00:00Z", to: "2026-10-15T10:00:01Z" });
    expect(filtered.records).toHaveLength(1); expect(filtered.summary.failed).toBe(1);
    expect(recordPage("activity", { to: "2026-10-15T10:00:00Z" }).records).toHaveLength(0);
    for (const invalid of [{ limit:"NaN" },{limit:"Infinity"},{limit:"101"},{limit:"0"},{limit:["25"]},{status:"600"},{unknown:"x"},{from:stamp,to:stamp}]) {
      expect(()=>recordPage("activity", invalid)).toThrow();
    }
    expect(()=>recordPage("visitors", { endpoint: "/api/" })).toThrow();
    expect(()=>recordPage("attempts", { status: "200" })).toThrow();
  });
  it("rejects altered, filter-rebound and expired cursors", () => {
    activity();
    const first = recordPage("activity", {});
    expect(()=>recordPage("activity", { cursor:first.snapshotCursor+"x" })).toThrow("cursor");
    expect(()=>recordPage("activity", { cursor:first.snapshotCursor, visitor:"other" })).toThrow("cursor");
    expect(()=>recordPage("visitors", { cursor:first.snapshotCursor })).toThrow("cursor");
    const clock = vi.spyOn(Date,"now").mockReturnValue(Date.now()+1800001);
    try { expect(()=>recordPage("activity", { cursor:first.snapshotCursor })).toThrow("expired"); } finally { clock.mockRestore(); }
  });
  it("exports only selected operational fields and neutralizes spreadsheet formulas", () => {
    getDb().prepare(`INSERT INTO openai_attempts(visitor_id,network_id,model,status,reserved_usd,rates_json,created_at)
      VALUES('visitor_test','private-network','=HYPERLINK("bad")','unknown',0.001,'private-rates-secret',?)`).run(stamp);
    const csv = recordCsv("attempts", {});
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('""bad""');
    expect(csv).not.toContain("private-network"); expect(csv).not.toContain("private-rates-secret");
    for (const value of ["=1+1", "+2", "-1+2", "@cmd", " \t=2", "\n=2"]) expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell('a,"b')).toBe('"a,""b"'); expect(csvCell(-2)).toBe('"-2"');
  });
  it("refuses exports above 10,000 records instead of truncating", () => {
    getDb().transaction(()=>{ for(let i=0;i<10001;i++) activity(); })();
    expect(()=>recordCsv("activity", {})).toThrow("10,000");
  });
  it("keeps every new route behind admin auth and protects exports from caching", async () => {
    const app=createApp(); activity();
    for (const endpoint of ["/api/admin/overview", "/api/admin/records/activity", "/api/admin/export/activity"]) {
      expect((await request(app).get(endpoint)).status).toBe(401);
    }
    const page=await request(app).get("/api/admin/records/activity").auth("qa-admin","local-test-only");
    expect(page.status).toBe(200); expect(page.headers["cache-control"]).toBe("no-store");
    const csv=await request(app).get("/api/admin/export/activity").auth("qa-admin","local-test-only");
    expect(csv.status).toBe(200); expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.headers["cache-control"]).toBe("no-store"); expect(csv.headers["content-type"]).toContain("text/csv");
    expect((await request(app).get("/api/admin/records/activity?limit=NaN").auth("qa-admin","local-test-only")).status).toBe(400);
    expect((await request(app).get("/api/admin/records/other").auth("qa-admin","local-test-only")).status).toBe(404);
  });
  it("uses visitor/status indexes for selective history queries", () => {
    const plan=getDb().prepare("EXPLAIN QUERY PLAN SELECT id FROM activity_events WHERE visitor_id=? AND id<? ORDER BY id DESC LIMIT 25").all("x",100);
    expect(JSON.stringify(plan)).toContain("idx_activity_visitor_id");
    const attemptPlan=getDb().prepare("EXPLAIN QUERY PLAN SELECT id FROM openai_attempts WHERE status=? AND id<? ORDER BY id DESC LIMIT 25").all("failed",100);
    expect(JSON.stringify(attemptPlan)).toContain("idx_attempt_status_id");
  });
  it("retains reset origin protection and supports the bounded UI's compact reset response", async () => {
    const app=createApp(); visitor("reset-test");
    const before=recordPage("visitors", { visitor:"reset-test" }); expect(before.summary.callsSinceReset).toBe(3);
    const denied=await request(app).post("/api/admin/usage/reset").auth("qa-admin","local-test-only")
      .set("Origin","https://another-site.invalid").send({scope:"visitor",visitorId:"reset-test",compact:true});
    expect(denied.status).toBe(403);
    const result=await request(app).post("/api/admin/usage/reset").auth("qa-admin","local-test-only")
      .send({scope:"visitor",visitorId:"reset-test",compact:true});
    expect(result.status).toBe(200); expect(result.body).toEqual({ok:true});
    expect(recordPage("visitors", { visitor:"reset-test" }).summary.callsSinceReset).toBe(0);
    expect((await request(app).post("/api/admin/usage/reset").auth("qa-admin","local-test-only").send([])).status).toBe(400);
  });
});
