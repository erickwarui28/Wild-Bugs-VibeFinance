import { DISCLAIMER, SearchResponse, EvaluationReport, LatencyReport, type CompareResponse, type Health, type Synthesis, type TraceStep } from "@vibefinance/shared";

const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
export const API_BASE = configured || (import.meta.env.DEV ? "" : "https://67.211.211.236");
const BASE = import.meta.env.BASE_URL;

let visitorPromise: Promise<string> | null = null;
let visitorToken = "";
async function visitorHeaders(): Promise<Record<string, string>> {
  if (!visitorPromise) visitorPromise = (async () => {
    try { visitorToken = localStorage.getItem("vf-visitor-token-v1") ?? ""; } catch { /* Memory-only when storage is blocked. */ }
    if (!visitorToken) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const response = await fetch(`${API_BASE}/api/visitor`, { method: "POST", signal: ctrl.signal });
        if (!response.ok) throw new Error("Could not establish anonymous visitor identity. Please retry.");
        const identity = await response.json() as { token: string };
        if (typeof identity.token !== "string" || !identity.token.startsWith("visitor_")) throw new Error("Invalid visitor identity response");
        visitorToken = identity.token;
        try { localStorage.setItem("vf-visitor-token-v1", visitorToken); } catch { /* Memory-only. */ }
      } finally { clearTimeout(timer); }
    }
    return visitorToken;
  })().catch((error) => { visitorPromise = null; throw error; });
  return { "x-vf-visitor": await visitorPromise };
}

async function checkIdentity(response: Response): Promise<void> {
  if(response.status===401 && response.url.includes('/api/auth/'))return;
  if (response.status !== 401) return;
  const body=await response.clone().json().catch(()=>({})) as {code?:string};
  if(body.code==="LOGIN_REQUIRED")throw new Error("Your Live login is missing or expired. Log in again; Demo remains available.");
  visitorPromise = null; visitorToken = "";
  try { localStorage.removeItem("vf-visitor-token-v1"); } catch { /* Blocked storage. */ }
  throw new Error("Your anonymous identity is no longer valid. Reload the page to reconnect.");
}

export interface TickerRow {
  ticker: string;
  sector: string;
  lastClose: number;
  provenance: "LIVE" | "CACHED" | "SYNTHETIC";
  asOf: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  age: number;
  riskTolerance: "conservative" | "moderate" | "aggressive";
  maxVol: number;
  holdings: { ticker: string; weight: number }[];
  behaviour: string[];
}

export function sessionId(): string {
  const key = "vf-session";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

async function getJson<T>(path: string, timeoutMs = 20000, callerSignal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, ctrl.signal]) : ctrl.signal;
  try {
    const headers = path === "/api/health" ? {} : await visitorHeaders();
    signal.throwIfAborted();
    const res = await fetch(`${API_BASE}${path}`, { signal, headers, credentials:"include" });
    await checkIdentity(res);
    if (res.status === 429) throw new Error("rate");
    if (!res.ok) throw new Error(await errorMessage(res,`request failed ${res.status}`));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    return await getJson<Health>("/api/health", 3000);
  } catch {
    return null;
  }
}

export type RunMode = "live" | "demo";

export async function fetchTickers(mode: RunMode, signal?: AbortSignal): Promise<TickerRow[]> {
  const body = await getJson<{ tickers: TickerRow[] }>(`/api/tickers?mode=${mode}`, 20000, signal);
  return body.tickers;
}

export async function fetchProfiles(signal?: AbortSignal): Promise<ProfileRow[]> {
  const body = await getJson<{ profiles: ProfileRow[] }>("/api/profiles", 20000, signal);
  return body.profiles;
}

export async function fetchMarket(ticker: string, asOf: string, mode: RunMode, snapshotId?: string, signal?: AbortSignal) {
  return getJson<{ bars: { date: string; close: number; open: number; high: number; low: number; volume: number; spike: boolean; provenance: string }[]; asOf: string }>(
    snapshotId ? `/api/snapshots/${encodeURIComponent(snapshotId)}/market` : `/api/market/${ticker}?asOf=${asOf}&mode=${mode}`,
    20000, signal,
  );
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export interface RunOptions { signal?: AbortSignal; refresh?: boolean }
async function postRun<T>(path: string, body: object, options: RunOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const headers = await visitorHeaders();
    signal.throwIfAborted();
    const response = await fetch(`${API_BASE}${path}`, { method: "POST", signal,
      headers: { "content-type": "application/json", ...headers }, credentials:"include", body: JSON.stringify({ ...body, refresh: options.refresh ?? false }) });
    await checkIdentity(response);
    if (!response.ok) throw new Error(await errorMessage(response, "Analysis could not complete. Please retry."));
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error("Analysis request timed out. Please retry; any unknown model billing remains reserved.");
    throw error;
  } finally { clearTimeout(timer); }
}

export function postAnalyze(ticker: string, profileId: string, degrade: string[], mode: RunMode, options: RunOptions = {}): Promise<Synthesis> {
  return postRun("/api/analyze", { ticker, profileId, sessionId: sessionId(), degrade, mode }, options);
}

export function postCompare(ticker: string, degrade: string[], mode: RunMode, options: RunOptions = {}): Promise<CompareResponse> {
  return postRun("/api/compare", { ticker, sessionId: sessionId(), degrade, mode }, options);
}

export async function fetchTrace(runId: string, signal?: AbortSignal): Promise<TraceStep[]> {
  const body = await getJson<{ steps: TraceStep[] }>(`/api/trace/${runId}`, 20000, signal);
  return body.steps;
}

export async function fetchDoc(docId: string, snapshotId?: string, signal?: AbortSignal) {
  return getJson<{
    id: string;
    title: string;
    type: string;
    date: string;
    body: string;
    provenance: string;
    sourceUrl?: string | null;
    chunks: { id: string; text: string }[];
  }>(`/api/docs/${encodeURIComponent(docId)}${snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : ""}`, 20000, signal);
}

export async function fetchMetrics(signal?: AbortSignal) {
  return getJson<{
    accuracy: { hitRate: number; n: number; spread: number };
    latency: { p50: number; p95: number; max: number };
    hhi: { before: number; after: number; effectiveHoldings: number };
    brier: number;
    uncitedDropped: number;
  }>(`/api/metrics?sessionId=${sessionId()}`, 20000, signal);
}

export async function fetchAlerts() {
  return getJson<{ alerts: { id: string; ticker: string; kind: string; message: string }[] }>(`/api/alerts?sessionId=${sessionId()}`);
}

export async function fetchHistory() {
  return getJson<{ decisions: { ticker: string; action: string; size_pct: number; composite: number; created_at: string }[] }>(
    `/api/sessions/${sessionId()}/history`,
  );
}

export async function fetchEval(signal?: AbortSignal) {
  const response = await getJson<{ backtest: unknown; latency: unknown }>("/api/eval", 20000, signal);
  return { backtest: response.backtest === null ? null : EvaluationReport.parse(response.backtest),
    latency: response.latency === null ? null : LatencyReport.parse(response.latency) };
}

export async function fetchSearch(q: string, ticker: string, mode: RunMode, signal?: AbortSignal) {
  const result = await getJson<unknown>(
    `/api/search?q=${encodeURIComponent(q)}&ticker=${encodeURIComponent(ticker)}&mode=${mode}`,
    20000, signal,
  );
  return SearchResponse.parse(result);
}

export async function loadDemo<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}demo/${name}`);
  if (!res.ok) throw new Error("demo missing");
  return (await res.json()) as T;
}

export { DISCLAIMER };
