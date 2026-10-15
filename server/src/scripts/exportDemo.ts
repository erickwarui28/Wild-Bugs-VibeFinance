import { Synthesis, TraceResponse } from "@vibefinance/shared";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, compare } from "../orchestrator.js";
import { readTrace } from "../trace.js";

process.env.VF_FAST = "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = path.join(root, "web", "public", "demo");
fs.mkdirSync(dir, { recursive: true });

const demo = await analyze({ ticker: "INFY", profileId: "moderate", sessionId: "export-demo" });
const compared = await compare({ ticker: "INFY", sessionId: "export-demo" });
const trace = { runId: demo.runId, steps: readTrace(demo.runId), disclaimer: demo.disclaimer };
Synthesis.parse(demo);
TraceResponse.parse(trace);
fs.writeFileSync(path.join(dir, "demo-infy-moderate.json"), JSON.stringify(demo, null, 2));
fs.writeFileSync(path.join(dir, "compare-infy.json"), JSON.stringify(compared, null, 2));
fs.writeFileSync(path.join(dir, "trace-infy.json"), JSON.stringify(trace, null, 2));
console.log(`exported demo run ${demo.runId}`);
process.exit(0);
