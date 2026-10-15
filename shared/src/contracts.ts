import { z } from "zod";
import { DISCLAIMER, TICKERS } from "./constants.js";

export const Provenance = z.enum(["LIVE", "CACHED", "SYNTHETIC"]);
export type Provenance = z.infer<typeof Provenance>;

export const SearchHit = z.object({
  docId: z.string().min(1),
  chunkId: z.string().min(1),
  title: z.string(),
  snippet: z.string(),
  score: z.number().finite(),
  provenance: Provenance,
  date: z.string().optional(),
  sourceUrl: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional(),
});
export type SearchHit = z.infer<typeof SearchHit>;
export const SearchResponse = z.object({ hits: z.array(SearchHit), disclaimer: z.string() });
export const RunRequest = z.object({
  refresh: z.boolean().optional(),
  ticker: z.string().transform((value) => value.toUpperCase()).refine((value) => (TICKERS as readonly string[]).includes(value), "Unsupported ticker"),
  sessionId: z.string().min(1).max(128),
  mode: z.enum(["live", "demo"]).optional(),
  degrade: z.array(z.enum(["feedDown", "missingFiling", "conflictingAgents", "llmDown", "slowAgent", "backtest"])).max(6).optional(),
});
export const AnalyzeRequest = RunRequest.extend({ profileId: z.enum(["conservative", "moderate", "aggressive"]) });

export const DataCitation = z.object({
  snapshotId: z.string().optional(),
  type: z.literal("data"),
  source: z.enum(["ohlcv", "volume", "flows", "derived"]),
  field: z.string(),
  asOf: z.string(),
  value: z.number(),
  provenance: Provenance,
  origin: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});

export const DocCitation = z.object({
  snapshotId: z.string().optional(),
  type: z.literal("doc"),
  docId: z.string(),
  chunkId: z.string(),
  snippet: z.string().max(300),
  score: z.number(),
  provenance: Provenance,
  sourceUrl: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});

export const Citation = z.discriminatedUnion("type", [DataCitation, DocCitation]);
export type Citation = z.infer<typeof Citation>;

export const Claim = z.object({
  text: z.string(),
  citations: z.array(Citation).min(1),
});
export type Claim = z.infer<typeof Claim>;

export const Label = z.enum(["bullish", "bearish", "neutral", "insufficient_evidence"]);
export type Label = z.infer<typeof Label>;

export const AgentName = z.enum(["momentum", "volume", "sentiment", "risk"]);
export type AgentName = z.infer<typeof AgentName>;

export const AgentOutput = z.object({
  agent: AgentName,
  ticker: z.string(),
  asOf: z.string(),
  label: Label,
  score: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  claims: z.array(Claim),
  features: z.record(z.number()),
  degraded: z.array(z.string()),
  latencyMs: z.number(),
  mode: z.enum(["llm", "mock", "rule"]),
});
export type AgentOutput = z.infer<typeof AgentOutput>;

export const ConcentrationAlert = z.object({
  hhiBefore: z.number(),
  hhiAfter: z.number(),
  sectorPct: z.number(),
  alert: z.boolean(),
});

export const ProfileAdjust = z.object({
  profileId: z.string(),
  riskTolerance: z.enum(["conservative", "moderate", "aggressive"]),
  action: z.enum(["buy", "accumulate", "hold", "reduce", "avoid", "insufficient_evidence"]),
  positionSizePct: z.number().min(0).max(25),
  concentrationAlert: ConcentrationAlert.nullable(),
  behaviourNudges: z.array(Claim),
  rationale: z.array(Claim),
});
export type ProfileAdjust = z.infer<typeof ProfileAdjust>;

export const EvidenceCoverage = z.object({
  capturedAt: z.string().datetime(), snapshotId: z.string().min(1),
  channels: z.array(z.object({
    kind: z.enum(["prices", "documents", "flows"]), count: z.number().int().nonnegative(),
    syntheticCount: z.number().int().nonnegative(), provenance: z.array(Provenance),
    firstDate: z.string().nullable(), latestDate: z.string().nullable(), dateBasis: z.enum(["source", "fixture"]),
    undatedCount: z.number().int().nonnegative(), calendarAgeDays: z.number().int().nonnegative().nullable(), dateAheadOfCapture: z.boolean(),
    retrievedFrom: z.string().nullable(), retrievedThrough: z.string().nullable(), retrievalUnknownCount: z.number().int().nonnegative(),
    sources: z.array(z.object({ name: z.string(), url: z.string().nullable() })), notes: z.array(z.string()),
  })).length(3),
});
export type EvidenceCoverage = z.infer<typeof EvidenceCoverage>;

export const Synthesis = z.object({
  evidenceCoverage: EvidenceCoverage.optional(),
  agentCache: z.object({ hit: z.boolean(), sourceRunId: z.string().nullable(), ageMs: z.number().nonnegative() }).optional(),
  snapshotId: z.string().optional(),
  capturedAt: z.string().optional(),
  runId: z.string(),
  ticker: z.string(),
  asOf: z.string(),
  profileId: z.string(),
  compositeLabel: Label,
  compositeScore: z.number(),
  confidence: z.number(),
  agreement: z.number().min(0).max(1),
  disagreements: z.array(
    z.object({
      agents: z.array(z.string()),
      explanation: Claim,
    }),
  ),
  summary: z.array(Claim),
  personalised: ProfileAdjust,
  agents: z.array(AgentOutput),
  degraded: z.array(z.string()),
  disclaimer: z.literal(DISCLAIMER),
  dataMode: z.enum(["live", "cached", "synthetic"]),
  provenance: Provenance,
});
export type Synthesis = z.infer<typeof Synthesis>;

export const Health = z.object({
  ok: z.literal(true),
  provider: z.string(),
  embeddings: z.string(),
  seed: z.number(),
  version: z.string(),
  features: z.array(z.string()),
  dataMode: z.enum(["live", "cached", "synthetic"]),
  snapshotId: z.string().nullable(),
  disclaimer: z.literal(DISCLAIMER),
});
export type Health = z.infer<typeof Health>;

export const CompareRequest = RunRequest;

export const CompareResponse = z.object({
  runId: z.string(),
  results: z.array(Synthesis).length(3),
  disclaimer: z.literal(DISCLAIMER),
});
export type CompareResponse = z.infer<typeof CompareResponse>;

export const TraceStep = z.object({
  name: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  latencyMs: z.number(),
  payload: z.record(z.unknown()),
});
export type TraceStep = z.infer<typeof TraceStep>;

export const TraceResponse = z.object({
  runId: z.string(),
  steps: z.array(TraceStep),
  disclaimer: z.literal(DISCLAIMER),
});

export const Holding = z.object({
  ticker: z.string(),
  weight: z.number(),
});

export const Profile = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  riskTolerance: z.enum(["conservative", "moderate", "aggressive"]),
  maxVol: z.number(),
  holdings: z.array(Holding),
  behaviour: z.array(z.string()),
});
export type Profile = z.infer<typeof Profile>;

export const TickerInfo = z.object({
  ticker: z.string(),
  sector: z.string(),
  lastClose: z.number(),
  provenance: Provenance,
  asOf: z.string(),
});

export const Bar = z.object({
  origin: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  spike: z.boolean(),
  provenance: Provenance,
});
export type Bar = z.infer<typeof Bar>;

export const DocHit = z.object({
  docId: z.string(),
  chunkId: z.string(),
  title: z.string(),
  date: z.string(),
  snippet: z.string(),
  score: z.number(),
  provenance: Provenance,
  sourceUrl: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});
export type DocHit = z.infer<typeof DocHit>;

export const LlmClaimDraft = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      citationIdx: z.array(z.number().int()),
    }),
  ),
});
export type LlmClaimDraft = z.infer<typeof LlmClaimDraft>;

export const AlertItem = z.object({
  id: z.string(),
  sessionId: z.string(),
  ticker: z.string(),
  kind: z.string(),
  message: z.string(),
  citations: z.array(Citation),
  createdAt: z.string(),
});
export type AlertItem = z.infer<typeof AlertItem>;
