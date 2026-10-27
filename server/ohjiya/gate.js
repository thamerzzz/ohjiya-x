/**
 * Which plan a route needs. Anything not listed stays open: the globe and the
 * keyless data layers are the free version.
 *
 * `feature` is a feature id from the entitlement document; `paid` means any
 * active plan. `forwarded` routes sit behind the upstream cross-site gate that
 * refuses reverse-proxy headers; once a signed-in paid user has passed this
 * gate those headers are removed so the route works behind Caddy.
 */

const RULES = [
  { prefix: '/api/setup/', deny: true }, // Provider Settings is never reachable on the public site.
  { prefix: '/api/realtime/', feature: 'voice', forwarded: true },
  { prefix: '/api/gemini/', feature: 'voice', forwarded: true },
  { prefix: '/api/openai/hud-summary', feature: 'chat', forwarded: true },
  { prefix: '/api/google/nearby-places', paid: true, forwarded: true },
  { prefix: '/api/google/text-search', paid: true, forwarded: true },
  { prefix: '/api/mapillary/', paid: true, forwarded: true },
  { prefix: '/api/tomtom', paid: true, forwarded: true },
];

/** The rule for a request path, or null when the route is open. */
export function ruleFor(pathname) {
  const lower = String(pathname).toLowerCase();
  return (
    RULES.find(
      (rule) =>
        lower === rule.prefix.replace(/\/$/, '') ||
        lower.startsWith(rule.prefix),
    ) ?? null
  );
}

/**
 * The strictest rule that any reading of the request target matches. The
 * upstream router and URL parsing can disagree about dot segments, backslashes
 * and absolute-form targets, so every reading is checked, as build/vite.js does
 * for its own /api test; a request is open only if no reading matches a rule.
 */
export function ruleForRequest(rawUrl) {
  const raw = String(rawUrl || '/');
  const candidates = new Set();
  candidates.add(raw.split(/[?#]/, 1)[0]);
  candidates.add(
    raw
      .trim()
      .split(/[?#]/, 1)[0]
      .replace(/\\/g, '/')
      .replace(/^[a-z][a-z0-9+.-]*:(?:\/\/[^/]*)?/i, ''),
  );
  try {
    candidates.add(new URL(raw, 'http://localhost').pathname);
  } catch {
    /* the unparsed readings still decide */
  }
  for (const path of [...candidates]) {
    try {
      candidates.add(decodeURIComponent(path));
    } catch {
      /* undecodable: the other readings still decide */
    }
  }
  const matched = [...candidates].map(ruleFor).filter(Boolean);
  const strictness = (rule) => (rule.deny ? 3 : rule.feature ? 2 : 1);
  return matched.sort((a, b) => strictness(b) - strictness(a))[0] ?? null;
}

/** @returns {{ok:true}|{ok:false,status:number,error:string,feature?:string}} */
export function decide(rule, entitlement, signedIn) {
  if (!rule) return { ok: true };
  if (rule.deny) return { ok: false, status: 404, error: 'not_found' };
  if (!signedIn) return { ok: false, status: 401, error: 'sign_in_required' };
  const active = entitlement.plan.status === 'active';
  if (
    rule.feature &&
    !(active && entitlement.features.includes(rule.feature))
  ) {
    return {
      ok: false,
      status: 402,
      error: 'plan_required',
      feature: rule.feature,
    };
  }
  if (rule.paid && !active)
    return { ok: false, status: 402, error: 'plan_required' };
  return { ok: true };
}

const FORWARDING_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'via',
  'cf-connecting-ip',
  'true-client-ip',
];

export function stripForwardingHeaders(headers) {
  for (const name of FORWARDING_HEADERS) delete headers[name];
}
