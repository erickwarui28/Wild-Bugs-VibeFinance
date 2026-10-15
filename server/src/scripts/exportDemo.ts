import { Synthesis, TraceResponse } from "@vibefinance/shared";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Isolate before imports: export must never read credentials, spend money or reseed production.
Object.assign(process.env, { VF_SKIP_ENV_FILES: "1", VF_FAST: "1", SEED: "42", LLM_PROVIDER: "mock",
  EMBEDDINGS: "local", DATA_MODE: "synthetic", FEATURES: "x7", LOG_LEVEL: "silent",
  DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vf-demo-export-")), "export.db") });
const { analyze, compare } = await import("../orchestrator.js");
const { readTrace } = await import("../trace.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = path.join(root, "web", "public", "demo");
fs.mkdirSync(dir, { recursive: true });

const demo = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "export-demo", mode: "demo" });
const compared = await compare({ ticker: "INFY", sessionId: "export-demo", mode: "demo" });
const trace = { runId: demo.runId, steps: readTrace(demo.runId), disclaimer: demo.disclaimer };
Synthesis.parse(demo);
TraceResponse.parse(trace);
fs.writeFileSync(path.join(dir, "demo-infy-moderate.json"), JSON.stringify(demo, null, 2));
fs.writeFileSync(path.join(dir, "compare-infy.json"), JSON.stringify(compared, null, 2));
fs.writeFileSync(path.join(dir, "trace-infy.json"), JSON.stringify(trace, null, 2));
console.log(`exported demo run ${demo.runId}`);
process.exit(0);
