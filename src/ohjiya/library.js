/**
 * Company library panel: pin places, draw areas, keep them for the whole
 * company, and save the current view as a tactic that restores in one click in
 * any edition. Shown to signed-in users with an active plan.
 */
import {
  TAG_IDS,
  createLibraryClient,
  errorText,
  filterItems,
  hasView,
  hashParams,
  tagColor,
  tagName,
} from './libraryModel.js';

const TEXT = {
  en: {
    button: 'Library',
    heading: 'Company library',
    filter: 'Show on map',
    pinPlace: 'Pin a place',
    drawArea: 'Draw an area',
    pickPlace: 'Click the map to place the pin. Esc cancels.',
    pickArea: 'Click corners, then double-click or press Enter. Esc cancels.',
    name: 'Name',
    tag: 'Type',
    save: 'Save',
    cancel: 'Cancel',
    places: 'Saved places and areas',
    none: 'Nothing saved yet.',
    go: 'Go',
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
    km: 'km',
    count: (n, max) => `${n} of ${max}`,
  },
  ar: {
    button: 'المكتبة',
    heading: 'مكتبة الشركة',
    filter: 'إظهار على الخريطة',
    pinPlace: 'تثبيت موقع',
    drawArea: 'رسم منطقة',
    pickPlace: 'انقر على الخريطة لتثبيت الموقع. Esc للإلغاء.',
    pickArea: 'انقر على الزوايا ثم انقر مرتين أو اضغط Enter. Esc للإلغاء.',
    name: 'الاسم',
    tag: 'النوع',
    save: 'حفظ',
    cancel: 'إلغاء',
    places: 'المواقع والمناطق المحفوظة',
    none: 'لا يوجد شيء محفوظ بعد.',
    go: 'انتقال',
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
    km: 'كم',
    count: (n, max) => `${n} من ${max}`,
  },
};

const STORAGE_KEY = 'ox-library-tags';

function readTags() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((t) => TAG_IDS.includes(t))
      : [];
  } catch {
    return [];
  }
}
function writeTags(tags) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
  } catch {
    /* private window: the filter just won't survive a reload */
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
 * @returns {{ button: HTMLElement, panel: HTMLElement }}
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
  let status = '';
  let form = null; // { kind, geom, defaultName }

  const button = el('button', {
    class: 'ox-chip',
    type: 'button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    text: text.button,
  });
  const panel = el('div', { class: 'ox-menu ox-library-menu', hidden: '' });

  const say = (message) => {
    status = message;
    draw();
  };
  const fail = (error) => say(errorText(error?.code, lang));

  function showOnMap() {
    map()?.show(filterItems(data.items, tags));
  }

  async function refresh() {
    try {
      data = await client.load();
      status = '';
    } catch (error) {
      status = errorText(error?.code, lang);
    }
    showOnMap();
    draw();
  }

  async function startPick(kind) {
    const bridge = map();
    if (!bridge) return say(text.mapNotReady);
    panel.setAttribute('hidden', '');
    button.setAttribute('aria-expanded', 'false');
    const hint = kind === 'point' ? text.pickPlace : text.pickArea;
    const toast = el('div', {
      class: 'ox-pick-hint',
      role: 'status',
      text: hint,
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

  function formView() {
    const name = el('input', {
      type: 'text',
      maxlength: '120',
      'aria-label': text.name,
      placeholder: text.name,
    });
    const select = el(
      'select',
      { 'aria-label': text.tag },
      TAG_IDS.map((id) => el('option', { value: id, text: tagName(id, lang) })),
    );
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
      if (form.kind === 'ring') {
        const km = Number(radius.value);
        return saveItem({
          kind: 'area',
          name: label,
          tag: select.value,
          geom: {
            type: 'circle',
            lat: form.geom.lat,
            lon: form.geom.lon,
            radius_m: Math.round(km * 1000),
          },
        });
      }
      return saveItem({
        kind: form.kind,
        name: label,
        tag: select.value,
        geom: form.geom,
      });
    });
    cancel.addEventListener('click', () => {
      form = null;
      draw();
    });
    if (form.defaultName) name.value = form.defaultName;
    if (form.defaultTag) select.value = form.defaultTag;
    return el('div', { class: 'ox-form' }, [
      name,
      select,
      ...(radius ? [el('label', { text: text.radius }), radius] : []),
      el('div', { class: 'ox-row' }, [ok, cancel]),
    ]);
  }

  function itemRow(item) {
    const go = el('button', {
      type: 'button',
      text: text.go,
      'aria-label': `${text.go}: ${item.name}`,
    });
    go.addEventListener('click', () => {
      const g = item.geom;
      const point = g.points?.length
        ? { lat: g.points[0].lat, lon: g.points[0].lon }
        : { lat: g.lat, lon: g.lon };
      map()?.flyTo({
        ...point,
        altitude: g.radius_m ? Math.max(1500, g.radius_m * 4) : 2500,
      });
    });
    const buttons = [go];
    if (item.kind === 'place') {
      const ring = el('button', {
        type: 'button',
        text: text.ring,
        'aria-label': `${text.ring}: ${item.name}`,
      });
      ring.addEventListener('click', () => {
        form = {
          kind: 'ring',
          geom: { lat: item.geom.lat, lon: item.geom.lon },
          defaultName: `${item.name} ${text.ring}`,
          defaultTag: item.tag,
        };
        draw();
      });
      buttons.push(ring);
    }
    const del = el('button', {
      type: 'button',
      class: 'ox-danger',
      text: text.remove,
      'aria-label': `${text.remove}: ${item.name}`,
    });
    del.addEventListener('click', async () => {
      if (!globalThis.confirm(`${text.removeSure} ${item.name}`)) return;
      try {
        await client.removeItem(item.id);
        await refresh();
      } catch (error) {
        fail(error);
      }
    });
    buttons.push(del);
    return el('li', { class: 'ox-lib-item' }, [
      el('span', {
        class: 'ox-dot',
        style: `background:${tagColor(item.tag)}`,
      }),
      el('span', { class: 'ox-lib-name', text: item.name }),
      el('span', { class: 'ox-lib-tag', text: tagName(item.tag, lang) }),
      el('span', { class: 'ox-row' }, buttons),
    ]);
  }

  function tacticRow(tactic) {
    const use = el('button', {
      type: 'button',
      class: 'ox-primary',
      text: text.apply,
      'aria-label': `${text.apply}: ${tactic.name}`,
    });
    use.addEventListener('click', () => {
      writeTags(tactic.tags ?? []);
      apply(hashParams(tactic.hash));
    });
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

    // Which tags are drawn on the map now, and stored with the next tactic.
    const chips = TAG_IDS.map((id) => {
      const on = tags.length === 0 || tags.includes(id);
      const chip = el('button', {
        type: 'button',
        class: `ox-tag${on ? ' on' : ''}`,
        'aria-pressed': String(on),
        style: `--tag:${tagColor(id)}`,
        text: tagName(id, lang),
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
    panel.append(
      el('div', { class: 'ox-menu-note', text: text.filter }),
      el('div', { class: 'ox-tags' }, chips),
    );

    if (form) {
      panel.append(formView());
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
  return { button, panel };
}
