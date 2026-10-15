// Offline restore/release rehearsal. Never opens the production database for writing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import net from 'node:net';

export function fingerprint(database) {
  assert.deepEqual(database.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  assert.equal(database.pragma('foreign_key_check').length, 0);
  const tables = database.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const hash = createHash('sha256');
  let rows = 0;
  for (const table of tables) {
    hash.update(JSON.stringify(table));
    // Sort row hashes rather than depending on physical SQLite row order.
    const digests = [];
    for (const row of database.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`).iterate()) {
      digests.push(createHash('sha256').update(JSON.stringify(row)).digest('hex'));
      rows++;
    }
    for (const digest of digests.sort()) hash.update(digest);
  }
  return { tables: tables.length, rows, sha256: hash.digest('hex') };
}

export async function rehearse(backupPath, { recoveryRoot = '/opt/vibefinance-recovery', port = 18093 } = {}) {
  const backup = realpathSync(backupPath);
  assert.ok(backup.startsWith('/opt/vibefinance-backups/'), 'Use an explicit release backup directory');
  for (const entry of ['vibefinance.db', 'server-dist', 'shared-dist', 'node-modules', 'previous-revision.txt']) {
    assert.ok(existsSync(path.join(backup, entry)), `Incomplete backup: ${entry}`);
  }
  mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  const target = mkdtempSync(path.join(recoveryRoot, 'drill-'));
  mkdirSync(path.join(target, 'server'), { mode: 0o700 });
  mkdirSync(path.join(target, 'shared'), { mode: 0o700 });
  cpSync(path.join(backup, 'server-dist'), path.join(target, 'server/dist'), { recursive: true });
  cpSync(path.join(backup, 'shared-dist'), path.join(target, 'shared/dist'), { recursive: true });
  cpSync(path.join(backup, 'node-modules'), path.join(target, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  // Preserve package module semantics without copying any production .env or credentials.
  writeFileSync(path.join(target, 'server/package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(path.join(target, 'shared/package.json'), JSON.stringify({ type: 'module', main: 'dist/index.js', exports: './dist/index.js' }));
  const require = createRequire(path.join(target, 'server/package.json'));
  assert.ok(realpathSync(path.join(target, 'node_modules/@vibefinance/shared')).startsWith(`${target}${path.sep}`), 'Shared workspace must resolve inside the isolated restore');
  const Database = require('better-sqlite3');
  const source = new Database(path.join(backup, 'vibefinance.db'), { readonly: true, fileMustExist: true });
  let expected;
  try {
    expected = fingerprint(source);
    await source.backup(path.join(target, 'restored.db'));
  } finally { source.close(); }
  const restored = new Database(path.join(target, 'restored.db'), { readonly: true, fileMustExist: true });
  try { assert.deepEqual(fingerprint(restored), expected); } finally { restored.close(); }
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: path.join(target, 'server'), stdio: 'ignore',
    // Allow-list environment: no inherited provider/admin/signing secrets.
    env: { PATH: process.env.PATH, NODE_ENV: 'test', VF_SKIP_ENV_FILES: '1', VF_FAST: '1',
      DB_PATH: path.join(target, 'restored.db'), HOST: '127.0.0.1', PORT: String(port),
      LLM_PROVIDER: 'mock', EMBEDDINGS: 'local', DATA_MODE: 'synthetic', LOG_LEVEL: 'silent' },
  });
  let exited = false;
  const exit = new Promise(resolve => child.once('exit', () => { exited = true; resolve(); }));
  let spawnError;
  child.once('error', error => { spawnError = error; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (spawnError) throw spawnError;
      assert.ok(!exited, 'Restored release exited before becoming healthy');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        const health = await response.json();
        if (response.ok && health.provider === 'mock') { ready = true; break; }
      } catch { /* bounded readiness retry */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Restored release did not become healthy');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/metrics`, { signal: AbortSignal.timeout(3000) })).status, 401);
    const report = { ok: true, completedAt: new Date().toISOString(), previousRevision: readFileSync(path.join(backup, 'previous-revision.txt'), 'utf8').trim(),
      tablesVerified: expected.tables, rowsVerified: expected.rows, databaseFingerprintMatched: true, restoredReleaseHealthy: true,
      productionDatabaseReplaced: false, paidModelsInvoked: false };
    writeFileSync(path.join(target, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...report, evidenceDirectory: target }, null, 2));
    return report;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 3000))]);
    if (!exited) { child.kill('SIGKILL'); await exit; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.ok(process.argv[2], 'Usage: node deploy/recovery.mjs /opt/vibefinance-backups/TIMESTAMP');
  await rehearse(process.argv[2]);
}
