import type { FlowRow } from "../providers/types.js";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') {
      if (quoted && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch ?? "";
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

function toIso(raw: string): string | null {
  const match = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[2] ?? ""] ?? "01";
  return `${match[3]}-${month}-${(match[1] ?? "1").padStart(2, "0")}`;
}

function num(raw: string): number {
  return Number(raw.replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
}

export function parseFiiCsv(text: string, fetchedAt: string | null = null): FlowRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const byDate = new Map<string, { fii: number; dii: number }>();
  for (const row of rows.slice(1)) {
    const category = (row[0] ?? "").replace(/\s+/g, " ").toUpperCase();
    const date = toIso(row[1] ?? "");
    if (!date) continue;
    const net = num(row[4] ?? row[row.length - 1] ?? "0");
    const bucket = byDate.get(date) ?? { fii: 0, dii: 0 };
    if (category.includes("FII") || category.includes("FPI")) bucket.fii = net;
    else if (category.includes("DII")) bucket.dii = net;
    byDate.set(date, bucket);
  }
  return [...byDate.entries()].map(([date, v]) => ({
    date,
    sector: "MARKET",
    fiiNet: v.fii,
    diiNet: v.dii,
    scope: "market" as const,
    provenance: "CACHED" as const,
    origin: "nse:fii_dii.csv",
    fetchedAt,
  }));
}
