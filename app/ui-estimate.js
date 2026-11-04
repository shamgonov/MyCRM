/* CRM2 :: app/ui-estimate.js — интерактивная смета: прайс, коэффициенты,
   доп. работы, расчёт итога. Зависит от db.js, auth.js, orders.js, core.js. */
'use strict';

// --- 6. calculateEstimateTotal: работы (с учётом коэффициента) + согласованные доп. ---

function calculateEstimateTotal(o) {
  if (!o) return 0;
  let total = 0;
  (o.works || []).forEach(function (w) {
    if (w.skipped) return;
    total += (Number(w.qty) || 0) * (Number(w.price) || 0) * (Number(w.coeff) || 1);
  });
  (o.extras || []).forEach(function (e) {
    if (e.status !== 'agreed') return;
    total += (Number(e.qty) || 0) * (Number(e.price) || 0);
  });
  return total;
}

// --- 5. toggleWorkDone: циклическое переключение (null → done → skipped → null) ---

function toggleWorkDone(o, idx) {
  if (!o || !Array.isArray(o.works) || idx < 0 || idx >= o.works.length) return;
  const w = o.works[idx];
  if (!w.done && !w.skipped) { w.done = true; w.skipped = false; }
  else if (w.done) { w.skipped = true; w.done = false; }
  else { w.done = false; w.skipped = false; }
  saveOrderLocal(o);
}

// --- 1. renderEstimateTab: полный рендер вкладки "Смета" ---

function renderEstimateTab(o) {
  if (!o) return '<p class="muted">Нет данных заявки.</p>';

  const worksRows = (o.works || []).map(function (w, i) {
    const sum = (Number(w.qty) || 0) * (Number(w.price) || 0) * (Number(w.coeff) || 1);
    const coeffLabel = (Number(w.coeff) || 1) !== 1 ? ' ×' + w.coeff : '';
    const coeffHtml = coeffLabel ? '<span class="muted small">' + coeffLabel + '</span>' : '';
    const stateIcon = w.skipped ? '🔴' : (w.done ? '🟢' : '⬜');
    return '<div class="est-row' + (w.skipped ? ' done' : '') + '">' +
      '<span>' + stateIcon + ' ' + escapeHtml(w.name || w.title) +
        ' · ' + w.qty + ' × ' + money(w.price) + coeffHtml + '</span>' +
      '<span>' +
        '<button class="btn" data-toggle-done="' + i + '" style="padding:2px 6px;font-size:12px">' +
          (w.skipped ? '↺' : (w.done ? '⬜' : '🟢')) + '</button>' +
        ' <b>' + money(sum) + '</b>' +
      '</span>' +
    '</div>';
  }).join('') || '<p class="muted">Работ пока нет.</p>';

  const extrasRows = (o.extras || []).map(function (e, i) {
    const badge = e.status === 'agreed' ? '🟢 Согласовано' :
      (e.status === 'rejected' ? '🔴 Отказ' : '🟡 Ждёт');
    return '<div class="est-row">' +
      '<span>➕ ' + escapeHtml(e.name) +
        (e.reason ? ' <span class="small muted">(' + escapeHtml(e.reason) + ')</span>' : '') +
        '</span>' +
      '<span>' + badge + ' · ' + money((Number(e.qty) || 0) * (Number(e.price) || 0)) + '</span>' +
    '</div>';
  }).join('') || '';

  return '<div class="card">' +
      '<h4>Основные работы</h4>' +
      worksRows +
    '</div>' +
    (extrasRows ? '<div class="card">' +
      '<h4>Доп. работы</h4>' +
      extrasRows +
    '</div>' : '') +
    '<div class="card">' +
      '<div class="est-total"><span>Итого:</span><span>' +
        money(calculateEstimateTotal(o)) + '</span></div>' +
    '</div>' +
    '<div class="row" style="gap:6px;margin-top:8px">' +
      '<button class="btn" data-action="price-list" style="flex:1">📋 Работа из прайса</button>' +
      '<button class="btn" data-action="add-extra" style="flex:1">➕ Доп. работа</button>' +
      '<button class="btn btn-primary" data-action="save-order" style="flex:1">💾 Сохранить</button>' +
    '</div>';
}

// --- 3. renderWorkConfigModal: настройка строки (количество, цена, коэффициент) ---

function renderWorkConfigModal(workItem, isNew) {
  const isPrice = !!workItem.id && !isNew;
  showModal(
    '<h3>' + (isNew ? 'Новая работа' : 'Настройка строки') + '</h3>' +
    '<label class="field"><span>Название</span>' +
      '<input id="ew-name" type="text" value="' + escapeHtml(workItem.name || workItem.title || '') +
        '"' + (isPrice ? ' readonly disabled' : '') + '></label>' +
    '<label class="field"><span>Кол-во</span>' +
      '<input id="ew-qty" type="number" min="1" value="' + (workItem.qty || 1) + '"></label>' +
    '<label class="field"><span>Цена</span>' +
      '<input id="ew-price" type="number" min="0" value="' + (workItem.price || '') + '"></label>' +
    '<label class="field"><span>Коэффициент</span>' +
      '<input id="ew-coeff" type="number" min="1" step="0.1" value="' + (workItem.coeff || 1) + '">' +
      '<div class="chips" style="margin-top:4px">' +
        [1, 1.2, 1.5, 2].map(function (c) {
          return '<button class="chip' + ((workItem.coeff || 1) === c ? ' active' : '') +
            '" data-coeff="' + c + '">' + c + '</button>';
        }).join('') +
      '</div>' +
    '</label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-work style="flex:1">Добавить в смету</button>' +
    '</div>'
  );
}

// --- 2. renderPriceListModal: выбор из прайса ---

function renderPriceListModal(o) {
  const items = (DB.priceList || []).map(function (p) {
    return '<div class="list-item" data-price-item="' + p.id + '">' +
      '<div class="spread">' +
        '<b>' + escapeHtml(p.name) + '</b>' +
        '<span class="muted small">' + money(p.basePrice) + ' / ' + p.unit + '</span>' +
      '</div>' +
      '<div class="small muted">' + escapeHtml(p.category) + '</div>' +
    '</div>';
  }).join('');

  showModal(
    '<h3>📋 Работа из прайса</h3>' +
    '<label class="field"><span>Поиск</span>' +
      '<input id="price-search" type="text" placeholder="Название..."></label>' +
    '<div id="price-list-container">' + items + '</div>' +
    '<button class="btn btn-block" data-close>Отмена</button>'
  );
}

// --- 4. renderExtraWorkModal: доп. работа на месте ---

function renderExtraWorkModal() {
  showModal(
    '<h3>➕ Доп. работа на месте</h3>' +
    '<label class="field"><span>Название</span>' +
      '<input id="en-name" type="text" placeholder="Название работы"></label>' +
    '<label class="field"><span>Цена</span>' +
      '<input id="en-price" type="number" min="0" placeholder="0"></label>' +
    '<label class="field"><span>Кол-во</span>' +
      '<input id="en-qty" type="number" min="1" value="1"></label>' +
    '<label class="field"><span>Причина</span>' +
      '<textarea id="en-reason" rows="2" placeholder="Почему добавляем на месте"></textarea></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-extra style="flex:1">Добавить</button>' +
    '</div>'
  );
}

// --- Делегирование событий сметы ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  // Переключение done/skipped/null
  const toggleBtn = sel('[data-toggle-done]');
  if (toggleBtn) {
    const idx = Number(toggleBtn.getAttribute('data-toggle-done'));
    const orderEl = toggleBtn.closest('[data-order]');
    if (orderEl) {
      const id = Number(orderEl.getAttribute('data-order'));
      const o = (DB.orders || []).find(function (x) { return x.id === id; });
      if (o) { toggleWorkDone(o, idx); render(); }
    } else {
      // Если кнопки нет в списке, а в карточке — ищем открытую карточку.
      // Это сложный кейс, пока просто toast.
      toast('Сначала откройте карточку заявки');
    }
    return;
  }

  // Кнопки действия
  const action = sel('[data-action]');
  if (action) {
    const act = action.getAttribute('data-action');
    // Находим текущую открытую заявку по state.orderId
    const o = (DB.orders || []).find(function (x) { return x.id === state.orderId; });
    if (!o) { toast('Откройте карточку заявки', true); return; }
    if (act === 'price-list') renderPriceListModal(o);
    else if (act === 'add-extra') renderExtraWorkModal();
    else if (act === 'save-order') { saveOrderLocal(o); toast('Сохранено'); }
    return;
  }

  // Выбор работы из прайса
  const priceItem = sel('[data-price-item]');
  if (priceItem) {
    const pid = Number(priceItem.getAttribute('data-price-item'));
    const item = (DB.priceList || []).find(function (p) { return p.id === pid; });
    if (item) renderWorkConfigModal({ name: item.name, price: item.basePrice, coeff: 1, qty: item.defaultQty }, true);
    return;
  }

  // Чипы коэффициента
  const coeffChip = sel('[data-coeff]');
  if (coeffChip) {
    document.querySelectorAll('[data-coeff].active').forEach(function (c) { c.classList.remove('active'); });
    coeffChip.classList.add('active');
    const coeffInput = document.getElementById('ew-coeff');
    if (coeffInput) coeffInput.value = coeffChip.getAttribute('data-coeff');
    return;
  }

  // Сохранение строки работы
  const saveWorkBtn = sel('[data-save-work]');
  if (saveWorkBtn) {
    const o = (DB.orders || []).find(function (x) { return x.id === state.orderId; });
    if (!o) { toast('Нет открытой заявки', true); return; }
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };
    const qty = parseFloat(val('ew-qty')) || 1;
    const price = parseFloat(val('ew-price')) || 0;
    const coeff = parseFloat(val('ew-coeff')) || 1;
    const name = val('ew-name');
    o.works.push({ name: name, qty: qty, price: price, coeff: coeff, unit: 'шт', done: false, skipped: false });
    saveOrderLocal(o);
    closeModal();
    ORD_TAB = 'estimate';
    render();
    return;
  }

  // Сохранение доп. работы
  const saveExtraBtn = sel('[data-save-extra]');
  if (saveExtraBtn) {
    const o = (DB.orders || []).find(function (x) { return x.id === state.orderId; });
    if (!o) { toast('Нет открытой заявки', true); return; }
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? (el.value || '') : '';
    };
    o.extras.push({
      name: val('en-name'),
      price: parseFloat(val('en-price')) || 0,
      qty: parseFloat(val('en-qty')) || 1,
      status: 'pending_agree',
      reason: val('en-reason')
    });
    saveOrderLocal(o);
    closeModal();
    ORD_TAB = 'estimate';
    render();
    return;
  }
});

// Фильтр поиска в прайсе
document.addEventListener('input', function (ev) {
  const searchInput = ev.target.closest && ev.target.closest('#price-search');
  if (!searchInput) return;
  const q = searchInput.value.toLowerCase();
  const container = document.getElementById('price-list-container');
  if (!container) return;
  const items = container.querySelectorAll('[data-price-item]');
  items.forEach(function (el) {
    const name = el.querySelector('b').textContent.toLowerCase();
    el.style.display = name.indexOf(q) >= 0 ? '' : 'none';
  });
});
