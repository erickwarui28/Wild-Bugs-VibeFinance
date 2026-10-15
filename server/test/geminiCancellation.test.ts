import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiJSON } from "../src/llm/gemini.js";
const sdk = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: class {
  getGenerativeModel() { return { generateContent: sdk.generate }; }
} }));
afterEach(() => sdk.generate.mockReset());

describe("Gemini cancellation", () => {
  it("passes native timeout and abort options to the installed SDK", async () => {
    sdk.generate.mockResolvedValue({ response: { text: () => '{"ok":true}' } });
    const controller = new AbortController();
    expect(await geminiJSON("test", 8000, controller.signal)).toEqual({ ok: true });
    expect(sdk.generate).toHaveBeenCalledWith("test", { timeout: 8000, signal: controller.signal });
  });
  it("does not issue a call after cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(geminiJSON("test", 8000, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.generate).not.toHaveBeenCalled();
  });
});
