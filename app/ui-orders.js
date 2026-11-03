/* CRM2 :: app/ui-orders.js — список заявок, карточка с табами, создание заявки.
   Зависит: db.js, auth.js, gates.js, orders.js, core.js (go/render/showModal/toast). */
'use strict';

// Русские названия статусов + цвет бейджа.
const STATUS_LABELS = {
  new: 'Новая', inspection: 'Осмотр', estimate: 'Смета', approved: 'Согласована',
  inwork: 'В работе', paused: 'Пауза', waiting: 'Ожидание', postponed: 'Отложена',
  completed: 'Завершена', paid: 'Оплачена', canceled: 'Отменена'
};

function statusBadgeClass(st) {
  if (st === 'inwork') return 'badge-accent';       // жёлтый
  if (st === 'completed' || st === 'paid') return 'badge-ok';   // зелёный
  if (st === 'canceled') return 'badge-danger';
  if (st === 'new') return 'badge';                  // серый (базовый)
  return 'badge-warn';
}

// Открытая вкладка карточки (переживает перерисовки).
var ORD_TAB = 'main';

// --- Фильтры списка: [Все][Сегодня][👷 Мои][⚠️ Просрочка] ---

function orderPassesFilter(o, f) {
  if (f === 'today') return o.date === localToday();
  if (f === 'mine') return isAssignedToMe(o);
  if (f === 'overdue') {
    return o.date < localToday() &&
      o.status !== 'completed' && o.status !== 'paid' && o.status !== 'canceled';
  }
  return true; // 'all'
}

// --- 1. Список заявок ---

function renderOrdersList() {
  const all = DB.orders || [];
  const f = state.filter || 'all';

  // Видимость: право на все заявки либо «мои» (гейты не обходятся).
  const rows = all
    .filter(function (o) { return canViewOrder(o); })
    .filter(function (o) { return orderPassesFilter(o, f); });

  const chips = [
    ['all', 'Все'], ['today', 'Сегодня'], ['mine', '👷 Мои'], ['overdue', '⚠️ Просрочка']
  ].map(function (c) {
    return '<button class="chip' + (f === c[0] ? ' active' : '') +
      '" data-filter="' + c[0] + '">' + c[1] + '</button>';
  }).join('');

  const cards = rows.length
    ? rows.map(renderOrderListItem).join('')
    : '<p class="muted">Заявок нет по этому фильтру.</p>';

  return '<div class="spread">' +
      '<h2>📋 Заявки</h2>' +
      '<button class="btn btn-primary" data-create-modal title="Новая заявка">➕</button>' +
    '</div>' +
    '<div class="chips">' + chips + '</div>' +
    '<div class="list">' + cards + '</div>';
}

// Карточка заявки в списке.
function renderOrderListItem(o) {
  const mine = isAssignedToMe(o);
  return '<div class="list-item' + (mine ? ' mine' : '') + '" data-order="' + o.id + '">' +
    '<div class="spread">' +
      '<b>№' + o.id + ' ' + escapeHtml(o.client) + '</b>' +
      '<span>' +
        (mine ? '<span class="badge badge-accent">👷 МОЯ</span> ' : '') +
        '<span class="' + statusBadgeClass(o.status) + '">' +
          (STATUS_LABELS[o.status] || o.status) + '</span>' +
      '</span>' +
    '</div>' +
    '<div class="small muted">' + o.date + ' ' + (o.t1 || '') + '-' + (o.t2 || '') +
      ' · ' + escapeHtml(o.city || '') + '</div>' +
  '</div>';
}

// --- 2. Карточка заявки (табы) ---

function renderOrderCard(id) {
  const o = (DB.orders || []).find(function (x) { return x.id === id; });
  if (!o) {
    return '<button class="btn" data-back>← Назад</button>' +
      '<div class="card"><p>Заявка не найдена.</p></div>';
  }
  if (!canViewOrder(o)) {
    return '<button class="btn" data-back>← Назад</button>' +
      '<div class="card"><p>Нет доступа к этой заявке.</p></div>';
  }

  const tabs = [
    ['main', 'Основное'], ['estimate', 'Смета'], ['money', 'Деньги'], ['journal', 'Журнал']
  ].map(function (t) {
    return '<button class="tab-btn' + (ORD_TAB === t[0] ? ' active' : '') +
      '" data-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');

  let body;
  if (ORD_TAB === 'estimate') body = renderOrderTabEstimate(o);
  else if (ORD_TAB === 'money') body = '<p class="muted">Оплаты и расчёты — Этап 10 (Отчёты).</p>';
  else if (ORD_TAB === 'journal') body = renderOrderTabJournal(o);
  else body = renderOrderTabMain(o);

  return '<div class="head-row">' +
      '<button class="btn" data-back>←</button>' +
      '<h2>Заявка №' + o.id + '</h2>' +
      (canEditOrder(o) ? '<button class="btn" data-edit-order="' + o.id + '" title="Редактировать">✎</button>' : '') +
    '</div>' +
    '<div class="tabs">' + tabs + '</div>' +
    body;
}

// Журнал (история) — читаем сразу, она простая.
function renderOrderTabJournal(o) {
  const rows = (o.history || []).slice().reverse().map(function (h) {
    const d = new Date(h.ts);
    const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    const when = p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    let text = h.action === 'status'
      ? 'Статус: ' + (STATUS_LABELS[h.from] || h.from) + ' → ' + (STATUS_LABELS[h.to] || h.to)
      : (h.details || h.action);
    if (h.reason) text += ' (' + escapeHtml(h.reason) + ')';
    return '<div class="est-row"><span>' + escapeHtml(text) +
      '</span><span class="small muted">' + when + ' · ' + escapeHtml(h.by || '') + '</span></div>';
  });
  return '<div class="card">' + (rows.join('') || '<p class="muted">Пусто.</p>') + '</div>';
}

// --- 3. Вкладка «Основное» ---

function renderOrderTabMain(o) {
  const editable = canEditOrder(o);
  const transitions = (editable ? (STATUS_TRANSITIONS[o.status] || []) : []);

  const statusBlock = '<div class="card info-block">' +
    '<h4>Статус</h4>' +
    '<div class="row">' +
      '<span class="' + statusBadgeClass(o.status) + '">' + (STATUS_LABELS[o.status] || o.status) + '</span>' +
      (transitions.length
        ? '<select data-status-select="' + o.id + '">' +
            '<option value="">Сменить статус…</option>' +
            transitions.map(function (s) {
              return '<option value="' + s + '">' + (STATUS_LABELS[s] || s) + '</option>';
            }).join('') +
          '</select>'
        : '<span class="small muted">Переходов нет</span>') +
    '</div>' +
  '</div>';

  return '<div class="card info-block">' +
      '<h4>Клиент</h4>' +
      '<div><b>' + escapeHtml(o.client) + '</b></div>' +
      '<div><a href="tel:' + escapeHtml(o.phone || '') + '">' + escapeHtml(o.phone || '—') + '</a></div>' +
      '<div class="muted">' + escapeHtml([o.city, o.address].filter(Boolean).join(', ')) + '</div>' +
    '</div>' +
    '<div class="card info-block">' +
      '<h4>Исполнители</h4>' +
      '<div>Основной: <b>' + escapeHtml(o.worker || '— не назначен —') + '</b></div>' +
      '<div class="muted">Соисполнители: ' +
        ((o.helpers && o.helpers.length) ? escapeHtml(o.helpers.join(', ')) : '—') + '</div>' +
    '</div>' +
    statusBlock;
}

// --- 4. Вкладка «Смета» ---

function renderOrderTabEstimate(o) {
  const rows = (o.works || []).map(function (w) {
    const sum = (Number(w.qty) || 0) * (Number(w.price) || 0);
    return '<div class="est-row' + (w.skipped ? ' done' : '') + '">' +
      '<span>' + escapeHtml(w.title) + '</span>' +
      '<span>' + w.qty + ' × ' + money(w.price) + ' = <b>' + money(sum) + '</b></span>' +
    '</div>';
  }).join('');

  return '<div class="card">' +
      (rows || '<p class="muted">Работ пока нет.</p>') +
      '<div class="est-total"><span>Итого:</span><span>' + money(calculateOrderTotal(o)) + '</span></div>' +
      '<button class="btn btn-block" data-add-work style="margin-top:10px">+ Добавить работу</button>' +
    '</div>';
}

// --- 5. Модалка создания заявки ---

function renderCreateOrderModal() {
  showModal(
    '<h3>Новая заявка</h3>' +
    '<label class="field"><span>Клиент *</span><input id="nc-client" type="text"></label>' +
    '<label class="field"><span>Телефон</span><input id="nc-phone" type="tel"></label>' +
    '<label class="field"><span>Адрес</span><input id="nc-address" type="text"></label>' +
    '<label class="field"><span>Дата</span><input id="nc-date" type="date" value="' + localToday() + '"></label>' +
    '<div class="row">' +
      '<label class="field" style="flex:1"><span>Время с</span><input id="nc-t1" type="time" value="09:00"></label>' +
      '<label class="field" style="flex:1"><span>Время до</span><input id="nc-t2" type="time" value="12:00"></label>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-order style="flex:1">Создать</button>' +
    '</div>'
  );
}

// --- Делегирование событий этого модуля ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  const createBtn = sel('[data-create-modal]');
  if (createBtn) { renderCreateOrderModal(); return; }

  const closeBtn = sel('[data-close]');
  if (closeBtn) { closeModal(); return; }

  const overlay = sel('[data-modal-overlay]');
  if (overlay && ev.target === overlay) { closeModal(); return; }

  const card = sel('[data-order]');
  if (card) { ORD_TAB = 'main'; go('order', Number(card.getAttribute('data-order'))); return; }

  const chip = sel('[data-filter]');
  if (chip) { state.filter = chip.getAttribute('data-filter'); render(); return; }

  const tab = sel('[data-tab]');
  if (tab) { ORD_TAB = tab.getAttribute('data-tab'); render(); return; }

  const addWork = sel('[data-add-work]');
  if (addWork) { alert('Добавление работ — этап 5'); return; }

  const editBtn = sel('[data-edit-order]');
  if (editBtn) { toast('Редактирование заявки — этап 5'); return; }

  const saveBtn = sel('[data-save-order]');
  if (saveBtn) {
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const client = val('nc-client');
    if (!client) { toast('Укажите клиента', true); return; }
    createOrder({
      client: client,
      phone: val('nc-phone'),
      address: val('nc-address'),
      date: val('nc-date') || localToday(),
      t1: val('nc-t1'),
      t2: val('nc-t2')
    });
    closeModal();
    state.filter = 'all';
    go('orders');
    return;
  }
});

// Смена статуса — событие change (не click).
document.addEventListener('change', function (ev) {
  const select = ev.target.closest && ev.target.closest('[data-status-select]');
  if (!select) return;
  const id = Number(select.getAttribute('data-status-select'));
  const ns = select.value;
  if (!ns) return;
  if (transitionOrder(id, ns)) {
    toast('Статус: ' + (STATUS_LABELS[ns] || ns));
    render();
  } else {
    toast('Переход не разрешён', true);
  }
});
