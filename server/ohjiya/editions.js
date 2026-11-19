/**
 * The three sector editions. One definition per edition: names, what it
 * offers, and its starter lens, a share-link view that opens the globe the way
 * that sector wants to look at it. The server reads these; the browser only
 * receives the parts it needs (see publicEdition / editionCatalog).
 *
 * `tools[].status` is honest: 'ready' works today, 'soon' is on the roadmap and
 * is shown as such. Starter lenses use layers that already exist; the sector
 * tools (hex maps, data import, connectors) are added to `tools` as they ship.
 */
import { createView, viewUrl } from '../../src/view/index.js';

const RIYADH = { lat: 24.7136, lon: 46.6753 };
const JEDDAH = { lat: 21.5433, lon: 39.1728 };
const DAMMAM = { lat: 26.4207, lon: 50.0888 };

/** A named starter view: a camera, the layers to turn on, and a base map. */
const lens = (id, en, ar, camera, layers) => ({
  id,
  label: { en, ar },
  lens: {
    camera: { heading_deg: 0, pitch_deg: -55, ...camera },
    layers,
    map: 'esri-imagery',
  },
});

export const EDITIONS = Object.freeze({
  real_estate: {
    id: 'real_estate',
    name: { en: 'Real Estate', ar: 'العقارات' },
    tagline: {
      en: 'Read any neighbourhood: transit, streets and value at a glance.',
      ar: 'اقرأ أي حي: المواصلات والشوارع والقيمة في لمحة.',
    },
    lens: {
      camera: { ...RIYADH, altitude_m: 12000, heading_deg: 0, pitch_deg: -55 },
      layers: ['transit', 'street-level', 'bikeshare'],
      map: 'esri-imagery',
    },
    lenses: [
      lens(
        'riyadh',
        'Riyadh neighbourhoods',
        'أحياء الرياض',
        { ...RIYADH, altitude_m: 12000 },
        ['transit', 'street-level', 'bikeshare'],
      ),
      lens(
        'jeddah',
        'Jeddah neighbourhoods',
        'أحياء جدة',
        { ...JEDDAH, altitude_m: 12000 },
        ['transit', 'street-level', 'bikeshare'],
      ),
      lens(
        'dammam',
        'Dammam and Khobar',
        'الدمام والخبر',
        { ...DAMMAM, altitude_m: 14000 },
        ['transit', 'street-level'],
      ),
      lens(
        'liveability',
        'Liveability: air, transit, bikes',
        'جودة الحياة: الهواء والمواصلات والدراجات',
        { ...RIYADH, altitude_m: 15000 },
        ['air-quality', 'transit', 'bikeshare'],
      ),
      lens(
        'change',
        'What changed: recent imagery and streets',
        'ما الذي تغيّر: صور حديثة وشوارع',
        { ...RIYADH, altitude_m: 6000 },
        ['recent-imagery', 'street-level'],
      ),
      lens(
        'risk',
        'Site risk: rain, storms, dams',
        'مخاطر الموقع: الأمطار والعواصف والسدود',
        { ...JEDDAH, altitude_m: 60000, pitch_deg: -70 },
        ['weather-radar', 'weather-cyclones', 'local-dams'],
      ),
    ],
    tools: [
      {
        id: 'lens',
        status: 'ready',
        label: {
          en: 'Neighbourhood lens: transit, street level, bikeshare',
          ar: 'عدسة الحي: المواصلات والمستوى الشارعي ودراجات المشاركة',
        },
      },
      {
        id: 'import',
        status: 'soon',
        label: {
          en: 'Import your listings and sites',
          ar: 'استيراد عقاراتك ومواقعك',
        },
      },
      {
        id: 'price-hex',
        status: 'soon',
        label: {
          en: 'Price and listing density hex map',
          ar: 'خريطة سداسية لكثافة الأسعار والعروض',
        },
      },
      {
        id: 'context',
        status: 'soon',
        label: {
          en: 'Neighbourhood context and drive-time ring',
          ar: 'سياق الحي وحلقة زمن القيادة',
        },
      },
    ],
  },
  retail: {
    id: 'retail',
    name: { en: 'Retail', ar: 'التجزئة' },
    tagline: {
      en: 'See where customers move and where competitors cluster.',
      ar: 'اعرف أين يتحرك العملاء وأين يتجمع المنافسون.',
    },
    lens: {
      camera: { ...RIYADH, altitude_m: 20000, heading_deg: 0, pitch_deg: -60 },
      layers: ['traffic', 'transit'],
      map: 'esri-imagery',
    },
    lenses: [
      lens(
        'riyadh',
        'Riyadh customer movement',
        'حركة العملاء في الرياض',
        { ...RIYADH, altitude_m: 20000, pitch_deg: -60 },
        ['traffic', 'transit'],
      ),
      lens(
        'jeddah',
        'Jeddah customer movement',
        'حركة العملاء في جدة',
        { ...JEDDAH, altitude_m: 20000, pitch_deg: -60 },
        ['traffic', 'transit'],
      ),
      lens(
        'dammam',
        'Dammam and Khobar movement',
        'حركة الدمام والخبر',
        { ...DAMMAM, altitude_m: 20000, pitch_deg: -60 },
        ['traffic', 'transit'],
      ),
      lens(
        'storefront',
        'Storefront check: streets and imagery',
        'فحص الواجهات: الشوارع والصور',
        { ...RIYADH, altitude_m: 3000 },
        ['street-level', 'recent-imagery'],
      ),
      lens(
        'delivery',
        'Delivery conditions: traffic, rain, air',
        'ظروف التوصيل: الازدحام والأمطار والهواء',
        { ...RIYADH, altitude_m: 30000, pitch_deg: -60 },
        ['traffic', 'weather-radar', 'air-quality'],
      ),
      lens(
        'security',
        'Site security: cameras and plate readers',
        'أمن المواقع: الكاميرات وقارئات اللوحات',
        { ...RIYADH, altitude_m: 8000 },
        ['cctv', 'alpr-cameras'],
      ),
    ],
    tools: [
      {
        id: 'lens',
        status: 'ready',
        label: {
          en: 'Customer movement lens: traffic and transit',
          ar: 'عدسة حركة العملاء: الازدحام والمواصلات',
        },
      },
      {
        id: 'import',
        status: 'soon',
        label: { en: 'Import your branches', ar: 'استيراد فروعك' },
      },
      {
        id: 'competitor-hex',
        status: 'ready',
        label: {
          en: 'Competitor density map (Library, filter by type)',
          ar: 'خريطة كثافة المنافسين (المكتبة، تصفية حسب النوع)',
        },
      },
      {
        id: 'catchment',
        status: 'soon',
        label: { en: 'Branch catchment rings', ar: 'نطاقات خدمة الفروع' },
      },
    ],
  },
  digital_business: {
    id: 'digital_business',
    name: { en: 'Digital Business', ar: 'الأعمال الرقمية' },
    tagline: {
      en: 'Map the digital infrastructure and audiences behind your market.',
      ar: 'ارسم خريطة البنية الرقمية والجمهور وراء سوقك.',
    },
    lens: {
      camera: {
        lat: 25.5,
        lon: 45.0,
        altitude_m: 4500000,
        heading_deg: 0,
        pitch_deg: -90,
      },
      layers: ['telegeography-submarine-cables', 'local-datacenters'],
      map: 'esri-imagery',
    },
    lenses: [
      lens(
        'cables',
        'Subsea cables and data centres',
        'الكابلات البحرية ومراكز البيانات',
        { lat: 25.5, lon: 45.0, altitude_m: 4500000, pitch_deg: -90 },
        ['telegeography-submarine-cables', 'local-datacenters'],
      ),
      lens(
        'datacentres',
        'Data centres near Riyadh',
        'مراكز البيانات قرب الرياض',
        { ...RIYADH, altitude_m: 60000, pitch_deg: -70 },
        ['local-datacenters'],
      ),
      lens(
        'landing',
        'Cable landing: Jeddah and the Red Sea',
        'هبوط الكابلات: جدة والبحر الأحمر',
        { ...JEDDAH, altitude_m: 500000, pitch_deg: -80 },
        ['telegeography-submarine-cables', 'ais-live-vessels'],
      ),
      lens(
        'trade',
        'Trade and logistics: flights and ships',
        'التجارة والخدمات اللوجستية: الطيران والسفن',
        { lat: 25.0, lon: 48.0, altitude_m: 2500000, pitch_deg: -90 },
        ['flights', 'ais-live-vessels'],
      ),
      lens(
        'signal',
        'Signal health: radio and GNSS',
        'سلامة الإشارة: الراديو والملاحة',
        { lat: 25.5, lon: 45.0, altitude_m: 3000000, pitch_deg: -90 },
        ['radio', 'gnss-integrity'],
      ),
      lens(
        'space',
        'Satellites overhead',
        'الأقمار الاصطناعية فوقنا',
        { lat: 25.5, lon: 45.0, altitude_m: 9000000, pitch_deg: -90 },
        ['satellites'],
      ),
    ],
    tools: [
      {
        id: 'lens',
        status: 'ready',
        label: {
          en: 'Infrastructure lens: subsea cables and data centres',
          ar: 'عدسة البنية التحتية: الكابلات البحرية ومراكز البيانات',
        },
      },
      {
        id: 'rss',
        status: 'soon',
        label: {
          en: 'Sector news and RSS feeds on the map',
          ar: 'أخبار القطاع وخلاصات RSS على الخريطة',
        },
      },
      {
        id: 'connectors',
        status: 'soon',
        label: {
          en: 'Analytics, search-trend and social connectors',
          ar: 'موصّلات التحليلات واتجاهات البحث والتواصل الاجتماعي',
        },
      },
      {
        id: 'audience',
        status: 'soon',
        label: { en: 'Audience and demand map', ar: 'خريطة الجمهور والطلب' },
      },
    ],
  },
});

export const EDITION_IDS = Object.freeze(Object.keys(EDITIONS));

/** The starter lens as a share link path, e.g. "/#v=2&lat=...". Built through the app's own view codec. */
export function lensPath(edition) {
  const definition = EDITIONS[edition];
  return definition ? lensViewPath(definition.lens) : null;
}

function lensViewPath(view) {
  const url = viewUrl('https://lens.invalid/', createView(view));
  return url.replace('https://lens.invalid', '');
}

/** What the browser gets for a signed-in user's own edition. */
export function publicEdition(edition) {
  const definition = EDITIONS[edition];
  if (!definition) return null;
  return {
    id: definition.id,
    name: definition.name,
    tagline: definition.tagline,
    lens: lensPath(edition),
    lenses: definition.lenses.map(({ id, label, lens: view }) => ({
      id,
      label,
      path: lensViewPath(view),
    })),
    tools: definition.tools.map(({ id, status, label }) => ({
      id,
      status,
      label,
    })),
  };
}

/** The user's edition, only while the plan is active and names a known edition. */
export function editionFor(entitlement) {
  return entitlement?.plan?.status === 'active'
    ? publicEdition(entitlement.plan.edition)
    : null;
}

/** Names and taglines of every edition, for the "what you could unlock" list. */
export function editionCatalog() {
  return EDITION_IDS.map((id) => ({
    id,
    name: EDITIONS[id].name,
    tagline: EDITIONS[id].tagline,
  }));
}
