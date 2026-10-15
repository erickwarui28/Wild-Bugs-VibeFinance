import type { DocHit, Profile, Provenance } from "@vibefinance/shared";
import type { FlowRow } from "../data/providers/types.js";
import type { Bar } from "@vibefinance/shared";

export interface MarketSlice {
  bars: Bar[];
  flows: FlowRow[];
  asOf: string;
  provenance: Provenance;
  indexReturns: number[];
}

export interface AgentContext {
  ticker: string;
  asOf: string;
  profile: Profile;
  degrade: string[];
  market: MarketSlice;
  hits: DocHit[];
  dataQuality: number;
  forceMock: boolean;
  signal?: AbortSignal;
}
