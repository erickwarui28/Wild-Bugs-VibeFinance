import type { ZodSchema } from "zod";
import { getConfig } from "../config.js";
import { finishOpenAiCall, reserveOpenAiCall, type TokenUsage } from "../usage.js";

export async function openaiJSON<T>(schema: ZodSchema<T>, prompt: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const cfg = getConfig();
  const { default: OpenAI } = await import("openai");
  const { zodResponseFormat } = await import("openai/helpers/zod");
  const client = new OpenAI({ apiKey: cfg.OPENAI_API_KEY, timeout: timeoutMs, maxRetries: 0 });
  signal?.throwIfAborted();
  const request = {
    model: cfg.OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You write short retail-investor claims. Return only JSON matching the schema. Use citationIdx values you are given. Do not invent numbers.",
      },
      { role: "user", content: prompt },
    ],
    max_completion_tokens: 400,
    reasoning_effort: "none",
    service_tier: "default",
    response_format: zodResponseFormat(schema, "agent_claims"),
  };
  // UTF-8 byte bound plus schema/framing headroom, deliberately more conservative than a text-length estimate.
  const attempt = reserveOpenAiCall({ model: cfg.OPENAI_MODEL, inputBound: Buffer.byteLength(JSON.stringify(request), "utf8") * 2 + 4096, outputBound: 400 });
  let usage: TokenUsage | undefined;
  try {
    const completion = (await client.chat.completions.create(request as never, { signal })) as {
      choices?: Array<{ message?: { content?: string | null } }>; usage?: TokenUsage;
    };
    usage = completion.usage;
    const text = completion.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text);
    finishOpenAiCall(attempt, usage);
    return parsed;
  } catch (error) {
    // Store only a class/category, never prompts, provider error bodies or credentials.
    finishOpenAiCall(attempt, usage, signal?.aborted ? "aborted" : error instanceof SyntaxError ? "invalid_json" : "provider_error");
    throw error;
  }
}
