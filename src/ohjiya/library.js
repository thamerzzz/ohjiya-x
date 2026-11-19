/**
 * Company library panel: pin places, draw areas, keep them for the whole
 * company, describe each one (status, details, notes), and save the current
 * view as a tactic that restores in one click in any edition. Saved tactics
 * also appear as a row of tabs under the toolbar. Shown to signed-in users with
 * an active plan.
 */
import { HEX_SIZES_M, hexBins } from './hexModel.js';
import {
  STATUS_IDS,
  TAG_IDS,
  createLibraryClient,
  errorText,
  filterItems,
  hasView,
  hashParams,
  legendCounts,
  statusColor,
  statusName,
  tagColor,
  tagName,
} from './libraryModel.js';

const TEXT = {
  en: {
    button: 'Library',
    heading: 'Company library',
    filter: 'Legend: show on map',
    statusLegend: 'Status',
    pinPlace: 'Pin a place',
    drawArea: 'Draw an area',
    pickPlace: 'Click the map to place the pin. Esc cancels.',
    pickArea: 'Click corners, then double-click or press Enter. Esc cancels.',
    name: 'Name',
    tag: 'Type',
    stateName: 'Status',
    save: 'Save',
    cancel: 'Cancel',
    places: 'Saved places and areas',
    none: 'Nothing saved yet.',
    go: 'Go',
    open: 'Open',
    remove: 'Delete',
    radius: 'Radius (km)',
    ring: 'Radius',
    tactics: 'Tactics',
    tacticName: 'Tactic name',
    saveTactic: 'Save current view as a tactic',
    noTactics: 'No tactics yet. Set up the map, then save it.',
    apply: 'Apply',
    mapNotReady: 'The map is still loading.',
    removeSure: 'Delete this?',
    back: 'Back to library',
    details: 'Details',
    detailName: 'Detail name',
    detailValue: 'Value',
    addDetail: 'Add a detail',
    notes: 'Notes',
    saved: 'Saved.',
    views: 'Saved views',
    density: 'Density map',
    densityOff: 'Off',
    densitySize: (m) => (m >= 1000 ? `${m / 1000} km` : `${m} m`),
    count: (n, max) => `${n} of ${max}`,
  },
  ar: {
    button: 'المكتبة',
    heading: 'مكتبة الشركة',
    filter: 'المفتاح: إظهار على الخريطة',
    statusLegend: 'الحالة',
    pinPlace: 'تثبيت موقع',
    drawArea: 'رسم منطقة',
    pickPlace: 'انقر على الخريطة لتثبيت الموقع. Esc للإلغاء.',
    pickArea: 'انقر على الزوايا ثم انقر مرتين أو اضغط Enter. Esc للإلغاء.',
    name: 'الاسم',
    tag: 'النوع',
    stateName: 'الحالة',
    save: 'حفظ',
    cancel: 'إلغاء',
    places: 'المواقع والمناطق المحفوظة',
    none: 'لا يوجد شيء محفوظ بعد.',
    go: 'انتقال',
    open: 'فتح',
    remove: 'حذف',
    radius: 'نصف القطر (كم)',
    ring: 'نطاق',
    tactics: 'الخطط',
    tacticName: 'اسم الخطة',
    saveTactic: 'حفظ العرض الحالي كخطة',
    noTactics: 'لا توجد خطط بعد. جهّز الخريطة ثم احفظها.',
    apply: 'تطبيق',
    mapNotReady: 'الخريطة قيد التحميل.',
    removeSure: 'حذف هذا؟',
    back: 'العودة إلى المكتبة',
    details: 'التفاصيل',
    detailName: 'اسم التفصيل',
    detailValue: 'القيمة',
    addDetail: 'إضافة تفصيل',
    notes: 'ملاحظات',
    saved: 'تم الحفظ.',
    views: 'العروض المحفوظة',
    density: 'خريطة الكثافة',
    densityOff: 'إيقاف',
    densitySize: (m) => (m >= 1000 ? `${m / 1000} كم` : `${m} م`),
    count: (n, max) => `${n} من ${max}`,
  },
};

const TAGS_KEY = 'ox-library-tags';
const ACTIVE_KEY = 'ox-active-tactic';
const HEX_KEY = 'ox-library-hex';
const MAX_FIELDS = 8;
const MAX_TABS = 6;

function readTags() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TAGS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((t) => TAG_IDS.includes(t))
      : [];
  } catch {
    return [];
  }
}
function readHex() {
  try {
    const n = Number(sessionStorage.getItem(HEX_KEY));
    return HEX_SIZES_M.includes(n) ? n : 0;
  } catch {
    return 0;
  }
}
function writeHex(size) {
  try {
    sessionStorage.setItem(HEX_KEY, String(size));
  } catch {
    /* the setting just won't survive a reload */
  }
}
function writeTags(tags) {
  try {
    sessionStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  } catch {
    /* private window: the filter just won't survive a reload */
  }
}
function readActive() {
  try {
    return Number(sessionStorage.getItem(ACTIVE_KEY)) || null;
  } catch {
    return null;
  }
}
function writeActive(id) {
  try {
    sessionStorage.setItem(ACTIVE_KEY, String(id));
  } catch {
    /* ignore */
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

/**
 * @param {object} me  the /api/me answer
 * @param {'en'|'ar'} lang
 * @param {{ client?: ReturnType<typeof createLibraryClient>, map?: () => any, apply?: (hash: string) => void }} [deps]
 * @returns {{ button: HTMLElement, panel: HTMLElement, tabs: HTMLElement }}
 */
export function createLibraryPanel(me, lang, deps = {}) {
  const text = TEXT[lang];
  const client = deps.client ?? createLibraryClient();
  const map = deps.map ?? (() => globalThis.window?.__oxMap ?? null);
  const apply =
    deps.apply ??
    ((hash) => {
      location.hash = `#${hash}`;
      location.reload();
    });
  let data = { items: [], tactics: [], limits: { items: 500, tactics: 50 } };
  let tags = readTags();
  let hexSize = readHex(); // 0 = density map off
  let status = '';
  let form = null; // a place or area just picked, waiting for a name
  let profileId = null; // the item whose profile is open

  const button = el('button', {
    class: 'ox-chip',
    type: 'button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    text: text.button,
  });
  const panel = el('div', { class: 'ox-menu ox-library-menu', hidden: '' });
  const tabs = el('div', {
    class: 'ox-tabs',
    role: 'tablist',
    'aria-label': text.views,
    hidden: '',
  });

  const say = (message) => {
    status = message;
    draw();
  };
  const fail = (error) => say(errorText(error?.code, lang));

  const showOnMap = () => {
    const shown = filterItems(data.items, tags);
    map()?.show(shown);
    map()?.showHex?.(hexBins(hexSize ? shown : [], hexSize));
  };

  async function refresh() {
    try {
      data = await client.load();
      status = '';
    } catch (error) {
      status = errorText(error?.code, lang);
    }
    showOnMap();
    drawTabs();
    draw();
  }

  async function startPick(kind) {
    const bridge = map();
    if (!bridge) return say(text.mapNotReady);
    panel.setAttribute('hidden', '');
    button.setAttribute('aria-expanded', 'false');
    const toast = el('div', {
      class: 'ox-pick-hint',
      role: 'status',
      text: kind === 'point' ? text.pickPlace : text.pickArea,
    });
    document.body.append(toast);
    let result = null;
    try {
      result =
        kind === 'point' ? await bridge.pickPoint() : await bridge.pickArea();
    } finally {
      toast.remove();
    }
    panel.removeAttribute('hidden');
    button.setAttribute('aria-expanded', 'true');
    if (!result) return say('');
    form =
      kind === 'point'
        ? { kind: 'place', geom: { lat: result.lat, lon: result.lon } }
        : {
            kind: 'area',
            geom: {
              type: 'polygon',
              points: result.map((p) => ({ lat: p.lat, lon: p.lon })),
            },
          };
    draw();
  }

  async function saveItem(body) {
    try {
      await client.addItem(body);
      form = null;
      await refresh();
    } catch (error) {
      fail(error);
    }
  }

  const select = (options, current, label) => {
    const node = el(
      'select',
      { 'aria-label': label },
      options.map(([value, name]) => el('option', { value, text: name })),
    );
    node.value = current;
    return node;
  };
  const tagSelect = (current = 'branch') =>
    select(
      TAG_IDS.map((id) => [id, tagName(id, lang)]),
      current,
      text.tag,
    );
  const statusSelect = (current = 'active') =>
    select(
      STATUS_IDS.map((id) => [id, statusName(id, lang)]),
      current,
      text.stateName,
    );
  const badge = (id) =>
    el('span', {
      class: 'ox-badge',
      style: `--badge:${statusColor(id)}`,
      text: statusName(id, lang),
    });

  /** The small form shown right after a pick or a radius request. */
  function newItemForm() {
    const name = el('input', {
      type: 'text',
      maxlength: '120',
      'aria-label': text.name,
      placeholder: text.name,
    });
    const tag = tagSelect(form.defaultTag ?? 'branch');
    const stat = statusSelect('active');
    const radius =
      form.kind === 'ring'
        ? el('input', {
            type: 'number',
            min: '0.05',
            max: '200',
            step: '0.5',
            value: '3',
            'aria-label': text.radius,
          })
        : null;
    const ok = el('button', {
      type: 'button',
      class: 'ox-primary',
      text: text.save,
    });
    const cancel = el('button', { type: 'button', text: text.cancel });
    ok.addEventListener('click', () => {
      const label = name.value.trim();
      if (!label) return say(errorText('bad_name', lang));
      if (form.kind === 'ring')
        return saveItem({
          kind: 'area',
          name: label,
          tag: tag.value,
          status: stat.value,
          geom: {
            type: 'circle',
            lat: form.geom.lat,
            lon: form.geom.lon,
            radius_m: Math.round(Number(radius.value) * 1000),
          },
        });
      return saveItem({
        kind: form.kind,
        name: label,
        tag: tag.value,
        status: stat.value,
        geom: form.geom,
      });
    });
    cancel.addEventListener('click', () => {
      form = null;
      draw();
    });
    if (form.defaultName) name.value = form.defaultName;
    return el('div', { class: 'ox-form' }, [
      name,
      tag,
      stat,
      ...(radius ? [el('label', { text: text.radius }), radius] : []),
      el('div', { class: 'ox-row' }, [ok, cancel]),
    ]);
  }

  const goTo = (item) => {
    const g = item.geom;
    const point = g.points?.length
      ? { lat: g.points[0].lat, lon: g.points[0].lon }
      : { lat: g.lat, lon: g.lon };
    map()?.flyTo({
      ...point,
      altitude: g.radius_m ? Math.max(1500, g.radius_m * 4) : 2500,
    });
  };

  async function removeItem(item) {
    if (!globalThis.confirm(`${text.removeSure} ${item.name}`)) return;
    try {
      await client.removeItem(item.id);
      if (profileId === item.id) profileId = null;
      await refresh();
    } catch (error) {
      fail(error);
    }
  }

  function itemRow(item) {
    const openProfile = el('button', {
      type: 'button',
      class: 'ox-lib-open',
      'aria-label': `${text.open}: ${item.name}`,
      text: item.name,
    });
    openProfile.addEventListener('click', () => {
      profileId = item.id;
      draw();
    });
    const go = el('button', {
      type: 'button',
      text: text.go,
      'aria-label': `${text.go}: ${item.name}`,
    });
    go.addEventListener('click', () => goTo(item));
    return el('li', { class: 'ox-lib-item' }, [
      el('span', {
        class: 'ox-dot',
        style: `background:${tagColor(item.tag)}`,
      }),
      openProfile,
      badge(item.status),
      go,
    ]);
  }

  /** One item's profile: status, named details and notes, all editable. */
  function profileView(item) {
    const name = el('input', {
      type: 'text',
      maxlength: '120',
      value: item.name,
      'aria-label': text.name,
    });
    const tag = tagSelect(item.tag);
    const stat = statusSelect(item.status);
    const fieldRows = el('div', { class: 'ox-fields' });
    const addFieldRow = (key = '', value = '') => {
      const k = el('input', {
        type: 'text',
        maxlength: '40',
        value: key,
        placeholder: text.detailName,
        'aria-label': text.detailName,
      });
      const v = el('input', {
        type: 'text',
        maxlength: '200',
        value,
        placeholder: text.detailValue,
        'aria-label': text.detailValue,
      });
      const x = el('button', {
        type: 'button',
        class: 'ox-danger',
        'aria-label': text.remove,
        text: '×',
      });
      const row = el('div', { class: 'ox-field-row' }, [k, v, x]);
      x.addEventListener('click', () => row.remove());
      fieldRows.append(row);
    };
    for (const f of item.fields) addFieldRow(f.key, f.value);
    const add = el('button', { type: 'button', text: text.addDetail });
    add.addEventListener('click', () => {
      if (fieldRows.children.length < MAX_FIELDS) addFieldRow();
    });
    const notes = el('textarea', {
      rows: '4',
      maxlength: '1000',
      'aria-label': text.notes,
      placeholder: text.notes,
    });
    notes.value = item.notes;

    const save = el('button', {
      type: 'button',
      class: 'ox-primary',
      text: text.save,
    });
    save.addEventListener('click', async () => {
      const label = name.value.trim();
      if (!label) return say(errorText('bad_name', lang));
      const fields = [...fieldRows.children]
        .map((row) => {
          const [k, v] = row.querySelectorAll('input');
          return { key: k.value.trim(), value: v.value.trim() };
        })
        .filter((f) => f.key || f.value);
      try {
        await client.updateItem(item.id, {
          name: label,
          tag: tag.value,
          status: stat.value,
          fields,
          notes: notes.value,
        });
        await refresh();
        say(text.saved);
      } catch (error) {
        fail(error);
      }
    });
    const back = el('button', { type: 'button', text: `← ${text.back}` });
    back.addEventListener('click', () => {
      profileId = null;
      draw();
    });
    const go = el('button', { type: 'button', text: text.go });
    go.addEventListener('click', () => goTo(item));
    const del = el('button', {
      type: 'button',
      class: 'ox-danger',
      text: text.remove,
    });
    del.addEventListener('click', () => removeItem(item));
    const ring =
      item.kind === 'place'
        ? el('button', { type: 'button', text: text.ring })
        : null;
    ring?.addEventListener('click', () => {
      form = {
        kind: 'ring',
        geom: { lat: item.geom.lat, lon: item.geom.lon },
        defaultName: `${item.name} ${text.ring}`,
        defaultTag: item.tag,
      };
      profileId = null;
      draw();
    });

    return el('div', { class: 'ox-profile' }, [
      back,
      el('div', { class: 'ox-form' }, [
        name,
        tag,
        stat,
        el('div', { class: 'ox-menu-plan', text: text.details }),
        fieldRows,
        add,
        notes,
        el('div', { class: 'ox-row' }, [
          save,
          go,
          ...(ring ? [ring] : []),
          del,
        ]),
      ]),
    ]);
  }

  /** The legend: type chips with counts (they also filter the map), and status counts. */
  function legend() {
    const counts = legendCounts(data.items);
    const chips = TAG_IDS.map((id) => {
      const on = tags.length === 0 || tags.includes(id);
      const chip = el('button', {
        type: 'button',
        class: `ox-tag${on ? ' on' : ''}`,
        'aria-pressed': String(on),
        style: `--tag:${tagColor(id)}`,
        text: `${tagName(id, lang)} ${counts.tags[id]}`,
      });
      chip.addEventListener('click', () => {
        const current = tags.length === 0 ? [...TAG_IDS] : [...tags];
        const next = current.includes(id)
          ? current.filter((t) => t !== id)
          : [...current, id];
        tags = next.length === TAG_IDS.length ? [] : next;
        writeTags(tags);
        showOnMap();
        draw();
      });
      return chip;
    });
    const statuses = STATUS_IDS.filter((id) => counts.statuses[id] > 0).map(
      (id) =>
        el('span', {
          class: 'ox-badge',
          style: `--badge:${statusColor(id)}`,
          text: `${statusName(id, lang)} ${counts.statuses[id]}`,
        }),
    );
    return [
      el('div', { class: 'ox-menu-note', text: text.filter }),
      el('div', { class: 'ox-tags' }, chips),
      ...(statuses.length
        ? [
            el('div', { class: 'ox-menu-note', text: text.statusLegend }),
            el('div', { class: 'ox-tags' }, statuses),
          ]
        : []),
    ];
  }

  function tacticRow(tactic) {
    const use = el('button', {
      type: 'button',
      class: 'ox-primary',
      text: text.apply,
      'aria-label': `${text.apply}: ${tactic.name}`,
    });
    use.addEventListener('click', () => applyTactic(tactic));
    const del = el('button', {
      type: 'button',
      class: 'ox-danger',
      text: text.remove,
      'aria-label': `${text.remove}: ${tactic.name}`,
    });
    del.addEventListener('click', async () => {
      if (!globalThis.confirm(`${text.removeSure} ${tactic.name}`)) return;
      try {
        await client.removeTactic(tactic.id);
        await refresh();
      } catch (error) {
        fail(error);
      }
    });
    return el('li', { class: 'ox-lib-item' }, [
      el('span', { class: 'ox-lib-name', text: tactic.name }),
      el('span', { class: 'ox-row' }, [use, del]),
    ]);
  }

  function applyTactic(tactic) {
    writeTags(tactic.tags ?? []);
    writeActive(tactic.id);
    apply(hashParams(tactic.hash));
  }

  /** Saved tactics as a row of tabs under the toolbar. */
  function drawTabs() {
    tabs.replaceChildren();
    const active = readActive();
    const shown = data.tactics.slice(0, MAX_TABS);
    for (const tactic of shown) {
      const tab = el('button', {
        type: 'button',
        class: `ox-tab${tactic.id === active ? ' on' : ''}`,
        role: 'tab',
        'aria-selected': String(tactic.id === active),
        text: tactic.name,
      });
      tab.addEventListener('click', () => applyTactic(tactic));
      tabs.append(tab);
    }
    tabs.toggleAttribute('hidden', shown.length === 0);
  }

  function tacticForm() {
    const name = el('input', {
      type: 'text',
      maxlength: '80',
      placeholder: text.tacticName,
      'aria-label': text.tacticName,
    });
    const save = el('button', { type: 'button', text: text.saveTactic });
    save.addEventListener('click', async () => {
      const label = name.value.trim();
      if (!label) return say(errorText('bad_name', lang));
      const hash = hashParams(location.hash);
      if (!hasView(hash)) return say(errorText('bad_view', lang));
      try {
        await client.addTactic({
          name: label,
          hash,
          tags,
          edition: me.edition?.id ?? null,
        });
        await refresh();
      } catch (error) {
        fail(error);
      }
    });
    return el('div', { class: 'ox-form' }, [name, save]);
  }

  function draw() {
    panel.replaceChildren();
    panel.append(
      el('div', {
        class: 'ox-menu-plan',
        text: `${text.heading} · ${text.count(data.items.length, data.limits.items)}`,
      }),
    );
    if (status)
      panel.append(
        el('div', {
          class: 'ox-menu-note ox-status',
          role: 'alert',
          text: status,
        }),
      );

    const open = profileId && data.items.find((i) => i.id === profileId);
    if (open) {
      panel.append(profileView(open));
      return;
    }
    profileId = null;

    panel.append(...legend());
    panel.append(
      el('div', { class: 'ox-menu-note', text: text.density }),
      el(
        'div',
        { class: 'ox-tags' },
        [0, ...HEX_SIZES_M].map((size) => {
          const chip = el('button', {
            type: 'button',
            class: `ox-tag${size === hexSize ? ' on' : ''}`,
            'aria-pressed': String(size === hexSize),
            style: '--tag:#ff6b3d',
            text: size ? text.densitySize(size) : text.densityOff,
          });
          chip.addEventListener('click', () => {
            hexSize = size;
            writeHex(size);
            showOnMap();
            draw();
          });
          return chip;
        }),
      ),
    );
    if (form) {
      panel.append(newItemForm());
    } else {
      const pin = el('button', {
        type: 'button',
        class: 'ox-primary',
        text: text.pinPlace,
      });
      pin.addEventListener('click', () => startPick('point'));
      const area = el('button', { type: 'button', text: text.drawArea });
      area.addEventListener('click', () => startPick('area'));
      panel.append(el('div', { class: 'ox-row' }, [pin, area]));
    }

    panel.append(el('div', { class: 'ox-menu-plan', text: text.places }));
    panel.append(
      data.items.length
        ? el('ul', { class: 'ox-lib-list' }, data.items.map(itemRow))
        : el('div', { class: 'ox-menu-note', text: text.none }),
    );

    panel.append(
      el('div', { class: 'ox-menu-plan', text: text.tactics }),
      tacticForm(),
    );
    panel.append(
      data.tactics.length
        ? el('ul', { class: 'ox-lib-list' }, data.tactics.map(tacticRow))
        : el('div', { class: 'ox-menu-note', text: text.noTactics }),
    );
  }

  draw();
  void refresh();
  globalThis.window?.addEventListener(
    'ox-library-changed',
    () => void refresh(),
  );
  // The globe finishes loading after the toolbar does: draw the library as
  // soon as the map bridge exists.
  let tries = 0;
  const waitForMap = setInterval(() => {
    tries += 1;
    if (map()) {
      clearInterval(waitForMap);
      showOnMap();
    } else if (tries > 120) clearInterval(waitForMap);
  }, 1000);
  return { button, panel, tabs };
}
