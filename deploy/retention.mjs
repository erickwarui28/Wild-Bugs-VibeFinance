// Explicitly approved release-backup policy only. Daily DB backups/history are excluded.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 86400000;
export function releaseDate(name) {
  if (!/^\d{8}T\d{6}Z$/.test(name)) return null;
  const iso = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T${name.slice(9, 11)}:${name.slice(11, 13)}:${name.slice(13, 15)}Z`;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().replace(/[-:]/g, '').replace('.000', '') !== name) return null;
  return timestamp;
}

export function retentionPlan(entries, now = Date.now()) {
  const releases = entries.filter(entry => !entry.symlink && entry.directory && releaseDate(entry.name) !== null)
    .sort((left, right) => right.name.localeCompare(left.name));
  const protectedNames = new Set([...releases.slice(0, 5), ...releases.filter(entry => entry.complete).slice(0, 5)].map(entry => entry.name));
  return releases.filter(entry => !protectedNames.has(entry.name) && now - releaseDate(entry.name) > 30 * DAY).map(entry => entry.name);
}

export function pruneReleaseBackups({ apply = false, root = '/opt/vibefinance-backups', now = Date.now(), audit = () => {} } = {}) {
  assert.equal(root, '/opt/vibefinance-backups', 'Only the named production release backup root is supported');
  assert.equal(realpathSync(root), root, 'Backup root cannot be a symlink');
  const inventory = readdirSync(root).map(name => {
    const target = path.join(root, name);
    const stat = lstatSync(target);
    return { name, directory: stat.isDirectory(), symlink: stat.isSymbolicLink(),
      complete: ['vibefinance.db', 'server-dist', 'shared-dist', 'node-modules', 'previous-revision.txt'].every(file => existsSync(path.join(target, file))) };
  });
  const eligible = retentionPlan(inventory, now);
  const removed = [];
  const report = { checkedAt: new Date(now).toISOString(), apply, retentionDays: 30, minimumKept: 5,
    eligible, removed, dailyDatabaseBackupsDeleted: false, databaseHistoryDeleted: false };
  if (apply) audit({ ...report, completed: false });
  for (const name of eligible) {
    const target = path.resolve(root, name);
    assert.equal(path.dirname(target), root);
    assert.equal(realpathSync(target), target, 'Release target cannot be a symlink');
    assert.ok(lstatSync(target).isDirectory());
    assert.ok(releaseDate(name) !== null && now - releaseDate(name) > 30 * DAY);
    if (apply) {
      rmSync(target, { recursive: true, force: false }); removed.push(name);
      audit({ ...report, completed: false });
    }
  }
  if (apply) audit({ ...report, completed: true });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.ok(process.argv.slice(2).every(arg => arg === '--apply'), 'Only --apply is supported; default is a dry run');
  const apply = process.argv.includes('--apply');
  let audit = () => {};
  if (apply) {
    mkdirSync('/var/lib/vibefinance-ops', { recursive: true, mode: 0o700 });
    const auditPath = `/var/lib/vibefinance-ops/retention-${Date.now()}.json`;
    audit = report => writeFileSync(auditPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  const report = pruneReleaseBackups({ apply, audit });
  console.log(JSON.stringify(report, null, 2));
}
