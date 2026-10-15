import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export interface Migration { version: number; name: string; sql: string }

/** Each migration and its ledger entry commit together; never erase application history. */
export function migrate(db: Database.Database, migrations: readonly Migration[]): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previous) {
      throw new Error("Migration versions must be positive and strictly increasing");
    }
    previous = migration.version;
  }
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    )`);
    const applied = db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all() as
      { version: number; name: string; checksum: string }[];
    for (const row of applied) {
      const migration = migrations.find(item => item.version === row.version);
      if (!migration || migration.name !== row.name || checksum(migration.sql) !== row.checksum) {
        throw new Error(`Unsupported or modified database migration ${row.version}`);
      }
    }
    for (const migration of migrations) {
      if (applied.some(row => row.version === migration.version)) continue;
      if (applied.some(row => row.version > migration.version)) throw new Error("Migration history has a gap");
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?)")
        .run(migration.version, migration.name, checksum(migration.sql), new Date().toISOString());
    }
  }).immediate();
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}
