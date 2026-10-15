import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fingerprint } from './recovery.mjs';

test('restore fingerprint detects changed evidence and ignores physical row order', () => {
  const left = new Database(':memory:');
  const right = new Database(':memory:');
  try {
    for (const db of [left, right]) db.exec('CREATE TABLE events (id TEXT, value INTEGER)');
    left.exec("INSERT INTO events VALUES ('a', 1), ('b', 2)");
    right.exec("INSERT INTO events VALUES ('b', 2), ('a', 1)");
    assert.deepEqual(fingerprint(left), fingerprint(right));
    right.exec("UPDATE events SET value=3 WHERE id='a'");
    assert.notEqual(fingerprint(left).sha256, fingerprint(right).sha256);
  } finally { left.close(); right.close(); }
});
test('restore validation rejects foreign-key violations', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys=OFF');
    db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(9)');
    assert.throws(() => fingerprint(db));
  } finally { db.close(); }
});
