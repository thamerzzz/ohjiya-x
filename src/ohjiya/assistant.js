/**
 * Atlas AI panel: a dock on the right of the map. A person asks a question;
 * the answer can include proposals (add a place, change a status). Each
 * proposal waits for Approve or Reject. Nothing is applied without a click.
 */
import {
  applyProposal,
  assistantErrorText,
  createAssistantClient,
} from './assistantModel.js';
import {
  createLibraryClient,
  hasView,
  hashParams,
  statusName,
  tagName,
} from './libraryModel.js';

const TEXT = {
  en: {
    button: 'Atlas AI',
    heading: 'Atlas AI',
    intro:
      'Ask about your places, competitors or this area. Suggestions wait for your approval.',
    offline: 'Atlas AI is not connected yet.',
    inputHint: 'Ask Atlas AI...',
    send: 'Send',
    close: 'Close',
    thinking: 'Thinking...',
    suggestions: 'Suggestions',
    approve: 'Approve',
    reject: 'Reject',
    applied: 'Applied',
    rejected: 'Rejected',
    failed: 'Not applied',
    you: 'You',
    atlas: 'Atlas AI',
  },
  ar: {
    button: 'الذكاء أطلس',
    heading: 'الذكاء الاصطناعي أطلس',
    intro:
      'اسأل عن مواقعك أو منافسيك أو هذه المنطقة. الاقتراحات تنتظر موافقتك.',
    offline: 'أطلس غير متصل بعد.',
    inputHint: 'اسأل أطلس...',
    send: 'إرسال',
    close: 'إغلاق',
    thinking: 'جارٍ التفكير...',
    suggestions: 'الاقتراحات',
    approve: 'موافقة',
    reject: 'رفض',
    applied: 'تم التطبيق',
    rejected: 'تم الرفض',
    failed: 'لم يتم التطبيق',
    you: 'أنت',
    atlas: 'أطلس',
  },
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** One line saying what a proposal would do, in the reader's language. */
function describe(proposal, lang) {
  if (proposal.kind === 'add_place') {
    const p = proposal.place;
    return `${tagName(p.tag, lang)} · ${statusName(p.status, lang)} · ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
  }
  return `#${proposal.item_id} → ${statusName(proposal.status, lang)}`;
}

/**
 * @param {object} me  the /api/me answer
 * @param {'en'|'ar'} lang
 * @param {{ assistant?: object, library?: object, changed?: () => void }} [deps]
 * @returns {{ button: HTMLElement, dock: HTMLElement }}
 */
export function createAssistantPanel(me, lang, deps = {}) {
  const text = TEXT[lang];
  const assistant = deps.assistant ?? createAssistantClient();
  const library = deps.library ?? createLibraryClient();
  const changed =
    deps.changed ??
    (() =>
      globalThis.window?.dispatchEvent(new CustomEvent('ox-library-changed')));
  let connected = null; // unknown until the first status answer
  let busy = false;

  document.getElementById('ox-assistant')?.remove();
  const dock = el('aside', {
    id: 'ox-assistant',
    class: 'ox-dock',
    'aria-label': text.heading,
    hidden: '',
  });
  const list = el('div', {
    class: 'ox-chat',
    role: 'log',
    'aria-live': 'polite',
  });
  const note = el('div', { class: 'ox-dock-note' });
  const input = el('textarea', {
    rows: '2',
    maxlength: '2000',
    placeholder: text.inputHint,
    'aria-label': text.inputHint,
  });
  const send = el('button', {
    type: 'button',
    class: 'ox-primary',
    text: text.send,
  });
  const close = el('button', {
    type: 'button',
    class: 'ox-dock-close',
    'aria-label': text.close,
    text: '×',
  });
  dock.append(
    el('div', { class: 'ox-dock-head' }, [
      el('strong', { text: text.heading }),
      close,
    ]),
    list,
    note,
    el('div', { class: 'ox-dock-input' }, [input, send]),
  );
  document.body.append(dock);
  dock.dir = lang === 'ar' ? 'rtl' : 'ltr';

  const button = el('button', {
    class: 'ox-chip',
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    text: text.button,
  });

  const bubble = (who, body) =>
    list.append(
      el('div', { class: `ox-msg ox-msg-${who}` }, [
        el('div', {
          class: 'ox-msg-who',
          text: who === 'me' ? text.you : text.atlas,
        }),
        el('div', { class: 'ox-msg-body', text: body }),
      ]),
    );
  const scroll = () => {
    list.scrollTop = list.scrollHeight;
  };

  function proposalCard(proposal) {
    const state = el('span', { class: 'ox-proposal-state' });
    const approve = el('button', {
      type: 'button',
      class: 'ox-primary',
      text: text.approve,
    });
    const reject = el('button', { type: 'button', text: text.reject });
    const row = el('div', { class: 'ox-row' }, [approve, reject]);
    const finish = (message, kind) => {
      row.replaceWith(state);
      state.textContent = message;
      state.dataset.kind = kind;
    };
    approve.addEventListener('click', async () => {
      approve.disabled = reject.disabled = true;
      try {
        await applyProposal(proposal, library);
        finish(text.applied, 'ok');
        changed();
      } catch (error) {
        finish(
          `${text.failed}: ${assistantErrorText(error?.code, lang)}`,
          'error',
        );
      }
    });
    reject.addEventListener('click', () => finish(text.rejected, 'no'));
    return el('div', { class: 'ox-proposal' }, [
      el('div', { class: 'ox-proposal-title', text: proposal.title }),
      el('div', {
        class: 'ox-proposal-detail',
        text: describe(proposal, lang),
      }),
      row,
    ]);
  }

  async function ask() {
    const message = input.value.trim();
    if (!message || busy || connected === false) return;
    busy = true;
    send.disabled = true;
    input.value = '';
    bubble('me', message);
    const pending = el('div', {
      class: 'ox-msg-body ox-thinking',
      text: text.thinking,
    });
    list.append(pending);
    scroll();
    try {
      const view = hasView(location.hash)
        ? hashParams(location.hash)
        : undefined;
      const answer = await assistant.ask({ message, language: lang, view });
      pending.remove();
      if (answer.reply) bubble('atlas', answer.reply);
      if (answer.proposals?.length) {
        const box = el('div', { class: 'ox-proposals' }, [
          el('div', { class: 'ox-proposals-head', text: text.suggestions }),
          ...answer.proposals.map(proposalCard),
        ]);
        list.append(box);
      }
    } catch (error) {
      pending.remove();
      if (error?.code === 'not_connected') setConnected(false);
      bubble('atlas', assistantErrorText(error?.code, lang));
    } finally {
      busy = false;
      send.disabled = false;
      scroll();
    }
  }

  function setConnected(value) {
    connected = value;
    note.textContent = value === false ? text.offline : '';
    input.disabled = send.disabled = value === false;
  }

  send.addEventListener('click', ask);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask();
    }
  });

  const open = (show) => {
    dock.toggleAttribute('hidden', !show);
    button.setAttribute('aria-expanded', String(show));
    document.documentElement.dataset.oxDock = show ? 'open' : 'closed';
    if (show) input.focus();
  };
  button.addEventListener('click', async () => {
    const show = dock.hasAttribute('hidden');
    open(show);
    if (show && connected === null) {
      try {
        setConnected((await assistant.status()).connected === true);
      } catch {
        setConnected(false);
      }
    }
  });
  close.addEventListener('click', () => open(false));
  dock.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') open(false);
  });

  bubble('atlas', text.intro);
  return { button, dock };
}
