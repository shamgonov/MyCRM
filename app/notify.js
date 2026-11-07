/* CRM2 :: app/notify.js — напоминания по заявкам и системные уведомления (Этап 9).
   Только локально: localStorage + нативный Notification API. Никаких push-серверов.
   Зависит от db.js (DB, lsGet/lsSet, localToday, dateShift), gates.js (isAssignedToMe),
   core.js (state, go, render, toast). */
'use strict';

// Статусы, по которым напоминания уже не нужны.
const NOTIFY_DONE = ['completed', 'paid', 'canceled'];

// Подписи kind для чипов баннера.
const REMINDER_LABELS = {
  overdue: '⚠️ Просрочено',
  upcoming: '⏰ Скоро',
  today: '📅 Сегодня',
  material: '🧱 Материалы'
};

// Ключ localStorage: { "<kind>:<orderId>": "YYYY-MM-DD" } — напоминание скрыто на день.
const SEEN_KEY = 'crm2_seen';

// 'HH:MM' → минуты от полуночи; null, если формат некорректный.
// Локальная копия: notify.js не должен зависеть от порядка загрузки ui-calendar.js.
function minutesOf(hhmm) {
  if (!hhmm || String(hhmm).indexOf(':') < 0) return null;
  const p = String(hhmm).split(':');
  const h = Number(p[0]);
  const m = Number(p[1]);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// Дата+время начала визита как локальный Date; null, если даты нет.
function orderStart(o) {
  if (!o || !o.date) return null;
  const p = String(o.date).split('-');
  const mins = minutesOf(o.t1);
  if (mins === null) return null;
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
    Math.floor(mins / 60), mins % 60, 0, 0);
}

// Часов до визита (отрицательное — визит уже прошёл).
function hoursUntil(start, now) {
  return (start.getTime() - now.getTime()) / 3600000;
}

// --- 1. Ближайшие мои незавершённые заявки ---

// getUpcomingOrders(hoursWindow): мои заявки, чей визит уже просрочен или случится
// в пределах hoursWindow часов (по умолчанию 48 — «сегодня и завтра»).
function getUpcomingOrders(hoursWindow) {
  const now = new Date();
  const horizonH = Number(hoursWindow) > 0 ? Number(hoursWindow) : 48;
  if (typeof isAssignedToMe !== 'function') return [];
  return (DB.orders || [])
    .filter(function (o) { return isAssignedToMe(o); })
    .filter(function (o) { return NOTIFY_DONE.indexOf(o.status) < 0; })
    .map(function (o) { return { o: o, start: orderStart(o) }; })
    .filter(function (x) { return !!x.start; })
    .filter(function (x) { return hoursUntil(x.start, now) <= horizonH; })
    .sort(function (a, b) { return a.start - b.start; })
    .map(function (x) { return x.o; });
}

// --- 2. Список напоминаний ---

function reminderKey(kind, orderId) { return kind + ':' + orderId; }

function seenToday(key) {
  const seen = lsGet(SEEN_KEY, null);
  if (!seen) return false;
  let map = null;
  try { map = JSON.parse(seen); } catch (e) { map = null; }
  return !!(map && map[key] === localToday());
}

// Отметить напоминание показанным/скрытым на сегодня.
function markSeen(key) {
  const raw = lsGet(SEEN_KEY, null);
  let map = null;
  try { map = raw ? JSON.parse(raw) : null; } catch (e) { map = null; }
  if (!map || typeof map !== 'object') map = {};
  // Заодно чистим отметки прошлых дней — иначе ключи копились бы бесконечно.
  const today = localToday();
  Object.keys(map).forEach(function (k) { if (map[k] !== today) delete map[k]; });
  map[key] = today;
  lsSet(SEEN_KEY, JSON.stringify(map));
}

// Один kind на заявку по времени: overdue → upcoming → today.
function timeKind(o, now, beforeH) {
  const start = orderStart(o);
  if (!start) return null;
  const h = hoursUntil(start, now);
  if (h < 0) return 'overdue';
  if (h <= beforeH) return 'upcoming';
  if (o.date === localToday()) return 'today';
  return null;
}

// buildReminders(orders): [{orderId, title, when, kind, key}] без скрытых сегодня.
function buildReminders(orders) {
  const now = new Date();
  const s = (DB && DB.settings) || {};
  const beforeH = Number(s.remindBeforeH) > 0 ? Number(s.remindBeforeH) : 2;
  const list = orders || getUpcomingOrders();
  const out = [];

  (list || []).forEach(function (o) {
    const kind = timeKind(o, now, beforeH);
    if (kind) {
      const key = reminderKey(kind, o.id);
      if (!seenToday(key)) {
        out.push({
          orderId: o.id,
          key: key,
          kind: kind,
          title: '№' + o.id + ' ' + (o.client || ''),
          when: o.date + ' ' + (o.t1 || '')
        });
      }
    }
    // Материалы к закупке — отдельное напоминание по той же заявке.
    const needed = (o.materials || []).filter(function (m) { return m.status === 'needed'; });
    if (needed.length) {
      const key = reminderKey('material', o.id);
      if (!seenToday(key)) {
        out.push({
          orderId: o.id, key: key, kind: 'material',
          title: '№' + o.id + ' ' + (o.client || ''),
          when: needed.length + ' поз. к закупке'
        });
      }
    }
  });
  return out;
}

// --- 3. Периодическая проверка ---

var NOTIFY_TIMER = null;

// scheduleChecks(intervalSec): пересчёт напоминаний по таймеру (не чаще 60 сек).
// Новые напоминания уходят в системное уведомление и помечаются показанными.
function scheduleChecks(intervalSec) {
  const ms = Math.max(60, Number(intervalSec) > 0 ? Number(intervalSec) : 300) * 1000;
  if (NOTIFY_TIMER !== null) return NOTIFY_TIMER;
  if (typeof setInterval !== 'function') return null;
  NOTIFY_TIMER = setInterval(function () { notifyTick(); }, ms);
  return NOTIFY_TIMER;
}

function notifyTick() {
  const fresh = buildReminders(getUpcomingOrders());
  fresh.forEach(function (r) {
    showSystemNotification(REMINDER_LABELS[r.kind] || 'CRM2', r.title + ' · ' + r.when);
    markSeen(r.key); // не дублируем уведомление об одном заказе в тот же день
  });
  if (typeof state !== 'undefined' && state.screen === 'orders' && typeof render === 'function') {
    render();
  }
  return fresh.length;
}

// --- 4/5. Разрешение и системное уведомление ---

function setNotifyEnabled(on) {
  if (DB && DB.settings) { DB.settings.notifyEnabled = !!on; save(); }
}

// Синхронно: 'granted' | 'denied' | 'unsupported'; при 'prompt' запускается
// браузерный диалог и возвращается 'prompt' (результат применится в колбэке).
function requestNotifyPermission() {
  if (typeof Notification === 'undefined' || !Notification ||
      typeof Notification.requestPermission !== 'function') {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') { setNotifyEnabled(true); return 'granted'; }
  if (Notification.permission === 'denied') { setNotifyEnabled(false); return 'denied'; }
  try {
    Notification.requestPermission(function (p) {
      setNotifyEnabled(p === 'granted');
      if (state.screen === 'orders' && typeof render === 'function') render();
    });
  } catch (e) {
    return 'denied';
  }
  return String(Notification.permission || 'prompt');
}

// Тихий фолбэк: без API, без разрешения или при ошибке — false, без исключений.
function showSystemNotification(title, body) {
  if (typeof Notification === 'undefined' || !Notification) return false;
  if (Notification.permission !== 'granted') return false;
  if (!DB || !DB.settings || !DB.settings.notifyEnabled) return false;
  try {
    new Notification(title, { body: body || '', tag: 'crm2-notify' });
    return true;
  } catch (e) {
    return false;
  }
}

// --- 6. Баннер напоминаний над списком заявок ---

function renderNotificationsBar() {
  if (typeof isAssignedToMe !== 'function') return '';
  const items = buildReminders(getUpcomingOrders());
  if (!items.length) return '';

  const counts = {};
  items.forEach(function (r) { counts[r.kind] = (counts[r.kind] || 0) + 1; });

  const chips = Object.keys(REMINDER_LABELS)
    .filter(function (k) { return counts[k]; })
    .map(function (k) {
      return '<button class="chip" data-reminder="' + items.filter(function (r) {
        return r.kind === k;
      })[0].orderId + '">' + REMINDER_LABELS[k] + ' ' + counts[k] + '</button>';
    }).join('');

  const rows = items.map(function (r) {
    return '<div class="list-item" data-reminder="' + r.orderId + '">' +
        '<div class="spread">' +
          '<span><b>' + escapeHtml(r.title) + '</b>' +
            ' <span class="small muted">' + escapeHtml(r.when) + '</span></span>' +
          '<button class="btn" data-remind-dismiss="' + r.key + '" title="Скрыть на сегодня">✕</button>' +
        '</div>' +
      '</div>';
  }).join('');

  const permBtn = '<button class="btn btn-primary" data-notify-enable>🔔 Разрешить уведомления</button>';

  return '<div class="card">' +
      '<div class="spread"><h4>Напоминания: ' + items.length + '</h4>' + permBtn + '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="list">' + rows + '</div>' +
    '</div>';
}

// --- 7. Делегирование событий ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  const enable = sel('[data-notify-enable]');
  if (enable) {
    const res = requestNotifyPermission();
    if (res === 'granted') toast('Уведомления включены');
    else if (res === 'unsupported') toast('Браузер не поддерживает уведомления', true);
    else if (res === 'denied') toast('Уведомления запрещены браузером', true);
    else toast('Разрешите уведомления в диалоге браузера');
    if (state.screen === 'orders' && typeof render === 'function') render();
    return;
  }

  const dismiss = sel('[data-remind-dismiss]');
  if (dismiss) {
    markSeen(dismiss.getAttribute('data-remind-dismiss'));
    toast('Скрыто до завтра');
    if (state.screen === 'orders' && typeof render === 'function') render();
    return;
  }

  const rem = sel('[data-reminder]');
  if (rem) {
    const id = Number(rem.getAttribute('data-reminder'));
    if (typeof ORD_TAB !== 'undefined') ORD_TAB = 'main';
    go('order', id);
    return;
  }
});

// Явный экспорт: баннер вызывают из ui-orders.js.
window.renderNotificationsBar = renderNotificationsBar;
