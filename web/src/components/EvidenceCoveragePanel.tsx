import { EvidenceCoverage, type Synthesis } from "@vibefinance/shared";
import { GlossaryButton } from "./Glossary";

const names={prices:"Closing prices",documents:"Documents / summaries",flows:"Institutional flows"};
function time(value:string|null){return value?new Date(value).toLocaleString():"Not recorded";}
function safeUrl(value:string|null){try{const url=new URL(value??"");return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function EvidenceCoveragePanel({ synthesis }: { synthesis:Synthesis }) {
  const parsed=EvidenceCoverage.safeParse(synthesis.evidenceCoverage);
  if(!parsed.success||parsed.data.snapshotId!==synthesis.snapshotId||parsed.data.capturedAt!==synthesis.capturedAt)return <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="font-semibold">Source freshness &amp; coverage</h2><p className="mt-2 text-sm text-[var(--text-muted)]">Coverage metadata was not recorded for this older or bundled result. Its sources have not been re-fetched. Run a connected analysis for a recorded evidence snapshot.</p><div className="mt-2 text-sm text-[var(--brand)]"><GlossaryButton term="coverage" label="What does coverage mean?" /></div></section>;
  const coverage=parsed.data;
  return <section aria-label="Source freshness and coverage" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Source freshness &amp; coverage</h2><span className="text-xs text-[var(--brand)]"><GlossaryButton term="freshness" label="Understand these dates" /></span></div>
    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{synthesis.ticker} · frozen {time(coverage.capturedAt)}. Capture time is not the latest market date. Row availability is not a completeness or freshness guarantee.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">{coverage.channels.map(channel=><article key={channel.kind} className="min-w-0 rounded-lg border border-[var(--border)] p-3">
      <h3 className="text-sm font-medium">{names[channel.kind]}</h3>
      <p className="mt-1 text-sm font-semibold">{channel.count?`${channel.count} ${channel.kind==="prices"?"observations":channel.kind==="documents"?"documents":"flow rows"}`:"Missing from this analysis"}</p>
      {channel.count?<p className="mt-1 text-xs text-[var(--text-muted)]">{channel.provenance.map(value=>value==="LIVE"?"Live-sourced":value==="CACHED"?"Cached source":"Synthetic demo").join(" + ")}</p>:null}
      <p className="mt-2 text-xs">{channel.dateBasis==="fixture"&&channel.count?"Latest fixture date":"Latest source date"}: <span className="whitespace-nowrap">{channel.latestDate??"Unknown"}</span></p>
      {channel.calendarAgeDays!==null?<p className="mt-1 text-xs text-[var(--text-muted)]">{channel.calendarAgeDays} calendar days old at capture (UTC). Not a trading-calendar assessment.</p>:null}
      {channel.dateAheadOfCapture?<p className="mt-1 text-xs text-[var(--insufficient)]">Source date is after capture; inspect timing before relying on it.</p>:null}
      <details className="mt-3 text-xs"><summary className="cursor-pointer py-1">Details: {names[channel.kind]}</summary>
        <dl className="mt-2 space-y-2 break-words"><div><dt>Date range</dt><dd>{channel.firstDate??"Unknown"} → {channel.latestDate??"Unknown"}</dd></div><div><dt>Known source retrieval range</dt><dd>{channel.dateBasis==="fixture"?"Not applicable to demo fixtures":`${time(channel.retrievedFrom)} → ${time(channel.retrievedThrough)}`}</dd></div><div><dt>Unknown dates / retrieval times</dt><dd>{channel.undatedCount} / {channel.retrievalUnknownCount}</dd></div><div><dt>Synthetic rows</dt><dd>{channel.syntheticCount}</dd></div></dl>
        <ul className="mt-2 space-y-2 text-[var(--text-muted)]">{channel.notes.map(note=><li key={note}>{note}</li>)}</ul>
        <ul className="mt-2 space-y-1">{channel.sources.map(source=><li key={source.name+source.url}>{safeUrl(source.url)?<a className="break-all text-[var(--brand)] underline" href={safeUrl(source.url)!} target="_blank" rel="noreferrer">{source.name}</a>:source.name}</li>)}</ul>
      </details>
    </article>)}</div>
    <p className="mt-3 text-xs text-[var(--text-muted)]">A new analysis can request newer inputs, but providers may return the same closing session or cached payload.</p>
  </section>;
}
