import { TICKERS } from "@vibefinance/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { evaluationManifest } from "./evaluationManifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "vf-latency-"));
Object.assign(process.env, { VF_SKIP_ENV_FILES: "1", DB_PATH: path.join(temporary, "latency.db"),
  SEED: "42", VF_FAST: "1", FEATURES: "x7", LLM_PROVIDER: "mock", DATA_MODE: "synthetic", LOG_LEVEL: "silent" });
const { analyze } = await import("../orchestrator.js");
const { resetConfigForTests } = await import("../config.js");
const { getDb, closeDb } = await import("../db/db.js");
getDb();
const repeats = 7;
async function cell(count: number, concurrency: number, shared: boolean) {
  process.env.FEATURES = shared ? "x7" : ""; resetConfigForTests();
  const limit = pLimit(concurrency);
  const start = performance.now();
  await Promise.all(TICKERS.slice(0, count).map(ticker => limit(() => analyze({ ticker, profileId: "moderate", sessionId: "isolated-latency",
    mode: "demo", refresh: true, degrade: ["backtest"] }))));
  return performance.now() - start;
}
const matrix = [];
try {
  for (const tickers of [1, 5, 10]) for (const concurrency of [1, 4, 8]) {
    const firstBatchMs = await cell(tickers, concurrency, true);
    await cell(tickers, concurrency, false);
    const on: number[] = [], off: number[] = [];
    for (let iteration = 0; iteration < repeats; iteration++) {
      // Alternate ordering to reduce a systematic warmup/order advantage.
      if (iteration % 2) { on.push(await cell(tickers, concurrency, true)); off.push(await cell(tickers, concurrency, false)); }
      else { off.push(await cell(tickers, concurrency, false)); on.push(await cell(tickers, concurrency, true)); }
    }
    const summary = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return {
      medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], samplesMs: values }; };
    matrix.push({ tickers, concurrency, firstBatchMs, sharedPreparation: summary(on), repeatedPreparation: summary(off) });
  }
  const report = { version: 2, ...evaluationManifest(root), repeats, dataMode: "synthetic", matrix,
    note: "Local in-process mock-engine batch benchmark, not production HTTP latency or a speed guarantee. Agent reuse bypassed; synthetic data/model, artificial pauses disabled. Seven warmed batches per cell, alternating order. p95 is nearest-rank over seven observations; firstBatch is not a process-cold startup measurement." };
  fs.mkdirSync(path.join(root, "docs/evaluation"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/evaluation/latency.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output: "docs/evaluation/latency.json", cells: matrix.length, repeats }));
} finally { closeDb(); }
