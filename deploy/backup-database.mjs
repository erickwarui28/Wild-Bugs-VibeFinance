// Online SQLite backup; never copies a live WAL database with plain cp.
import Database from 'better-sqlite3';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/dist/config.js';
import { fingerprint } from './recovery.mjs';

const target = `/opt/vibefinance-backups/database-${new Date().toISOString().replaceAll(/[-:.]/g, '')}`;
mkdirSync(target, { mode: 0o700 });
const source = new Database(path.resolve(getConfig().DB_PATH), { readonly: true, fileMustExist: true });
try { await source.backup(path.join(target, 'pending.db')); } finally { source.close(); }
const copy = new Database(path.join(target, 'pending.db'), { readonly: true, fileMustExist: true });
let verified;
try { verified = fingerprint(copy); } finally { copy.close(); }
renameSync(path.join(target, 'pending.db'), path.join(target, 'vibefinance.db'));
const report = { completedAt: new Date().toISOString(), integrityVerified: true, ...verified };
writeFileSync(path.join(target, 'verified.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ok: true, target, tablesVerified: verified.tables, rowsVerified: verified.rows }));
