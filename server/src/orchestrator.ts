import {
  DISCLAIMER,
  type AgentName,
  type AgentOutput,
  type Profile,
  type Synthesis,
} from "@vibefinance/shared";
import { personalise } from "./agents/profile.js";
import { runMomentum } from "./agents/momentum.js";
import { runRisk } from "./agents/risk.js";
import { runSentiment } from "./agents/sentiment.js";
import { aggregate } from "./agents/synthesizer.js";
import { runVolume } from "./agents/volume.js";
import type { AgentContext } from "./agents/types.js";
import { dataCite } from "./agents/common.js";
import { enforceSynthesis } from "./citations.js";
import { featureOn, getConfig } from "./config.js";
import { getProfile, metaValue, sectorOf } from "./db/db.js";
import { cachedLiveBars } from "./data/live/fetch.js";
import { loadMarket } from "./data/providers/index.js";
import { hashString, mean } from "./math.js";
import { recordRun } from "./metrics.js";
import { runParallel, withTimeout } from "./parallel.js";
import { getDoc, hitsFromDocs, retrieve } from "./rag/retrieve.js";
import { raiseAlerts } from "./alerts.js";
import { persistSession } from "./sessions.js";
import { readTrace, saveTrace, step } from "./trace.js";
import { getDb } from "./db/db.js";
import { randomUUID } from "node:crypto";
import { UsageLimitError } from "./usage.js";
import { saveSnapshot, type AnalysisSnapshot } from "./snapshots.js";
import { evidenceCoverage } from "./evidenceCoverage.js";
import { analysisGate, analysisKey, cacheAnalysis, cachedAnalysis } from "./analysisRuntime.js";
import { abortable } from "./reliability.js";

const RUNNERS = [
  { name: "momentum" as const, run: runMomentum },
  { name: "volume" as const, run: runVolume },
  { name: "sentiment" as const, run: runSentiment },
  { name: "risk" as const, run: runRisk },
];

function timedOutAgent(name: AgentName, ticker: string, asOf: string, ms: number, provenance: Synthesis["provenance"]): AgentOutput {
  return {
    agent: name,
    ticker,
    asOf,
    label: "insufficient_evidence",
    score: 0,
    confidence: 0,
    claims: [
      {
        text: `Timed out at ${(ms / 1000).toFixed(1)}s and excluded from synthesis.`,
        citations: [dataCite({ source: "derived", field: "agent.timeout", asOf, value: ms, provenance, origin: "orchestrator" })],
      },
    ],
    features: {},
    degraded: ["timeout"],
    latencyMs: ms,
    mode: "rule",
  };
}

function indexReturns(asOf: string): number[] {
  const db = getDb();
  const tickers = db.prepare(`SELECT DISTINCT ticker FROM bars`).all() as { ticker: string }[];
  const series = tickers.map((t) => {
    const rows = db.prepare(`SELECT close FROM bars WHERE ticker = ? AND date <= ? ORDER BY date`).all(t.ticker, asOf) as { close: number }[];
    return rows.map((r) => r.close);
  });
  const n = Math.min(...series.map((s) => s.length));
  if (!Number.isFinite(n) || n < 3) return [];
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const day = series.map((s) => {
      const prev = s[i - 1] ?? 1;
      return ((s[i] ?? prev) - prev) / prev;
    });
    rets.push(mean(day));
  }
  return rets;
}

export function makeRunId(ticker: string, asOf: string, degrade: string[], mode?: string): string {
  const key = `${getConfig().SEED}|${ticker}|${asOf}|${mode ?? ""}|${[...degrade].sort().join(",")}`;
  return `run_${Math.abs(hashString(key)).toString(16)}`;
}

interface AnalyzeInput {
  ticker: string;
  profileId: string;
  sessionId: string;
  degrade?: string[];
  asOf?: string;
  mode?: "live" | "demo";
  signal?: AbortSignal;
  refresh?: boolean;
  requestedAt?: number;
}

export function analyze(input: AnalyzeInput): Promise<Synthesis> {
  const requestedAt = Date.now();
  return analysisGate().run(input.sessionId, input.signal, () => analyzeInternal({ ...input, requestedAt }));
}

async function analyzeInternal(input: AnalyzeInput): Promise<Synthesis> {
  const profile = getProfile(input.profileId);
  if (!profile) throw Object.assign(new Error("Unknown profile"), { status: 404 });
  const degrade = input.degrade ?? [];
  const built = await buildAgents(input.ticker, degrade, profile, input.asOf, input.mode, input.sessionId, input.signal, input.refresh, input.requestedAt);
  input.signal?.throwIfAborted();
  saveSnapshot(built.snapshot, input.sessionId);
  const synthesis = finish(built, profile, input.sessionId, degrade);
  recordRun(input.sessionId, synthesis.synthesis, synthesis.dropped);
  persistSession(input.sessionId, synthesis.synthesis);
  raiseAlerts(input.sessionId, synthesis.synthesis);
  return synthesis.synthesis;
}

interface CompareInput { ticker: string; sessionId: string; degrade?: string[]; mode?: "live" | "demo"; signal?: AbortSignal; refresh?: boolean; requestedAt?: number }
export function compare(input: CompareInput) {
  const requestedAt = Date.now();
  return analysisGate().run(input.sessionId, input.signal, () => compareInternal({ ...input, requestedAt }));
}
async function compareInternal(input: CompareInput) {
  const degrade = input.degrade ?? [];
  const profiles = ["conservative", "moderate", "aggressive"].map((id) => {
    const profile = getProfile(id);
    if (!profile) throw new Error(`missing profile ${id}`);
    return profile;
  });
  const first = profiles[0];
  if (!first) throw new Error("no profiles");
  const built = await buildAgents(input.ticker, degrade, first, undefined, input.mode, input.sessionId, input.signal, input.refresh, input.requestedAt);
  input.signal?.throwIfAborted();
  saveSnapshot(built.snapshot, input.sessionId);
  const results = profiles.map((profile) => {
    const done = finish(built, profile, input.sessionId, degrade);
    recordRun(input.sessionId, done.synthesis, done.dropped);
    persistSession(input.sessionId, done.synthesis);
    raiseAlerts(input.sessionId, done.synthesis);
    return done.synthesis;
  });
  saveTrace(built.runId, readTrace(built.runId).map((entry) => entry.name === "recommendation" ? {
    ...entry,
    payload: { comparison: results.map((result) => ({ profileId: result.profileId, action: result.personalised.action, allocationPct: result.personalised.positionSizePct })) },
  } : entry));
  return { runId: built.runId, results, disclaimer: DISCLAIMER };
}

interface Built {
  agentCache: NonNullable<Synthesis["agentCache"]>;
  snapshot: AnalysisSnapshot;
  runId: string;
  ticker: string;
  asOf: string;
  agents: AgentOutput[];
  aggInputsReady: true;
  marketProvenance: Synthesis["provenance"];
  dataMode: Synthesis["dataMode"];
  degraded: string[];
  traceStepsBase: ReturnType<typeof step>[];
  droppedPrep: number;
  liveTexts: Map<string, string>;
}

function liveIndex(asOf: string, own: { date: string; close: number }[]): number[] {
  const series = [...cachedLiveBars().values()].map((bars) => closesOf(bars, asOf)).filter((s) => s.length > 2);
  if (series.length === 0) series.push(closesOf(own, asOf));
  return equalWeightReturns(series);
}

function closesOf(bars: { date: string; close: number }[], asOf: string): number[] {
  return bars.filter((bar) => bar.date <= asOf).map((bar) => bar.close);
}

function equalWeightReturns(series: number[][]): number[] {
  const n = Math.min(...series.map((s) => s.length));
  if (!Number.isFinite(n) || n < 3) return [];
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const day = series.map((s) => {
      const prev = s[i - 1] ?? 1;
      return ((s[i] ?? prev) - prev) / (prev || 1);
    });
    rets.push(mean(day));
  }
  return rets;
}

async function buildAgents(
  ticker: string,
  degrade: string[],
  profile: Profile,
  asOfInput?: string,
  mode?: "live" | "demo",
  owner = "maintenance",
  signal?: AbortSignal,
  refresh = false,
  requestedAt?: number,
): Promise<Built> {
  const cfg = getConfig();
  const tIngest = Date.now();
  const admission = step("admission", requestedAt ?? tIngest, tIngest, { includesQueueWait: true });
  const asOf = asOfInput ?? (mode === "live" ? new Date().toISOString().slice(0, 10) : (metaValue("as_of") ?? "2026-08-19"));
  signal?.throwIfAborted();
  const sliced = structuredClone(await loadMarket(ticker, asOf, degrade, mode, false, signal));
  signal?.throwIfAborted();
  const runId = `${makeRunId(ticker, asOf, degrade, mode)}_${randomUUID()}`;
  const share = featureOn("x7");
  const cachedIndex = mode === "live" ? liveIndex(asOf, sliced.bars) : indexReturns(asOf);
  const liveHits = mode === "live" && !degrade.includes("missingFiling") ? hitsFromDocs(sliced.docs, ticker) : null;
  const hits = liveHits ? liveHits.hits : degrade.includes("missingFiling") ? [] : retrieve(ticker, asOf);
  // Freeze every document actually referenced, including fixtures used by legacy cached retrieval.
  for (const id of new Set(hits.map((hit) => hit.docId))) {
    if (sliced.docs.some((doc) => doc.id === id)) continue;
    const doc = getDoc(id);
    if (doc) sliced.docs.push({ ...doc, provenance: doc.provenance as Synthesis["provenance"], fetchedAt: null });
  }
  const snapshot: AnalysisSnapshot = { version: 1, id: runId, ticker, asOf,
    capturedAt: new Date().toISOString(), market: structuredClone(sliced), hits: structuredClone(hits), indexReturns: [...cachedIndex] };
  const key = analysisKey(owner, [ticker, asOf, mode, [...degrade].sort(), sliced, hits, cachedIndex]);
  const cached = cachedAnalysis<Built>(key, refresh);
  if (cached) {
    const old = cached.value;
    const now = Date.now();
    return { ...old, runId, snapshot, agentCache: { hit: true, sourceRunId: old.runId, ageMs: cached.ageMs },
      // Do not relabel cached model work as work performed during this execution.
      agents: old.agents.map((agent) => ({ ...agent, latencyMs: 0 })),
      traceStepsBase: [admission, step("ingest", tIngest, now, { asOf, snapshotId: runId, capturedAt: snapshot.capturedAt,
        bars: sliced.bars.length, flows: sliced.flows.length, docs: sliced.docs.length, chunks: hits.length, dataMode: sliced.dataMode }),
        step("agent-cache", now, now, { hit: true, sourceRunId: old.runId, ageMs: cached.ageMs, originalAgentLatenciesMs: old.agents.map((agent) => ({ agent: agent.agent, ms: agent.latencyMs })) })] };
  }
  const dataQuality = sliced.degraded.includes("synthetic_fallback") ? 0.5 : 1;
  const ctxBase: AgentContext = {
    ticker,
    asOf,
    profile,
    degrade,
    market: { bars: sliced.bars, flows: sliced.flows, asOf, provenance: sliced.provenance, indexReturns: cachedIndex },
    hits,
    dataQuality,
    forceMock: mode === "demo" || degrade.includes("llmDown"),
  };
  const tAgents = Date.now();
  const settled = await runParallel(
    RUNNERS.map(async (runner) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.AGENT_TIMEOUT_MS);
      const local: AgentContext = share
        ? { ...ctxBase, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal }
        : { ...ctxBase, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, market: { ...ctxBase.market, indexReturns: mode === "live" ? [...cachedIndex] : indexReturns(asOf) } };
      try { return await abortable(withTimeout(runner.run(local), cfg.AGENT_TIMEOUT_MS), local.signal); }
      finally { clearTimeout(timer); controller.abort(); }
    }),
  );
  signal?.throwIfAborted();
  const agents = settled.map((result, i) => {
    const name = RUNNERS[i]?.name ?? "momentum";
    if (result.status === "fulfilled") return result.value;
    if (result.reason instanceof UsageLimitError) throw result.reason;
    return timedOutAgent(name, ticker, asOf, cfg.AGENT_TIMEOUT_MS, sliced.provenance);
  });
  const ingestEnded = tAgents;
  const degraded = [...sliced.degraded];
  if (degrade.includes("missingFiling")) degraded.push("missing_filing");
  if (degrade.includes("conflictingAgents")) degraded.push("conflicting_agents");
  if (degrade.includes("llmDown")) degraded.push("llm_fallback");
  if (agents.some((a) => a.degraded.includes("timeout"))) degraded.push("timeout");
  if (agents.some((a) => a.degraded.includes("llm_fallback"))) degraded.push("llm_fallback");
  const traceStepsBase = [
    admission,
    step("ingest", tIngest, ingestEnded, {
      asOf,
      snapshotId: snapshot.id,
      capturedAt: snapshot.capturedAt,
      bars: sliced.bars.length,
      flows: sliced.flows.length,
      docs: sliced.docs.length,
      chunks: hits.length,
      dataMode: sliced.dataMode,
      sector: sectorOf(ticker),
    }),
    ...agents.map((agent, idx) =>
      step(agent.agent, tAgents, tAgents + agent.latencyMs, {
        features: agent.features,
        label: agent.label,
        score: agent.score,
        confidence: agent.confidence,
        claims: agent.claims,
        mode: agent.mode,
        degraded: agent.degraded,
        chunks: agent.agent === "sentiment" ? hits : [],
        order: idx,
      }),
    ),
  ];
  const built: Built = {
    agentCache: { hit: false, sourceRunId: null, ageMs: 0 },
    snapshot,
    runId,
    ticker,
    asOf,
    agents,
    aggInputsReady: true,
    marketProvenance: sliced.provenance,
    dataMode: sliced.dataMode,
    degraded: [...new Set(degraded)],
    traceStepsBase,
    droppedPrep: 0,
    liveTexts: liveHits?.texts ?? new Map(),
  };
  // Do not reuse failures, fallbacks or deliberate degradation simulations.
  if (!degrade.length && !agents.some((agent) => agent.degraded.some((flag) => mode !== "demo" || flag !== "llm_fallback")) && !sliced.degraded.length) cacheAnalysis(key, built);
  return built;
}

function finish(built: Built, profile: Profile, sessionId: string, degrade: string[]): { synthesis: Synthesis; dropped: number } {
  const t0 = Date.now();
  const agg = aggregate(built.agents, built.asOf, built.marketProvenance);
  const aggregatedAt = Date.now();
  const personal = personalise(profile, agg, built.agents, built.asOf, built.marketProvenance, built.ticker, sessionId);
  const personalisedAt = Date.now();
  const draft: Synthesis = {
    evidenceCoverage: evidenceCoverage(built.snapshot),
    agentCache: built.agentCache,
    snapshotId: built.snapshot.id,
    capturedAt: built.snapshot.capturedAt,
    runId: built.runId,
    ticker: built.ticker,
    asOf: built.asOf,
    profileId: profile.id,
    compositeLabel: agg.compositeLabel,
    compositeScore: agg.compositeScore,
    confidence: agg.confidence,
    agreement: agg.agreement,
    disagreements: agg.disagreements,
    summary: agg.summary,
    personalised: personal,
    agents: built.agents,
    degraded: built.degraded,
    disclaimer: DISCLAIMER,
    dataMode: built.dataMode,
    provenance: built.marketProvenance,
  };
  const enforced = enforceSynthesis(draft, built.liveTexts);
  const claims = [...enforced.synthesis.summary, ...enforced.synthesis.agents.flatMap((agent) => agent.claims),
    ...enforced.synthesis.personalised.rationale, ...enforced.synthesis.personalised.behaviourNudges,
    ...enforced.synthesis.disagreements.map((disagreement) => disagreement.explanation)];
  for (const claim of claims) for (const citation of claim.citations) citation.snapshotId = built.snapshot.id;
  if (degrade.includes("conflictingAgents") && profile.riskTolerance === "conservative") {
    if (enforced.synthesis.personalised.action === "buy" || enforced.synthesis.personalised.action === "accumulate") {
      enforced.synthesis.personalised.action = "hold";
    }
  }
  const t1 = Date.now();
  const steps = [
    ...built.traceStepsBase,
    step("synthesizer", t0, aggregatedAt, { rows: agg.rows, formula: "composite = sum(effW * score) / sum(effW)", compositeScore: agg.compositeScore, agreement: agg.agreement, confidence: agg.confidence, rawConfidence: agg.rawConfidence, calibratedConfidence: agg.calibratedConfidence, uncertainty: agg.uncertainty }),
    step("personaliser", aggregatedAt, personalisedAt, { action: enforced.synthesis.personalised.action, positionSizePct: enforced.synthesis.personalised.positionSizePct, rules: ["thresholds", "hhi", "behaviour"] }),
    step("citation-enforcer", personalisedAt, t1, { dropped: enforced.dropped, kept: countClaims(enforced.synthesis) }),
    step("recommendation", t1, t1, { action: enforced.synthesis.personalised.action, label: enforced.synthesis.compositeLabel, profileId: profile.id,
      ticker: built.ticker, asOf: built.asOf, dataMode: built.dataMode, capturedAt: built.snapshot.capturedAt, snapshotId: built.snapshot.id }),
  ];
  saveTrace(built.runId, steps);
  return enforced;
}

function countClaims(s: Synthesis): number {
  return s.agents.reduce((n, a) => n + a.claims.length, 0) + s.summary.length + s.personalised.rationale.length;
}
