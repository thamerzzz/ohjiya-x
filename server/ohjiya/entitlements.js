/**
 * Entitlement client: asks WordPress what a user's company owns.
 *
 * Request signature: hex HMAC-SHA256("{timestamp}.{user id}", OXE_API_SECRET).
 * Answers are cached for 10 minutes. If WordPress is unreachable the last good
 * answer is used for up to 24 hours, then the user is treated as free.
 */
import { createHmac } from 'node:crypto';

export const FREE = Object.freeze({
  company: null,
  plan: Object.freeze({
    edition: null,
    status: 'none',
    expires: null,
    seats: 0,
  }),
  features: Object.freeze([]),
});

function validDoc(doc) {
  return (
    doc &&
    typeof doc === 'object' &&
    Array.isArray(doc.features) &&
    doc.features.every((feature) => typeof feature === 'string') &&
    doc.plan &&
    typeof doc.plan.status === 'string'
  );
}

export function createEntitlementClient({
  config,
  store,
  fetchImpl = fetch,
  now = () => Date.now(),
  log = (...args) => console.warn('[ohjiya]', ...args),
}) {
  const inflight = new Map();

  async function fetchFresh(userId) {
    const ts = String(Math.floor(now() / 1000));
    const signature = createHmac('sha256', config.apiSecret)
      .update(`${ts}.${userId}`)
      .digest('hex');
    const response = await fetchImpl(
      `${config.wpUrl}/wp-json/ohjiya-x/v1/entitlement?user=${userId}`,
      {
        headers: {
          'X-OXE-Timestamp': ts,
          'X-OXE-Signature': signature,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error(`WordPress answered ${response.status}`);
    const doc = await response.json();
    if (!validDoc(doc))
      throw new Error('WordPress returned an unexpected entitlement document');
    return doc;
  }

  async function get(userId) {
    const cached = store.getEntitlement(userId);
    const age = cached ? now() - cached.fetchedMs : Infinity;
    if (cached && age < config.entitlementTtlMs) return cached.doc;

    if (!inflight.has(userId)) {
      inflight.set(
        userId,
        fetchFresh(userId)
          .then((doc) => {
            store.putEntitlement(userId, doc, now());
            return doc;
          })
          .catch((error) => {
            log(
              `entitlement lookup failed for user ${userId}: ${error.message}`,
            );
            if (cached && age < config.entitlementStaleMs) return cached.doc;
            return FREE;
          })
          .finally(() => inflight.delete(userId)),
      );
    }
    return inflight.get(userId);
  }

  return { get, invalidate: (userIds) => store.dropEntitlements(userIds) };
}
