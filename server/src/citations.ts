import type { AgentOutput, Citation, Claim, Provenance, Synthesis } from "@vibefinance/shared";
import { getDb } from "./db/db.js";

export interface EnforceResult<T> {
  value: T;
  dropped: number;
}

function chunkMap(ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const db = getDb();
  const stmt = db.prepare(`SELECT text FROM chunks WHERE id = ?`);
  for (const id of ids) {
    const row = stmt.get(id) as { text: string } | undefined;
    if (row) map.set(id, row.text);
  }
  return map;
}

export function citationOk(citation: Citation, chunks: Map<string, string>): boolean {
  if (citation.type === "data") return citation.field.length > 0 && Number.isFinite(citation.value);
  const text = chunks.get(citation.chunkId);
  if (!text) return false;
  return text.includes(citation.snippet);
}

function cleanClaims(claims: Claim[], chunks: Map<string, string>, dropped: { n: number }): Claim[] {
  const kept: Claim[] = [];
  for (const item of claims) {
    const citations = item.citations.filter((c) => citationOk(c, chunks));
    if (citations.length === 0 || !item.text.trim()) {
      dropped.n += 1;
      continue;
    }
    kept.push({ text: item.text, citations });
  }
  return kept;
}

export function enforceAgent(
  agent: AgentOutput,
  chunks: Map<string, string>,
  dropped: { n: number },
  provenance: Provenance = "SYNTHETIC",
): AgentOutput {
  const claims = cleanClaims(agent.claims, chunks, dropped);
  if (claims.length === 0) {
    return {
      ...agent,
      label: "insufficient_evidence",
      score: 0,
      claims: [
        {
          text: "Insufficient evidence for this dimension.",
          citations: [
            {
              type: "data",
              source: "derived",
              field: "evidence.count",
              asOf: agent.asOf,
              value: 0,
              provenance,
              origin: "enforcer",
              fetchedAt: null,
            },
          ],
        },
      ],
    };
  }
  return { ...agent, claims };
}

export function enforceSynthesis(synthesis: Synthesis, extraChunks?: Map<string, string>): { synthesis: Synthesis; dropped: number } {
  const ids: string[] = [];
  const collect = (claims: Claim[]) => {
    for (const claim of claims) {
      for (const citation of claim.citations) {
        if (citation.type === "doc") ids.push(citation.chunkId);
      }
    }
  };
  for (const agent of synthesis.agents) collect(agent.claims);
  collect(synthesis.summary);
  for (const d of synthesis.disagreements) collect([d.explanation]);
  collect(synthesis.personalised.rationale);
  collect(synthesis.personalised.behaviourNudges);
  const chunks = chunkMap(ids);
  if (extraChunks) for (const [id, text] of extraChunks) chunks.set(id, text);
  const dropped = { n: 0 };
  const agents = synthesis.agents.map((agent) => enforceAgent(agent, chunks, dropped, synthesis.provenance));
  return {
    synthesis: {
      ...synthesis,
      agents,
      summary: cleanClaims(synthesis.summary, chunks, dropped),
      disagreements: synthesis.disagreements
        .map((d) => ({ ...d, explanation: cleanClaims([d.explanation], chunks, dropped)[0] }))
        .filter((d): d is typeof d & { explanation: Claim } => Boolean(d.explanation)),
      personalised: {
        ...synthesis.personalised,
        rationale: cleanClaims(synthesis.personalised.rationale, chunks, dropped),
        behaviourNudges: cleanClaims(synthesis.personalised.behaviourNudges, chunks, dropped),
      },
    },
    dropped: dropped.n,
  };
}
