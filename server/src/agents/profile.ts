import type { AgentOutput, Profile, ProfileAdjust, Provenance } from "@vibefinance/shared";
import { SECTOR_BY_TICKER } from "@vibefinance/shared";
import { featureOn } from "../config.js";
import { hhi } from "../math.js";
import { behaviourCount } from "../sessions.js";
import { claim, dataCite } from "./common.js";
import type { Aggregate } from "./synthesizer.js";

const BASE: Record<Profile["riskTolerance"], number> = {
  conservative: 2,
  moderate: 4,
  aggressive: 7,
};

export function personalise(
  profile: Profile,
  agg: Aggregate,
  agents: AgentOutput[],
  asOf: string,
  provenance: Provenance,
  ticker: string,
  sessionId: string | null,
): ProfileAdjust {
  const insufficient = agg.compositeLabel === "insufficient_evidence";
  const hasDisagreement = agg.disagreements.length > 0;
  let action = pickAction(profile.riskTolerance, agg.compositeScore, agg.confidence, hasDisagreement, insufficient);
  const vol = agents.find((a) => a.agent === "risk")?.features.vol20 ?? 0.25;
  const riskFactor = Math.min(1, profile.maxVol / Math.max(0.05, vol));
  let size = BASE[profile.riskTolerance] * Math.max(agg.confidence, 0.35) * riskFactor;
  if (action === "avoid" || action === "insufficient_evidence") size *= 0.25;
  if (action === "reduce") size *= 0.5;
  const before = profile.holdings.map((h) => h.weight);
  const hhiBefore = hhi(before);
  const projected = projectWeights(profile.holdings, ticker, size / 100);
  const hhiAfter = hhi(projected.map((h) => h.weight));
  const sector = SECTOR_BY_TICKER[ticker as keyof typeof SECTOR_BY_TICKER] ?? "Other";
  const sectorPct = projected.filter((h) => (SECTOR_BY_TICKER[h.ticker as keyof typeof SECTOR_BY_TICKER] ?? "") === sector).reduce((s, h) => s + h.weight, 0);
  const bankPct = projected
    .filter((h) => SECTOR_BY_TICKER[h.ticker as keyof typeof SECTOR_BY_TICKER] === "Banks")
    .reduce((s, h) => s + h.weight, 0);
  const alert = hhiAfter > 0.25 || sectorPct > 0.4 || bankPct > 0.4;
  if (alert) size *= 0.55;
  size = Math.max(0.4, Math.min(25, size));
  const profileCite = dataCite({
    source: "derived",
    field: "profile.riskTolerance",
    asOf,
    value: profile.riskTolerance === "conservative" ? 0 : profile.riskTolerance === "moderate" ? 1 : 2,
    provenance,
    origin: `profile:${profile.id}`,
  });
  const hhiCite = dataCite({
    source: "derived",
    field: "profile.sectorWeight",
    asOf,
    value: Math.max(sectorPct, bankPct),
    provenance,
    origin: `profile:${profile.id}`,
  });
  const rationale = [
    claim(reasonSentence(profile, action, ticker, Math.max(sectorPct, bankPct)), [action === "hold" && alert ? hhiCite : profileCite]),
    claim(
      `Suggested size is ${size.toFixed(1)}% of the portfolio after the risk and concentration checks.`,
      [dataCite({ source: "derived", field: "positionSizePct", asOf, value: size, provenance, origin: `profile:${profile.id}` })],
    ),
  ];
  const nudges = [];
  const dd = agents.find((a) => a.agent === "risk")?.features.maxDrawdown60 ?? 0;
  if (profile.behaviour.includes("loss-averse") || profile.behaviour.includes("panic-sells")) {
    if (dd < -0.02) {
      nudges.push(
        claim(
          `Observed 60-day drawdown is ${(dd * 100).toFixed(1)}%. Review your risk plan before reacting to recent prices.`,
          [dataCite({ source: "derived", field: "maxDrawdown60", asOf, value: dd, provenance, origin: `profile:${profile.id}` })],
        ),
      );
    }
  }
  const z = agents.find((a) => a.agent === "volume")?.features.volumeZ ?? 0;
  if (profile.behaviour.includes("chases-spikes") && Math.abs(z) > 2) {
    nudges.push(
      claim(
        "Volume is elevated. Check the evidence and concentration limits before increasing exposure.",
        [dataCite({ source: "volume", field: "volumeZ20", asOf, value: z, provenance, origin: `profile:${profile.id}` })],
      ),
    );
  }
  if (profile.behaviour.includes("recency-bias") && (agents.find((a) => a.agent === "momentum")?.score ?? 0) > 0.3) {
    nudges.push(
      claim(
        "The recent rally is easy to overweight. Check the filing before adding just because price went up.",
        [profileCite],
      ),
    );
  }
  if (featureOn("x6") && sessionId) {
    const chases = behaviourCount(sessionId, profile.id, "spike-chase");
    if (chases > 0) {
      nudges.push(
        claim(
          `Your history shows ${chases} chase${chases === 1 ? "" : "s"} of a volume spike in this session.`,
          [dataCite({ source: "derived", field: "profile.history.spikeChases", asOf, value: chases, provenance, origin: `profile:${profile.id}` })],
        ),
      );
    }
  }
  return {
    profileId: profile.id,
    riskTolerance: profile.riskTolerance,
    action,
    positionSizePct: Math.round(size * 10) / 10,
    concentrationAlert: { hhiBefore, hhiAfter, sectorPct: Math.max(sectorPct, bankPct), alert },
    behaviourNudges: nudges,
    rationale,
  };
}

function pickAction(
  risk: Profile["riskTolerance"],
  score: number,
  confidence: number,
  disagreement: boolean,
  insufficient: boolean,
): ProfileAdjust["action"] {
  if (insufficient) return "insufficient_evidence";
  if (risk === "conservative") {
    if (!disagreement && score > 0.35 && confidence > 0.6) return "buy";
    if (!disagreement && score > 0.2 && confidence > 0.55) return "accumulate";
    if (score > -0.15) return "hold";
    if (score > -0.35) return "reduce";
    return "avoid";
  }
  if (risk === "moderate") {
    if (score > 0.25 && confidence > 0.5) return "buy";
    if (score > 0.1) return "accumulate";
    if (score > -0.15) return "hold";
    if (score > -0.3) return "reduce";
    return "avoid";
  }
  if (score > 0.15) return "buy";
  if (score > 0.05) return "accumulate";
  if (score > -0.2) return "hold";
  if (score > -0.35) return "reduce";
  return "avoid";
}

function reasonSentence(profile: Profile, action: string, ticker: string, sectorPct: number): string {
  const verb = action.toUpperCase();
  if (profile.id === "conservative" && sectorPct > 0.4) {
    return `${verb}: your portfolio is already ${(sectorPct * 100).toFixed(0)}% in one sector, so ${ticker} does not get a larger add.`;
  }
  if (profile.id === "aggressive") {
    return `${verb}: the combined score clears your lower bar, with a cap so ${ticker} does not become the whole portfolio.`;
  }
  return `${verb}: this matches a ${profile.riskTolerance} investor looking at ${ticker}.`;
}

function projectWeights(holdings: Profile["holdings"], ticker: string, add: number): Profile["holdings"] {
  const next = holdings.map((h) => ({ ...h }));
  const found = next.find((h) => h.ticker === ticker);
  if (found) found.weight += add;
  else next.push({ ticker, weight: add });
  const sum = next.reduce((s, h) => s + h.weight, 0) || 1;
  return next.map((h) => ({ ...h, weight: h.weight / sum }));
}
