/* CRM2 :: app/ui-digest.js — единое окно «Сводка дня» (Этап 39).
   Одна кнопка → одно окно: KPI, секции внимания, план на сегодня, задачи,
   итог дня и озвучка. Данные берутся из готовых источников (attentionGroups,
   orderRevenue/orderPaid/orderBalance, isPoolOrder), новых бизнес-правил нет.
   Зависит от db.js, auth.js, gates.js, orders.js, core.js; ui-orders.js и
   ui-attention.js подключаются раньше — их функции вызываются через typeof-гарды. */
'use strict';

var DG_TAB = 'now';   // 'now' | 'day'
var DG_OPEN = null;   // { sectionKey: true } — раскрытые секции (ленивая загрузка)
var DG_SPEAKING = false;
var DG_RESTORE = false; // действие строки выполнено: окно надо вернуть/обновить

var DG_SECTIONS_KEY = 'crm2_digest_sections';
var DG_TAB_KEY = 'crm2_digest_tab';

var DG_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// --- 1. Мелкие утилиты (гарды на локальный режим и смоук-контекст) ---

function dgLsGet(key, def) {
  return (typeof lsGet === 'function') ? lsGet(key, def) : def;
}

function dgLsSet(key, val) {
  if (typeof lsSet === 'function') lsSet(key, val);
}

function dgToday() {
  return (typeof localToday === 'function') ? localToday() : '';
}

function dgOrders() {
  return (typeof DB !== 'undefined' && DB && Array.isArray(DB.orders)) ? DB.orders : [];
}

function dgTasks() {
  return (typeof DB !== 'undefined' && DB && Array.isArray(DB.tasks)) ? DB.tasks : [];
}

function dgMoneyVisible() {
  return (typeof can === 'function') ? !!can('money_view') : false;
}

// 'YYYY-MM-DD' → 'ДД.ММ.ГГГГ' (в шапке окна).
function dgDateRu(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return String(iso || '');
  return p[2] + '.' + p[1] + '.' + p[0];
}

// 'YYYY-MM-DD' → '19 ноября' (для озвучки).
function dgDateSpoken(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return String(iso || '');
  var m = Number(p[1]);
  var month = (m >= 1 && m <= 12) ? DG_MONTHS[m - 1] : p[1];
  return Number(p[2]) + ' ' + month;
}

// --- 2. Состояние раскрытых секций и активного таба ---

function dgOpenState() {
  if (DG_OPEN) return DG_OPEN;
  var def = { callback: true, overdue: true };
  var raw = dgLsGet(DG_SECTIONS_KEY, '');
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') def = parsed;
    } catch (e) { /* битый JSON — дефолт */ }
  }
  DG_OPEN = def;
  return DG_OPEN;
}

function dgSaveOpen() {
  try {
    dgLsSet(DG_SECTIONS_KEY, JSON.stringify(dgOpenState()));
  } catch (e) { /* переполнение хранилища — не критично */ }
}

function dgRestoreTab() {
  var t = dgLsGet(DG_TAB_KEY, 'now');
  return (t === 'day') ? 'day' : 'now';
}

function dgIsOpen(key) {
  return !!dgOpenState()[key];
}

// --- 3. Модель (чистая функция, без DOM) ---

// Итог дня по заявкам за сегодня. Суммы — через orderRevenue/orderPaid
// (orders.js, единая база calculateOrderTotal), только при праве money_view.
function digestDayTotals(orders, today, money) {
  var list = (Array.isArray(orders) ? orders : []).filter(function (o) {
    return o && o.date === today;
  });
  var sum = 0;
  var paid = 0;
  var overdue = 0;
  list.forEach(function (o) {
    if (money) {
      sum += (typeof orderRevenue === 'function') ? (Number(orderRevenue(o)) || 0) : 0;
      paid += (typeof orderPaid === 'function') ? (Number(orderPaid(o)) || 0) : 0;
    }
    if (o.status !== 'completed' && o.status !== 'paid' && o.status !== 'canceled') {
      var ts = (typeof visitStartTs === 'function') ? visitStartTs(o) : 0;
      if (ts && ts < Date.now()) overdue++;
    }
  });
  return {
    orders: list, count: list.length, sum: sum, paid: paid,
    debt: Math.max(0, sum - paid), overdue: overdue
  };
}

// digestModel(): всё состояние дня одним объектом. Пустой DB и отсутствующие
// модули дают нули/пустые массивы, а не undefined.
function digestModel() {
  var today = dgToday();
  var money = dgMoneyVisible();
  var orders = dgOrders();

  var groups = {
    callback: [], overdue: [], noWorker: [], balance: [], materials: [], confirm: []
  };
  if (typeof attentionGroups === 'function') {
    var g = attentionGroups();
    if (g) {
      ['callback', 'overdue', 'noWorker', 'balance', 'materials', 'confirm']
        .forEach(function (k) {
          if (Array.isArray(g[k])) groups[k] = g[k];
        });
    }
  }

  // План на сегодня: визиты по дате, сортировка по времени начала.
  var plan = orders.filter(function (o) { return o && o.date === today; }).slice()
    .sort(function (a, b) {
      return String(a.t1 || '').localeCompare(String(b.t1 || ''));
    });

  var planSum = 0;
  if (money) {
    plan.forEach(function (o) {
      planSum += (typeof orderRevenue === 'function') ? (Number(orderRevenue(o)) || 0) : 0;
    });
  }

  var pool = orders.filter(function (o) {
    return (typeof isPoolOrder === 'function') ? isPoolOrder(o) : false;
  });

  var tasks = dgTasks().filter(function (t) {
    return t && !t.done && t.dueDate === today;
  });

  var counts = {
    callback: groups.callback.length,
    overdue: groups.overdue.length,
    noWorker: groups.noWorker.length,
    balance: groups.balance.length,
    materials: groups.materials.length,
    confirm: groups.confirm.length,
    pool: pool.length,
    tasks: tasks.length
  };

  // noWorker и pool — одно и то же множество (оба = isPoolOrder), поэтому в
  // бейдж идёт сумма без дубля noWorker.
  var total = counts.callback + counts.overdue + counts.pool + counts.balance +
    counts.materials + counts.confirm + counts.tasks;

  var sync = null;
  if (typeof syncStatus === 'function') {
    try { sync = syncStatus(); } catch (e) { sync = null; }
  }

  return {
    date: today,
    role: (typeof state !== 'undefined' && state) ? state.role : null,
    money: money,
    sync: sync,
    now: {
      plan: plan, planCount: plan.length, planSum: planSum,
      groups: groups, pool: pool, tasks: tasks,
      counts: counts, total: total
    },
    day: digestDayTotals(orders, today, money)
  };
}

// --- 4. Озвучка: текст (чистая функция) и запуск ---

function digestSpeechText(m) {
  var model = m || digestModel();
  var now = model.now || { counts: {}, planCount: 0, planSum: 0 };
  var c = now.counts || {};
  var parts = ['Сводка на ' + dgDateSpoken(model.date) + '.'];
  var plan = 'План: ' + (now.planCount || 0) + ' ' + dgPlural(now.planCount || 0, 'визит', 'визита', 'визитов');
  if (model.money) plan += ', ' + Math.round(Number(now.planSum) || 0) + ' рублей';
  parts.push(plan + '.');
  parts.push('Нужно перезвонить: ' + (c.callback || 0) + '.');
  parts.push('Просрочено: ' + (c.overdue || 0) + '.');
  parts.push('В пуле: ' + (c.pool || 0) + '.');
  parts.push('Задач на сегодня: ' + (c.tasks || 0) + '.');
  return parts.join(' ');
}

// Русское склонение: 1 визит / 2 визита / 5 визитов.
function dgPlural(n, one, few, many) {
  var v = Math.abs(Number(n) || 0) % 100;
  var d = v % 10;
  if (v > 10 && v < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

function dgSpeechSupported() {
  return typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    window.speechSynthesis !== null &&
    typeof SpeechSynthesisUtterance !== 'undefined';
}

function dgSpeakButtonLabel() {
  return DG_SPEAKING ? '⏹ Остановить' : '🔊 Озвучить';
}

function dgSetSpeakLabel() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  var nodes = document.querySelectorAll('[data-digest-speak]');
  if (!nodes || !nodes.length) return;
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].textContent = dgSpeakButtonLabel();
  }
}

function speakDigest() {
  if (!dgSpeechSupported()) {
    toast('Озвучка не поддерживается браузером', true);
    return false;
  }
  var synth = window.speechSynthesis;
  if (DG_SPEAKING) {
    synth.cancel();
    DG_SPEAKING = false;
    dgSetSpeakLabel();
    return true;
  }
  synth.cancel();
  var text = digestSpeechText(digestModel());
  var utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ru-RU';
  utter.rate = 1;
  var done = function () {
    DG_SPEAKING = false;
    dgSetSpeakLabel();
  };
  utter.onend = done;
  utter.onerror = done;
  DG_SPEAKING = true;
  dgSetSpeakLabel();
  synth.speak(utter);
  return true;
}

function dgStopSpeech() {
  DG_SPEAKING = false;
  if (!dgSpeechSupported()) return;
  try { window.speechSynthesis.cancel(); } catch (e) { /* нет голоса — молча */ }
}

// --- 5. Кнопка в шапке приложения ---

function renderDigestButton() {
  var m = digestModel();
  var total = m.now.total;
  return '<div class="dg-entry-wrap">' +
      '<button class="btn dg-entry" data-digest-open>📊 Сводка' +
        (total > 0 ? '<span class="dg-entry-badge">' + total + '</span>' : '') +
      '</button>' +
    '</div>';
}

// --- 6. Строки секций ---

function dgOrderBadges(o) {
  var badges = (typeof renderOrderBadges === 'function') ? renderOrderBadges(o) : '';
  var cd = (typeof renderCountdownBadge === 'function') ? renderCountdownBadge(o) : '';
  return String(badges || '') + String(cd || '');
}

function dgStatusBadge(o) {
  if (typeof STATUS_LABELS === 'undefined' || typeof statusBadgeClass !== 'function') return '';
  var label = STATUS_LABELS[o.status] || o.status || '';
  return '<span class="' + statusBadgeClass(o.status) + '">' + escapeHtml(label) + '</span>';
}

// Строка заявки: №, клиент, дата/время, статус, бейджи, кнопки действий.
// data-order стоит ТОЛЬКО на кнопке «📖» — иначе closest('[data-order]')
// перехватил бы клик по кнопке действия внутри строки.
function renderDigestOrderRow(o, actions, note) {
  if (!o) return '';
  var num = (typeof orderDisplayNumber === 'function') ? orderDisplayNumber(o) : o.id;
  var when = String(o.date || '') + (o.t1 ? ' ' + o.t1 : '') + (o.t2 ? '-' + o.t2 : '');
  return '<div class="dg-row">' +
      '<div class="dg-row-top">' +
        '<b>№' + escapeHtml(String(num)) + ' ' + escapeHtml(o.client || '—') + '</b>' +
        dgStatusBadge(o) +
      '</div>' +
      '<div class="dg-row-sub">' + escapeHtml(when) +
        (note ? ' · ' + escapeHtml(note) : '') + '</div>' +
      '<div class="dg-row-badges">' + dgOrderBadges(o) + '</div>' +
      '<div class="dg-row-actions">' +
        String(actions || '') +
        '<button class="btn" data-order="' + escapeHtml(String(o.id)) + '" title="Открыть">📖</button>' +
      '</div>' +
    '</div>';
}

function dgRowCallback(it) {
  var o = it.o;
  return renderDigestOrderRow(o,
    '<button class="btn" data-call-result="start" data-order-id="' + escapeHtml(String(o.id)) + '">📞 Итог звонка</button>' +
    '<button class="btn" data-call-result="later_2h" data-order-id="' + escapeHtml(String(o.id)) + '">⏰ +2 ч</button>',
    it.note);
}

function dgRowOverdue(it) {
  var o = it.o;
  return renderDigestOrderRow(o,
    '<button class="btn" data-transfer-order="' + escapeHtml(String(o.id)) + '">📅 Перенести</button>',
    it.note);
}

function dgRowPool(o) {
  return renderDigestOrderRow(o,
    '<button class="btn btn-primary" data-take-order="' + escapeHtml(String(o.id)) + '">✋ Взять</button>',
    'исполнитель не назначен');
}

function dgRowBalance(it) {
  var o = it.o;
  return renderDigestOrderRow(o,
    '<button class="btn" data-order="' + escapeHtml(String(o.id)) + '" data-order-tab="money">💰 К оплате</button>',
    it.note);
}

function dgRowMaterials(it) {
  var o = it.o;
  return renderDigestOrderRow(o,
    '<button class="btn" data-order="' + escapeHtml(String(o.id)) + '" data-order-tab="materials">📦 Закупки</button>',
    it.note);
}

function dgRowConfirm(it) {
  var o = it.o;
  return renderDigestOrderRow(o,
    '<button class="btn" data-confirm-helper="' + escapeHtml(String(o.id)) + '|ok">🤝 Подтвердить</button>',
    it.note);
}

function dgRowTask(t) {
  return '<div class="dg-row">' +
      '<div class="dg-row-top"><b>' + escapeHtml(t.title || '—') + '</b></div>' +
      (t.note ? '<div class="dg-row-sub">' + escapeHtml(t.note) + '</div>' : '') +
      '<div class="dg-row-actions">' +
        '<button class="btn" data-toggle-task="' + escapeHtml(String(t.id)) + '">✔ Готово</button>' +
      '</div>' +
    '</div>';
}

function dgRowPlan(o) {
  return renderDigestOrderRow(o, '', '');
}

// Сворачиваемая секция. Пустая — не исчезает: показывает «✅ пусто».
function renderDigestSection(key, icon, title, count, rowsHtml) {
  var open = dgIsOpen(key) ? ' dg-open' : '';
  var body = rowsHtml || '<div class="dg-empty">✅ пусто</div>';
  return '<div class="dg-sec' + open + '" data-dg-sec="' + key + '">' +
      '<button class="dg-sec-head" data-dg-toggle="' + key + '">' +
        '<span class="dg-sec-title">' + icon + ' ' + escapeHtml(title) + '</span>' +
        '<span class="dg-count">' + (Number(count) || 0) + '</span>' +
        '<span class="dg-caret">▾</span>' +
      '</button>' +
      '<div class="dg-body">' + body + '</div>' +
    '</div>';
}

function dgRows(items, rowFn) {
  if (!items || !items.length) return '';
  return items.map(rowFn).join('');
}

// --- 7. KPI-плитки ---

function renderDigestKpi(m) {
  var now = m.now;
  var c = now.counts;
  var debtSum = 0;
  if (m.money) {
    (now.groups.balance || []).forEach(function (it) {
      debtSum += (typeof orderBalance === 'function') ? (Number(orderBalance(it.o)) || 0) : 0;
    });
  }

  var tiles = [
    ['plan', '📅 План на сегодня',
      now.planCount + ' ' + dgPlural(now.planCount, 'визит', 'визита', 'визитов') +
        (m.money ? ' · ' + Math.round(now.planSum) + ' ₽' : ''), ''],
    ['callback', '📞 Перезвонить', String(c.callback), c.callback > 0 ? ' dg-kpi-warn' : ''],
    ['overdue', '⚠️ Просрочка', String(c.overdue), c.overdue > 0 ? ' dg-kpi-danger' : ''],
    ['pool', '🖐 Пул / без исполнителя', String(c.pool), ''],
    ['balance', '💰 Остаток к оплате',
      String(c.balance) + (m.money && debtSum > 0 ? ' · ' + Math.round(debtSum) + ' ₽' : ''),
      ' dg-kpi-warn'],
    ['tasks', '📝 Задачи', String(c.tasks), ' dg-kpi-muted']
  ];

  return '<div class="dg-kpi">' + tiles.map(function (t) {
    return '<button class="dg-kpi-item' + t[3] + '" data-digest-jump="' + t[0] + '">' +
        '<span class="dg-kpi-label">' + t[1] + '</span>' +
        '<span class="dg-kpi-num">' + escapeHtml(t[2]) + '</span>' +
      '</button>';
  }).join('') + '</div>';
}

// --- 8. Тело окна: вкладки ---

function renderDigestNow(m) {
  var now = m.now;
  var g = now.groups;
  return renderDigestKpi(m) +
    renderDigestSection('callback', '📞', 'Нужен перезвон',
      g.callback.length, dgRows(g.callback, dgRowCallback)) +
    renderDigestSection('overdue', '⚠️', 'Просрочено',
      g.overdue.length, dgRows(g.overdue, dgRowOverdue)) +
    renderDigestSection('pool', '🖐', 'Пул / без исполнителя',
      now.pool.length, dgRows(now.pool, dgRowPool)) +
    renderDigestSection('balance', '💰', 'Остаток к оплате',
      g.balance.length, dgRows(g.balance, dgRowBalance)) +
    renderDigestSection('materials', '🧱', 'Материалы к закупке',
      g.materials.length, dgRows(g.materials, dgRowMaterials)) +
    renderDigestSection('confirm', '❓', 'Ждёт подтверждения',
      g.confirm.length, dgRows(g.confirm, dgRowConfirm)) +
    renderDigestSection('tasks', '📝', 'Задачи на сегодня',
      now.tasks.length, dgRows(now.tasks, dgRowTask)) +
    renderDigestSection('plan', '📅', 'План на сегодня',
      now.plan.length, dgRows(now.plan, dgRowPlan));
}

function renderDigestDay(m) {
  var d = m.day;
  if (!d) return '<p class="muted">Итог дня недоступен.</p>';

  var tiles = [
    ['📋 Заявок за день', String(d.count), ''],
    ['⚠️ Просрочено', String(d.overdue), d.overdue > 0 ? ' dg-kpi-danger' : '']
  ];
  if (m.money) {
    tiles.push(['💵 Сумма', Math.round(d.sum) + ' ₽', '']);
    tiles.push(['✅ Оплачено', Math.round(d.paid) + ' ₽', '']);
    tiles.push(['💰 Долг', Math.round(d.debt) + ' ₽', d.debt > 0 ? ' dg-kpi-warn' : '']);
  }

  var rows = (d.orders || []).map(function (o) {
    var revenue = (typeof orderRevenue === 'function') ? (Number(orderRevenue(o)) || 0) : 0;
    var paid = (typeof orderPaid === 'function') ? (Number(orderPaid(o)) || 0) : 0;
    var money = m.money
      ? ' · ' + Math.round(revenue) + ' ₽ / оплачено ' + Math.round(paid) + ' ₽'
      : '';
    return renderDigestOrderRow(o, '', money.replace(/^ · /, ''));
  }).join('');

  return '<div class="dg-kpi">' + tiles.map(function (t) {
      return '<div class="dg-kpi-item dg-kpi-static' + t[2] + '">' +
          '<span class="dg-kpi-label">' + t[0] + '</span>' +
          '<span class="dg-kpi-num">' + escapeHtml(t[1]) + '</span>' +
        '</div>';
    }).join('') + '</div>' +
    '<div class="dg-sec dg-open" data-dg-sec="day-orders">' +
      '<div class="dg-sec-head dg-sec-head-static">' +
        '<span class="dg-sec-title">📋 Заявки за сегодня</span>' +
        '<span class="dg-count">' + (d.count || 0) + '</span>' +
      '</div>' +
      '<div class="dg-body">' +
        (rows || '<div class="dg-empty">✅ Заявок за сегодня нет</div>') +
      '</div>' +
    '</div>';
}

function dgBodyHtml() {
  var m = digestModel();
  return DG_TAB === 'day' ? renderDigestDay(m) : renderDigestNow(m);
}

// --- 9. Окно целиком ---

function dgHeadHtml(m) {
  var syncChip = '';
  if (m.sync && m.sync.mode) {
    syncChip = '<span class="dg-sync">☁ ' + escapeHtml(String(m.sync.mode)) + '</span>';
  }
  return '<div class="dg-head">' +
      '<div class="dg-head-top">' +
        '<b class="dg-title">📊 Сводка дня</b>' +
        '<span class="dg-date">' + escapeHtml(dgDateRu(m.date)) + '</span>' +
        (m.role ? '<span class="dg-role">' + escapeHtml(String(m.role)) + '</span>' : '') +
        syncChip +
        '<span class="dg-spacer"></span>' +
        '<button class="btn" data-digest-refresh title="Обновить">🔄</button>' +
        '<button class="btn" data-close title="Закрыть">✕</button>' +
      '</div>' +
      '<div class="dg-tabs">' +
        '<button class="btn dg-tab' + (DG_TAB === 'now' ? ' dg-tab-active' : '') +
          '" data-digest-tab="now">⚡ Сейчас</button>' +
        '<button class="btn dg-tab' + (DG_TAB === 'day' ? ' dg-tab-active' : '') +
          '" data-digest-tab="day">📈 Итог дня</button>' +
      '</div>' +
    '</div>';
}

function dgFootHtml() {
  return '<div class="dg-foot">' +
      '<button class="btn" data-digest-speak>' + dgSpeakButtonLabel() + '</button>' +
      '<button class="btn" data-digest-refresh>🔄 Обновить</button>' +
      '<button class="btn btn-primary" data-close>Закрыть</button>' +
    '</div>';
}

function renderDigestModal() {
  var m = digestModel();
  showModal(
    '<div class="dg-wrap">' +
      dgHeadHtml(m) +
      '<div class="dg-scroll" id="dg-scroll">' + dgBodyHtml() + '</div>' +
      dgFootHtml() +
    '</div>'
  );
}

function openDigest() {
  DG_TAB = dgRestoreTab();
  DG_SPEAKING = false;
  renderDigestModal();
}

// --- 10. Точечные обновления (без render()) ---

function dgScrollEl() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null;
  return document.getElementById('dg-scroll');
}

// Перерисовать только тело окна (шапка, табы и футер остаются).
function dgPaintBody(keepScroll) {
  var el = dgScrollEl();
  if (!el) return false;
  var top = 0;
  if (keepScroll) top = Number(el.scrollTop) || 0;
  el.innerHTML = dgBodyHtml();
  if (keepScroll) {
    try { el.scrollTop = top; } catch (e) { /* нет скролла */ }
  }
  return true;
}

function dgSyncTabClasses() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  var nodes = document.querySelectorAll('[data-digest-tab]');
  if (!nodes || !nodes.length) return;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var key = el.getAttribute('data-digest-tab');
    var cls = String(el.className || '').replace(/\s*dg-tab-active/g, '');
    el.className = cls + (key === DG_TAB ? ' dg-tab-active' : '');
  }
}

// refreshDigestBadge(): только число в кнопке шапки, без render().
function refreshDigestBadge() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
  var badge = null;
  try { badge = document.querySelector('.dg-entry-badge'); } catch (e) { return false; }
  var total = digestModel().now.total;
  if (badge) {
    badge.textContent = String(total);
    if (badge.style) badge.style.display = total > 0 ? '' : 'none';
    return true;
  }
  // Бейджа не было (total был 0) — создаём его внутри кнопки, если она есть.
  if (total <= 0) return false;
  var btn = null;
  try { btn = document.querySelector('[data-digest-open]'); } catch (e) { return false; }
  if (!btn || typeof document.createElement !== 'function') return false;
  var span = document.createElement('span');
  span.className = 'dg-entry-badge';
  span.textContent = String(total);
  btn.appendChild(span);
  return true;
}

// refreshDigestIfOpen(): пересчитать и перерисовать тело открытого окна.
// Если окна нет — тихо выйти (смоуки, другие экраны).
function refreshDigestIfOpen() {
  var el = dgScrollEl();
  if (!el) return false;
  dgPaintBody(true);
  return true;
}

// Есть ли в контейнере модалок что-то, кроме сводки (перенос, конфликт взятия).
function dgOtherModalOpen() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return false;
  var host = document.getElementById('modal-container');
  if (!host) return false;
  if (dgScrollEl()) return false;
  var html = String(host.innerHTML || '');
  return html.replace(/\s+/g, '') !== '';
}

// --- 11. Делегирование (capture — чтобы не пересечься с data-order) ---

document.addEventListener('click', function (ev) {
  var t = ev.target;
  if (!t || typeof t.closest !== 'function') return;

  // Открытие окна из шапки.
  if (t.closest('[data-digest-open]')) {
    ev.stopPropagation();
    ev.preventDefault();
    openDigest();
    return;
  }

  // Переключение вкладки: меняется только тело, шапка и табы на месте.
  var tab = t.closest('[data-digest-tab]');
  if (tab) {
    ev.stopPropagation();
    ev.preventDefault();
    var next = tab.getAttribute('data-digest-tab');
    DG_TAB = (next === 'day') ? 'day' : 'now';
    dgLsSet(DG_TAB_KEY, DG_TAB);
    dgSyncTabClasses();
    dgPaintBody(false);
    var el = dgScrollEl();
    if (el) { try { el.scrollTop = 0; } catch (e) { /* нет скролла */ } }
    return;
  }

  // Сворачивание секции: без перерисовки, чтобы не терять скролл.
  var head = t.closest('[data-dg-toggle]');
  if (head) {
    ev.stopPropagation();
    ev.preventDefault();
    var key = head.getAttribute('data-dg-toggle');
    var sec = null;
    if (typeof head.closest === 'function') sec = head.closest('.dg-sec');
    if (!sec && head.parentNode) sec = head.parentNode;
    var opened = dgOpenState();
    var isOpen = !!opened[key];
    if (sec && sec.classList && typeof sec.classList.toggle === 'function') {
      isOpen = !!sec.classList.toggle('dg-open');
    } else {
      isOpen = !isOpen;
    }
    opened[key] = isOpen;
    dgSaveOpen();
    return;
  }

  // Прыжок к секции из KPI-плитки.
  var jump = t.closest('[data-digest-jump]');
  if (jump) {
    ev.stopPropagation();
    ev.preventDefault();
    dgJumpTo(jump.getAttribute('data-digest-jump'));
    return;
  }

  // Обновление по кнопке.
  if (t.closest('[data-digest-refresh]')) {
    ev.stopPropagation();
    ev.preventDefault();
    dgPaintBody(true);
    return;
  }

  // Озвучка.
  if (t.closest('[data-digest-speak]')) {
    ev.stopPropagation();
    ev.preventDefault();
    speakDigest();
    return;
  }

  // Клик по действию строки: чужие делегаты НЕ перехватываем и состояние не
  // меняем. Только запоминаем, что после их работы окно надо вернуть.
  if (dgScrollEl() && dgIsRowAction(t)) {
    DG_RESTORE = true;
  }
}, true);

// Действия строк, после которых окно сводки нужно вернуть или обновить.
function dgIsRowAction(t) {
  var attrs = ['[data-call-result]', '[data-take-order]', '[data-confirm-helper]',
    '[data-toggle-task]', '[data-transfer-order]'];
  for (var i = 0; i < attrs.length; i++) {
    if (t.closest(attrs[i])) return true;
  }
  return false;
}

function dgJumpTo(key) {
  var opened = dgOpenState();
  if (key && !opened[key]) {
    opened[key] = true;
    dgSaveOpen();
  }
  // Секция должна существовать в текущем теле: если открыт «Итог дня» — уходим
  // на «Сейчас», где эти секции есть.
  var el = dgScrollEl();
  if (!el) return;
  if (DG_TAB !== 'now') {
    DG_TAB = 'now';
    dgLsSet(DG_TAB_KEY, DG_TAB);
    dgSyncTabClasses();
    dgPaintBody(false);
    el = dgScrollEl();
  }
  if (!el) return;
  var sec = null;
  if (typeof el.querySelector === 'function') {
    sec = el.querySelector('[data-dg-sec="' + key + '"]');
  }
  if (!sec) return;
  if (sec.classList && typeof sec.classList.add === 'function') sec.classList.add('dg-open');
  if (typeof sec.scrollIntoView === 'function') {
    try { sec.scrollIntoView({ block: 'start' }); } catch (e) { /* старый браузер */ }
  }
}

// Возврат окна после действия строки: чужой делегат уже отработал.
document.addEventListener('click', function (ev) {
  if (!DG_RESTORE) return;
  DG_RESTORE = false;
  var t = ev.target;
  // Переход в карточку (data-order) закрывает сводку намеренно: пользователь
  // уходит на экран заявки. Восстанавливаем только действия «на месте».
  if (t && typeof t.closest === 'function' && t.closest('[data-order]')) return;
  // Модалка поверх сводки (перенос, конфликт взятия) — окно вернём, когда
  // пользователь её закроет; сейчас не подменяем её содержимое.
  if (dgOtherModalOpen()) return;
  refreshDigestIfOpen();
});

// Закрытие окна: гасим озвучку, чтобы голос не продолжался на другом экране.
document.addEventListener('click', function (ev) {
  var t = ev.target;
  if (!t || typeof t.closest !== 'function') return;
  if (!t.closest('[data-close]')) return;
  if (!dgScrollEl()) return;
  dgStopSpeech();
});

// --- 12. Экспорт ---

window.renderDigestButton = renderDigestButton;
window.renderDigestModal = renderDigestModal;
window.openDigest = openDigest;
window.digestModel = digestModel;
window.digestDayTotals = digestDayTotals;
window.digestSpeechText = digestSpeechText;
window.speakDigest = speakDigest;
window.refreshDigestBadge = refreshDigestBadge;
window.refreshDigestIfOpen = refreshDigestIfOpen;
