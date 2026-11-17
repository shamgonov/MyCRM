/* CRM2 :: app/ui-attention.js — экран «Требует внимания» и «Итог звонка» (Этап 19).
   Собирает заявки по пяти признакам плюс перезвон, даёт 6 веток итога звонка.
   Зависит от db.js, auth.js, gates.js, orders.js, core.js. */
'use strict';

// Ветки итога звонка: код → [подпись, что делать].
const CALL_BRANCHES = [
  ['no_answer',       '📞 Не дозвонился'],
  ['later_1h',        '🔄 Перезвонить через 1 час'],
  ['later_2h',        '🔄 Перезвонить через 2 часа'],
  ['later_4h',        '🔄 Перезвонить через 4 часа'],
  ['later_24h',       '🔄 Перезвонить через 24 часа'],
  ['later_tomorrow',  '🔄 Перезвонить завтра'],
  ['later_custom',    '📅 Выбрать дату и время'],
  ['inspection',      '🔍 Договорились об осмотре'],
  ['approved',        '✅ Согласована смета'],
  ['postponed',       '⏸ Отложено'],
  ['canceled',        '❌ Отказ']
];

// Через сколько часов перезвонить по веткам (без «завтра» и «выбрать дату»).
const CALLBACK_HOURS = { no_answer: 2, later_1h: 1, later_2h: 2, later_4h: 4, later_24h: 24 };

// Timestamp завтрашнего дня в 09:00 по локальному времени.
function tomorrowAt9() {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

// Заявка «требует внимания по звонку»: время наступило, статус ещё рабочий.
function isCallbackDue(o, now) {
  if (!o || !o.callbackAt) return false;
  if (Number(now || Date.now()) < Number(o.callbackAt)) return false;
  return o.status === 'new' || o.status === 'inspection';
}

// --- 1. Группы признака «требует внимания» ---

// attentionGroups(): только видимые мне заявки (гейты не обходятся).
// Каждая строка группы — { o, note } или { o, note, ... }.
function attentionGroups() {
  const now = Date.now();
  const today = localToday();
  const g = {
    callback: [], overdue: [], noWorker: [], balance: [], materials: [], confirm: []
  };
  (DB.orders || []).forEach(function (o) {
    if (typeof canViewOrder === 'function' && !canViewOrder(o)) return;
    const closed = o.status === 'completed' || o.status === 'paid' || o.status === 'canceled';

    if (isCallbackDue(o, now)) g.callback.push({ o: o, note: 'нужен перезвон' });

    if (!closed && o.date && o.date < today) {
      g.overdue.push({ o: o, note: 'просрочена дата: ' + o.date });
    }

    if (!o.worker && (o.status === 'new' || o.status === 'inspection' || o.status === 'approved')) {
      g.noWorker.push({ o: o, note: 'исполнитель не назначен' });
    }

    if (o.status === 'completed' && typeof orderBalance === 'function' && orderBalance(o) > 0) {
      g.balance.push({ o: o, note: 'остаток ' + money(orderBalance(o)) });
    }

    if (!closed) {
      const needed = (o.materials || []).filter(function (m) { return m.status === 'needed'; });
      if (needed.length) {
        g.materials.push({ o: o, note: needed.length + ' поз. к закупке' });
      }
    }

    const pending = (o.helpers || []).filter(function (h) {
      return o.confirm && o.confirm[h] === 'pending';
    });
    if (pending.length) {
      g.confirm.push({ o: o, note: pending.join(', ') + ' — ждёт подтверждения' });
    }
  });
  return g;
}

// Блок-карточка: заголовок + строки заявок с переходом в карточку.
function renderAttentionBlock(title, items) {
  const rows = items.map(function (it) {
    const o = it.o;
    return '<div class="list-item" data-attention-order="' + o.id + '">' +
      '<div class="spread">' +
        '<b>№' + orderDisplayNumber(o) + ' ' + escapeHtml(o.client || '—') + '</b>' +
        '<span class="' + statusBadgeClass(o.status) + '">' +
          (STATUS_LABELS[o.status] || o.status) + '</span>' +
      '</div>' +
      '<div class="small muted">' + o.date + ' ' + (o.t1 || '') + '-' + (o.t2 || '') +
        ' · ' + escapeHtml(it.note || '') + '</div>' +
    '</div>';
  }).join('');

  return '<div class="card">' +
      '<h4>' + title + ' <span class="muted small">' + items.length + '</span></h4>' +
      (rows || '<p class="small muted">Таких заявок нет.</p>') +
    '</div>';
}

// --- 2. Главный экран «Требует внимания» ---

function renderAttention() {
  const g = attentionGroups();
  const blocks = [
    ['📞 Нужен перезвон', g.callback],
    ['⚠️ Просрочено', g.overdue],
    ['👷 Без исполнителя', g.noWorker],
    ['💰 Остаток к оплате', g.balance],
    ['🧱 Материалы к закупке', g.materials],
    ['❓ Ждёт подтверждения', g.confirm]
  ].filter(function (b) { return b[1].length; })
   .map(function (b) { return renderAttentionBlock(b[0], b[1]); });

  const total = blocks.length ? g.callback.length + g.overdue.length + g.noWorker.length +
    g.balance.length + g.materials.length + g.confirm.length : 0;

  return '<h2>⚠️ Требует внимания</h2>' +
    (blocks.length
      ? '<p class="small muted">Всего позиций: ' + total + '</p>' + blocks.join('')
      : '<div class="card"><p class="muted">Всё под контролем — заявок, требующих внимания, нет.</p></div>');
}

// --- 3. Итог звонка: модалка и доменная ветка ---

function renderCallResultModal(o) {
  if (!o) return;
  const buttons = CALL_BRANCHES.map(function (b) {
    return '<button class="btn btn-block" data-call-result="' + b[0] + '" style="margin-top:6px">' +
      b[1] + '</button>';
  }).join('');

  showModal(
    '<h3>📞 Итог звонка: №' + orderDisplayNumber(o) + '</h3>' +
    '<p class="small muted">' + escapeHtml(o.client || '') + ' · ' +
      escapeHtml(o.phone || '—') + '</p>' +
    '<p class="small muted">Выберите результат — он попадёт в журнал заявки.</p>' +
    buttons +
    '<button class="btn" data-close style="margin-top:10px">Отмена</button>'
  );
}

// Модалка ручного выбора даты/времени перезвона (ветка 'later_custom').
function renderCustomCallbackModal(o) {
  var today = localToday();
  showModal(
    '<h3>📅 Перезвонить: №' + orderDisplayNumber(o) + '</h3>' +
    '<label class="field"><span>Дата *</span>' +
      '<input id="cc-date" type="date" value="' + today + '" min="' + today + '"></label>' +
    '<label class="field"><span>Время *</span>' +
      '<input id="cc-time" type="time" value="09:00"></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-callback="' + o.id + '" style="flex:1">Установить</button>' +
    '</div>'
  );
}

// applyCallResult(o, branch): одна запись в историю + действие ветки.
// Возвращает { ok, text } — text идёт в toast.
function applyCallResult(o, branch) {
  if (!o) return { ok: false, text: 'Нет заявки' };
  var known = CALL_BRANCHES.some(function (b) { return b[0] === branch; });
  if (!known) return { ok: false, text: 'Неизвестная ветка' };

  normalizeOrder(o);

  // Ветка «завтра»: callbackAt = завтра 09:00, статус не меняется.
  if (branch === 'later_tomorrow') {
    o.callbackAt = tomorrowAt9();
    o.history.push({
      ts: Date.now(), by: state.user, action: 'call_result',
      details: '🔄 Перезвонить завтра (09:00)'
    });
    saveOrderLocal(o);
    return { ok: true, text: 'Перезвон завтра в 09:00' };
  }

  // Ветка «выбрать дату/время»: открываем модалку, не трогаем callbackAt.
  if (branch === 'later_custom') {
    renderCustomCallbackModal(o);
    return { ok: true, text: '' }; // пустой текст — toast не показываем
  }

  // Ветки перезвона по часам: ставим callbackAt, статус не меняем.
  if (CALLBACK_HOURS[branch]) {
    var hours = CALLBACK_HOURS[branch];
    var cbLabel = (CALL_BRANCHES.filter(function (b) { return b[0] === branch; })[0] || [])[1] || branch;
    o.callbackAt = Date.now() + hours * 3600000;
    o.history.push({
      ts: Date.now(), by: state.user, action: 'call_result',
      details: cbLabel + ' — перезвон через ' + hours + ' ч.'
    });
    saveOrderLocal(o);
    return { ok: true, text: 'Перезвон через ' + hours + ' ч.' };
  }

  var label = (CALL_BRANCHES.filter(function (b) { return b[0] === branch; })[0] || [])[1] || branch;

  // Остальные ветки: звонок состоялся, назначенный перезвон больше не нужен.
  o.callbackAt = null;

  // Отказ: переход + причина.
  if (branch === 'canceled') {
    o.history.push({
      ts: Date.now(), by: state.user, action: 'call_result', details: label
    });
    saveOrderLocal(o);
    const moved = transitionOrder(o.id, 'canceled', 'Отказ клиента');
    return { ok: moved, text: moved ? 'Заявка отменена' : 'Переход в «Отменена» не разрешён' };
  }

  // Остальные ветки — смена статуса.
  const to = branch;
  o.history.push({
    ts: Date.now(), by: state.user, action: 'call_result', details: label
  });
  saveOrderLocal(o);
  const moved = transitionOrder(o.id, to);
  return {
    ok: moved,
    text: moved
      ? 'Статус: ' + (STATUS_LABELS[to] || to)
      : 'Переход в «' + (STATUS_LABELS[to] || to) + '» не разрешён'
  };
}

// --- 4. Делегирование кликов ---

function delegateClicks() {
  document.addEventListener('click', function (ev) {
    const sel = function (s) { return ev.target.closest(s); };

    // Переход в карточку заявки с экрана «Требует внимания».
    const att = sel('[data-attention-order]');
    if (att) {
      const id = Number(att.getAttribute('data-attention-order'));
      if (typeof ORD_TAB !== 'undefined') ORD_TAB = 'main';
      go('order', id);
      return;
    }

    // Сохранение выбранной даты/времени перезвона (модалка later_custom).
    const saveCbBtn = sel('[data-save-callback]');
    if (saveCbBtn) {
      const cid = Number(saveCbBtn.getAttribute('data-save-callback'));
      const co = (DB.orders || []).find(function (x) { return x.id === cid; });
      if (!co) { closeModal(); return; }
      const dateEl = document.getElementById('cc-date');
      const timeEl = document.getElementById('cc-time');
      const date = dateEl ? dateEl.value : '';
      const time = timeEl ? timeEl.value : '';
      if (!date || !time) { toast('Укажите дату и время', true); return; }
      const parts = date.split('-');
      const tparts = time.split(':');
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]),
                         Number(tparts[0]), Number(tparts[1]), 0, 0);
      const ts = d.getTime();
      if (ts <= Date.now()) { toast('Время уже прошло', true); return; }
      normalizeOrder(co);
      co.callbackAt = ts;
      co.history.push({
        ts: Date.now(), by: state.user, action: 'call_result',
        details: '📅 Перезвон ' + date + ' в ' + time
      });
      saveOrderLocal(co);
      closeModal();
      toast('Перезвон: ' + date + ' ' + time);
      render();
      return;
    }

    // Ветка итога звонка. Значение 'start' — кнопка открытия модалки в
    // карточке заявки, её обрабатывает ui-orders.js.
    const call = sel('[data-call-result]');
    if (call) {
      const branch = call.getAttribute('data-call-result');
      if (branch === 'start') return;
      const o = (DB.orders || []).find(function (x) { return x.id === state.orderId; });
      if (!o) { toast('Нет открытой заявки', true); return; }
      const res = applyCallResult(o, call.getAttribute('data-call-result'));
      // Ветка 'later_custom' сама открыла модалку выбора даты — не закрываем
      // её и не показываем toast (res.text пустой).
      if (!res.text) return;
      closeModal();
      toast(res.text, !res.ok);
      render();
      return;
    }
  });
}

delegateClicks();

// Явный экспорт в window: экран и модалка вызываются из core.js / ui-orders.js.
window.renderAttention = renderAttention;
window.renderCallResultModal = renderCallResultModal;
window.renderCustomCallbackModal = renderCustomCallbackModal;
window.applyCallResult = applyCallResult;
window.attentionGroups = attentionGroups;
window.tomorrowAt9 = tomorrowAt9;
