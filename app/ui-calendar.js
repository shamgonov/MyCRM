/* CRM2 :: app/ui-calendar.js — календарь заявок по дням, вид Общий/Мой,
   свободные слоты, «На линии», мягкое предупреждение о пересечениях.
   Зависит: db.js, auth.js, gates.js, orders.js, core.js, ui-orders.js (модалка/карточка). */
'use strict';

// Таб «Общий/Мой» и чип-фильтр типа живут в state (переживают перерисовки).
function calViewMode() { return state.calView || 'all'; }
function calFilter() { return state.calFilter || 'all'; }

// --- 7. Режим «На линии» (state.online, localStorage crm2_online) ---

function loadOnline() {
  const v = lsGet('crm2_online', '');
  state.online = v === '1';
  return state.online;
}

function isOnline() {
  return state.online === true;
}

function renderOnlineToggle() {
  const on = isOnline();
  return '<button class="btn' + (on ? '' : ' btn-primary') + '" data-online-toggle title="Режим «На линии»">' +
    (on ? '🟢 На линии' : '🔴 Не беспокоить') +
    '</button>';
}

// --- 2. Фильтрация заявок для календаря ---

// Тип заявки для фильтров чипов: осмотр / работа.
function orderKind(o) {
  if (o.kind === 'inspection' || o.type === 'service' || o.status === 'inspection' || o.examiner) {
    return 'inspection';
  }
  return 'work';
}

function getCalendarOrders(date, filter, viewMode) {
  const rows = (DB.orders || []).filter(function (o) {
    if (o.date !== date) return false;
    if (viewMode === 'my' && !isAssignedToMe(o)) return false;
    if (filter === 'inspection' && orderKind(o) !== 'inspection') return false;
    if (filter === 'work' && orderKind(o) !== 'work') return false;
    return true;
  });
  rows.sort(function (a, b) {
    return String(a.t1 || '').localeCompare(String(b.t1 || ''));
  });
  return rows;
}

// Цвет/иконка строки: 🔍 осмотр (синий), 🔧 работа (зелёный), ⚠️ просрочка (красный).
function dayRowStyle(o) {
  const today = localToday();
  if (o.date < today && o.status !== 'completed' && o.status !== 'paid' && o.status !== 'canceled') {
    return { cls: 'badge-danger', icon: '⚠️' };
  }
  if (orderKind(o) === 'inspection') return { cls: 'badge-info', icon: '🔍' };
  return { cls: 'badge-ok', icon: '🔧' };
}

// --- 3. Список заявок на день ---

function renderCalendarDay(orders) {
  if (!orders.length) return '<p class="muted">Заявок нет по этому фильтру.</p>';
  return '<div class="list">' + orders.map(function (o) {
    const st = dayRowStyle(o);
    const mine = isAssignedToMe(o);
    return '<div class="list-item' + (mine ? ' mine' : '') + '" data-order="' + o.id + '">' +
      '<div class="spread">' +
        '<b>' + st.icon + ' ' + (o.t1 || '') + '-' + (o.t2 || '') +
          ' · №' + o.id + ' ' + escapeHtml(o.client) + '</b>' +
        '<span>' +
          (mine ? '<span class="badge badge-accent">👷 МОЯ</span> ' : '') +
          '<span class="' + st.cls + '">' + (STATUS_LABELS[o.status] || o.status) + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="small muted">' + escapeHtml(o.city || '') + ', ' + escapeHtml(o.address || '') +
        ' · Исп: ' + escapeHtml(o.worker || '—') + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

// --- 4. Свободные слоты: разрыв между заявками > 30 минут ---

function toMin(hhmm) {
  if (!hhmm || hhmm.indexOf(':') < 0) return null;
  const p = hhmm.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

// Возвращает [{t1,t2}] свободных промежутков рабочего дня 08:00-20:00.
function freeSlots(orders) {
  const DAY_START = 8 * 60;
  const DAY_END = 20 * 60;
  const busy = orders
    .map(function (o) { return [toMin(o.t1), toMin(o.t2)]; })
    .filter(function (iv) { return iv[0] !== null && iv[1] !== null; })
    .sort(function (a, b) { return a[0] - b[0]; });

  const slots = [];
  let cur = DAY_START;
  for (const iv of busy) {
    if (iv[0] - cur >= 30) slots.push([cur, iv[0]]);
    if (iv[1] > cur) cur = iv[1];
  }
  if (DAY_END - cur >= 30) slots.push([cur, DAY_END]);
  return slots.map(function (s) {
    const mm = function (v) {
      return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
    };
    return { t1: mm(s[0]), t2: mm(s[1]) };
  });
}

function renderFreeSlot(slot) {
  return '<div class="list-item slot" data-slot="' + slot.t1 + '|' + slot.t2 + '">' +
    '<span class="muted">🟢 Свободно ' + slot.t1 + '-' + slot.t2 + '</span>' +
    '<span class="small muted">нажмите, чтобы создать заявку</span>' +
  '</div>';
}

// Все свободные слоты дня вперемешку с занятыми строками (по времени).
function renderDayTimeline(orders) {
  const slots = freeSlots(orders);
  if (!orders.length) {
    return '<p class="muted" style="text-align:center;margin:18px 0">🌙 Свободно весь день</p>' +
      freeSlots([]).map(renderFreeSlot).join('');
  }
  const items = orders.map(function (o) {
    return { at: toMin(o.t1) || 0, html: renderCalendarDay([o]) };
  });
  // Слоты вставляем после ближайшей заявки, заканчивающейся до начала слота.
  const out = [];
  let si = 0;
  for (const it of items) {
    while (si < slots.length && toMin(slots[si].t2) <= it.at) {
      out.push(renderFreeSlot(slots[si]));
      si++;
    }
    out.push(it.html);
  }
  while (si < slots.length) { out.push(renderFreeSlot(slots[si])); si++; }
  return out.join('');
}

// --- 1. Главный экран календаря ---

function renderCalendar() {
  const date = state.calDate || localToday();
  const view = calViewMode();
  const filter = calFilter();
  const orders = getCalendarOrders(date, filter, view);

  const chips = [['all', 'Все'], ['inspection', '🔍 Осмотры'], ['work', '🔧 Работы']]
    .map(function (c) {
      return '<button class="chip' + (filter === c[0] ? ' active' : '') +
        '" data-cal-filter="' + c[0] + '">' + c[1] + '</button>';
    }).join('');

  const tabs =
    '<button class="chip' + (view === 'all' ? ' active' : '') + '" data-cal-view="all">👥 Общий</button>' +
    '<button class="chip' + (view === 'my' ? ' active' : '') + '" data-cal-view="my">👷 Мой</button>';

  return '<div class="spread">' +
      '<h2>📅 Календарь</h2>' +
      renderOnlineToggle() +
    '</div>' +
    '<div class="head-row">' +
      '<button class="btn" data-cal-shift="-1">‹</button>' +
      '<span style="flex:1;text-align:center"><b>' + date + '</b>' +
        (date === localToday() ? ' (сегодня)' : '') + '</span>' +
      '<button class="btn" data-cal-shift="1">›</button>' +
      '<button class="btn" data-cal-today>Сегодня</button>' +
    '</div>' +
    '<div class="chips">' + tabs + '</div>' +
    '<div class="chips">' + chips + '</div>' +
    renderDayTimeline(orders) +
    '<button class="btn btn-block" data-create-cal style="margin-top:10px">➕ Создать задачу</button>';
}

// --- 6. Мягкое предупреждение о пересечении ---

function showConflictModal(conflicts, newOrder) {
  const nums = conflicts.map(function (o) { return '№' + o.id; }).join(', ');
  showModal(
    '<h3>⚠️ Пересечение по времени</h3>' +
    '<p>Пересечение с заявками: <b>' + nums + '</b>.</p>' +
    '<p class="small muted">Если это один подъезд или адреса рядом, вы можете взять заказ.</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">🔙 Отмена</button>' +
      '<button class="btn btn-primary" data-force-order style="flex:1">✅ Всё равно взять</button>' +
    '</div>'
  );
}

// Создание с проверкой конфликта (используется слотами и формой календаря).
function tryCreateOrder(data) {
  const conflicts = checkTimeConflict(data);
  if (conflicts.length) {
    showConflictModal(conflicts, data);
    return false;
  }
  finishCreateOrder(data);
  return true;
}

function finishCreateOrder(data) {
  createOrder(data);
  closeModal();
  go('orders');
}

// --- 5. Проверка пересечений: та же дата, тот же worker, интервалы наслаиваются ---

function checkTimeConflict(newOrder) {
  if (!newOrder || !newOrder.date) return [];
  const t1n = toMin(newOrder.t1);
  const t2n = toMin(newOrder.t2);
  if (t1n === null || t2n === null || t2n <= t1n) return [];
  return (DB.orders || []).filter(function (o) {
    if (o.date !== newOrder.date) return false;
    if (o.worker !== newOrder.worker) return false; // null !== null → заявки без worker не конфликтуют
    if (o.status === 'canceled') return false;
    const t1 = toMin(o.t1);
    const t2 = toMin(o.t2);
    if (t1 === null || t2 === null) return false;
    return t1n < t2 && t2n > t1;
  });
}

// --- Делегирование событий ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  const shift = sel('[data-cal-shift]');
  if (shift) {
    state.calDate = dateShift(state.calDate || localToday(), Number(shift.getAttribute('data-cal-shift')));
    render();
    return;
  }

  const todayBtn = sel('[data-cal-today]');
  if (todayBtn) { state.calDate = localToday(); render(); return; }

  const viewChip = sel('[data-cal-view]');
  if (viewChip) { state.calView = viewChip.getAttribute('data-cal-view'); render(); return; }

  const filterChip = sel('[data-cal-filter]');
  if (filterChip) { state.calFilter = filterChip.getAttribute('data-cal-filter'); render(); return; }

  const online = sel('[data-online-toggle]');
  if (online) {
    state.online = !isOnline();
    lsSet('crm2_online', state.online ? '1' : '0');
    render();
    return;
  }

  // Слот: создаём заявку с этим временем (без работника — пул).
  const slot = sel('[data-slot]');
  if (slot) {
    const parts = slot.getAttribute('data-slot').split('|');
    createCalOrder(parts[0], parts[1]);
    return;
  }

  const createBtn = sel('[data-create-cal]');
  if (createBtn) { createCalOrder('', ''); return; }

  const forceBtn = sel('[data-force-order]');
  if (forceBtn && window.__calPending) {
    finishCreateOrder(window.__calPending);
    window.__calPending = null;
    return;
  }

  // Клики по заявкам дня обработаны в ui-orders (data-order) — не дублируем.
});

// Создание из календаря: предзаполненные дата и время, конфликт → модалка.
function createCalOrder(t1, t2) {
  const data = {
    client: '',
    date: state.calDate || localToday(),
    t1: t1,
    t2: t2
  };
  renderCreateOrderPrefilled(data);
}

// Модалка создания (ui-orders) с предзаполненными датой/временем.
function renderCreateOrderPrefilled(data) {
  renderCreateOrderModal();
  const set = function (id, v) {
    const el = document.getElementById(id);
    if (el && v) el.value = v;
  };
  set('nc-date', data.date);
  set('nc-t1', data.t1);
  set('nc-t2', data.t2);
}

loadOnline();

// Явный экспорт в window: экран календаря вызывается из карты S (core.js).
window.renderCalendar = renderCalendar;
