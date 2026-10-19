import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { API_BASE, DISCLAIMER } from "../api";
import { useStore } from "../store";
import { GlossaryButton } from "./Glossary";
import {accountSite,accountUrl,useAccount} from "../account";

const NAV = [
  ["/", "Dashboard"],
  ["/compare", "Compare"],
  ["/trace", "Trace"],
  ["/eval", "Eval"],
  ["/docs", "Docs"],
  ["/journal", "Journal"],
];

const MODES: { id: string; label: string; detail: string }[] = [
  { id: "feedDown", label: "Feed down", detail: "Use cached data if available. Live never substitutes synthetic prices." },
  { id: "missingFiling", label: "Missing filing", detail: "Sentiment becomes insufficient evidence." },
  { id: "conflictingAgents", label: "Conflicting agents", detail: "Force a disagreement and cap a conservative investor at hold." },
  { id: "llmDown", label: "LLM down", detail: "Deterministic explanations, same structure." },
  { id: "slowAgent", label: "Slow agent", detail: "Sentiment exceeds the timeout and is excluded." },
];

export function AppShell() {
  const account=useAccount();
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const aboutTrigger = useRef<HTMLButtonElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const degradeTrigger = useRef<HTMLButtonElement>(null);
  const provider = store.offline ? "offline" : (store.health?.provider ?? "connecting");
  const provenance = store.synthesis?.provenance ?? (store.mode === "live" ? "LIVE" : "SYNTHETIC");
  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="min-h-screen">
        <a href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--surface)] focus:p-3">Skip to main content</a>
        <header className="border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
            <button ref={navigationTrigger} className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
            <NavLink to="/" className="flex shrink-0 items-center" aria-label="VibeFinance home">
              <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" className="h-9 w-9 rounded-xl md:hidden" />
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="VibeFinance" className="hidden h-11 w-auto mix-blend-lighten md:block" />
            </NavLink>
            <nav className="hidden gap-3 md:flex">
              {NAV.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `text-sm ${isActive ? "text-[var(--brand)]" : "text-[var(--text-muted)]"}`}>
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {accountSite?<NavLink className="text-sm underline" to={account.user?"/account":"/login"}>{account.user?"Account":"Log in / Sign up"}</NavLink>:<a className="text-sm underline" href={accountUrl("login")}>Log in / Sign up</a>}
              {account.user?.isAdmin&&<a className="text-sm underline" href={`${API_BASE}/admin/users`}>Manage users</a>}
              <select className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1" value={store.ticker} onChange={(e) => store.setTicker(e.target.value)} aria-label="Ticker">
                {(store.tickers.length ? store.tickers : [{ ticker: "INFY" }]).map((t) => (
                  <option key={t.ticker}>{t.ticker}</option>
                ))}
              </select>
              <select className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1" value={store.profileId} onChange={(e) => store.setProfileId(e.target.value)} aria-label="Profile">
                <option value="conservative">Asha · Conservative</option>
                <option value="moderate">Rohan · Moderate</option>
                <option value="aggressive">Meera · Aggressive</option>
              </select>
              <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-sm" role="group" aria-label="Data mode">
                <button className={`rounded-md px-2 py-0.5 ${store.mode === "live" ? "bg-[var(--brand-fill)] text-white" : "text-[var(--text-muted)]"}`} aria-pressed={store.mode === "live"} onClick={() => store.setMode("live")}>Live</button>
                <button className={`rounded-md px-2 py-0.5 ${store.mode === "demo" ? "bg-[var(--brand-fill)] text-white" : "text-[var(--text-muted)]"}`} aria-pressed={store.mode === "demo"} onClick={() => store.setMode("demo")}>Demo</button>
              </div>
              <button ref={degradeTrigger} className="rounded-lg border border-[var(--border)] px-2 py-1 text-sm" onClick={() => setOpen(true)}>
                Degrade · {store.degrade.length}
              </button>
              <span className="hidden rounded-md border border-[var(--border)] px-2 py-0.5 text-xs xl:inline">{store.mode === "demo" ? "Explanations: deterministic" : `Configured provider: ${provider}`}</span>
              <Tooltip.Root>
                <Tooltip.Trigger className="rounded-md border px-2 py-0.5 text-xs" style={{ color: provenance === "LIVE" ? "var(--bull)" : provenance === "CACHED" ? "var(--doc)" : "var(--insufficient)", borderColor: provenance === "LIVE" ? "var(--bull)" : provenance === "CACHED" ? "var(--doc)" : "var(--insufficient)" }}>{provenance}</Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="rounded bg-[var(--surface-2)] px-2 py-1 text-xs">Each citation identifies its own provenance; sources may have different coverage and freshness.</Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </div>
          </div>
        </header>
        {store.offline ? <Banner text={store.mode === "live" ? "API unreachable. Reconnect for live analysis, or switch to Demo." : "API unreachable. The offline demo supports INFY for Rohan."} /> : null}
        {store.degrade.length > 0 ? <Banner text={degradeCopy(store.degrade)} /> : null}
        {store.mode === "demo" ? <Banner text="Demo: seeded data and deterministic explanations" /> : null}
        {store.mode === "live" && (provider === "mock" || store.synthesis?.degraded.includes("llm_fallback")) ? <Banner text="LLM unavailable: deterministic explanations" /> : null}
        <main id="main-content" tabIndex={-1} className="app-bento mx-auto max-w-7xl px-4 py-4">
          <Outlet />
        </main>
        <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 px-4 py-6 text-xs text-[var(--text-muted)]">
          <span>{DISCLAIMER}</span>
          <div className="flex gap-4"><GlossaryButton /><button ref={aboutTrigger} className="underline" onClick={() => setAbout(true)}>About the data</button></div>
        </footer>
        <DegradeSheet open={open} onOpenChange={setOpen} restoreFocus={() => degradeTrigger.current?.focus()} />
        <AboutDialog open={about} onOpenChange={setAbout} restoreFocus={() => aboutTrigger.current?.focus()} />
        <MobileNav open={navOpen} onOpenChange={setNavOpen} restoreFocus={() => navigationTrigger.current?.focus()} />
        <div aria-live="polite" className="sr-only">
          {store.synthesis ? `Analysis complete: ${store.synthesis.compositeLabel}, confidence ${Math.round(store.synthesis.confidence * 100)}%` : ""}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

function Banner({ text }: { text: string }) {
  return <div className="bg-[var(--insufficient)]/15 px-4 py-2 text-center text-sm text-[var(--insufficient)]">{text}</div>;
}

function degradeCopy(modes: string[]): string {
  return modes.map((m) => MODES.find((x) => x.id === m)?.detail ?? m).join(" ");
}

function DegradeSheet({ open, onOpenChange, restoreFocus }: { open: boolean; onOpenChange: (v: boolean) => void; restoreFocus: () => void }) {
  const store = useStore();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} className="fixed top-0 right-0 z-50 m-0 h-full w-[min(360px,100%)] overflow-auto border-l border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)]">
      <div className="mb-4 flex items-center justify-between">
        <Dialog.Title className="font-semibold">Degrade</Dialog.Title>
        <Dialog.Close>Close</Dialog.Close>
      </div>
      <Dialog.Description className="mb-4 text-sm text-[var(--text-muted)]">Simulate source and model failures to inspect resilience.</Dialog.Description>
      <div className="space-y-4">
        {MODES.map((mode) => (
          <label key={mode.id} className="flex items-start justify-between gap-3">
            <span>
              <span className="block">{mode.label}</span>
              <span className="text-xs text-[var(--text-muted)]">{mode.detail}</span>
            </span>
            <Switch.Root aria-label={mode.label} checked={store.degrade.includes(mode.id)} onCheckedChange={() => store.toggleDegrade(mode.id)} className="h-6 w-10 shrink-0 rounded-full bg-[var(--surface-2)] data-[state=checked]:bg-[var(--brand-fill)]">
              <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-4" />
            </Switch.Root>
          </label>
        ))}
      </div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  );
}

function AboutDialog({ open, onOpenChange, restoreFocus }: { open: boolean; onOpenChange: (v: boolean) => void; restoreFocus: () => void }) {
  const store = useStore();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} className="fixed top-1/2 left-1/2 max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <Dialog.Title className="text-lg font-semibold">About the data · {store.mode === "live" ? "Live" : "Demo"}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-[var(--text-muted)]">Sources, provenance and limitations for the selected mode.</Dialog.Description>
          <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-muted)]">
            {store.mode === "live" ? <>
              <p>Prices are daily NSE close-field observations retrieved through Yahoo Finance, not guaranteed final closing prices or real-time trading quotes. Each citation identifies whether its data is LIVE or CACHED.</p>
              <p>The feed supplies daily bars' close fields. The latest bar may still be provisional: exchange-session completion is not verified. Neither LIVE provenance nor a recent retrieval timestamp proves a completed or up-to-date trading session.</p>
              <p>NSE announcements provide titles and summaries; available news comes from GDELT. Coverage can be incomplete. Missing filings are reported as insufficient evidence.</p>
              <p>NSE FII/DII data, when available, describes market-wide flows. It does not establish the flow into an individual stock or sector. Check each citation's provenance before interpreting a flow.</p>
              <p>OpenAI writes explanations from the supplied evidence. If the model is unavailable, deterministic explanations are used and flagged.</p>
              {store.offline ? <p className="text-[var(--insufficient)]">The live API is currently unreachable. Live analysis requires a connection to the backend.</p> : null}
            </> : <>
            <p>Synthetic NSE-style prices come from a seeded regime generator. They are not live quotes.</p>
            <p>Synthetic SEBI-style filings and earnings transcripts are templates. Each body starts with a synthetic-document banner.</p>
            <p>Sector FII/DII flows are synthetic. A hand-downloaded NSE CSV, when present, is market-wide only and is cited as market-wide.</p>
            <p>Demo explanations are deterministic and use seeded evidence.</p>
            </>}
            <p>Sentiment is a lexicon over retrieved chunks, not a model of management intent.</p>
            <p>New analyses freeze the chart and cited source evidence together. Refresh an analysis to request newer data.</p>
            <p>Demo requires no account. Live requires a logged-in account approved by the administrator. Account sessions use an HTTP-only cookie for 30 days, with explicit renewal and logout. Email addresses and password hashes are stored on the backend; email addresses are not verified. An anonymous visitor token is still used for Demo usage and history. Operational records include usage and a keyed network identifier, not raw IP addresses. Journal notes stay on this device, are shared by users of this browser, and are not account-synced. Hosting infrastructure may retain separate access logs.</p>
            <p>Accuracy against 30-day forward returns is an evaluation on this fixture or on a pinned snapshot. It is not a forecast.</p>
            <p>This is not SEBI-registered advice. Not financial advice. Demonstration only.</p>
          </div>
          <Dialog.Close className="mt-4 rounded-md border border-[var(--border)] px-3 py-2">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MobileNav({ open, onOpenChange, restoreFocus }: { open: boolean; onOpenChange: (v: boolean) => void; restoreFocus: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} className="fixed inset-y-0 left-0 z-50 w-64 bg-[var(--surface)] p-4">
        <Dialog.Title className="sr-only">Navigation</Dialog.Title>
        <Dialog.Description className="sr-only">Choose a VibeFinance page.</Dialog.Description>
        <Dialog.Close className="mb-4 rounded-md border border-[var(--border)] px-3 py-2">Close menu</Dialog.Close>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="VibeFinance" className="mb-4 h-12 w-auto mix-blend-lighten" />
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} className="block py-2" onClick={() => onOpenChange(false)}>
            {label}
          </NavLink>
        ))}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  );
}
