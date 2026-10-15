import { LlmClaimDraft, type LlmClaimDraft as Draft } from "@vibefinance/shared";
import type { ZodSchema } from "zod";
import { getConfig } from "../config.js";
import { geminiJSON } from "./gemini.js";
import { openaiJSON } from "./openai.js";
import { UsageLimitError } from "../usage.js";

export interface GenerateResult<T> {
  data: T;
  mode: "llm" | "mock";
  attempts: number;
  degraded: string[];
}

export type GenerateFn = (prompt: string, attempt: number) => Promise<unknown>;

function mockDraft(lines: string[]): Draft {
  return {
    claims: lines.map((text, i) => ({ text, citationIdx: [i] })),
  };
}

export async function generateJSON<T>(
  schema: ZodSchema<T>,
  prompt: string,
  opts: { timeoutMs: number; mock: T; forceMock?: boolean; expectedMock?: boolean; generate?: GenerateFn; signal?: AbortSignal },
): Promise<GenerateResult<T>> {
  opts.signal?.throwIfAborted();
  const cfg = getConfig();
  const useMock =
    !opts.generate &&
    (opts.forceMock ||
      cfg.LLM_PROVIDER === "mock" ||
      (cfg.LLM_PROVIDER === "openai" && !cfg.OPENAI_API_KEY) ||
      (cfg.LLM_PROVIDER === "gemini" && !cfg.GEMINI_API_KEY));
  if (useMock) {
    const parsed = schema.safeParse(opts.mock);
    if (!parsed.success) throw new Error("mock payload failed schema");
    return { data: parsed.data, mode: "mock", attempts: 0, degraded: opts.forceMock && !opts.expectedMock ? ["llm_fallback"] : [] };
  }

  const call = async (attempt: number, extra: string): Promise<unknown> => {
    opts.signal?.throwIfAborted();
    if (opts.generate) return opts.generate(`${prompt}\n${extra}`, attempt);
    const full = extra ? `${prompt}\n${extra}` : prompt;
    if (cfg.LLM_PROVIDER === "gemini") return geminiJSON(full, opts.timeoutMs, opts.signal);
    opts.signal?.throwIfAborted();
    return openaiJSON(schema, full, opts.timeoutMs, opts.signal);
  };

  try {
    const first = await call(1, "");
    const parsed = schema.safeParse(first);
    if (parsed.success) return { data: parsed.data, mode: "llm", attempts: 1, degraded: [] };
    const repairNote = `The previous JSON failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}. Return only valid JSON.`;
    const second = await call(2, repairNote);
    const parsed2 = schema.safeParse(second);
    if (parsed2.success) return { data: parsed2.data, mode: "llm", attempts: 2, degraded: [] };
  } catch (error) {
    if (error instanceof UsageLimitError) throw error;
    if (opts.signal?.aborted) throw error;
    // fall through to mock
  }
  const parsed = schema.safeParse(opts.mock);
  if (!parsed.success) throw new Error("mock payload failed schema");
  return { data: parsed.data, mode: "mock", attempts: 2, degraded: ["llm_fallback"] };
}

export function draftFromLines(lines: string[]): Draft {
  const draft = mockDraft(lines);
  return LlmClaimDraft.parse(draft);
}
