// Read-only post-release admin checks. No reset, models, exported files or identity output.
import assert from 'node:assert/strict';
import { getConfig } from '../server/dist/config.js';

const cfg = getConfig(), base = `http://127.0.0.1:${cfg.PORT}`;
const headers = { Authorization: `Basic ${Buffer.from(`${cfg.ADMIN_USERNAME}:${cfg.ADMIN_PASSWORD}`).toString('base64')}` };
async function get(endpoint, authorized = true) {
  return fetch(base + endpoint, { headers: authorized ? headers : {}, signal: AbortSignal.timeout(15000) });
}
const overviewResponse = await get('/api/admin/overview');
assert.equal(overviewResponse.status, 200);
const overview = await overviewResponse.json();
assert.equal(overview.budget.limitUsd, 5);
assert.ok(!('visitors' in overview));
const reports = [];
for (const kind of ['visitors', 'attempts', 'activity']) {
  assert.equal((await get(`/api/admin/records/${kind}`, false)).status, 401);
  assert.equal((await get(`/api/admin/export/${kind}`, false)).status, 401);
  const response = await get(`/api/admin/records/${kind}?limit=2`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await response.json();
  assert.ok(page.records.length <= 2); assert.ok(page.snapshotCursor);
  if (page.nextCursor) {
    const next = await (await get(`/api/admin/records/${kind}?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`)).json();
    assert.ok(next.records.every(row => !page.records.some(previous => previous.id === row.id)));
  }
  const csv = await get(`/api/admin/export/${kind}?limit=2&cursor=${encodeURIComponent(page.snapshotCursor)}`);
  assert.equal(csv.status, 200); assert.equal(csv.headers.get('cache-control'), 'no-store');
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.ok((await csv.text()).includes('"visitorId"'));
  reports.push({ table: kind, authorized: true, bounded: true, csvPrivate: true, matchingRecords: page.summary.total });
}
assert.equal((await get('/api/admin/records/activity?limit=NaN')).status, 400);
assert.equal((await get('/api/admin/records/activity?cursor=invalid')).status, 400);
console.log(JSON.stringify({ ok: true, tables: reports, productionResetPerformed: false, paidModelsInvoked: false }, null, 2));
