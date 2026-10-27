/**
 * Ohjiya X account chip (sign in / plan / sign out) and plan-based UI.
 *
 * Asks the server who this is (`/api/me`). When accounts are off (local use)
 * the route does not exist and nothing here changes anything. The server is
 * what enforces the plan; this only reflects it: voice controls are hidden
 * when the plan has no voice, and its routes answer 401/402 regardless.
 */

const TEXT = {
  en: {
    signIn: 'Sign in / Register',
    signOut: 'Sign out',
    manage: 'Manage plan',
    free: 'Free',
    voiceOff: 'Voice is part of paid plans',
    plan: 'Plan',
    until: 'until',
    expired: 'ended - renew to restore access',
    grace: 'ended - renew soon',
    editions: 'Editions',
    editionsIntro: 'Sector editions, one plan each:',
    seePlans: 'See plans',
    lens: 'lens',
    ready: 'ready',
    soon: 'soon',
    yourEdition: 'Your edition',
  },
  ar: {
    signIn: 'تسجيل الدخول / إنشاء حساب',
    signOut: 'تسجيل الخروج',
    manage: 'إدارة الاشتراك',
    free: 'مجاني',
    voiceOff: 'الصوت ضمن الاشتراكات المدفوعة',
    plan: 'الاشتراك',
    until: 'حتى',
    expired: 'انتهى - جدّد لاستعادة الوصول',
    grace: 'انتهى - جدّد قريبًا',
    editions: 'الإصدارات',
    editionsIntro: 'إصدارات قطاعية، لكل منها اشتراك:',
    seePlans: 'عرض الاشتراكات',
    lens: 'عدسة',
    ready: 'جاهز',
    soon: 'قريبًا',
    yourEdition: 'إصدارك',
  },
};

const EDITIONS = {
  retail: { en: 'Retail', ar: 'التجزئة' },
  digital_business: { en: 'Digital Business', ar: 'الأعمال الرقمية' },
  real_estate: { en: 'Real Estate', ar: 'العقارات' },
};

export function pickLanguage(me, navigatorLanguage = '') {
  const locale = String(
    me?.user?.locale || navigatorLanguage || 'en',
  ).toLowerCase();
  return locale.startsWith('ar') ? 'ar' : 'en';
}

export function planSummary(me, lang) {
  const text = TEXT[lang];
  const plan = me?.plan;
  if (!me?.signedIn || !plan || plan.status === 'none') return text.free;
  const edition = EDITIONS[plan.edition]?.[lang] ?? plan.edition ?? '';
  if (plan.status === 'active')
    return `${edition} ${text.until} ${plan.expires ?? ''}`.trim();
  return `${edition} ${plan.status === 'grace' ? text.grace : text.expired}`;
}

export async function loadMe(fetchImpl = fetch) {
  try {
    const response = await fetchImpl('/api/me', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const me = await response.json();
    return typeof me?.signedIn === 'boolean' ? me : null;
  } catch {
    return null;
  }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** Open an edition's starter lens: same page, new share link. A hash-only change would not reload the globe. */
function openLens(lens) {
  location.assign(lens);
  location.reload();
}

/** A panel that opens and closes from a button; closing others keeps one panel open at a time. */
function togglePanel(button, panel) {
  button.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    for (const other of document.querySelectorAll('#ox-account .ox-menu'))
      other.setAttribute('hidden', '');
    panel.toggleAttribute('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
  });
}

function editionPanel(me, lang, text) {
  const e = me.edition;
  const tools = e.tools.map((tool) =>
    el('li', { class: `ox-tool ox-tool-${tool.status}` }, [
      el('span', {
        class: 'ox-tool-state',
        text: tool.status === 'ready' ? text.ready : text.soon,
      }),
      el('span', { text: tool.label[lang] ?? tool.label.en }),
    ]),
  );
  return el('div', { class: 'ox-menu ox-edition-menu', hidden: '' }, [
    el('div', {
      class: 'ox-menu-plan',
      text: `${text.yourEdition}: ${e.name[lang] ?? e.name.en}`,
    }),
    el('div', {
      class: 'ox-menu-note ox-tagline',
      text: e.tagline[lang] ?? e.tagline.en,
    }),
    el('ul', { class: 'ox-tools' }, tools),
  ]);
}

function catalogPanel(me, lang, text) {
  const items = (me.editions ?? []).map((e) =>
    el('li', { class: 'ox-catalog-item' }, [
      el('strong', { text: e.name[lang] ?? e.name.en }),
      el('span', { text: e.tagline[lang] ?? e.tagline.en }),
    ]),
  );
  return el('div', { class: 'ox-menu ox-catalog-menu', hidden: '' }, [
    el('div', { class: 'ox-menu-plan', text: text.editionsIntro }),
    el('ul', { class: 'ox-catalog' }, items),
    el('a', {
      href: me.plansUrl || '#',
      target: '_blank',
      rel: 'noopener',
      text: text.seePlans,
    }),
  ]);
}

export function renderAccount(me, doc = document) {
  const lang = pickLanguage(
    me,
    doc.documentElement.lang || globalThis.navigator?.language,
  );
  const text = TEXT[lang];
  const root =
    doc.getElementById('ox-account') ??
    doc.body.appendChild(
      Object.assign(doc.createElement('div'), { id: 'ox-account' }),
    );
  root.replaceChildren();
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';

  const hasVoice =
    me.features?.includes('voice') && me.plan?.status === 'active';
  doc.documentElement.dataset.oxVoice = hasVoice ? 'on' : 'off';
  doc.documentElement.dataset.oxPlan = me.plan?.status ?? 'none';

  if (!me.signedIn) {
    const back = encodeURIComponent(
      location.pathname + location.search + location.hash,
    );
    root.append(
      el('a', {
        class: 'ox-chip',
        href: `/auth/start?redirect_to=${back}`,
        text: text.signIn,
      }),
    );
    return root;
  }

  const menu = el('div', { class: 'ox-menu', hidden: '' }, [
    el('div', {
      class: 'ox-menu-plan',
      text: `${text.plan}: ${planSummary(me, lang)}`,
    }),
    ...(hasVoice
      ? []
      : [el('div', { class: 'ox-menu-note', text: text.voiceOff })]),
    el('a', {
      href: me.accountUrl || '#',
      target: '_blank',
      rel: 'noopener',
      text: text.manage,
    }),
  ]);
  const signOut = el('button', { type: 'button', text: text.signOut });
  signOut.addEventListener('click', async () => {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      location.reload();
    }
  });
  menu.append(signOut);

  const chip = el('button', {
    class: 'ox-chip',
    type: 'button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    text: me.user?.name || me.user?.email || '',
  });
  togglePanel(chip, menu);
  if (me.edition) {
    const lensButton = el('button', {
      class: 'ox-chip ox-lens',
      type: 'button',
      text: `${me.edition.name[lang] ?? me.edition.name.en} ${text.lens}`,
    });
    lensButton.addEventListener('click', () => openLens(me.edition.lens));
    const panel = editionPanel(me, lang, text);
    const infoButton = el('button', {
      class: 'ox-chip ox-info',
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-label': text.yourEdition,
      text: 'i',
    });
    togglePanel(infoButton, panel);
    root.append(lensButton, infoButton, chip, panel, menu);
  } else {
    const editionsButton = el('button', {
      class: 'ox-chip',
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      text: text.editions,
    });
    const catalog = catalogPanel(me, lang, text);
    togglePanel(editionsButton, catalog);
    root.append(editionsButton, chip, catalog, menu);
  }
  return root;
}

export async function startAccount() {
  const me = await loadMe();
  if (me) renderAccount(me);
  return me;
}
