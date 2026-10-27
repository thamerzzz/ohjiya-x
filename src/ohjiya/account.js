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
  chip.addEventListener('click', () => {
    const open = menu.hasAttribute('hidden');
    menu.toggleAttribute('hidden', !open);
    chip.setAttribute('aria-expanded', String(open));
  });
  root.append(chip, menu);
  return root;
}

export async function startAccount() {
  const me = await loadMe();
  if (me) renderAccount(me);
  return me;
}
