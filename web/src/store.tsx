import type { Synthesis } from "@vibefinance/shared";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  fetchHealth,
  fetchMetrics,
  fetchProfiles,
  fetchTickers,
  loadDemo,
  postAnalyze,
  type ProfileRow,
  type RunMode,
  type TickerRow,
} from "./api";
import type { Health } from "@vibefinance/shared";

interface Metrics {
  accuracy: { hitRate: number; n: number; spread: number };
  latency: { p50: number; p95: number; max: number };
  hhi: { before: number; after: number; effectiveHoldings: number };
  brier: number;
  uncitedDropped: number;
}

interface Store {
  offline: boolean;
  health: Health | null;
  tickers: TickerRow[];
  profiles: ProfileRow[];
  ticker: string;
  profileId: string;
  degrade: string[];
  mode: RunMode;
  synthesis: Synthesis | null;
  metrics: Metrics | null;
  loading: boolean;
  ready: boolean;
  setTicker: (t: string) => void;
  setProfileId: (id: string) => void;
  toggleDegrade: (mode: string) => void;
  setMode: (mode: RunMode) => void;
  run: (opts?: { ticker?: string; profileId?: string; refresh?: boolean }) => Promise<void>;
  cancelRun: () => void;
}

const Ctx = createContext<Store | null>(null);
export function useStore(): Store {
  const value = useContext(Ctx);
  if (!value) throw new Error("store missing");
  return value;
}

const EMPTY_METRICS: Metrics = {
  accuracy: { hitRate: 0, n: 0, spread: 0 },
  latency: { p50: 0, p95: 0, max: 0 },
  hhi: { before: 0, after: 0, effectiveHoldings: 0 },
  brier: 0,
  uncitedDropped: 0,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [tickers, setTickers] = useState<TickerRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [ticker, setTicker] = useState("INFY");
  const [profileId, setProfileId] = useState("moderate");
  const [degrade, setDegrade] = useState<string[]>([]);
  const [mode, setModeState] = useState<RunMode>(() => (localStorage.getItem("vf-run-mode") === "demo" ? "demo" : "live"));
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const runGen = useRef(0);
  const activeRun = useRef<AbortController | null>(null);
  function cancelRun() { runGen.current++; activeRun.current?.abort(); activeRun.current = null; setLoading(false); }

  async function run(opts?: { ticker?: string; profileId?: string; offline?: boolean; mode?: RunMode; refresh?: boolean }) {
    activeRun.current?.abort();
    const controller = new AbortController(); activeRun.current = controller;
    const nextTicker = opts?.ticker ?? ticker;
    const nextProfile = opts?.profileId ?? profileId;
    const nextOffline = opts?.offline ?? offline;
    const nextMode = opts?.mode ?? mode;
    const seq = ++runGen.current;
    setTicker(nextTicker);
    setProfileId(nextProfile);
    setLoading(true);
    try {
      if (nextOffline) {
        if (nextMode === "live" || nextTicker !== "INFY" || nextProfile !== "moderate") {
          toast("Offline analysis supports only the INFY / Rohan demo. Reconnect for other selections.");
          return;
        }
        const demo = await loadDemo<Synthesis>("demo-infy-moderate.json");
        if (seq !== runGen.current) return;
        setSynthesis(demo);
        return;
      }
      const result = await postAnalyze(nextTicker, nextProfile, degrade, nextMode, { signal: controller.signal, refresh: opts?.refresh });
      if (seq !== runGen.current) return;
      setSynthesis(result);
      const nextMetrics = await fetchMetrics(controller.signal).catch(() => EMPTY_METRICS);
      if (seq !== runGen.current) return;
      setMetrics(nextMetrics);
    } catch (err) {
      if (seq !== runGen.current || controller.signal.aborted) return;
      if (err instanceof Error && err.message === "rate") {
        toast("Too many runs: showing the last result.");
        return;
      }
      toast(err instanceof Error && err.message !== "rate" ? err.message : "Analysis failed. You can retry, or switch to Demo if the feed is down.");
    } finally {
      if (activeRun.current === controller) activeRun.current = null;
      if (seq === runGen.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const metadataController = new AbortController();
    void (async () => {
      const h = await fetchHealth();
      if (cancelled) return;
      if (!h) {
        setOffline(true);
        setHealth(null);
        setTickers([{ ticker: "INFY", sector: "IT", lastClose: 0, provenance: "SYNTHETIC", asOf: "2026-09-30" }]);
        setReady(true);
        setLoading(false);
        return;
      }
      setHealth(h);
      setOffline(false);
      setReady(true);
      setLoading(false);
      try {
        const [nextTickers, nextProfiles] = await Promise.all([fetchTickers(mode, metadataController.signal), fetchProfiles(metadataController.signal)]);
        if (cancelled) return;
        setTickers(nextTickers);
        setProfiles(nextProfiles);
      } catch (err) {
        if (!cancelled) toast(err instanceof Error ? err.message : "Could not load the watchlist.");
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
      metadataController.abort(); activeRun.current?.abort();
      runGen.current += 1;
    };
  }, [mode]);

  function toggleDegrade(flag: string) {
    activeRun.current?.abort();
    runGen.current += 1;
    setSynthesis(null);
    setLoading(false);
    setDegrade((curr) => (curr.includes(flag) ? curr.filter((m) => m !== flag) : [...curr, flag]));
  }

  function setMode(next: RunMode) {
    if (next === mode) return;
    activeRun.current?.abort(); runGen.current++;
    localStorage.setItem("vf-run-mode", next);
    setModeState(next);
    setSynthesis(null);
    setReady(false);
    setLoading(true);
  }

  function selectTicker(next: string) {
    if (next === ticker) return;
    activeRun.current?.abort();
    runGen.current += 1;
    setTicker(next);
    setSynthesis(null);
    setMetrics(null);
    setLoading(false);
  }

  function selectProfile(next: string) {
    if (next === profileId) return;
    activeRun.current?.abort();
    runGen.current += 1;
    setProfileId(next);
    setSynthesis(null);
    setMetrics(null);
    setLoading(false);
  }

  const value = useMemo(
    () => ({ offline, health, tickers, profiles, ticker, profileId, degrade, mode, synthesis, metrics, loading, ready, setTicker: selectTicker, setProfileId: selectProfile, toggleDegrade, setMode, run, cancelRun }),
    [offline, health, tickers, profiles, ticker, profileId, degrade, mode, synthesis, metrics, loading, ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
