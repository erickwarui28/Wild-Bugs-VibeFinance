import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDate, retentionPlan, pruneReleaseBackups } from './retention.mjs';

const entry = (name, extra = {}) => ({ name, directory: true, symlink: false, complete: true, ...extra });
const now = Date.parse('2026-10-14T12:00:00Z');
test('keeps newest five even if every release is older than thirty days', () => {
  const rows = Array.from({ length: 8 }, (_, index) => entry(`2026080${index + 1}T120000Z`));
  assert.deepEqual(retentionPlan(rows, now), ['20260803T120000Z', '20260802T120000Z', '20260801T120000Z']);
});
test('preserves thirty-day boundary and excludes daily backups, unexpected names and symlinks', () => {
  const rows = ['20261014', '20261013', '20261012', '20261011', '20261010', '20260914', '20260913'].map(date => entry(`${date}T120000Z`));
  rows.push(entry('database-20260801T120000000Z'), entry('20260801T120000Z', { symlink: true }), entry('../20260802T120000Z'));
  assert.deepEqual(retentionPlan(rows, now), ['20260913T120000Z']);
});
test('keeps five complete recovery sets even when newer backups are incomplete', () => {
  const rows = Array.from({ length: 10 }, (_, index) => entry(`202608${String(index + 1).padStart(2, '0')}T120000Z`, { complete: index < 5 }));
  assert.deepEqual(retentionPlan(rows, now), []);
});
test('invalid dates and broad/custom deletion roots fail closed', () => {
  assert.equal(releaseDate('20260230T120000Z'), null);
  assert.equal(releaseDate('20261014T256000Z'), null);
  assert.throws(() => pruneReleaseBackups({ root: '/' }));
});
