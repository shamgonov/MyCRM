/* CRM2 :: app/ui-shopping.js — учёт материалов: вкладка «Материалы» в карточке
   заявки и глобальный экран «Закупки» (статусы, свои средства, брак, компенсации).
   Зависит: db.js, auth.js, gates.js, orders.js, core.js. */
'use strict';

const MAT_UNITS = ['шт', 'пог.м', 'м²', 'м', 'комплект'];

// Бейдж статуса материала.
function materialStatusBadge(m) {
  if (m.status === 'bought') {
    const own = (m.buyer === 'worker') ? ' 💳' : '';
    return '<span class="badge badge-ok">🟢 Куплено' + own + '</span>' +
      (m.buyer === 'worker' ? ' <span class="badge badge-accent">💳 Свои средства</span>' : '');
  }
  if (m.status === 'spoiled') return '<span class="badge badge-danger">🔴 Испорчен</span>';
  if (m.status === 'compensated') return '<span class="badge badge-ok">💰 Компенсировано</span>';
  return '<span class="badge badge-warn">🟡 Нужно купить</span>';
}

function matSum(m) {
  const price = (m.status === 'bought' || m.status === 'compensated') && m.factPrice
    ? Number(m.factPrice) : Number(m.price) || 0;
  return (Number(m.qty) || 0) * price;
}

// --- 1. Вкладка «Материалы» в карточке заявки ---

function renderShoppingTab(o) {
  if (!o) return '<p class="muted">Нет данных заявки.</p>';
  const editable = canEditOrder(o);

  const rows = (o.materials || []).map(function (m, i) {
    const quick = editable && m.status === 'needed'
      ? '<button class="btn" data-quick-mat="' + i + '" data-quick-act="bought" style="padding:2px 6px;font-size:12px">🟢 Куплено</button>'
      : (editable && m.status === 'bought' && m.buyer === 'worker'
        ? '<button class="btn" data-quick-mat="' + i + '" data-quick-act="compensated" style="padding:2px 6px;font-size:12px">💰 Компенсировать</button>'
        : '');
    return '<div class="list-item" data-edit-material="' + i + '">' +
      '<div class="spread">' +
        '<b>🧱 ' + escapeHtml(m.name) + '</b>' +
        '<span>' + materialStatusBadge(m) + '</span>' +
      '</div>' +
      '<div class="small muted">' + (m.qty || 0) + ' ' + escapeHtml(m.unit || 'шт') +
        ' × ' + money(m.price) +
        (m.factPrice ? ' · факт ' + money(m.factPrice) : '') +
        (m.hasReceipt ? ' · 📷 чек' : '') +
        (m.note ? ' · ' + escapeHtml(m.note) : '') + '</div>' +
      (quick ? '<div style="margin-top:4px">' + quick + '</div>' : '') +
    '</div>';
  }).join('') || '<p class="muted">Материалов пока нет.</p>';

  return '<div class="card">' +
      '<h4>Материалы</h4>' + rows +
      (editable ? '<button class="btn btn-block" data-add-material style="margin-top:10px">➕ Добавить материал</button>' : '') +
    '</div>';
}

// --- 2. Модалка добавления/редактирования материала ---

function renderMaterialModal(o, matIndex) {
  const m = (matIndex !== null && matIndex !== undefined && o.materials && o.materials[matIndex])
    ? o.materials[matIndex]
    : { name: '', qty: 1, unit: 'шт', price: '', buyer: 'company', status: 'needed',
        factPrice: '', hasReceipt: false, note: '' };

  const unitOpts = MAT_UNITS.map(function (u) {
    return '<option value="' + u + '"' + (m.unit === u ? ' selected' : '') + '>' + u + '</option>';
  }).join('');

  const buyerOpts = [['company', 'Компания'], ['worker', 'Работник (свои)']]
    .map(function (b) {
      return '<option value="' + b[0] + '"' + (m.buyer === b[0] ? ' selected' : '') + '>' + b[1] + '</option>';
    }).join('');

  const statusOpts = [['needed', '🟡 Нужно купить'], ['bought', '🟢 Куплено'], ['spoiled', '🔴 Испорчен']]
    .map(function (s) {
      return '<option value="' + s[0] + '"' + (m.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');

  window.__matEdit = { orderId: o.id, idx: (matIndex === null || matIndex === undefined) ? null : matIndex };

  showModal(
    '<h3>' + (window.__matEdit.idx === null ? '➕ Новый материал' : '✎ Материал: ' + escapeHtml(m.name)) + '</h3>' +
    '<label class="field"><span>Название *</span>' +
      '<input id="mt-name" type="text" value="' + escapeHtml(m.name) + '"></label>' +
    '<div class="row">' +
      '<label class="field" style="flex:1"><span>Кол-во</span>' +
        '<input id="mt-qty" type="number" min="0" step="0.1" value="' + (m.qty || 1) + '"></label>' +
      '<label class="field" style="flex:1"><span>Ед.изм</span>' +
        '<select id="mt-unit">' + unitOpts + '</select></label>' +
    '</div>' +
    '<label class="field"><span>Цена плановая</span>' +
      '<input id="mt-price" type="number" min="0" value="' + (m.price || '') + '"></label>' +
    '<div class="row">' +
      '<label class="field" style="flex:1"><span>Кто покупает</span>' +
        '<select id="mt-buyer">' + buyerOpts + '</select></label>' +
      '<label class="field" style="flex:1"><span>Статус</span>' +
        '<select id="mt-status">' + statusOpts + '</select></label>' +
    '</div>' +
    '<div id="mt-bought-fields"' + (m.status === 'bought' ? '' : ' hidden') + '>' +
      '<label class="field"><span>Факт. цена</span>' +
        '<input id="mt-fact" type="number" min="0" value="' + (m.factPrice || '') + '"></label>' +
      '<label class="field"><span>Комментарий / что куплено</span>' +
        '<input id="mt-note-b" type="text" value="' + escapeHtml(m.note || '') + '"></label>' +
      '<label class="field"><label><input id="mt-receipt" type="checkbox"' +
        (m.hasReceipt ? ' checked' : '') + '> 📷 Фото чека прикреплено</label></label>' +
    '</div>' +
    '<div id="mt-spoiled-fields"' + (m.status === 'spoiled' ? '' : ' hidden') + '>' +
      '<label class="field"><span>Причина (брак)</span>' +
        '<input id="mt-note-s" type="text" placeholder="например: упал при транспортировке" value="' +
        escapeHtml(m.note || '') + '"></label>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-material style="flex:1">Сохранить</button>' +
    '</div>'
  );
}

// Чтение значений модалки + сохранение. Вызывается делегатом; значения передаются
// словарём (в смоуке — напрямую, без DOM).
function saveMaterialFromModal(orderId, idx, v) {
  const o = (DB.orders || []).find(function (x) { return x.id === orderId; });
  if (!o || !v.name) return null;
  const mat = {
    name: v.name,
    qty: Number(v.qty) || 0,
    unit: v.unit || 'шт',
    price: Number(v.price) || 0,
    buyer: v.buyer || 'company',
    status: v.status || 'needed'
  };
  if (mat.status === 'bought') {
    mat.factPrice = Number(v.factPrice) || 0;
    mat.note = v.note || '';
    mat.hasReceipt = !!v.hasReceipt;
  } else if (mat.status === 'spoiled') {
    mat.note = v.note || '';
  }
  if (!Array.isArray(o.materials)) o.materials = [];
  if (idx === null || idx === undefined) o.materials.push(mat);
  else o.materials[idx] = mat;
  saveOrderLocal(o);
  return mat;
}

// --- 4. Быстрое переключение статуса из списка ---

function updateMaterialStatus(o, matIndex, newStatus, factPrice, note) {
  if (!o || !Array.isArray(o.materials) || !o.materials[matIndex]) return null;
  const m = o.materials[matIndex];
  m.status = newStatus;
  if (factPrice !== null && factPrice !== undefined) m.factPrice = Number(factPrice) || 0;
  if (note) m.note = note;
  saveOrderLocal(o);
  return m;
}

// --- 3. Глобальный экран «Закупки» ---

function shopFilter() { return state.shopFilter || 'all'; }

// Плоский список материалов всех видимых заявок: [{o, m, idx}].
function collectMaterials(filter) {
  const out = [];
  (DB.orders || []).forEach(function (o) {
    if (!canViewOrder(o)) return;
    (o.materials || []).forEach(function (m, idx) {
      if (filter === 'needed' && m.status !== 'needed') return;
      if (filter === 'comp' && !(m.buyer === 'worker' && m.status === 'bought')) return;
      out.push({ o: o, m: m, idx: idx });
    });
  });
  return out;
}

function renderGlobalShopping() {
  const f = shopFilter();
  const items = collectMaterials(f);

  const chips = [['all', 'Все'], ['needed', '🟡 Нужно купить'], ['comp', '💰 Компенсации']]
    .map(function (c) {
      return '<button class="chip' + (f === c[0] ? ' active' : '') +
        '" data-shop-filter="' + c[0] + '">' + c[1] + '</button>';
    }).join('');

  const owed = items.reduce(function (s, it) {
    return s + ((it.m.buyer === 'worker' && it.m.status === 'bought')
      ? (Number(it.m.factPrice || it.m.price) || 0) * (Number(it.m.qty) || 0) : 0);
  }, 0);

  const rows = items.map(function (it) {
    const compBtn = (it.m.buyer === 'worker' && it.m.status === 'bought' && canEditOrder(it.o))
      ? '<button class="btn btn-primary" data-compensate="' + it.o.id + '|' + it.idx +
        '" style="padding:2px 8px;font-size:12px">💰 Компенсировать</button>'
      : '';
    return '<div class="list-item">' +
      '<div class="spread">' +
        '<span data-order="' + it.o.id + '"><b>🧱 ' + escapeHtml(it.m.name) + '</b>' +
          ' <span class="small muted">№' + it.o.id + ' · ' + escapeHtml(it.o.client) + '</span></span>' +
        '<span>' + materialStatusBadge(it.m) + '</span>' +
      '</div>' +
      '<div class="spread" style="margin-top:4px">' +
        '<span class="small muted">' + (it.m.qty || 0) + ' ' + escapeHtml(it.m.unit || 'шт') +
          ' · ' + money((Number(it.m.factPrice) || Number(it.m.price) || 0) * (Number(it.m.qty) || 0)) +
          (it.m.hasReceipt ? ' · 📷 чек' : '') +
          (it.m.note ? ' · ' + escapeHtml(it.m.note) : '') + '</span>' +
        compBtn +
      '</div>' +
    '</div>';
  }).join('') || '<p class="muted">Ничего не найдено по этому фильтру.</p>';

  return '<h2>🛒 Закупки</h2>' +
    '<div class="chips">' + chips + '</div>' +
    '<p class="small muted">К выплате работникам: <b>' + money(owed) + '</b></p>' +
    '<div class="list">' + rows + '</div>';
}

// --- Делегирование событий закупок ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  // Фильтры глобального экрана
  const chip = sel('[data-shop-filter]');
  if (chip) { state.shopFilter = chip.getAttribute('data-shop-filter'); render(); return; }

  // Быстрые статусы в табе карточки
  const quick = sel('[data-quick-mat]');
  if (quick) {
    ev.stopPropagation();
    const idx = Number(quick.getAttribute('data-quick-mat'));
    const act = quick.getAttribute('data-quick-act');
    const o = (DB.orders || []).find(function (x) { return x.id === state.orderId; });
    if (o) { updateMaterialStatus(o, idx, act); render(); }
    return;
  }

  // Компенсация из глобального экрана
  const comp = sel('[data-compensate]');
  if (comp) {
    ev.stopPropagation();
    const parts = comp.getAttribute('data-compensate').split('|');
    const o = (DB.orders || []).find(function (x) { return x.id === Number(parts[0]); });
    if (o) {
      updateMaterialStatus(o, Number(parts[1]), 'compensated');
      toast('Компенсация выплачена');
      render();
    }
    return;
  }

  // Добавление материала
  const add = sel('[data-add-material]');
  if (add) {
    const o = (DB.orders || []).find(function (x) { return x.id === state.orderId; });
    if (o) renderMaterialModal(o, null);
    return;
  }

  // Клик по строке материала — редактирование
  const editRow = sel('[data-edit-material]');
  if (editRow) {
    const o = (DB.orders || []).find(function (x) { return x.id === state.orderId; });
    if (o) renderMaterialModal(o, Number(editRow.getAttribute('data-edit-material')));
    return;
  }

  // Сохранение из модалки
  const save = sel('[data-save-material]');
  if (save) {
    const ctx = window.__matEdit || {};
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const chk = function (id) {
      const el = document.getElementById(id);
      return !!(el && el.checked);
    };
    const status = val('mt-status');
    const v = {
      name: val('mt-name'),
      qty: val('mt-qty'),
      unit: val('mt-unit'),
      price: val('mt-price'),
      buyer: val('mt-buyer'),
      status: status,
      factPrice: val('mt-fact'),
      note: status === 'spoiled' ? val('mt-note-s') : val('mt-note-b'),
      hasReceipt: chk('mt-receipt')
    };
    if (!v.name) { toast('Укажите название', true); return; }
    const saved = saveMaterialFromModal(ctx.orderId, ctx.idx, v);
    if (saved) {
      window.__matEdit = null;
      closeModal();
      ORD_TAB = 'materials';
      render();
    }
    return;
  }
});
