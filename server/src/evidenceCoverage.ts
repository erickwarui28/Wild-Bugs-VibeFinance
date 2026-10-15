import { EvidenceCoverage, type Provenance } from "@vibefinance/shared";
import type { AnalysisSnapshot } from "./snapshots.js";

export function validDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === value ? value : null;
}
function timestamp(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d\d-\d\dT/.test(value) || !validDay(value.slice(0,10)) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function sourceUrl(value: string | null | undefined): string | null {
  try { const url = new URL(value ?? ""); return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
type Row = { date: string; provenance: Provenance; fetchedAt?: string | null; sourceUrl?: string | null; origin?: string | null };
export function evidenceCoverage(snapshot: AnalysisSnapshot): EvidenceCoverage {
  const { market } = snapshot;
  const groups: Array<{ kind: "prices" | "documents" | "flows"; rows: Row[]; notes: string[] }> = [
    { kind:"prices", rows:market.bars, notes:["Daily bars' close field, not a real-time quote service. The latest bar may be provisional; session completion and an unbroken trading history are not verified."] },
    { kind:"documents", rows:market.docs, notes:["Titles/summaries may be incomplete. Source dates can be publication or news-indexing dates, not retrieval times.", "Undated live summaries remain browsable but are excluded from date-weighted sentiment retrieval.", `${new Set(snapshot.hits.map(hit=>hit.docId)).size} distinct documents supplied retrieved excerpts to the agents.`] },
    { kind:"flows", rows:market.flows, notes:["Market-wide flows do not establish buying or selling in this stock or its sector."] },
  ];
  const channels = groups.map(({kind, rows, notes}) => {
    const real = rows.filter(row=>row.provenance!=="SYNTHETIC");
    const datedRows = real.length ? real : rows;
    const dates = datedRows.map(row=>validDay(row.date)).filter((value):value is string=>value!==null).sort();
    // Imported CSV timestamps historically described a local read, not a verified download.
    const retrievalRows = kind === "flows" ? real.filter(row=>!row.origin?.startsWith("nse:")) : real;
    const retrieved = retrievalRows.map(row=>timestamp(row.fetchedAt)).filter((value):value is string=>value!==null).sort();
    const latestDate = dates.at(-1) ?? null;
    const captureDay = validDay(snapshot.capturedAt.slice(0,10));
    const delta = latestDate && captureDay ? (Date.parse(captureDay)-Date.parse(latestDate))/86400000 : null;
    const sources = new Map<string, {name:string; url:string|null}>();
    for (const row of rows) {
      const url = sourceUrl(row.sourceUrl);
      const name = row.provenance === "SYNTHETIC" ? "Seeded demo fixtures" : url ? new URL(url).hostname
        : row.origin?.startsWith("nse:") ? "Imported NSE CSV" : row.origin?.startsWith("yahoo:") ? "Yahoo Finance" : "Origin not recorded";
      const safe = { name, url:row.provenance==="SYNTHETIC"?null:url };
      sources.set(`${safe.name}|${safe.url}`, safe);
    }
    if (!rows.length) notes.unshift("No rows supplied in this frozen analysis. This does not prove that no such evidence exists elsewhere.");
    if (kind === "flows" && real.some(row=>row.origin?.startsWith("nse:"))) notes.push("Imported CSV download time is not verified; a local file read is not a new source retrieval.");
    if (real.length && real.length < rows.length) notes.push("Mixed real-source and synthetic rows. Date range below describes only real-source rows.");
    if (kind === "flows" && market.flows.some(row=>row.scope==="sector")) notes.push("Sector series are listed by their citation provenance; demo sector flows are simulated.");
    return { kind, count:rows.length, syntheticCount:rows.length-real.length, provenance:[...new Set(rows.map(row=>row.provenance))],
      firstDate:dates[0]??null, latestDate, dateBasis:!real.length&&rows.length?"fixture" as const:"source" as const,
      undatedCount:datedRows.length-dates.length, calendarAgeDays:real.length && delta!==null && delta>=0?delta:null, dateAheadOfCapture:real.length>0 && delta!==null && delta<0,
      retrievedFrom:retrieved[0]??null, retrievedThrough:retrieved.at(-1)??null, retrievalUnknownCount:real.length-retrieved.length,
      sources:[...sources.values()], notes };
  });
  return EvidenceCoverage.parse({ snapshotId:snapshot.id, capturedAt:snapshot.capturedAt, channels });
}
