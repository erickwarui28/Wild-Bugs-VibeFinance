import { getConfig } from "../config.js";

export async function geminiJSON(prompt: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const cfg = getConfig();
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const client = new GoogleGenerativeAI(cfg.GEMINI_API_KEY);
  const model = client.getGenerativeModel({
    model: cfg.GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 400 },
  });
  signal?.throwIfAborted();
  const result = await model.generateContent(prompt, { timeout: timeoutMs, signal });
  const text = result.response.text();
  return JSON.parse(text);
}
