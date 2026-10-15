import { describe, expect, it } from "vitest";
import { UsageLimitError, reserveOpenAiCall, resetUsage, runWithVisitor, usageSnapshot } from "../src/usage.js";

describe("OpenAI usage quotas", () => {
  it("enforces the per-visitor hourly limit and supports individual and global resets", () => {
    resetUsage("global");
    for (let i = 0; i < 100; i++) runWithVisitor("visitor_quota_test", reserveOpenAiCall);
    expect(() => runWithVisitor("visitor_quota_test", reserveOpenAiCall)).toThrow(UsageLimitError);
    expect(usageSnapshot().visitors.find((visitor) => visitor.visitorId === "visitor_quota_test")?.hourCalls).toBe(100);
    resetUsage("visitor", "visitor_quota_test");
    runWithVisitor("visitor_quota_test", reserveOpenAiCall);
    expect(usageSnapshot().visitors.find((visitor) => visitor.visitorId === "visitor_quota_test")?.totalCalls).toBe(1);
    resetUsage("global");
    expect(usageSnapshot().global.totalCalls).toBe(0);
  });
});
