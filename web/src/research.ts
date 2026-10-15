import { Synthesis } from "@vibefinance/shared";

export interface ResearchEntry {
  id: string;
  savedAt: string;
  note: string;
  synthesis: Synthesis;
}

const KEY = "vf-research-journal";
export const JOURNAL_MAX_BYTES = 5 * 1024 * 1024;

export function exportResearch(entries: ResearchEntry[]): string {
  return JSON.stringify({ format: "vibefinance-journal", version: 1, entries }, null, 2);
}

/** Validate the whole file before committing anything; existing local notes win conflicts. */
export function importResearch(text: string, existing: ResearchEntry[]): ResearchEntry[] {
  if (new TextEncoder().encode(text).length > JOURNAL_MAX_BYTES) throw new Error("Journal file exceeds 5 MB.");
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || !("format" in data) || data.format !== "vibefinance-journal" ||
      !("version" in data) || data.version !== 1 || !("entries" in data) || !Array.isArray(data.entries) || data.entries.length > 50) {
    throw new Error("Choose a version-1 VibeFinance journal with at most 50 entries.");
  }
  const imported = data.entries.map((entry): ResearchEntry => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || entry.id.length > 300 ||
        typeof entry.savedAt !== "string" || !Number.isFinite(Date.parse(entry.savedAt)) ||
        typeof entry.note !== "string" || entry.note.length > 3000) throw new Error("Invalid journal entry.");
    const synthesis = Synthesis.parse(entry.synthesis);
    if (entry.id !== `${synthesis.runId}:${synthesis.profileId}`) throw new Error("Journal identity does not match its snapshot.");
    return { id: entry.id, savedAt: entry.savedAt, note: entry.note, synthesis };
  });
  const merged = new Map(existing.map(entry => [entry.id, entry]));
  for (const entry of imported) if (!merged.has(entry.id)) merged.set(entry.id, entry);
  if (merged.size > 50) throw new Error("Import would exceed 50 snapshots. Remove entries or import a smaller file; nothing was changed.");
  return [...merged.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export function evidenceBrief(entry: ResearchEntry): string {
  const s = entry.synthesis;
  return [`# VibeFinance evidence brief: ${s.ticker}`, `Profile: ${s.profileId} · analysis cut-off: ${s.asOf}`,
    `Provenance: ${s.provenance} · run: ${s.runId}`, "",
    "Research demonstration, not financial advice. Confidence is not a calibrated probability of profit.", "",
    ...s.summary.flatMap(claim => [claim.text, ...claim.citations.map(citation => JSON.stringify(citation)), ""]),
    "Private journal notes, visitor credentials and personal holdings are excluded."].join("\n");
}
export function readResearch(): ResearchEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.savedAt !== "string" || typeof entry.note !== "string") return [];
      const parsed = Synthesis.safeParse(entry.synthesis);
      return parsed.success ? [{ id: entry.id, savedAt: entry.savedAt, note: entry.note.slice(0, 3000), synthesis: parsed.data }] : [];
    }).slice(0, 50);
  } catch { return []; }
}

export function writeResearch(entries: ResearchEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 50)));
}

export function saveResearch(synthesis: Synthesis): void {
  const id = `${synthesis.runId}:${synthesis.profileId}`;
  const entries = readResearch();
  if (entries.some((entry) => entry.id === id)) return;
  writeResearch([{ id, savedAt: new Date().toISOString(), note: "", synthesis }, ...entries]);
}
