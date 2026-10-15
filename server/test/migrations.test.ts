import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrations.js";

describe("transactional schema migrations", () => {
  const baseline = { version: 1, name: "baseline", sql: "CREATE TABLE IF NOT EXISTS history (value TEXT)" };
  it("adopts an existing database without losing history and is repeatable", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE history (value TEXT); INSERT INTO history VALUES ('preserve')");
    migrate(db, [baseline]);
    migrate(db, [baseline]);
    expect(db.prepare("SELECT value FROM history").pluck().get()).toBe("preserve");
    expect(db.prepare("SELECT COUNT(*) FROM schema_migrations").pluck().get()).toBe(1);
    db.close();
  });
  it("rolls back schema, data and ledger together on failure", () => {
    const db = new Database(":memory:");
    migrate(db, [baseline]);
    expect(() => migrate(db, [baseline, { version: 2, name: "bad", sql:
      "INSERT INTO history VALUES ('partial'); CREATE TABLE partial (id); SELECT * FROM missing" }])).toThrow();
    expect(db.prepare("SELECT COUNT(*) FROM history").pluck().get()).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) FROM schema_migrations").pluck().get()).toBe(1);
    db.close();
  });
  it("rejects changed, unknown and unordered migrations", () => {
    const db = new Database(":memory:");
    migrate(db, [baseline]);
    expect(() => migrate(db, [{ ...baseline, sql: baseline.sql + "; SELECT 1" }])).toThrow(/modified/);
    expect(() => migrate(db, [])).toThrow(/Unsupported/);
    expect(() => migrate(db, [baseline, baseline])).toThrow(/increasing/);
    db.close();
  });
});
