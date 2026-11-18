/**
 * Company library: the parts that need no map and no DOM, so they can be tested
 * on their own. Tag colours and names, filtering, the server calls, and the
 * share-link hash a tactic stores.
 */

export const TAGS = Object.freeze({
  branch: { color: '#5dff9f', en: 'Branch', ar: 'فرع' },
  listing: { color: '#ffb547', en: 'Listing', ar: 'عقار معروض' },
  competitor: { color: '#ff6b6b', en: 'Competitor', ar: 'منافس' },
  attraction: { color: '#39d0ff', en: 'Attraction', ar: 'معلم جذب' },
  other: { color: '#c9a7ff', en: 'Other', ar: 'أخرى' },
});
export const TAG_IDS = Object.freeze(Object.keys(TAGS));

export const tagColor = (tag) => (TAGS[tag] ?? TAGS.other).color;
export const tagName = (tag, lang) =>
  (TAGS[tag] ?? TAGS.other)[lang === 'ar' ? 'ar' : 'en'];

/** Items shown for a tag filter; an empty filter shows everything. */
export function filterItems(items, tags) {
  const wanted = new Set(tags ?? []);
  return wanted.size === 0
    ? [...items]
    : items.filter((item) => wanted.has(item.tag));
}

/** Metres between two points; enough for "which place is nearest". */
export function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A place's own point, or an area's centre (circle centre or polygon mean). */
export function pointOf(item) {
  const g = item.geom;
  if (g.points?.length)
    return {
      lat: g.points.reduce((s, p) => s + p.lat, 0) / g.points.length,
      lon: g.points.reduce((s, p) => s + p.lon, 0) / g.points.length,
    };
  return { lat: g.lat, lon: g.lon };
}

/** The share-link parameters in an address bar hash, without the leading #. */
export function hashParams(hash) {
  return String(hash ?? '').replace(/^#/, '');
}

/** Whether a hash carries a view a tactic can store (it needs a camera). */
export function hasView(hash) {
  const params = new URLSearchParams(hashParams(hash));
  return (
    Number.isFinite(Number.parseFloat(params.get('lat'))) &&
    Number.isFinite(Number.parseFloat(params.get('lon')))
  );
}

export class LibraryError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  en: {
    plan_required: 'Your plan is not active.',
    sign_in_required: 'Please sign in again.',
    limit_reached: 'Your company library is full.',
    bad_name: 'Give it a name.',
    bad_geometry: 'That shape is not valid.',
    bad_view: 'This view cannot be saved.',
    cross_site: 'Request refused.',
    default: 'Something went wrong. Try again.',
  },
  ar: {
    plan_required: 'اشتراكك غير فعّال.',
    sign_in_required: 'يرجى تسجيل الدخول مرة أخرى.',
    limit_reached: 'مكتبة شركتك ممتلئة.',
    bad_name: 'اكتب اسمًا.',
    bad_geometry: 'هذا الشكل غير صالح.',
    bad_view: 'لا يمكن حفظ هذا العرض.',
    cross_site: 'تم رفض الطلب.',
    default: 'حدث خطأ. حاول مرة أخرى.',
  },
};
export const errorText = (code, lang) =>
  (MESSAGES[lang] ?? MESSAGES.en)[code] ??
  (MESSAGES[lang] ?? MESSAGES.en).default;

export function createLibraryClient(fetchImpl = globalThis.fetch) {
  async function call(path, method = 'GET', body) {
    const response = await fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* non-JSON error page */
    }
    if (!response.ok)
      throw new LibraryError(payload?.error ?? 'default', response.status);
    return payload;
  }
  return {
    load: () => call('/api/library'),
    addItem: (item) => call('/api/library/items', 'POST', item),
    removeItem: (id) => call(`/api/library/items/${id}`, 'DELETE'),
    addTactic: (tactic) => call('/api/library/tactics', 'POST', tactic),
    removeTactic: (id) => call(`/api/library/tactics/${id}`, 'DELETE'),
  };
}
