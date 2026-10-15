import { describe, expect, it } from "vitest";
import { LlmClaimDraft } from "@vibefinance/shared";
import { generateJSON } from "../src/llm/json.js";

describe("llm", () => {
  it("repairs invalid JSON once and then uses the mock", async () => {
    let calls = 0;
    const result = await generateJSON(LlmClaimDraft, "prompt", {
      timeoutMs: 1000,
      mock: { claims: [{ text: "fallback", citationIdx: [0] }] },
      generate: async () => {
        calls++;
        return { nope: true };
      },
    });
    expect(calls).toBe(2);
    expect(result.mode).toBe("mock");
    expect(result.degraded).toContain("llm_fallback");
    expect(result.data.claims[0]?.text).toBe("fallback");
  });
});
