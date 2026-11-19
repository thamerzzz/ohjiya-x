/**
 * Per-company daily quotas for the paid upstream APIs (Google Places, Mapillary,
 * TomTom, OpenAI, voice, Atlas AI). A company shares one allowance per bucket
 * per UTC day, so one customer cannot spend the operator's whole API budget.
 * Counts live in SQLite, so a restart does not reset them.
 */

export const DEFAULT_QUOTAS = Object.freeze({
  places: 300,
  mapillary: 1000,
  tomtom: 2000,
  chat: 200,
  assistant: 200,
  voice: 60,
});
export const QUOTA_BUCKETS = Object.freeze(Object.keys(DEFAULT_QUOTAS));

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Quotas from env vars like OX_QUOTA_PLACES=500; bad or missing values keep the default. */
export function quotasFromEnv(env = {}) {
  const limits = { ...DEFAULT_QUOTAS };
  for (const bucket of QUOTA_BUCKETS) {
    const raw = env[`OX_QUOTA_${bucket.toUpperCase()}`];
    const n = Number.parseInt(raw, 10);
    if (raw !== undefined && Number.isInteger(n) && n >= 0) limits[bucket] = n;
  }
  return limits;
}

export function createQuota(db, limits = DEFAULT_QUOTAS) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_use (
      company_id INTEGER NOT NULL,
      bucket TEXT NOT NULL,
      day TEXT NOT NULL,
      used INTEGER NOT NULL,
      PRIMARY KEY (company_id, bucket, day)
    );
  `);
  const bump = db.prepare(
    `INSERT INTO quota_use (company_id, bucket, day, used) VALUES (?, ?, ?, 1)
     ON CONFLICT(company_id, bucket, day) DO UPDATE SET used = used + 1
     WHERE used < ?
     RETURNING used`,
  );
  const read = db.prepare(
    'SELECT used FROM quota_use WHERE company_id = ? AND bucket = ? AND day = ?',
  );
  const purge = db.prepare('DELETE FROM quota_use WHERE day < ?');

  return {
    /** Count one use. @returns {{ok:boolean, used:number, limit:number}} */
    take(companyId, bucket, nowMs = Date.now()) {
      const limit = limits[bucket];
      if (!Number.isInteger(limit)) return { ok: true, used: 0, limit: -1 }; // unknown bucket: not metered
      const today = day(nowMs);
      const row = bump.get(companyId, bucket, today, limit);
      if (row) return { ok: true, used: row.used, limit };
      const current = read.get(companyId, bucket, today)?.used ?? 0;
      return { ok: false, used: current, limit };
    },
    /** Today's use for every bucket, for the account menu. */
    usage(companyId, nowMs = Date.now()) {
      const today = day(nowMs);
      return Object.fromEntries(
        QUOTA_BUCKETS.map((bucket) => [
          bucket,
          {
            used: read.get(companyId, bucket, today)?.used ?? 0,
            limit: limits[bucket],
          },
        ]),
      );
    },
    /** Drop counts older than a week. */
    tidy(nowMs = Date.now()) {
      purge.run(day(nowMs - 7 * 86_400_000));
    },
  };
}
