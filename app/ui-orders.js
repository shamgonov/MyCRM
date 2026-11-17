/* CRM2 :: app/ui-orders.js — список заявок, карточка с табами, создание заявки.
   Зависит: db.js, auth.js, gates.js, orders.js, core.js (go/render/showModal/toast). */
'use strict';

// Русские названия статусов + цвет бейджа.
const STATUS_LABELS = {
  new: 'Новая', inspection: 'Осмотр', estimate: 'Смета', approved: 'Согласована',
  inwork: 'В работе', paused: 'Пауза', waiting: 'Ожидание', postponed: 'Отложена',
  transfer: '📅 Перенос',
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

// --- Фильтры списка: [Все][🤝 Пул][Сегодня][👷 Мои][⚠️ Просрочка] + 🏷️ тег ---

function orderPassesFilter(o, f) {
  if (f === 'today') return o.date === localToday();
  if (f === 'mine') return isAssignedToMe(o);
  if (f === 'pool') return isPoolOrder(o) && !hiddenTakeFromMe(o);
  if (f === 'overdue') {
    return o.date < localToday() &&
      o.status !== 'completed' && o.status !== 'paid' && o.status !== 'canceled';
  }
  if (f && f.indexOf('tag:') === 0) {
    const tag = f.slice(4);
    return Array.isArray(o.tags) && o.tags.indexOf(tag) >= 0;
  }
  return true; // 'all'
}

// Все теги для фильтра: пресеты настроек + уникальные теги заявок (Этап 17).
function allOrderTags() {
  const seen = {};
  const out = [];
  const add = function (t) {
    t = String(t || '').trim();
    if (!t || seen[t]) return;
    seen[t] = true;
    out.push(t);
  };
  ((DB.settings && DB.settings.tagPresets) || []).forEach(add);
  (DB.orders || []).forEach(function (o) { (o.tags || []).forEach(add); });
  return out;
}

// --- 0. Свёрнутый/развёрнутый вид карточек (Этап 28) ---

var EXPANDED_ORDERS = {}; // { [id]: true } — развёрнутые карточки

// --- 0.1 Таймер обратного отсчёта (Микро-этап) ---
// Точечное обновление DOM: рендер отдаёт плейсхолдер с data-target, а
// updateAllCountdowns() в core.js меняет только текст/класс по data-атрибутам.
// НИКАКОГО render() из таймера.

// Статусы, для которых обратный отсчёт до визита не показываем.
var COUNTDOWN_TERMINAL = ['completed', 'paid', 'canceled'];

// Epoch-миллисекунды начала визита (date + t1) или null, если данных нет.
function visitStartTs(o) {
  if (!o || !o.date || !o.t1) return null;
  var d = new Date(o.date + 'T' + o.t1);
  var ts = d.getTime();
  return isNaN(ts) ? null : ts;
}

// Обратный отсчёт «уже просрочено» (diff <= 0) — отдельный вид.
function isCountdownOverdue(o) {
  if (!o) return false;
  if (o.callbackAt) return Number(o.callbackAt) <= Date.now();
  var v = visitStartTs(o);
  if (v === null) return false;
  if (COUNTDOWN_TERMINAL.indexOf(o.status) >= 0) return false;
  return v <= Date.now();
}

// Человекочитаемый остаток времени: "3 д. 4 ч." / "2 ч. 5 мин." / "12 мин.".
function formatCountdown(ms) {
  var total = Math.max(0, Math.floor(ms / 60000)); // минуты
  var days = Math.floor(total / 1440);
  var hours = Math.floor((total % 1440) / 60);
  var mins = total % 60;
  if (days > 0) return days + ' д. ' + hours + ' ч.';
  if (hours > 0) return hours + ' ч. ' + mins + ' мин.';
  return mins + ' мин.';
}

// Класс цвета по остатку: >24ч — ok, >2ч — warn, иначе danger.
function countdownVariantClass(ms) {
  if (ms <= 0) return 'countdown-overdue';
  if (ms > 24 * 3600000) return 'countdown-ok';
  if (ms > 2 * 3600000) return 'countdown-warn';
  return 'countdown-danger';
}

// Текст бейджа обратного отсчёта по типу и остатку.
function countdownLabel(type, ms) {
  if (ms <= 0) return type === 'callback' ? '🔴 Перезвон просрочен' : '🔴 Визит просрочен';
  var word = type === 'callback' ? 'до перезвона' : 'до визита';
  return '⏳ ' + word + ': ' + formatCountdown(ms);
}

// Плейсхолдер таймера для карточки/списка. Приоритет: callbackAt > визит.
// Текст и класс считаются сразу, чтобы не ждать первого тика интервала.
function renderCountdownBadge(o) {
  if (!o) return '';
  var target = null;
  var type = '';
  if (o.callbackAt && Number(o.callbackAt) > 0) {
    target = Number(o.callbackAt);
    type = 'callback';
  } else if (COUNTDOWN_TERMINAL.indexOf(o.status) < 0) {
    var v = visitStartTs(o);
    if (v !== null) { target = v; type = 'visit'; }
  }
  if (target === null) return '';
  var diff = target - Date.now();
  return '<span id="cd-' + type + '-' + o.id + '" class="countdown-timer ' +
    countdownVariantClass(diff) + '" data-target="' + target + '" data-type="' + type + '">' +
    countdownLabel(type, diff) + '</span>';
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
    ['all', 'Все'], ['pool', '🤝 Пул'], ['today', 'Сегодня'],
    ['mine', '👷 Мои'], ['overdue', '⚠️ Просрочка']
  ].map(function (c) {
    return '<button class="chip' + (f === c[0] ? ' active' : '') +
      '" data-filter="' + c[0] + '">' + c[1] + '</button>';
  }).join('');

  // Фильтр по тегу (Этап 17): пресеты + теги заявок; значение — 'tag:Тег'.
  const tagVal = (f && f.indexOf('tag:') === 0) ? f.slice(4) : '';
  const tagOptions = allOrderTags().map(function (t) {
    return '<option value="' + escapeHtml(t) + '"' + (t === tagVal ? ' selected' : '') +
      '>' + escapeHtml(t) + '</option>';
  }).join('');
  const tagFilter = '<label class="field" style="margin:6px 0 0"><span>🏷️ По тегу</span>' +
    '<select data-tag-filter><option value="">— все теги —</option>' + tagOptions + '</select></label>';

  const cards = rows.length
    ? rows.map(renderOrderListItem).join('')
    : '<p class="muted">Заявок нет по этому фильтру.</p>';

  // Баннер напоминаний (Этап 9) живёт в notify.js — он грузится позже этого
  // модуля, поэтому ленивый вызов: без notify.js список работает как раньше.
  const bar = (typeof renderNotificationsBar === 'function') ? renderNotificationsBar() : '';

  return '<div class="spread">' +
      '<h2>📋 Заявки</h2>' +
      '<button class="btn btn-primary" data-create-modal title="Новая заявка">➕</button>' +
    '</div>' +
    bar +
    '<div class="chips">' + chips + '</div>' +
    tagFilter +
    '<div class="list">' + cards + '</div>';
}

// Карточка заявки в списке: свёрнута по умолчанию, разворачивается по клику.
function renderOrderListItem(o) {
  if (EXPANDED_ORDERS[o.id]) return renderOrderListItemExpanded(o);
  return renderOrderListItemCollapsed(o);
}

// Свёрнутый обзор: клиент, дата/время, статус, исполнитель, бейджи, кнопка «Взять».
function renderOrderListItemCollapsed(o) {
  const mine = isAssignedToMe(o);
  const pending = isMyPendingConfirm(o);
  const badges = (typeof renderOrderBadges === 'function') ? renderOrderBadges(o) : '';
  const worker = o.worker ? escapeHtml(o.worker) : '<span class="muted">не назначен</span>';
  var extra = '';
  if (pending) {
    extra += '<span class="badge badge-warn">❓ Подтвердить</span> ';
  }
  if (mine) {
    extra += '<span class="badge badge-accent">👷 МОЯ</span> ';
  }
  if (showTakeBtn(o)) {
    extra += takeButton(o);
  }
  return '<div class="list-item' + (mine ? ' mine' : '') + ' order-card-collapsed' +
    '" data-order="' + o.id + '" data-expand-order="' + o.id + '">' +
    '<div class="spread">' +
      '<b>№' + escapeHtml(orderDisplayNumber(o)) + ' ' + escapeHtml(o.client || '—') + '</b>' +
      '<span>' + extra +
        '<span class="' + statusBadgeClass(o.status) + '">' +
          escapeHtml(STATUS_LABELS[o.status] || o.status) + '</span>' +
      '</span>' +
    '</div>' +
    '<div class="small muted">' + escapeHtml(o.date || '—') + ' ' +
      escapeHtml(o.t1 || '') + '-' + escapeHtml(o.t2 || '') +
      ' · 👷 ' + worker + '</div>' +
    (typeof renderCountdownBadge === 'function' ? renderCountdownBadge(o) : '') +
    (badges ? '<div class="small" style="margin-top:4px">' + badges + '</div>' : '') +
  '</div>';
}

// Развёрнутый вид: всё из свёрнутого + телефон, адрес, кнопки действий.
function renderOrderListItemExpanded(o) {
  const mine = isAssignedToMe(o);
  const badges = (typeof renderOrderBadges === 'function') ? renderOrderBadges(o) : '';
  const worker = o.worker ? escapeHtml(o.worker) : '<span class="muted">не назначен</span>';
  const address = [o.city, o.address].filter(Boolean).join(', ');
  return '<div class="list-item' + (mine ? ' mine' : '') + ' order-card-expanded' +
    '" data-order="' + o.id + '">' +
    '<div class="spread">' +
      '<b>№' + escapeHtml(orderDisplayNumber(o)) + ' ' + escapeHtml(o.client || '—') + '</b>' +
      '<span class="' + statusBadgeClass(o.status) + '">' +
        escapeHtml(STATUS_LABELS[o.status] || o.status) + '</span>' +
    '</div>' +
    '<div class="small muted">📅 ' + escapeHtml(o.date || '—') + ' ' +
      escapeHtml(o.t1 || '') + '-' + escapeHtml(o.t2 || '') + '</div>' +
    (typeof renderCountdownBadge === 'function' ? renderCountdownBadge(o) : '') +
    '<div class="small">👷 ' + worker + '</div>' +
    (o.phone ? '<div class="small">📞 <a href="tel:' + escapeHtml(o.phone) + '">' +
      escapeHtml(o.phone) + '</a></div>' : '') +
    (address ? '<div class="small">📍 ' + escapeHtml(address) + '</div>' : '') +
    (badges ? '<div class="small" style="margin-top:4px">' + badges + '</div>' : '') +
    '<div class="row" style="margin-top:8px;gap:6px">' +
      '<button class="btn" data-collapse-order="' + o.id + '" style="flex:1">🔼 Свернуть</button>' +
      '<button class="btn btn-primary" data-open-order="' + o.id + '" style="flex:1">📖 Открыть</button>' +
    '</div>' +
  '</div>';
}

// Ожидаю ли я подтвердить участие в этой заявке (Этап 14).
function isMyPendingConfirm(o) {
  if (!o || !o.confirm) return false;
  return o.confirm[state.user] === 'pending';
}

function takeButton(o) {
  return '<button class="btn btn-primary" data-take-order="' + o.id + '">✋ Взять в работу</button>';
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
    ['main', 'Основное'], ['estimate', 'Смета'], ['materials', 'Материалы'],
    ['docs', 'Документы'], ['money', 'Деньги'], ['journal', 'Журнал']
  ].map(function (t) {
    return '<button class="tab-btn' + (ORD_TAB === t[0] ? ' active' : '') +
      '" data-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');

  let body;
  if (ORD_TAB === 'estimate') body = renderEstimateTab(o);
  else if (ORD_TAB === 'materials') body = renderShoppingTab(o);
  else if (ORD_TAB === 'docs') body = (typeof renderDocsTab === 'function') ? renderDocsTab(o) : '<p class="muted">Модуль документов не загружен.</p>';
  else if (ORD_TAB === 'money') body = (typeof renderMoneyTab === 'function') ? renderMoneyTab(o) : '<p class="muted">Модуль денег не загружен.</p>';
  else if (ORD_TAB === 'journal') body = renderOrderTabJournal(o);
  else body = renderOrderTabMain(o);

  return '<div class="head-row">' +
      '<button class="btn" data-back>←</button>' +
      '<h2>Заявка №' + o.id + '</h2>' +
      // 🔢 Калькулятор (Этап 20): ui-calc.js может не загрузиться — ленивый вызов.
      (typeof renderCalcButton === 'function' ? renderCalcButton() : '') +
      (canEditOrder(o) ? '<button class="btn" data-edit-order="' + o.id + '" title="Редактировать">✎</button>' : '') +
    '</div>' +
    '<div class="tabs order-tabs-scroll">' + tabs + '</div>' +
    body;
}

// Журнал (история) — читаем сразу, она простая.
function renderOrderTabJournal(o) {
  // Этап 28: полная хронология действий — сортировка от новых к старым,
  // иконка по типу события, автор и время.
  const ICONS = {
    status: '🔄', take: '✋', assign_worker: '👷', assign_helper: '👷',
    confirm_helper: '🤝', release_pool: '🤝', call_result: '📞', transfer: '📅',
    followup: '🔁', inherit: '🧬', payment: '💳', tag: '🏷', create: '➕'
  };
  const rows = (o.history || []).slice().sort(function (a, b) {
    return (Number(b.ts) || 0) - (Number(a.ts) || 0);
  }).map(function (h) {
    const d = new Date(Number(h.ts) || 0);
    const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    const when = p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + ' ' +
      p2(d.getHours()) + ':' + p2(d.getMinutes());
    let text = h.action === 'status'
      ? 'Статус: ' + (STATUS_LABELS[h.from] || h.from) + ' → ' + (STATUS_LABELS[h.to] || h.to)
      : (h.details || h.action);
    if (h.reason) text += ' (' + h.reason + ')';
    const icon = ICONS[h.action] || '•';
    return '<div class="est-row"><span>' + icon + ' ' + escapeHtml(text) +
      '</span><span class="small muted">' + when + ' · ' + escapeHtml(h.by || '') + '</span></div>';
  });
  return '<div class="card">' +
    '<h4>Хронология заявки</h4>' +
    (rows.join('') || '<p class="muted">История пуста.</p>') +
  '</div>';
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
    (typeof renderCountdownBadge === 'function' ? renderCountdownBadge(o) : '') +
  '</div>';

  return '<div class="card info-block">' +
      '<h4>Клиент</h4>' +
      '<div><b>' + escapeHtml(o.client) + '</b></div>' +
      '<div><a href="tel:' + escapeHtml(o.phone || '') + '">' + escapeHtml(o.phone || '—') + '</a></div>' +
      '<div class="muted">' + escapeHtml([o.city, o.address].filter(Boolean).join(', ')) + '</div>' +
      // Бейджи звонка/тегов (Этап 27) — под заголовком клиента, над блоком тегов.
      renderOrderBadges(o) +
    '</div>' +
    (editable && (o.status === 'new' || o.status === 'inspection')
      ? '<div class="card" style="margin-top:8px">' +
          '<button class="btn btn-block" data-call-result="start">' +
            '📞 Итог звонка</button>' +
        '</div>'
      : '') +
    // Перенос на другое время (Этап 28): из любого рабочего статуса.
    (editable && o.status !== 'completed' && o.status !== 'paid' &&
      o.status !== 'canceled' && o.status !== 'transfer'
      ? '<div class="card" style="margin-top:8px">' +
          '<button class="btn btn-block" data-transfer-order="' + o.id + '">' +
            '📅 Перенести</button>' +
        '</div>'
      : '') +
    renderOrderTagsBlock(o, editable) +
    renderOrderRouteBlock(o, editable) +
    renderOrderTeamBlock(o, editable) +
    // Задачи заявки (Этап 20): ui-tasks.js может не загрузиться — ленивый вызов.
    (typeof renderOrderTasksBlock === 'function' ? renderOrderTasksBlock(o) : '') +
    statusBlock +
    renderFollowUpBlock(o, editable);
}

// Блок «Маршрут закупки» (Этап 18): точки (поставщики/склад) с «игнорировать»
// и кнопки навигаторов — обычные веб-URL, без библиотек карт.
function renderOrderRouteBlock(o, editable) {
  const points = buildPurchaseRoute(o, o.routeIgnored);
  if (!points.length) return '';

  const navBtns = function (addr) {
    if (!addr) return '';
    // Обычные веб-ссылки карт: target="_blank" открывает навигатор без JS.
    return '<span class="row" style="gap:4px">' +
      '<a class="btn" href="' + navigatorUrl('2gis', addr) +
        '" target="_blank" rel="noopener">2ГИС</a>' +
      '<a class="btn" href="' + navigatorUrl('yandex', addr) +
        '" target="_blank" rel="noopener">Яндекс</a>' +
      '<a class="btn" href="' + navigatorUrl('google', addr) +
        '" target="_blank" rel="noopener">Google</a>' +
      '</span>';
  };

  const rows = points.map(function (p) {
    const cb = editable
      ? '<label class="small"><input type="checkbox" data-route-ignore="' + escapeHtml(p.key) + '"' +
          (p.ignored ? ' checked' : '') + '> игнорировать</label>'
      : (p.ignored ? '<span class="small muted">игнорируется</span>' : '');
    return '<div class="est-row"><span><b>' + escapeHtml(p.title) + '</b>' +
        (p.address ? '<div class="small muted">' + escapeHtml(p.address) + '</div>' : '') +
        (p.phone ? '<div class="small">' + escapeHtml(p.phone) + '</div>' : '') +
        '</span>' +
      '<span class="row" style="gap:6px">' + navBtns(p.address) + cb + '</span>' +
    '</div>';
  }).join('');

  return '<div class="card info-block">' +
      '<h4>📍 Маршрут закупки</h4>' + rows +
      '<p class="small muted">Навигатор откроется в новой вкладке по адресу точки.</p>' +
    '</div>';
}

// --- Бейджи заявки: последний итог звонка + теги (Этап 27) ---

// callResultBadgeVariant(details): цвет бейджа по смыслу итога звонка.
// «не дозвонился» / «перезвон(ить)» → warn, «отказ» → danger, иначе → accent.
function callResultBadgeVariant(details) {
  const d = String(details || '').toLowerCase();
  if (d.indexOf('не дозвонился') >= 0 || d.indexOf('перезвон') >= 0) return 'var(--warn)';
  if (d.indexOf('отказ') >= 0) return 'var(--danger)';
  return 'var(--accent)';
}

// stripLeadingEmoji(txt): убирает префикс-эмодзи (всё до первой буквы).
// Простой срез по индексу безопасен для суррогатных пар в ES2017.
function stripLeadingEmoji(txt) {
  const s = String(txt || '');
  const m = s.match(/[A-Za-zА-Яа-яЁё]/);
  return m ? s.slice(m.index) : s;
}

// renderOrderBadges(o): HTML-строка бейджей ('' если показывать нечего).
function renderOrderBadges(o) {
  if (!o) return '';
  const parts = [];

  const hist = o.history || [];
  let lastCall = null;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i] && hist[i].action === 'call_result') { lastCall = hist[i]; break; }
  }
  if (lastCall) {
    parts.push('<span class="badge" style="background:' + callResultBadgeVariant(lastCall.details) +
      ';border-color:transparent;color:var(--accent-ink);margin-right:4px">📞 ' +
      escapeHtml(stripLeadingEmoji(lastCall.details)) + '</span>');
  }

  (o.tags || []).forEach(function (t) {
    parts.push('<span class="badge" style="background:var(--accent-soft);color:var(--accent);margin-right:4px">' +
      escapeHtml(t) + '</span>');
  });

  return parts.length ? '<div style="margin-top:6px">' + parts.join('') + '</div>' : '';
}

// Блок тегов проблемы (Этап 17): чипы с крестиком + пресет + произвольный тег.
function renderOrderTagsBlock(o, editable) {
  normalizeOrder(o);
  const chips = o.tags.length
    ? o.tags.map(function (t) {
        return '<span class="badge">' + escapeHtml(t) +
          (editable ? ' <b data-remove-tag="' + escapeHtml(t) + '" style="cursor:pointer">✕</b>' : '') +
          '</span>';
      }).join(' ')
    : '<span class="muted small">Тегов нет</span>';

  const presets = ((DB.settings && DB.settings.tagPresets) || []).map(function (t) {
    return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>';
  }).join('');

  const actions = editable
    ? '<div class="row" style="margin-top:8px;gap:6px">' +
        '<select data-add-tag-preset style="flex:1">' +
          '<option value="">🏷️ Пресет…</option>' + presets +
        '</select>' +
        '<input id="tag-custom" type="text" placeholder="свой тег" style="flex:1">' +
        '<button class="btn" data-add-tag-custom>＋</button>' +
      '</div>'
    : '';

  return '<div class="card info-block">' +
      '<h4>Теги</h4>' +
      '<div class="chips">' + chips + '</div>' +
      actions +
    '</div>';
}

// Блок переноса остатка (Этап 15): связи родитель/дети + кнопка новой заявки.
function renderFollowUpBlock(o, editable) {
  const kids = (o.followUpIds || []).length;
  const parent = o.parentId;
  if (!editable && !kids && !parent) return '';

  let links = '';
  if (parent) {
    const parentOrder = (DB.orders || []).find(function (x) { return x.id === parent; });
    const pNum = (typeof orderDisplayNumber === 'function' && parentOrder)
      ? orderDisplayNumber(parentOrder) : parent;
    links += '<div>Родитель: <b><span data-order="' + parent + '" style="color:var(--accent);cursor:pointer">№' +
      pNum + '</span></b></div>';
  }
  if (kids) {
    links += '<div class="muted">Дочерние: ' + (o.followUpIds || []).map(function (id) {
      const child = (DB.orders || []).find(function (x) { return x.id === id; });
      const num = (typeof orderDisplayNumber === 'function' && child) ? orderDisplayNumber(child) : id;
      return '<span data-order="' + id + '" style="color:var(--accent);cursor:pointer">№' + num + '</span>';
    }).join(', ') + '</div>';
  }

  // Перенос остатка доступен отложенной заявке (инструктаж клиента/пауза работ).
  const btn = (editable && o.status === 'postponed')
    ? '<button class="btn" data-followup="' + o.id + '" style="margin-top:8px">🔄 Перенести остаток</button>'
    : '';

  return '<div class="card info-block">' +
      '<h4>Перенос остатка</h4>' +
      (links || '<p class="small muted">Связанных заявок нет.</p>') +
      '<p class="small muted">Работы «в работе» и материалы «нужно купить» уйдут в новую заявку.</p>' +
      btn +
    '</div>';
}

// Подпись статуса подтверждения соисполнителя.
const CONFIRM_LABELS = {
  pending: ['⏳ ждёт подтверждения', 'badge-warn'],
  ok: ['✅ подтвердил', 'badge-ok'],
  no: ['✖ отказался', 'badge-danger']
};

// Блок «Исполнители»: взятие из пула, подтверждение соисполнителя, приглашение.
function renderOrderTeamBlock(o, editable) {
  const rows = (o.helpers || []).map(function (h) {
    const st = (o.confirm && o.confirm[h]) || 'ok';
    const label = CONFIRM_LABELS[st] || CONFIRM_LABELS.ok;
    return '<div class="est-row"><span>' + escapeHtml(h) + '</span>' +
      '<span class="badge ' + label[1] + '">' + label[0] + '</span></div>';
  });

  let actions = '';
  if (showTakeBtn(o)) actions += takeButton(o);
  if (isMyPendingConfirm(o)) {
    actions += '<div class="row" style="margin-top:8px">' +
      '<button class="btn btn-primary" data-confirm-helper="' + o.id + '|ok" style="flex:1">✅ Принять</button>' +
      '<button class="btn btn-danger" data-confirm-helper="' + o.id + '|no" style="flex:1">Отказаться</button>' +
    '</div>';
  }
  if (editable && can('order_assign')) {
    actions += '<button class="btn" data-add-helper="' + o.id + '" style="margin-top:8px">＋ Соисполнитель</button>';
  }
  // Отдать в пул: снять назначенного исполнителя с незакрытой заявки.
  if (o.worker && editable && canReleaseToPool(o)) {
    actions += '<button class="btn" data-release-pool="' + o.id + '" style="margin-top:8px">🤝 Отдать в пул</button>';
  }
  // Назначение / смена основного исполнителя.
  if (editable && can('order_assign') &&
      o.status !== 'completed' && o.status !== 'paid' && o.status !== 'canceled') {
    actions += '<button class="btn" data-assign-worker="' + o.id + '" style="margin-top:8px">' +
      (o.worker ? '✎ Сменить исполнителя' : '👷 Назначить исполнителя') + '</button>';
  }

  return '<div class="card info-block">' +
      '<h4>Исполнители</h4>' +
      '<div>Основной: <b>' + escapeHtml(o.worker || '— не назначен —') + '</b></div>' +
      (rows.length
        ? '<div class="muted">Соисполнители:</div>' + rows.join('')
        : '<div class="muted">Соисполнители: —</div>') +
      actions +
    '</div>';
}

// --- 4.5. Задачи заявки (Этап 20) — вызов ui-tasks.js, ленивый (typeof) ---

// renderOrderTasksBlock подключён из ui-tasks.js

// Заявка по id (общий поиск для обработчиков карточки).
function findOrderById(id) {
  return (DB.orders || []).find(function (x) { return x.id === id; }) || null;
}

// --- Перенос заявки на другое время (Этап 28) ---

function renderTransferModal(o) {
  if (!o) return;
  showModal(
    '<h3>📅 Перенос заявки №' + orderDisplayNumber(o) + '</h3>' +
    '<p class="small muted">Текущая дата: <b>' + escapeHtml(o.date) +
      ' ' + escapeHtml(o.t1 || '') + '-' + escapeHtml(o.t2 || '') + '</b></p>' +
    '<label class="field"><span>Новая дата *</span>' +
      '<input id="tr-date" type="date" value="' + escapeHtml(o.date) + '"></label>' +
    '<div class="row">' +
      '<label class="field" style="flex:1"><span>Время с</span>' +
        '<input id="tr-t1" type="time" value="' + escapeHtml(o.t1 || '') + '"></label>' +
      '<label class="field" style="flex:1"><span>Время по</span>' +
        '<input id="tr-t2" type="time" value="' + escapeHtml(o.t2 || '') + '"></label>' +
    '</div>' +
    '<label class="field"><span>Причина (необязательно)</span>' +
      '<textarea id="tr-reason" rows="2" placeholder="Клиент попросил перенести..."></textarea></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-transfer="' + o.id + '" style="flex:1">Перенести</button>' +
    '</div>'
  );
}

// Применить перенос из модалки: собрать поля и вызвать transferOrder.
function applyTransferFromModal(id) {
  const o = findOrderById(Number(id));
  if (!o) return false;
  const val = function (fid) {
    const el = document.getElementById(fid);
    return el ? String(el.value).trim() : '';
  };
  const date = val('tr-date');
  if (!date) { toast('Укажите дату', true); return false; }
  if (!transferOrder(o, { date: date, t1: val('tr-t1'), t2: val('tr-t2'), reason: val('tr-reason') })) {
    toast('Не удалось перенести заявку', true);
    return false;
  }
  closeModal();
  toast('Заявка перенесена на ' + date);
  render();
  return true;
}

// Взять заявку: спереди проверка слота, иначе мягкая модалка конфликта (как в календаре).
function doTakeOrder(id) {
  const o = findOrderById(id);
  if (!o) return;
  if (!canTakeOrder(o)) { toast('Заявку нельзя взять', true); return; }
  const probe = { date: o.date, t1: o.t1, t2: o.t2, worker: state.user };
  const conflicts = (typeof checkTimeConflict === 'function') ? checkTimeConflict(probe) : [];
  if (conflicts.length) {
    window.__takePending = id;
    showTakeConflictModal(conflicts);
    return;
  }
  applyTakeOrder(id);
}

function applyTakeOrder(id) {
  const o = findOrderById(id);
  if (!o) return false;
  const res = takeOrder(o);
  if (!res.ok) { toast(res.reason, true); return false; }
  toast('Заявка №' + id + ' взята в работу');
  render();
  return true;
}

// Отдача в пул разрешена, пока заявка не закрыта (деньги/отмена).
function canReleaseToPool(o) {
  if (!o || !o.worker) return false;
  return o.status !== 'completed' && o.status !== 'paid' && o.status !== 'canceled';
}

// releaseOrderToPool(id): снять исполнителя, заявка снова свободна в пуле.
function releaseOrderToPool(id) {
  const o = findOrderById(id);
  if (!o) return false;
  if (!canReleaseToPool(o)) { toast('Отдача в пул недоступна', true); return false; }
  o.worker = null;
  o.takenAt = null;
  o.takenBy = null;
  normalizeOrder(o);
  o.history.push({
    ts: Date.now(), by: state.user, action: 'release_pool',
    details: 'Заявка возвращена в общий пул'
  });
  saveOrderLocal(o);
  toast('Заявка №' + id + ' отдана в пул');
  render();
  return true;
}

// Пересечение при взятии — своя модалка: кнопка «Всё равно взять» относится
// к назначению, а не к созданию заявки (data-force-order занят календарём).
function showTakeConflictModal(conflicts) {
  const nums = conflicts.map(function (o) { return '№' + o.id; }).join(', ');
  showModal(
    '<h3>⚠️ Пересечение по времени</h3>' +
    '<p>У вас уже есть заявки в это время: <b>' + nums + '</b>.</p>' +
    '<p class="small muted">Если это один подъезд или адреса рядом, брать можно.</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-force-take style="flex:1">✅ Всё равно взять</button>' +
    '</div>'
  );
}

// Приглашение соисполнителя: выбор из сотрудников, кроме занятых на этой заявке.
function renderHelperModal(o) {
  const taken = (o.helpers || []).concat(o.worker ? [o.worker] : []).concat([state.user]);
  const names = (DB.users || [])
    .map(function (u) { return u.name; })
    .filter(function (n) { return n && taken.indexOf(n) < 0; });
  if (!names.length) { toast('Все сотрудники уже на заявке', true); return; }
  showModal(
    '<h3>Соисполнитель к заявке №' + o.id + '</h3>' +
    '<label class="field"><span>Сотрудник</span><select id="helper-name">' +
      names.map(function (n) { return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; }).join('') +
    '</select></label>' +
    '<p class="small muted">Сотрудник получит приглашение и должен подтвердить участие.</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-helper="' + o.id + '" style="flex:1">Пригласить</button>' +
    '</div>'
  );
}

// --- Назначение основного исполнителя (после создания заявки) ---

// Модалка выбора основного исполнителя: сотрудники из DB.users, текущий
// помечен; пустой выбор = «в пул» (снятие исполнителя).
function renderAssignWorkerModal(o) {
  var names = (DB.users || []).map(function (u) { return u.name; }).filter(Boolean);
  if (!names.length) { toast('В админке нет сотрудников', true); return; }
  var opts = '<option value="">🤝 В пул (снять исполнителя)</option>' +
    names.map(function (n) {
      return '<option value="' + escapeHtml(n) + '"' + (n === o.worker ? ' selected' : '') + '>' +
        escapeHtml(n) + (n === o.worker ? ' — текущий' : '') + '</option>';
    }).join('');
  showModal(
    '<h3>Исполнитель заявки №' + o.id + '</h3>' +
    '<p class="small muted">Сейчас: <b>' + escapeHtml(o.worker || '— не назначен —') + '</b></p>' +
    '<label class="field"><span>Основной исполнитель</span><select id="aw-name">' + opts + '</select></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-worker="' + o.id + '" style="flex:1">Назначить</button>' +
    '</div>'
  );
}

// Пересечение слота у выбранного сотрудника — подтверждение назначения.
function showAssignConflictModal(conflicts, name) {
  var nums = conflicts.map(function (c) { return '№' + c.id; }).join(', ');
  showModal(
    '<h3>⚠️ Пересечение по времени</h3>' +
    '<p>У сотрудника <b>' + escapeHtml(name) + '</b> уже есть заявки в это время: <b>' + nums + '</b>.</p>' +
    '<p class="small muted">Если это один подъезд или адреса рядом, назначать можно.</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-force-assign style="flex:1">✅ Всё равно назначить</button>' +
    '</div>'
  );
}

// doAssignWorker(id, name): name='' → снятие в пул; конфликт по времени →
// модалка подтверждения (данные ждём в window.__assignPending).
function doAssignWorker(id, name) {
  var o = findOrderById(id);
  if (!o) return;
  if (!name) {
    if (typeof canReleaseToPool === 'function' && canReleaseToPool(o)) {
      releaseOrderToPool(id);
    } else {
      toast('Нельзя снять исполнителя в этом статусе', true);
    }
    closeModal();
    render();
    return;
  }
  if (name === o.worker) { closeModal(); toast('Исполнитель не изменился'); return; }
  var probe = { date: o.date, t1: o.t1, t2: o.t2, worker: name };
  var conflicts = (typeof checkTimeConflict === 'function') ? checkTimeConflict(probe) : [];
  if (conflicts.length) {
    window.__assignPending = { id: id, name: name };
    showAssignConflictModal(conflicts, name);
    return;
  }
  applyAssignWorker(id, name);
}

function applyAssignWorker(id, name) {
  var o = findOrderById(id);
  if (!o) return false;
  if (!assignWorker(o, name)) { toast('Не удалось назначить исполнителя', true); return false; }
  window.__assignPending = null;
  closeModal();
  toast('Исполнитель: ' + name);
  render();
  return true;
}

// --- Перенос остатка: модалка (Этап 15) ---

function renderFollowUpModal(o) {
  showModal(
    '<h3>Перенос остатка заявки №' + o.id + '</h3>' +
    '<p class="small muted">Работы «в работе» и материалы «нужно купить» уйдут в новую заявку. ' +
    'Выполненные строки войдут в промежуточный акт.</p>' +
    '<label class="field"><span>Дата новой заявки</span>' +
      '<input id="fu-date" type="date" value="' + (o.date || localToday()) + '"></label>' +
    '<div class="row">' +
      '<label class="field" style="flex:1"><span>Время с</span>' +
        '<input id="fu-t1" type="time" value="' + escapeHtml(o.t1 || '09:00') + '"></label>' +
      '<label class="field" style="flex:1"><span>Время до</span>' +
        '<input id="fu-t2" type="time" value="' + escapeHtml(o.t2 || '12:00') + '"></label>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-create-followup="' + o.id + '" style="flex:1">Создать дочернюю</button>' +
    '</div>'
  );
}

// Перенос остатка: открываем модалку, либо сразу создаём (без даты).
function doFollowUp(id) {
  var o = findOrderById(id);
  if (!o) return;
  if (!canEditOrder(o)) { toast('Нельзя переносить', true); return; }
  renderFollowUpModal(o);
}

// --- 4. Вкладка «Смета» (заглушка, перенесена в ui-estimate.js) ---

// renderEstimateTab подключён из ui-estimate.js (Этап 6)

// --- 5. Модалка создания заявки ---

// Опции выбора исполнителя при создании заявки (модалка «Новая заявка»):
// «в пул» (пусто), «себе», и — для наделённых order_assign — сотрудники из
// DB.users кроме текущего пользователя (себя выбирают опцией «Себе»).
function buildWorkerOptions() {
  const defSelf = state.role === 'worker';
  let html = '<option value=""' + (defSelf ? '' : ' selected') + '>' +
    '🤝 В общий пул (без исполнителя)</option>';
  html += '<option value="self"' + (defSelf ? ' selected' : '') + '>' +
    '👷 Себе (' + escapeHtml(state.user || '') + ')</option>';
  if (can('order_assign')) {
    const names = (DB.users || [])
      .map(function (u) { return u.name; })
      .filter(function (n) { return n && n !== state.user; });
    html += names.map(function (n) {
      return '<option value="' + escapeHtml(n) + '">👤 ' + escapeHtml(n) + '</option>';
    }).join('');
  }
  return html;
}

function renderCreateOrderModal() {
  var clients = (DB.clients || []).map(function (c) {
    return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
  }).join('');
  showModal(
    '<h3>Новая заявка</h3>' +
    '<label class="field"><span>Контрагент</span><select id="co-client-id"><option value="">— вручную —</option>' + clients + '</select></label>' +
    '<label class="field"><span>Исполнитель</span><select id="nc-worker">' + buildWorkerOptions() + '</select></label>' +
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
  if (closeBtn) { closeModal(); window.__assignPending = null; return; }

  const overlay = sel('[data-modal-overlay]');
  if (overlay && ev.target === overlay) { closeModal(); window.__assignPending = null; return; }

  // Кнопки пула и подтверждения стоят ВНУТРИ карточки [data-order], поэтому их
  // проверяем раньше перехода по карточке — иначе клик откроет заявку.
  const takeBtn = sel('[data-take-order]');
  if (takeBtn) { doTakeOrder(Number(takeBtn.getAttribute('data-take-order'))); return; }

  // Подтверждение «Всё равно взять» в модалке пересечения при взятии.
  const forceTakeBtn = sel('[data-force-take]');
  if (forceTakeBtn) {
    if (window.__takePending === null || window.__takePending === undefined) {
      closeModal();
      return;
    }
    applyTakeOrder(window.__takePending);
    window.__takePending = null;
    closeModal();
    return;
  }

  const confirmBtn = sel('[data-confirm-helper]');
  if (confirmBtn) {
    const parts = String(confirmBtn.getAttribute('data-confirm-helper')).split('|');
    const o = findOrderById(Number(parts[0]));
    if (o && confirmHelper(o, state.user, parts[1])) {
      closeModal();
      toast(parts[1] === 'ok' ? 'Участие подтверждено' : 'Вы отказались от заявки');
      render();
    } else {
      toast('Подтверждение уже обработано', true);
    }
    return;
  }

  const addHelperBtn = sel('[data-add-helper]');
  if (addHelperBtn) {
    const o = findOrderById(Number(addHelperBtn.getAttribute('data-add-helper')));
    if (o) renderHelperModal(o);
    return;
  }

  const saveHelperBtn = sel('[data-save-helper]');
  if (saveHelperBtn) {
    const o = findOrderById(Number(saveHelperBtn.getAttribute('data-save-helper')));
    const sel2 = document.getElementById('helper-name');
    const name = sel2 ? sel2.value : '';
    if (!o) return;
    if (!assignHelper(o, name)) { toast('Не удалось пригласить сотрудника', true); return; }
    closeModal();
    toast(name + ' приглашён (ждёт подтверждения)');
    render();
    return;
  }

  const followupBtn = sel('[data-followup]');
  if (followupBtn) { doFollowUp(Number(followupBtn.getAttribute('data-followup'))); return; }

  // «Итог звонка» (Этап 19): модуль ui-attention.js может не загрузиться.
  const callBtn = sel('[data-call-result="start"]');
  if (callBtn) {
    const o = findOrderById(state.orderId);
    if (!o) return;
    if (typeof renderCallResultModal !== 'function') {
      toast('Модуль «Итог звонка» не загружен', true);
      return;
    }
    renderCallResultModal(o);
    return;
  }

  // Перенос заявки (Этап 28): кнопка на «Основном» + сохранение из модалки.
  const transferBtn = sel('[data-transfer-order]');
  if (transferBtn) {
    const o = findOrderById(Number(transferBtn.getAttribute('data-transfer-order')));
    if (o) renderTransferModal(o);
    return;
  }
  const saveTransferBtn = sel('[data-save-transfer]');
  if (saveTransferBtn) {
    applyTransferFromModal(saveTransferBtn.getAttribute('data-save-transfer'));
    return;
  }

  const createFollowupBtn = sel('[data-create-followup]');
  if (createFollowupBtn) {
    var o = findOrderById(Number(createFollowupBtn.getAttribute('data-create-followup')));
    if (!o) return;
    var val = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    // createFollowUpOrder(parentId, data) — сигнатура Этапа 15 (ТЗ).
    var child = createFollowUpOrder(o.id, {
      date: val('fu-date') || localToday(),
      t1: val('fu-t1'),
      t2: val('fu-t2')
    });
    if (!child) { toast('Не удалось создать дочернюю заявку (не больше 9?)', true); return; }
    closeModal();
    toast('Создана дочерняя заявка №' + orderDisplayNumber(child));
    render();
    return;
  }

  // Теги заявки (Этап 17): крестик на чипе и кнопка «свой тег».
  const removeTagBtn = sel('[data-remove-tag]');
  if (removeTagBtn) {
    const o = findOrderById(state.orderId);
    if (o && canEditOrder(o)) {
      removeTag(o, removeTagBtn.getAttribute('data-remove-tag'));
      render();
    }
    return;
  }

  const addCustomTagBtn = sel('[data-add-tag-custom]');
  if (addCustomTagBtn) {
    const o = findOrderById(state.orderId);
    const input = document.getElementById('tag-custom');
    const tag = input ? String(input.value).trim() : '';
    if (!o || !canEditOrder(o)) return;
    if (!tag) { toast('Введите тег', true); return; }
    if (!addTag(o, tag)) { toast('Такой тег уже есть', true); return; }
    render();
    return;
  }

  // «Отдать в пул» стоит ВНУТРИ карточки [data-order] — проверяем до перехода.
  const releaseBtn = sel('[data-release-pool]');
  if (releaseBtn) {
    releaseOrderToPool(Number(releaseBtn.getAttribute('data-release-pool')));
    return;
  }

  // Назначение / смена основного исполнителя.
  const assignBtn = sel('[data-assign-worker]');
  if (assignBtn) {
    const o = findOrderById(Number(assignBtn.getAttribute('data-assign-worker')));
    if (o && can('order_assign')) { renderAssignWorkerModal(o); }
    else { toast('Нет права назначать исполнителя', true); }
    return;
  }

  // Сохранение выбора исполнителя из модалки.
  const saveWorkerBtn = sel('[data-save-worker]');
  if (saveWorkerBtn) {
    const id = Number(saveWorkerBtn.getAttribute('data-save-worker'));
    const el = document.getElementById('aw-name');
    doAssignWorker(id, el ? el.value : '');
    return;
  }

  // «Всё равно назначить» — подтверждение конфликта при смене исполнителя.
  const forceAssignBtn = sel('[data-force-assign]');
  if (forceAssignBtn) {
    const p = window.__assignPending;
    if (p) { applyAssignWorker(p.id, p.name); }
    else { closeModal(); }
    return;
  }

  // Развернуть свёрнутую карточку (Этап 28).
  const expandBtn = sel('[data-expand-order]');
  if (expandBtn) {
    const id = Number(expandBtn.getAttribute('data-expand-order'));
    EXPANDED_ORDERS[id] = true;
    render();
    return;
  }

  // Свернуть развёрнутую карточку (Этап 28).
  const collapseBtn = sel('[data-collapse-order]');
  if (collapseBtn) {
    const id = Number(collapseBtn.getAttribute('data-collapse-order'));
    delete EXPANDED_ORDERS[id];
    render();
    return;
  }

  // Открыть полный экран заявки из развёрнутой карточки (Этап 28).
  const openBtn = sel('[data-open-order]');
  if (openBtn) {
    const id = Number(openBtn.getAttribute('data-open-order'));
    ORD_TAB = 'main';
    go('order', id);
    return;
  }

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
    const data = {
      client: client,
      phone: val('nc-phone'),
      address: val('nc-address'),
      date: val('nc-date') || localToday(),
      t1: val('nc-t1'),
      t2: val('nc-t2')
    };
    // Исполнитель из модалки: пусто → общий пул, 'self' → текущий пользователь,
    // иначе — выбранное имя (опции для других доступны только с order_assign).
    const w = (document.getElementById('nc-worker') || {}).value || '';
    data.worker = (w === 'self') ? state.user : (w ? w : null);
    // Конфликт по времени ищем только для назначенного исполнителя;
    // заявка в пуле свободна — её возьмут позже, слот пока не занят.
    if (data.worker) {
      const conflicts = (typeof checkTimeConflict === 'function') ? checkTimeConflict(data) : [];
      if (conflicts.length) {
        window.__calPending = data; // «Всё равно взять» доукомплектует через finishCreateOrder
        showConflictModal(conflicts, data);
        return;
      }
    }
    saveOrderWithClient(data);
    closeModal();
    state.filter = 'all';
    go('orders');
    return;
  }
});

// Создание заявки с привязкой к контрагенту (Этап 16): o.clientId + orderIds
// контрагента + clientLegal для юрлиц (документы берут отсюда реквизиты).
// Этап 30: без выбранного контрагента в модалке привязка идёт по имени
// и телефону (getOrCreateClient; авто-создание карточки требует clients_edit).
function saveOrderWithClient(data) {
  const selEl = document.getElementById('co-client-id');
  let cid = selEl ? Number(selEl.value) : 0;
  if (!cid && typeof getOrCreateClient === 'function') {
    cid = getOrCreateClient(data.client, data.phone, data.address) || 0;
  }
  const c = cid ? (DB.clients || []).find(function (x) { return x.id === cid; }) : null;
  if (c) {
    data.clientId = c.id;
    if (c.kind === 'company' || c.kind === 'ip') {
      data.clientLegal = {
        name: c.name, inn: c.inn || '', kpp: c.kpp || '',
        ogrn: c.ogrn || '', phone: c.phone || ''
      };
    }
  }
  const o = createOrder(data);
  if (c && o) {
    if (!Array.isArray(c.orderIds)) c.orderIds = [];
    c.orderIds.push(o.id);
    save();
    if (typeof collectionSave === 'function') collectionSave('clients', c);
  }
  return o;
}

// Смена статуса — событие change (не click).
document.addEventListener('change', function (ev) {
  const select = ev.target.closest && ev.target.closest('[data-status-select]');
  if (select) {
    const id = Number(select.getAttribute('data-status-select'));
    const ns = select.value;
    if (!ns) return;
    // Этап 29 Hotfix: «Перенос» — не меняем статус, открываем модалку.
    if (ns === 'transfer') {
      const o = (DB.orders || []).find(function (x) { return x.id === id; });
      if (o) renderTransferModal(o);
      select.value = o ? o.status : '';
      return;
    }
    if (transitionOrder(id, ns)) {
      toast('Статус: ' + (STATUS_LABELS[ns] || ns));
      render();
      // Завершение с долгом: предлагаем напоминание об остатке (Этап 12).
      if (ns === 'completed' && typeof orderBalance === 'function' &&
          typeof showBalanceReminderModal === 'function') {
        const done = (DB.orders || []).find(function (x) { return x.id === id; });
        if (done && orderBalance(done) > 0) showBalanceReminderModal(done);
      }
    } else {
      toast('Переход не разрешён', true);
    }
    return;
  }

  // Выбор контрагента из справочника — подставляем реквизиты в форму (Этап 16).
  const clientSel = ev.target.closest && ev.target.closest('#co-client-id');
  if (clientSel) {
    const cid = Number(clientSel.value);
    const c = (DB.clients || []).find(function (x) { return x.id === cid; });
    const set = function (id, v) {
      const el = document.getElementById(id);
      if (el) el.value = v || '';
    };
    if (!c) { set('nc-client', ''); set('nc-phone', ''); set('nc-address', ''); return; }
    set('nc-client', c.name);
    set('nc-phone', c.phone);
    set('nc-address', [c.city, c.address].filter(Boolean).join(', '));
    return;
  }

  // Фильтр списка по тегу (Этап 17): значение 'tag:Тег', пусто — все.
  const tagFilter = ev.target.closest && ev.target.closest('[data-tag-filter]');
  if (tagFilter) {
    const t = String(tagFilter.value || '').trim();
    state.filter = t ? 'tag:' + t : 'all';
    render();
    return;
  }

  // Добавление тега-пресета к открытой заявке (Этап 17).
  const tagPreset = ev.target.closest && ev.target.closest('[data-add-tag-preset]');
  if (tagPreset) {
    const o = findOrderById(state.orderId);
    const tag = String(tagPreset.value || '').trim();
    if (!o || !tag) return;
    if (!canEditOrder(o)) { toast('Нельзя редактировать заявку', true); return; }
    if (!addTag(o, tag)) { toast('Такой тег уже есть', true); return; }
    render();
    return;
  }

  // «Игнорировать точку» маршрута закупки (Этап 18).
  const routeIg = ev.target.closest && ev.target.closest('[data-route-ignore]');
  if (routeIg) {
    const o = findOrderById(state.orderId);
    if (!o || !canEditOrder(o)) return;
    const key = routeIg.getAttribute('data-route-ignore');
    if (!o.routeIgnored || typeof o.routeIgnored !== 'object') o.routeIgnored = {};
    if (routeIg.checked) o.routeIgnored[key] = true;
    else delete o.routeIgnored[key];
    saveOrderLocal(o);
    render();
    return;
  }
});
