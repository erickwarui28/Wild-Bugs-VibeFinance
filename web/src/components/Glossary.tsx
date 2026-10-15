import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

export const GLOSSARY = [
  { id:"confidence", term:"Evidence confidence", text:"An app-specific indicator combining evidence quality and signal strength. It is not the probability that a price will rise, and it is not a guarantee of correctness." },
  { id:"agreement", term:"Agent agreement", text:"How closely the specialist signals align. Agreement can be high even when every agent is wrong; disagreement reduces composite confidence." },
  { id:"provenance", term:"Live, cached and synthetic", text:"Live identifies data obtained from a real source, not a real-time quote. Cached means a retained source snapshot. Synthetic means simulated fixtures. None of these labels alone establishes freshness or completeness." },
  { id:"snapshot", term:"Frozen evidence snapshot", text:"The exact price rows, documents, flows and retrieved excerpts captured for one analysis. Opening a saved result does not update its evidence. A newly captured timestamp is not a new market observation." },
  { id:"freshness", term:"Observation, retrieval and capture", text:"Observation is the source's session or document date. Retrieval is when the backend obtained that source payload, when recorded. Capture is when the app froze an analysis. Calendar age at capture uses UTC dates, not an exchange holiday calendar." },
  { id:"coverage", term:"Evidence coverage", text:"Which evidence categories supplied rows to this analysis. A source row or headline does not prove full coverage of filings or market activity. Missing means not supplied here, not that the evidence does not exist elsewhere." },
  { id:"rsi", term:"RSI (Relative Strength Index)", text:"Compares recent price gains and losses on a 0–100 scale. This app uses 14 closing-price changes. High or low RSI is not, by itself, an instruction to buy or sell.", url:"https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI" },
  { id:"sma", term:"SMA (Simple Moving Average)", text:"The arithmetic average of recent closing observations. SMA20 and SMA50 refer to 20 and 50 observations, not necessarily 20 and 50 calendar days. Historical trend does not predict a future return." },
  { id:"volatility", term:"Volatility", text:"Variability of recent daily returns, scaled here using 252 sessions per year. It measures one form of historical risk, not every risk or a forecast." },
  { id:"drawdown", term:"Drawdown", text:"A decline from an earlier peak. The app's 60-observation drawdown describes the selected historical window; it does not bound future losses." },
  { id:"beta", term:"Beta", text:"Historical return sensitivity to a comparison basket. This app uses an equal-weight basket of available instruments, not necessarily a broad-market index. The result depends on the supplied history." },
  { id:"flows", term:"FII/FPI and DII net flows", text:"Foreign portfolio and domestic institutional net purchases (buying minus selling). The imported NSE CSV is market-wide, not evidence of flows into an individual company or sector. Demo sector flows are simulated.", url:"https://www.nseindia.com/reports/fii-dii" },
  { id:"hhi", term:"HHI (concentration)", text:"The sum of squared portfolio weights, expressed as fractions. Higher values mean greater weight concentration. Effective holdings is 1/HHI: a concentration equivalent, not a guarantee of independent risks." },
  { id:"allocation", term:"Illustrative allocation", text:"An example profile's sizing percentage, constrained by risk tolerance and concentration rules. It is not a verified target portfolio weight. These are example portfolios, not your actual holdings or a trade instruction.", url:"https://www.investor.gov/introduction-investing/getting-started/asset-allocation" },
  { id:"brier", term:"Fixture Brier score", text:"Squared error between a probability-like score and a binary outcome; lower is better under the same evaluation setup. Here it is a synthetic-fixture diagnostic, not evidence of calibrated live forecasts." },
  { id:"latency", term:"p50 / p95 latency", text:"Elapsed result times: the median and the value at or below which approximately 95% of measured requests fall. The sample is this visitor's recorded executions, not a promise about future speed." },
] as const;
export type GlossaryId = typeof GLOSSARY[number]["id"];

export function GlossaryButton({ term, label = "Glossary" }: { term?: GlossaryId; label?: string }) {
  const [query,setQuery]=useState("");
  const found=GLOSSARY.find(entry=>entry.id===term);
  const matches=GLOSSARY.filter(entry=>`${entry.term} ${entry.text}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <Dialog.Root onOpenChange={open=>{if(open)setQuery(found?.term??"");}}>
    <Dialog.Trigger className="rounded-sm underline decoration-dotted underline-offset-4" aria-label={term?`Explain ${label}`:"Glossary"}>{label}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/65" />
      <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(700px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <Dialog.Title className="text-lg font-semibold">Research glossary</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-[var(--text-muted)]">Plain-language definitions and how VibeFinance uses them. Educational context, not investment advice.</Dialog.Description>
        <label className="mt-3 text-sm">Find a term<input value={query} onChange={event=>setQuery(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2" /></label>
        <button className="mt-2 self-start rounded-md px-2 py-1 text-sm text-[var(--brand)]" onClick={()=>setQuery("")}>Show all terms</button>
        <div className="mt-3 overflow-y-auto pr-2" tabIndex={0} aria-label="Glossary definitions">
          <p role="status" className="mb-3 text-xs text-[var(--text-muted)]">{matches.length} definitions</p>
          <dl className="space-y-4">{matches.map(entry=><div key={entry.id}><dt className="font-semibold">{entry.term}</dt><dd className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{entry.text}{"url" in entry?<a className="ml-2 text-[var(--brand)] underline" href={entry.url} target="_blank" rel="noreferrer">Source: {entry.id==="rsi"?"Fidelity":entry.id==="flows"?"NSE":"Investor.gov"}</a>:null}</dd></div>)}</dl>
          {!matches.length?<p className="text-sm">No matching terms. Try RSI, confidence, flows or snapshot.</p>:null}
        </div>
        <Dialog.Close className="mt-4 self-start rounded-md border border-[var(--border)] px-3 py-2">Close glossary</Dialog.Close>
      </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
