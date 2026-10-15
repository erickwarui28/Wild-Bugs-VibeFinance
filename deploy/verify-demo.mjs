// Functional post-deploy smoke. Creates disposable Demo runs, never calls paid models.
import assert from 'node:assert/strict';
import { Synthesis, CompareResponse } from '@vibefinance/shared';
import { getConfig } from '../server/dist/config.js';

const base = `http://127.0.0.1:${getConfig().PORT}`;
const identityResponse = await fetch(`${base}/api/visitor`, { method: 'POST', signal: AbortSignal.timeout(10000) });
assert.equal(identityResponse.status, 200);
const { token } = await identityResponse.json();
assert.equal(typeof token, 'string');
const headers = { 'content-type': 'application/json', 'x-vf-visitor': token };
async function post(endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers,
    body: JSON.stringify({ ticker: 'INFY', sessionId: 'deployment-demo-smoke', mode: 'demo', ...body }), signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200);
  return response.json();
}
const analysis = Synthesis.parse(await post('/api/analyze', { profileId: 'moderate' }));
assert.equal(analysis.dataMode, 'synthetic');
assert.ok(analysis.snapshotId);
assert.equal(analysis.evidenceCoverage?.snapshotId, analysis.snapshotId);
assert.equal(analysis.evidenceCoverage?.channels.length, 3);
assert.ok(analysis.evidenceCoverage.channels.every(channel=>channel.provenance.every(value=>value==='SYNTHETIC')));
assert.ok(analysis.agents.every(agent => agent.mode === 'mock'));
const comparison = CompareResponse.parse(await post('/api/compare', {}));
assert.equal(comparison.results.length, 3);
assert.ok(comparison.results.every(result => result.agentCache?.hit && result.agents.every(agent => agent.mode === 'mock')));
assert.ok(comparison.results.every(result=>result.evidenceCoverage?.snapshotId===result.snapshotId));
assert.equal((await fetch(`${base}/api/trace/${analysis.runId}`, { headers, signal: AbortSignal.timeout(10000) })).status, 200);
console.log(JSON.stringify({ ok: true, demoAnalysis: true, immutableSnapshot: true, compareProfiles: 3,
  privateAgentReuse: true, ownedTraceAccessible: true, paidModelsInvoked: false }));
