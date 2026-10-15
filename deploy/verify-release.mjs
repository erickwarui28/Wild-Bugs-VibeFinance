// Run from the VPS server directory. Read-only checks except issuing a disposable anonymous identity.
// Never prints tokens, credentials, prompts or notes; does not run models or reset production limits.
import assert from 'node:assert/strict';
import { getConfig } from '../server/dist/config.js';
import { EvaluationReport, LatencyReport } from '@vibefinance/shared';

const cfg = getConfig();
const base = `http://127.0.0.1:${cfg.PORT}`;
const health = await fetch(`${base}/api/health`);
assert.equal(health.status, 200);
const evaluation = await fetch(`${base}/api/eval`);
assert.equal(evaluation.status, 200);
const reports = await evaluation.json();
EvaluationReport.parse(reports.backtest);
LatencyReport.parse(reports.latency);
assert.equal((await fetch(`${base}/api/metrics`)).status, 401);
const response = await fetch(`${base}/api/visitor`, { method: 'POST' });
assert.equal(response.status, 200);
const visitor = await response.json();
assert.equal((await fetch(`${base}/api/metrics`, { headers: { 'x-vf-visitor': visitor.token } })).status, 200);
const usageResponse = await fetch(`${base}/api/admin/usage`, {
  headers: { Authorization: `Basic ${Buffer.from(`${cfg.ADMIN_USERNAME}:${cfg.ADMIN_PASSWORD}`).toString('base64')}` },
});
assert.equal(usageResponse.status, 200);
const usage = await usageResponse.json();
assert.equal(usage.budget.limitUsd, 5);
assert.equal(usage.budget.networkHourlyLimit, 300);
assert.equal(usage.global.visitorHourlyLimit, 100);
assert.equal(usage.global.limit, 10000);
assert.equal(usage.budget.pricingModel, cfg.OPENAI_MODEL);
assert.ok(usage.budget.committedUsd >= 0);
assert.equal(cfg.HOST, '127.0.0.1');
const runtimeResponse = await fetch(`${base}/api/admin/reliability`, {
  headers: { Authorization: `Basic ${Buffer.from(`${cfg.ADMIN_USERNAME}:${cfg.ADMIN_PASSWORD}`).toString('base64')}` },
});
assert.equal(runtimeResponse.status, 200);
const runtime = await runtimeResponse.json();
assert.equal(runtime.analysis.maximumActive, cfg.ANALYSIS_MAX_ACTIVE);
assert.equal(runtime.sources.maximumActive, cfg.SOURCE_MAX_ACTIVE);
assert.ok(runtime.analysis.active <= runtime.analysis.maximumActive);
console.log(JSON.stringify({ ok: true, policy: { budgetUsd: 5, visitorHourly: 100, networkHourly: 300, globalCalls: 10000 },
  reliability: runtime,
  spending: { measuredUsd: usage.budget.measuredUsd, heldUsd: usage.budget.heldUsd, remainingUsd: usage.budget.remainingUsd },
  latestAttempts: usage.attempts.slice(0, 4).map(({ status, input_tokens, output_tokens, charged_usd, error_kind }) => ({ status, input_tokens, output_tokens, charged_usd, error_kind })),
}, null, 2));
