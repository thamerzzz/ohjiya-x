/**
 * Assistant (Atlas AI) gateway. The app never talks to the AI from the
 * browser: the server forwards one question, with a small summary of the
 * company's library, to the endpoint the operator configured, and returns the
 * reply plus any *proposals*. A proposal is only a suggestion: the browser
 * shows it, a person approves or rejects it, and approving goes through the
 * normal library API, which validates it again.
 *
 * Request sent upstream (POST, JSON, optional Bearer key):
 *   { message, language, context: { view, library: [{ id, name, tag, status, lat, lon }] } }
 * Expected answer (JSON):
 *   { reply: string, proposals?: [ { kind: 'add_place', title, place: { name, tag, status?, lat, lon } }
 *                                 | { kind: 'set_status', title, item_id, status } ] }
 * Anything else in the answer is dropped.
 */
import { PLACE_TAGS, STATUSES } from './library.js';

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_REPLY_CHARS = 4000;
export const MAX_PROPOSALS = 20;
const MAX_CONTEXT_ITEMS = 100;
const clip = (value, max) =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

/** What the upstream answered, reduced to the two proposal kinds the app understands. */
export function cleanProposals(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const p of value) {
    if (out.length >= MAX_PROPOSALS) break;
    const title = clip(p?.title, 120);
    if (p?.kind === 'add_place') {
      const place = p.place;
      const name = clip(place?.name, 120);
      if (!name || !num(place?.lat, -90, 90) || !num(place?.lon, -180, 180))
        continue;
      const tag = PLACE_TAGS.includes(place.tag) ? place.tag : 'other';
      const status = STATUSES.includes(place.status) ? place.status : 'active';
      out.push({
        id: `p${out.length + 1}`,
        kind: 'add_place',
        title: title || name,
        place: { name, tag, status, lat: place.lat, lon: place.lon },
      });
    } else if (p?.kind === 'set_status') {
      if (
        !Number.isInteger(p.item_id) ||
        p.item_id < 1 ||
        !STATUSES.includes(p.status)
      )
        continue;
      out.push({
        id: `p${out.length + 1}`,
        kind: 'set_status',
        title: title || `Set status: ${p.status}`,
        item_id: p.item_id,
        status: p.status,
      });
    }
  }
  return out;
}

/** The library summary sent upstream: ids, names, tags, statuses and positions only. */
export function summarizeLibrary(items) {
  return items
    .filter((item) => item.kind === 'place')
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((item) => ({
      id: item.id,
      name: item.name,
      tag: item.tag,
      status: item.status,
      lat: item.geom.lat,
      lon: item.geom.lon,
    }));
}

export class AssistantError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function createAssistant({
  url,
  key = '',
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  return {
    connected: Boolean(url),
    async ask({ message, language, view, library }) {
      if (!url) throw new AssistantError('not_connected', 503);
      const body = JSON.stringify({
        message: clip(message, MAX_MESSAGE_CHARS),
        language: language === 'ar' ? 'ar' : 'en',
        context: {
          view: view ?? null,
          library: summarizeLibrary(library ?? []),
        },
      });
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new AssistantError(
          error?.name === 'TimeoutError'
            ? 'upstream_timeout'
            : 'upstream_error',
          error?.name === 'TimeoutError' ? 504 : 502,
        );
      }
      if (!response.ok) throw new AssistantError('upstream_error', 502);
      let data;
      try {
        data = await response.json();
      } catch {
        throw new AssistantError('upstream_error', 502);
      }
      const reply = clip(data?.reply, MAX_REPLY_CHARS);
      if (!reply && !Array.isArray(data?.proposals))
        throw new AssistantError('upstream_error', 502);
      return { reply, proposals: cleanProposals(data?.proposals) };
    },
  };
}
