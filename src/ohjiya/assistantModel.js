/**
 * Assistant (Atlas AI) pieces that need no DOM: the server calls, and what
 * approving a proposal actually does. A proposal never changes anything by
 * itself; `applyProposal` runs only after a person clicks Approve, and goes
 * through the same library API (and its validation) as any manual edit.
 */
import { LibraryError, errorText } from './libraryModel.js';

export function createAssistantClient(fetchImpl = globalThis.fetch) {
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
    status: () => call('/api/assistant/status'),
    ask: ({ message, language, view }) =>
      call('/api/assistant/message', 'POST', { message, language, view }),
  };
}

/**
 * Carry out one approved proposal.
 * @param {object} proposal  as the server cleaned it (add_place or set_status)
 * @param {{ addItem: Function, updateItem: Function }} library  the library client
 */
export async function applyProposal(proposal, library) {
  if (proposal?.kind === 'add_place') {
    const { name, tag, status, lat, lon } = proposal.place;
    return library.addItem({
      kind: 'place',
      name,
      tag,
      status,
      geom: { lat, lon },
    });
  }
  if (proposal?.kind === 'set_status')
    return library.updateItem(proposal.item_id, { status: proposal.status });
  throw new LibraryError('bad_proposal', 400);
}

const MESSAGES = {
  en: {
    not_connected: 'Atlas AI is not connected yet.',
    slow_down: 'Too many questions. Wait a moment.',
    upstream_error: 'Atlas AI could not answer. Try again.',
    upstream_timeout: 'Atlas AI took too long. Try again.',
    bad_message: 'Write a shorter question.',
    plan_required: 'Atlas AI is part of an active plan with chat.',
    bad_proposal: 'That suggestion cannot be applied.',
  },
  ar: {
    not_connected: 'الذكاء الاصطناعي أطلس غير متصل بعد.',
    slow_down: 'أسئلة كثيرة. انتظر قليلًا.',
    upstream_error: 'تعذّر على أطلس الإجابة. حاول مرة أخرى.',
    upstream_timeout: 'استغرق أطلس وقتًا طويلًا. حاول مرة أخرى.',
    bad_message: 'اكتب سؤالًا أقصر.',
    plan_required: 'أطلس جزء من اشتراك فعّال مع الدردشة.',
    bad_proposal: 'لا يمكن تطبيق هذا الاقتراح.',
  },
};

/** A message for any failure: the assistant's own codes first, then the library's. */
export const assistantErrorText = (code, lang) =>
  MESSAGES[lang === 'ar' ? 'ar' : 'en'][code] ?? errorText(code, lang);
