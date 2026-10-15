import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchDoc, fetchSearch } from "../api";
import { ProvenanceBadge } from "../components/LabelChip";
import { useStore } from "../store";
import type { SearchHit } from "@vibefinance/shared";

export function Docs() {
  const { docId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const chunk = params.get("chunk");
  const snapshotId = params.get("snapshotId") ?? undefined;
  const store = useStore();
  const [doc, setDoc] = useState<{ title: string; type: string; date: string; body: string; provenance: string; sourceUrl?: string | null; chunks: { id: string; text: string }[] } | null>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const query = params.get("q") ?? "";
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");

  useEffect(() => { setQ(query); }, [query]);

  useEffect(() => {
    if (store.loading) return;
    let cancelled = false;
    const controller = new AbortController();
    setSearching(true);
    setError("");
    setHits([]);
    if (store.health && !store.health.features.includes("x2")) {
      setError("Evidence search is disabled on this backend. You can still open documents from their citations.");
      setSearching(false);
      return;
    }
    if (store.offline) {
      setError("Document search requires the API connection. Please try again when the backend is available.");
      setSearching(false);
      return;
    }
    void fetchSearch(query, store.ticker, store.mode, controller.signal).then((r) => {
      if (!cancelled) { setHits(r.hits); setSearched(true); }
    }).catch(() => {
      if (!cancelled) { setHits([]); setError("Document search is unavailable. You can still open source links from analysis citations."); }
    }).finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [query, store.ticker, store.mode, store.offline, store.loading, store.health]);

  useEffect(() => {
    if (!docId || store.offline) { setDoc(null); return; }
    let cancelled = false;
    const controller = new AbortController();
    setDoc(null);
    setDocError("");
    setDocLoading(true);
    void fetchDoc(docId, snapshotId, controller.signal).then((value) => { if (!cancelled) setDoc(value); }).catch(() => { if (!cancelled) setDocError("This document could not be loaded. Open its original source from the citation when available."); }).finally(() => { if (!cancelled) setDocLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [docId, snapshotId, store.offline]);

  useEffect(() => {
    if (doc && chunk) document.getElementById(chunk)?.scrollIntoView({ block: "center" });
  }, [doc, chunk]);

  const documents = hits.filter((hit, index) => hits.findIndex((candidate) => candidate.docId === hit.docId) === index);

  return (
    <div className="space-y-4">
      <section className="bento-hero rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h1 className="text-2xl font-semibold">Evidence library</h1>
        {snapshotId ? <p className="mt-2 text-sm text-[var(--text-muted)]">Viewing a frozen source from a saved analysis. Search results below are current and may differ.</p> : null}
        <p className="mt-2 text-sm text-[var(--text-muted)]">Search {store.mode === "live" ? "available announcements and news" : "seeded filings and transcripts"} for {store.ticker}. Open citations to inspect the evidence behind an analysis.</p>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          next.set("q", q.trim());
          setParams(next);
        }}
      >
        <input className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search filings" placeholder="Search guidance, results or announcements" />
        <button className="rounded-lg bg-[var(--brand-fill)] px-3 text-white">Search</button>
      </form>
      {searching || store.loading ? <p role="status" className="text-sm text-[var(--text-muted)]">Loading available evidence…</p> : null}
      {error ? <p role="alert" className="text-sm text-[var(--insufficient)]">{error}</p> : null}
      {!searching && !store.loading && searched && !error && hits.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No matching evidence is available for {store.ticker}. Try another search or ticker. Live coverage may be incomplete.</p> : null}
      {hits.length > 0 ? (
        <ul className="mb-4 grid gap-3 md:grid-cols-2 text-sm">
          {documents.map((hit) => (
            <li key={hit.chunkId} className="rounded-xl border border-[var(--border)] p-4">
              {hit.title} · {hit.score.toFixed(2)} <ProvenanceBadge provenance={hit.provenance} />
              <p className="text-[var(--text-muted)]">{hit.snippet.slice(0, 180)}</p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">Source date (publication or indexing): {hit.date || "Not recorded"} · retrieval: {hit.provenance==="SYNTHETIC"?"Not applicable (demo)":hit.fetchedAt ? new Date(hit.fetchedAt).toLocaleString() : "Not recorded"}</p>
              <Link className="mt-2 inline-block text-[var(--brand)]" to={`/docs/${encodeURIComponent(hit.docId)}?chunk=${encodeURIComponent(hit.chunkId)}&q=${encodeURIComponent(query)}`}>Read source →</Link>
            </li>
          ))}
        </ul>
      ) : null}
      {!docId ? <p className="text-sm text-[var(--text-muted)]">Open a citation to read the source chunk.</p> : null}
      </section>
      {docLoading ? <p role="status">Loading document…</p> : null}
      {docError ? <p role="alert">{docError}</p> : null}
      {doc ? (
        <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="mb-2 flex items-center gap-2">
            <ProvenanceBadge provenance={doc.provenance} />
            <span className="text-xs text-[var(--text-muted)]">{doc.type} · source date {doc.date || "not recorded"}</span>
          </div>
          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <Link to={`/docs?q=${encodeURIComponent(query)}`} className="mt-3 inline-block text-[var(--brand)]">← Back to results</Link>
          {doc.sourceUrl ? <a href={doc.sourceUrl} target="_blank" rel="noreferrer" className="ml-4 text-[var(--brand)]">Original source ↗</a> : null}
          {doc.provenance !== "SYNTHETIC" ? <p className="mt-2 text-xs text-[var(--text-muted)]">Available announcement or news summary; not a full filing or transcript.</p> : null}
          {doc.body.startsWith("[SYNTHETIC") ? <p className="mt-2 text-xs text-[var(--insufficient)]">SYNTHETIC DOCUMENT</p> : null}
          <div className="mt-4 space-y-4">
            {doc.chunks.map((c) => (
              <p key={c.id} id={c.id} className={`text-sm leading-7 ${c.id === chunk ? "border-l-2 border-[var(--doc)] pl-3" : ""}`}>
                <span className="mono mr-2 text-[10px] text-[var(--text-muted)]">{c.id}</span>
                {c.text}
              </p>
            ))}
          </div>
        </article>
      ) : null}
    </div>
  );
}
