import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import { getDb } from "../src/db/db.js";
import { runWithVisitor } from "../src/usage.js";
import { openaiJSON } from "../src/llm/openai.js";

const sdk = vi.hoisted(() => ({ create: vi.fn(), options: {} as Record<string, unknown> }));
vi.mock("openai", () => ({ default: class {
  chat = { completions: { create: sdk.create } };
  constructor(options: Record<string, unknown>) { sdk.options = options; }
} }));
vi.mock("openai/helpers/zod", () => ({ zodResponseFormat: () => ({ type: "json_schema", json_schema: { name: "test" } }) }));
afterEach(() => { sdk.create.mockReset(); });

describe("OpenAI HTTP attempt accounting", () => {
  it("records returned token usage and explicitly disables SDK retries", async () => {
    sdk.create.mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
    const parsed = await runWithVisitor("sdk-accounting", () => openaiJSON(z.object({ ok: z.boolean() }), "test prompt", 1000));
    expect(parsed).toEqual({ ok: true });
    expect(sdk.options.maxRetries).toBe(0);
    expect(sdk.create).toHaveBeenCalledTimes(1);
    const row = getDb().prepare("SELECT * FROM openai_attempts WHERE visitor_id = ? ORDER BY id DESC LIMIT 1").get("sdk-accounting") as Record<string, unknown>;
    expect(row.status).toBe("succeeded"); expect(row.input_tokens).toBe(100); expect(row.output_tokens).toBe(10);
    expect(row.charged_usd).toBeCloseTo(0.000015);
  });

  it("holds the reservation after a network failure", async () => {
    sdk.create.mockRejectedValue(new Error("network unavailable"));
    await expect(runWithVisitor("sdk-failure", () => openaiJSON(z.object({ ok: z.boolean() }), "test prompt", 1000))).rejects.toThrow();
    const row = getDb().prepare("SELECT * FROM openai_attempts WHERE visitor_id = ? ORDER BY id DESC LIMIT 1").get("sdk-failure") as Record<string, unknown>;
    expect(row.status).toBe("failed"); expect(row.charged_usd).toBeNull(); expect(Number(row.reserved_usd)).toBeGreaterThan(0);
    expect(row.error_kind).toBe("provider_error");
  });

  it("records known costs when the provider returns malformed JSON", async () => {
    sdk.create.mockResolvedValue({ choices: [{ message: { content: "not JSON" } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
    await expect(runWithVisitor("sdk-json-failure", () => openaiJSON(z.object({ ok: z.boolean() }), "test prompt", 1000))).rejects.toThrow();
    const row = getDb().prepare("SELECT status, charged_usd, error_kind FROM openai_attempts WHERE visitor_id = ? ORDER BY id DESC LIMIT 1").get("sdk-json-failure") as Record<string, unknown>;
    expect(row.status).toBe("failed"); expect(row.error_kind).toBe("invalid_json"); expect(Number(row.charged_usd)).toBeGreaterThan(0);
  });

  it("does not reserve or start an HTTP attempt after cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runWithVisitor("sdk-pre-aborted", () => openaiJSON(z.object({ ok: z.boolean() }), "prompt", 1000, controller.signal))).rejects.toThrow();
    expect(sdk.create).not.toHaveBeenCalled();
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM openai_attempts WHERE visitor_id = ?").get("sdk-pre-aborted")).toEqual({ n: 0 });
  });
});
