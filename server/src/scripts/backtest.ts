import { TICKERS } from "@vibefinance/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { evaluateRows, temporalWindows, type EvaluationRow } from "../evaluation.js";
import { evaluationManifest } from "./evaluationManifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.join(root, "docs/evaluation");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "vf-evaluation-"));
// Set isolation before dynamic imports: never read .env, modify production
// accounting/calibration, or invoke a network/model provider.
Object.assign(process.env, { VF_SKIP_ENV_FILES: "1", DB_PATH: path.join(temporary, "evaluation.db"),
  SEED: "42", VF_FAST: "1", FEATURES: "x7", LLM_PROVIDER: "mock", DATA_MODE: "synthetic", LOG_LEVEL: "silent" });
const { getDb, closeDb } = await import("../db/db.js");
const { forwardReturn } = await import("../data/providers/synthetic.js");
const { analyze } = await import("../orchestrator.js");
const { retrieve } = await import("../rag/retrieve.js");
try {
  const allDates = (getDb().prepare("SELECT date FROM bars WHERE ticker = 'INFY' ORDER BY date").all() as { date: string }[]).map(row => row.date);
  const eligibleDates = allDates.slice(60, -30);
  const windows = temporalWindows(eligibleDates);
  const rows: EvaluationRow[] = [];
  for (const ticker of TICKERS) {
    for (let index = 0; index < eligibleDates.length; index += 5) {
      const asOf = eligibleDates[index]!;
      const result = await analyze({ ticker, profileId: "moderate", sessionId: "isolated-evaluation", mode: "demo", degrade: ["backtest"], asOf });
      const fwd = forwardReturn(ticker, asOf);
      if (fwd === null) continue;
      rows.push({ ticker, asOf, score: result.compositeScore, label: result.compositeLabel,
        confidence: result.confidence, momentum: result.agents.find(agent => agent.agent === "momentum")!.score, fwd });
    }
  }
  const holdout = rows.filter(row => windows.holdout.includes(row.asOf));
  const development = rows.filter(row => windows.development.includes(row.asOf));
  const result = evaluateRows(holdout);
  const cutOff = (getDb().prepare("SELECT value FROM meta WHERE key='as_of'").get() as { value: string }).value;
  const retrievalChecks = [
    { ticker: "INFY", expected: "guidance cut", pattern: /guidance cut/i },
    { ticker: "ITC", expected: "pledge disclosure", pattern: /pledge/i },
    { ticker: "SBIN", expected: "earnings beat", pattern: /earnings beat/i },
  ].map(test => {
    const hits = retrieve(test.ticker, cutOff);
    return { ticker: test.ticker, expected: test.expected, k: 4,
      relevantPassageFound: hits.some(hit => test.pattern.test(hit.snippet)),
      allCitationsResolvable: hits.every(hit => Boolean(getDb().prepare("SELECT 1 FROM chunks WHERE id=? AND doc_id=?").get(hit.chunkId, hit.docId))),
      noFutureSources: hits.every(hit => hit.date <= cutOff), retrievedDocuments: [...new Set(hits.map(hit => hit.docId))] };
  });
  const report = {
    version: 2, ...evaluationManifest(root), dataMode: "synthetic", profile: "moderate", tickers: TICKERS,
    inputHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    note: "Synthetic fixture benchmark, not real-market validation. Confidence is an evidence heuristic, not a calibrated probability of profit.",
    methodology: { horizonTradingSessions: 30, strideTradingSessions: 5, warmupTradingSessions: 60,
      developmentEnd: windows.development.at(-1), holdoutStart: windows.holdout[0], holdoutEnd: windows.holdout.at(-1),
      purgeTradingSessions: 30, fittedParameters: false, calibrated: false,
      scoring: "Non-neutral composite signals with nonzero forward returns. Baselines use exactly the same rows; zero momentum receives half credit. Coverage reports abstentions. Brier uses a heuristic upward-probability transform; no calibration claim.",
      limitations: "Designed synthetic scenarios, not an untouched external dataset. Five-session samples have overlapping 30-session labels and correlated tickers; no independent-sample confidence intervals. No fees, slippage, execution or strategy P&L. Baseline thresholds were not optimized on this holdout." },
    ...result, development: evaluateRows(development),
    retrieval: { note: "Three curated synthetic planted-passage checks of the agent's fixed-query top-four retrieval. Not a representative relevance benchmark or semantic-understanding score.",
      checks: retrievalChecks, missingCorpusAbstains: retrieve("HINDUNILVR", cutOff).length === 0 },
  };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "backtest.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output: "docs/evaluation/backtest.json", holdoutN: result.composite.n, coverage: result.coverage, inputHash: report.inputHash }));
} finally { closeDb(); }
