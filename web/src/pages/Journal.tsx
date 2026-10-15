import { useState } from "react";
import { readResearch, writeResearch, exportResearch, importResearch, evidenceBrief, JOURNAL_MAX_BYTES, type ResearchEntry } from "../research";
import { ProvenanceBadge } from "../components/LabelChip";
import { CitationChip } from "../components/CitationChip";
import { EvidenceCoveragePanel } from "../components/EvidenceCoveragePanel";

export function Journal() {
  const [entries, setEntries] = useState(readResearch);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function update(next: ResearchEntry[]) {
    try { writeResearch(next); setEntries(next); setError(""); }
    catch { setError("Could not save changes. Device storage may be full or unavailable."); }
  }
  return <div className="space-y-4">
    <section className="bento-hero rounded-xl border border-[var(--border)] p-5"><h1 className="text-2xl font-semibold">Research journal</h1><p className="mt-2 text-sm text-[var(--text-muted)]">Saved evidence snapshots and your notes. Stored only in this browser, with no account or cloud sync. Up to 50 recent snapshots; new saves replace the oldest when full.</p></section>
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3" aria-label="Journal backups">
      <p className="text-sm">Journal backups contain your private notes. Keep downloaded files private. Import merges without overwriting existing notes and rejects files that exceed 50 combined snapshots.</p>
      <div className="flex flex-wrap gap-3">
        <button className="rounded-md border border-[var(--border)] px-3 py-2" onClick={() => download("vibefinance-private-journal.json", exportResearch(entries), "application/json")}>Export private journal</button>
        <label className="block w-full min-w-0 max-w-full rounded-md border border-[var(--border)] px-3 py-2 sm:w-auto">Import journal<input aria-label="Import journal file" type="file" accept=".json,application/json" className="mt-2 block w-full min-w-0 max-w-full text-sm" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          try {
            if (file.size > JOURNAL_MAX_BYTES) throw new Error("Journal file exceeds 5 MB.");
            const text = await file.text();
            const next = importResearch(text, readResearch());
            writeResearch(next); setEntries(next); setError(""); setNotice("Journal imported on this device. Existing notes were preserved.");
          } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not import journal."); }
        }} /></label>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
    {error ? <p role="alert">{error}</p> : null}
    {!entries.length ? <section className="rounded-xl border border-[var(--border)] p-5"><p>Save an analysis from the dashboard to start your research journal.</p><a href="#/" className="mt-3 inline-block text-[var(--brand)]">Open dashboard →</a></section> : null}
    <div className="grid items-start gap-3 md:grid-cols-2">{entries.map((entry) => {
      const s = entry.synthesis;
      return <article key={entry.id} className="rounded-xl border border-[var(--border)] p-5">
        <header className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{s.ticker} · {s.profileId}</h2><ProvenanceBadge provenance={s.provenance} /></header>
        <p className="mt-2 text-xs text-[var(--text-muted)]">Saved {new Date(entry.savedAt).toLocaleString()} · as of {s.asOf}</p>
        <p className="mt-3">{s.personalised.action.toUpperCase()} · score {s.compositeScore.toFixed(2)} · confidence {(s.confidence * 100).toFixed(0)}%</p>
        <button className="mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={() => download(`vibefinance-${s.ticker}-evidence.md`, evidenceBrief(entry), "text/markdown")}>Download evidence brief (without notes)</button>
        <details className="mt-3"><summary className="cursor-pointer text-sm">Saved source coverage</summary><div className="mt-2"><EvidenceCoveragePanel synthesis={s} /></div></details>
        <label className="mt-4 block text-sm">Your research note<textarea maxLength={3000} className="mt-2 block w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3" rows={3} value={entry.note} onChange={(event) => update(entries.map((item) => item.id === entry.id ? { ...item, note: event.target.value } : item))} placeholder="What do you want to investigate or revisit?" /></label>
        <details className="mt-4"><summary className="cursor-pointer">Saved evidence and reasoning</summary><ul className="mt-3 space-y-3 text-sm">{s.summary.map((claim, i) => <li key={i}>{claim.text}<div>{claim.citations.map((citation, j) => <CitationChip key={j} citation={citation} />)}</div></li>)}</ul></details>
        <button className="mt-4 rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={() => { if (window.confirm("Remove this saved snapshot and note from this browser?")) update(entries.filter((item) => item.id !== entry.id)); }}>Remove saved note</button>
      </article>;
    })}</div>
  </div>;
}
