/**
 * Small SQLite store (node:sqlite): used sign-in token ids and the entitlement
 * cache. Both survive a restart, so a captured sign-in link cannot be replayed
 * after one and the app keeps its last good plan answers if WordPress is down.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createStore(dbPath = ':memory:') {
  if (dbPath !== ':memory:')
    mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS used_jti (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS entitlement (
      user_id INTEGER PRIMARY KEY,
      doc TEXT NOT NULL,
      fetched_ms INTEGER NOT NULL
    );
  `);
  const insertJti = db.prepare(
    'INSERT OR IGNORE INTO used_jti (jti, exp) VALUES (?, ?)',
  );
  const purgeJti = db.prepare('DELETE FROM used_jti WHERE exp < ?');
  const getEnt = db.prepare(
    'SELECT doc, fetched_ms FROM entitlement WHERE user_id = ?',
  );
  const putEnt = db.prepare(
    'INSERT INTO entitlement (user_id, doc, fetched_ms) VALUES (?, ?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc, fetched_ms = excluded.fetched_ms',
  );
  const delEnt = db.prepare('DELETE FROM entitlement WHERE user_id = ?');

  return {
    /** @returns {boolean} true the first time a token id is seen. */
    markTokenUsed(jti, expSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
      purgeJti.run(nowSeconds);
      return insertJti.run(jti, expSeconds).changes === 1;
    },
    getEntitlement(userId) {
      const row = getEnt.get(userId);
      return row
        ? { doc: JSON.parse(row.doc), fetchedMs: row.fetched_ms }
        : null;
    },
    putEntitlement(userId, doc, nowMs = Date.now()) {
      putEnt.run(userId, JSON.stringify(doc), nowMs);
    },
    dropEntitlements(userIds) {
      for (const id of userIds) delEnt.run(id);
    },
    close() {
      db.close();
    },
  };
}
