// Local diagnostics only. No models, quota resets, external notifications or secret output.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/dist/config.js';

const cfg = getConfig();
const checks = [];
async function check(name, action) {
  try { checks.push({ name, ok: true, ...(await action()) }); }
  catch { checks.push({ name, ok: false }); }
}
await check('local-health', async () => {
  const response = await fetch(`http://127.0.0.1:${cfg.PORT}/api/health`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok || !(await response.json()).ok) throw new Error('unhealthy');
  return {};
});
await check('public-https', async () => {
  // curl verifies certificate trust and the IP SAN. No --insecure fallback.
  execFileSync('curl', ['--fail', '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '15',
    '--output', '/dev/null', 'https://67.211.211.236/api/health'], { stdio: 'ignore', timeout: 16000 });
  return {};
});
await check('certificate-expiry', async () => {
  execFileSync('openssl', ['x509', '-in', '/etc/letsencrypt/live/67.211.211.236/fullchain.pem', '-noout', '-checkend', '172800'], { stdio: 'ignore' });
  return { minimumRemainingHours: 48 };
});
await check('renewal-timer', async () => {
  execFileSync('systemctl', ['is-active', '--quiet', 'certbot-renew.timer'], { stdio: 'ignore' });
  execFileSync('systemctl', ['is-enabled', '--quiet', 'certbot-renew.timer'], { stdio: 'ignore' });
  return {};
});
await check('disk-headroom', async () => {
  const disk = statfsSync('/opt/vibefinance');
  const freeBytes = disk.bavail * disk.bsize;
  if (freeBytes < 2 * 1024 ** 3 || disk.bavail / disk.blocks < 0.1) throw new Error('disk pressure');
  return { freeBytes };
});
await check('database-size', async () => {
  const database = path.resolve(cfg.DB_PATH);
  const bytes = statSync(database).size;
  let walBytes = 0;
  try { walBytes = statSync(`${database}-wal`).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (walBytes > 512 * 1024 ** 2) throw new Error('WAL pressure');
  return { bytes, walBytes };
});
await check('verified-backup-age', async () => {
  const root = '/opt/vibefinance-backups';
  const completed = readdirSync(root).filter(name => /^database-[0-9TZ]+$/.test(name)).flatMap(name => {
    try { return [JSON.parse(readFileSync(path.join(root, name, 'verified.json'), 'utf8')).completedAt]; }
    catch { return []; }
  }).map(value => Date.parse(value)).filter(Number.isFinite);
  const ageHours = (Date.now() - Math.max(...completed)) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours > 36 || ageHours < 0) throw new Error('No recent verified backup');
  return { ageHours };
});
const report = { checkedAt: new Date().toISOString(), ok: checks.every(check => check.ok), checks };
mkdirSync('/var/lib/vibefinance-ops', { recursive: true, mode: 0o700 });
writeFileSync('/var/lib/vibefinance-ops/status.json.tmp', JSON.stringify(report, null, 2), { mode: 0o600 });
renameSync('/var/lib/vibefinance-ops/status.json.tmp', '/var/lib/vibefinance-ops/status.json');
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
