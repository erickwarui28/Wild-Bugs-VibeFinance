import type { Citation } from "@vibefinance/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ProvenanceBadge } from "./LabelChip";

export function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  if (citation.type === "data") {
    const flows = citation.source === "flows";
    const text = flows
      ? `FII ${citation.field} = ${citation.value.toLocaleString("en-IN")} cr`
      : `${citation.field}@${citation.asOf} = ${citation.value.toLocaleString("en-IN")}`;
    const percentage = /^(ret\d+|vol\d+|maxDrawdown\d+|profile\.sectorWeight)$/.test(citation.field);
    const price = /^(close|sma\d+)$/.test(citation.field);
    const value = flows ? `${citation.value.toLocaleString("en-IN")} crore INR`
      : percentage ? `${(citation.value * 100).toFixed(2)}%`
      : price ? `₹${citation.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
      : citation.value.toLocaleString("en-IN");
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="my-1 mr-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--data)]/40 bg-[var(--data)]/10 px-2 py-1 text-[11px] text-[var(--data)]" title={citation.origin ?? citation.source}>
        <span aria-hidden>{flows ? "🏦" : "📊"}</span>
        {text}
        <ProvenanceBadge provenance={citation.provenance} dotOnly />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <Dialog.Title className="font-semibold">Evidence: {citation.field}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-[var(--text-muted)]">The measured or derived value supporting this claim.</Dialog.Description>
          {citation.snapshotId ? <p className="mt-2 text-xs text-[var(--text-muted)]">Frozen analysis evidence · {citation.snapshotId}</p> : null}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><dt>Value</dt><dd>{value}</dd><dt>As of</dt><dd>{citation.asOf}</dd><dt>Source / calculation</dt><dd className="break-words">{citation.origin ?? citation.source}</dd><dt>Provenance</dt><dd>{citation.provenance}</dd><dt>Fetched</dt><dd>{citation.fetchedAt ?? "Not recorded"}</dd></dl>
          <Dialog.Close className="mt-4 rounded-md border border-[var(--border)] px-3 py-2">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="my-1 mr-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--doc)]/40 bg-[var(--doc)]/10 px-2 py-1 text-[11px] text-[var(--doc)]">
        <span aria-hidden>📄</span>
        {citation.chunkId} · {citation.score.toFixed(2)}
        <ProvenanceBadge provenance={citation.provenance} dotOnly />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <Dialog.Title className="text-base font-semibold">{citation.docId}</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs text-[var(--text-muted)]">Source excerpt supporting the analysis.</Dialog.Description>
          <p className="mt-3 text-sm leading-6">{citation.snippet}</p>
          <div className="mt-4 flex gap-3 text-sm">
            <Link className="text-[var(--brand)]" to={`/docs/${encodeURIComponent(citation.docId)}?chunk=${encodeURIComponent(citation.chunkId)}${citation.snapshotId ? `&snapshotId=${encodeURIComponent(citation.snapshotId)}` : ""}`} onClick={() => setOpen(false)}>
              Open document
            </Link>
            {citation.sourceUrl ? (
              <a className="text-[var(--doc)]" href={citation.sourceUrl} target="_blank" rel="noreferrer">
                Source
              </a>
            ) : null}
          </div>
          <Dialog.Close className="mt-4 rounded-md border border-[var(--border)] px-3 py-2">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
