/**
 * Company library: the places, areas and saved tactics a company builds on the
 * map. Stored per company (not per user), so everyone on the plan sees the same
 * library, and kept when a plan lapses (it is only hidden until renewal).
 *
 *   place  one point: a branch, listing, competitor or attraction
 *   area   a circle around a point, or a drawn polygon
 *   tactic a named, reusable view: the share-link parameters (camera, layers,
 *          drawn marks) plus which library tags it shows
 *
 * This file is pure data handling: `handle()` takes a parsed request and
 * returns { status, body }. Sessions, plan checks and HTTP live in plugin.js.
 */

export const PLACE_TAGS = Object.freeze([
  'branch',
  'listing',
  'competitor',
  'attraction',
  'other',
]);

export const STATUSES = Object.freeze([
  'active',
  'planned',
  'attention',
  'closed',
]);

export const LIMITS = Object.freeze({
  fields: 8,
  fieldKeyChars: 40,
  fieldValueChars: 200,
  notesChars: 1000,
  items: 500,
  tactics: 50,
  polygonPoints: 200,
  minRadiusM: 50,
  maxRadiusM: 200_000,
  hashChars: 8000,
  hashKeys: 64,
});

const NAME_MAX = 120;
const TACTIC_NAME_MAX = 80;

const text = (value, max) =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
const lat = (v) => Number.isFinite(v) && Math.abs(v) <= 90;
const lon = (v) => Number.isFinite(v) && Math.abs(v) <= 180;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** The geometry a place or area may carry, or null. */
function geometryOf(kind, input) {
  if (!input || typeof input !== 'object') return null;
  if (kind === 'place') {
    return lat(input.lat) && lon(input.lon)
      ? { lat: round6(input.lat), lon: round6(input.lon) }
      : null;
  }
  if (kind === 'area') {
    if (input.type === 'circle') {
      const r = input.radius_m;
      return lat(input.lat) &&
        lon(input.lon) &&
        Number.isFinite(r) &&
        r >= LIMITS.minRadiusM &&
        r <= LIMITS.maxRadiusM
        ? {
            type: 'circle',
            lat: round6(input.lat),
            lon: round6(input.lon),
            radius_m: Math.round(r),
          }
        : null;
    }
    if (input.type === 'polygon') {
      const points = Array.isArray(input.points) ? input.points : [];
      if (points.length < 3 || points.length > LIMITS.polygonPoints)
        return null;
      if (!points.every((p) => p && lat(p.lat) && lon(p.lon))) return null;
      // A double-click to finish can repeat the last corner; drop repeats so
      // the shape still has to be a real triangle or larger.
      const ring = [];
      for (const p of points) {
        const next = { lat: round6(p.lat), lon: round6(p.lon) };
        const last = ring[ring.length - 1];
        if (!last || last.lat !== next.lat || last.lon !== next.lon)
          ring.push(next);
      }
      return ring.length >= 3 ? { type: 'polygon', points: ring } : null;
    }
  }
  return null;
}

/** Share-link parameters as stored: bounded, and parseable as a hash string. */
export function cleanHash(value) {
  if (typeof value !== 'string') return null;
  const raw = value.startsWith('#') ? value.slice(1) : value;
  if (!raw || raw.length > LIMITS.hashChars || /[\u0000-\u001f]/.test(raw))
    return null;
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (keys.length === 0 || keys.length > LIMITS.hashKeys) return null;
  const la = Number.parseFloat(params.get('lat'));
  const lo = Number.parseFloat(params.get('lon'));
  if (!lat(la) || !lon(lo)) return null;
  return raw;
}

/** Notes keep their line breaks; everything else control-like is dropped. */
const notesText = (value) =>
  typeof value === 'string'
    ? value
        .replace(/[^\S\n]+/g, ' ')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, LIMITS.notesChars)
    : '';

/**
 * The editable details of an item: a status, a few named fields (manager,
 * size, price...) and free notes. Only keys present in `input` change `base`.
 * @returns {{ok: true, meta: object} | {ok: false, error: string}}
 */
function metaOf(input, base = { status: 'active', fields: [], notes: '' }) {
  const meta = { status: base.status, fields: base.fields, notes: base.notes };
  if (input?.status !== undefined) {
    if (!STATUSES.includes(input.status))
      return { ok: false, error: 'bad_status' };
    meta.status = input.status;
  }
  if (input?.fields !== undefined) {
    if (!Array.isArray(input.fields) || input.fields.length > LIMITS.fields)
      return { ok: false, error: 'bad_fields' };
    const fields = [];
    for (const f of input.fields) {
      const key = text(f?.key, LIMITS.fieldKeyChars);
      const value = text(f?.value, LIMITS.fieldValueChars);
      if (!key) return { ok: false, error: 'bad_fields' };
      fields.push({ key, value });
    }
    meta.fields = fields;
  }
  if (input?.notes !== undefined) {
    if (typeof input.notes !== 'string')
      return { ok: false, error: 'bad_notes' };
    meta.notes = notesText(input.notes);
  }
  return { ok: true, meta };
}

function tagFilter(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((t) => PLACE_TAGS.includes(t)))];
}

export function createLibrary(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lib_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      tag TEXT NOT NULL,
      geom TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lib_item_company ON lib_item (company_id);
    CREATE TABLE IF NOT EXISTS lib_tactic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      doc TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lib_tactic_company ON lib_tactic (company_id);
  `);
  // Details added after the first schema: status, fields, notes.
  if (
    !db
      .prepare('PRAGMA table_info(lib_item)')
      .all()
      .some((c) => c.name === 'meta')
  )
    db.exec("ALTER TABLE lib_item ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'");
  const listItems = db.prepare(
    'SELECT id, kind, name, tag, geom, meta, created_ms FROM lib_item WHERE company_id = ? ORDER BY id',
  );
  const countItems = db.prepare(
    'SELECT COUNT(*) AS n FROM lib_item WHERE company_id = ?',
  );
  const insertItem = db.prepare(
    'INSERT INTO lib_item (company_id, kind, name, tag, geom, meta, created_by, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const getItem = db.prepare(
    'SELECT id, kind, name, tag, geom, meta, created_ms FROM lib_item WHERE id = ? AND company_id = ?',
  );
  const updateItem = db.prepare(
    'UPDATE lib_item SET name = ?, tag = ?, meta = ? WHERE id = ? AND company_id = ?',
  );
  const deleteItem = db.prepare(
    'DELETE FROM lib_item WHERE id = ? AND company_id = ?',
  );
  const listTactics = db.prepare(
    'SELECT id, name, doc, created_ms FROM lib_tactic WHERE company_id = ? ORDER BY id',
  );
  const countTactics = db.prepare(
    'SELECT COUNT(*) AS n FROM lib_tactic WHERE company_id = ?',
  );
  const insertTactic = db.prepare(
    'INSERT INTO lib_tactic (company_id, name, doc, created_by, created_ms) VALUES (?, ?, ?, ?, ?)',
  );
  const deleteTactic = db.prepare(
    'DELETE FROM lib_tactic WHERE id = ? AND company_id = ?',
  );

  const metaFrom = (raw) => {
    const m = JSON.parse(raw || '{}');
    return {
      status: STATUSES.includes(m.status) ? m.status : 'active',
      fields: Array.isArray(m.fields) ? m.fields : [],
      notes: typeof m.notes === 'string' ? m.notes : '',
    };
  };
  const itemOut = (row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    tag: row.tag,
    geom: JSON.parse(row.geom),
    ...metaFrom(row.meta),
    created_ms: row.created_ms,
  });
  const tacticOut = (row) => ({
    id: row.id,
    name: row.name,
    ...JSON.parse(row.doc),
    created_ms: row.created_ms,
  });
  const bad = (error) => ({ status: 400, body: { error } });

  return {
    /**
     * @param {{method: string, path: string, body: any, companyId: number, userId: number}} request
     * @returns {{status: number, body: object}}
     */
    handle({ method, path, body, companyId, userId }, now = Date.now()) {
      const parts = path
        .replace(/^\/api\/library\/?/, '')
        .split('/')
        .filter(Boolean);

      if (method === 'GET' && parts.length === 0)
        return {
          status: 200,
          body: {
            items: listItems.all(companyId).map(itemOut),
            tactics: listTactics.all(companyId).map(tacticOut),
            tags: PLACE_TAGS,
            statuses: STATUSES,
            limits: { items: LIMITS.items, tactics: LIMITS.tactics },
          },
        };

      if (parts[0] === 'items' && method === 'POST' && parts.length === 1) {
        const kind = body?.kind;
        if (kind !== 'place' && kind !== 'area') return bad('bad_kind');
        const name = text(body?.name, NAME_MAX);
        if (!name) return bad('bad_name');
        const tag = body?.tag === undefined ? 'other' : body.tag;
        if (!PLACE_TAGS.includes(tag)) return bad('bad_tag');
        const geom = geometryOf(kind, body?.geom);
        if (!geom) return bad('bad_geometry');
        const details = metaOf(body);
        if (!details.ok) return bad(details.error);
        if (countItems.get(companyId).n >= LIMITS.items)
          return {
            status: 409,
            body: { error: 'limit_reached', limit: LIMITS.items },
          };
        const result = insertItem.run(
          companyId,
          kind,
          name,
          tag,
          JSON.stringify(geom),
          JSON.stringify(details.meta),
          userId,
          now,
        );
        return {
          status: 201,
          body: itemOut({
            id: Number(result.lastInsertRowid),
            kind,
            name,
            tag,
            geom: JSON.stringify(geom),
            meta: JSON.stringify(details.meta),
            created_ms: now,
          }),
        };
      }

      if (parts[0] === 'items' && method === 'PATCH' && parts.length === 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id) || id < 1) return bad('bad_id');
        const row = getItem.get(id, companyId);
        if (!row) return { status: 404, body: { error: 'not_found' } };
        let name = row.name;
        if (body?.name !== undefined) {
          name = text(body.name, NAME_MAX);
          if (!name) return bad('bad_name');
        }
        let tag = row.tag;
        if (body?.tag !== undefined) {
          if (!PLACE_TAGS.includes(body.tag)) return bad('bad_tag');
          tag = body.tag;
        }
        const details = metaOf(body, metaFrom(row.meta));
        if (!details.ok) return bad(details.error);
        updateItem.run(name, tag, JSON.stringify(details.meta), id, companyId);
        return {
          status: 200,
          body: itemOut({
            ...row,
            name,
            tag,
            meta: JSON.stringify(details.meta),
          }),
        };
      }

      if (parts[0] === 'items' && method === 'DELETE' && parts.length === 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id) || id < 1) return bad('bad_id');
        return deleteItem.run(id, companyId).changes === 1
          ? { status: 204, body: null }
          : { status: 404, body: { error: 'not_found' } };
      }

      if (parts[0] === 'tactics' && method === 'POST' && parts.length === 1) {
        const name = text(body?.name, TACTIC_NAME_MAX);
        if (!name) return bad('bad_name');
        const hash = cleanHash(body?.hash);
        if (!hash) return bad('bad_view');
        const edition =
          typeof body?.edition === 'string'
            ? body.edition.replace(/[^a-z_]/g, '').slice(0, 32)
            : null;
        const doc = {
          hash,
          tags: tagFilter(body?.tags),
          edition: edition || null,
        };
        if (countTactics.get(companyId).n >= LIMITS.tactics)
          return {
            status: 409,
            body: { error: 'limit_reached', limit: LIMITS.tactics },
          };
        const result = insertTactic.run(
          companyId,
          name,
          JSON.stringify(doc),
          userId,
          now,
        );
        return {
          status: 201,
          body: tacticOut({
            id: Number(result.lastInsertRowid),
            name,
            doc: JSON.stringify(doc),
            created_ms: now,
          }),
        };
      }

      if (parts[0] === 'tactics' && method === 'DELETE' && parts.length === 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id) || id < 1) return bad('bad_id');
        return deleteTactic.run(id, companyId).changes === 1
          ? { status: 204, body: null }
          : { status: 404, body: { error: 'not_found' } };
      }

      return { status: 404, body: { error: 'not_found' } };
    },
  };
}
