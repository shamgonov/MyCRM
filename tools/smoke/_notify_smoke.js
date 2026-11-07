/* Смоук app/notify.js (Этап 9): напоминания по заявкам и системные уведомления. */
'use strict';

globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
const appStub = { innerHTML: '' };
const navStub = { innerHTML: '' };
const modalStub = { innerHTML: '' };
// Делегаты click собираем с самого начала — они регистрируются при загрузке модулей.
const clickHandlers = [];
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
  },
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
};
globalThis.confirm = function () { return false; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
const intervals = [];
globalThis.setInterval = function (fn, ms) { intervals.push({ fn: fn, ms: ms }); return intervals.length; };

// Мок Notification: КОНСТРУКТОР (notify.js делает new Notification(...)).
function NotifMock(title, opts) {
  NotifMock.last = { title: title, opts: opts };
  NotifMock.count++;
}
NotifMock.permission = 'default';
NotifMock.count = 0;
NotifMock.last = null;
NotifMock.requestPermission = function (cb) {
  NotifMock.permission = 'granted';
  if (cb) cb('granted');
};
globalThis.Notification = NotifMock;

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-estimate.js');
loadModule('app/ui-shopping.js');
loadModule('app/ui-docs.js');
loadModule('app/notify.js');

setOwnerFlag(false);
DB.users = [];
login('worker', 'Мастер');

const CLOSED = ['completed', 'paid', 'canceled'];

// --- 1. getUpcomingOrders: только назначенные, без закрытых ---
const upcoming = getUpcomingOrders(48);
assert(upcoming.length > 0, 'getUpcomingOrders: есть назначенные заявки в окне 48ч');
assert(upcoming.every(function (o) { return isAssignedToMe(o); }),
  'getUpcomingOrders: все заявки назначены текущему пользователю');
assert(upcoming.every(function (o) { return CLOSED.indexOf(o.status) < 0; }),
  'getUpcomingOrders: нет completed/paid/canceled');
const doneOrder = DB.orders.find(function (o) { return o.status === 'completed'; });
assert(!!doneOrder, 'сид: есть completed-заявка');
assert(!upcoming.some(function (o) { return o.id === doneOrder.id; }),
  'getUpcomingOrders: completed-заявка не в списке');
// Сортировка по времени визита.
const starts = upcoming.map(orderStart).map(function (d) { return d.getTime(); });
assert(starts.every(function (v, i) { return i === 0 || starts[i - 1] <= v; }),
  'getUpcomingOrders: отсортировано по дате/времени визита');

// --- 2. buildReminders: корректные kind ---
DB.settings.remindBeforeH = 2;
const reminders = buildReminders(upcoming);
assert(reminders.length > 0, 'buildReminders: список непустой');
const KINDS = ['overdue', 'upcoming', 'today', 'material'];
assert(reminders.every(function (r) { return KINDS.indexOf(r.kind) >= 0; }),
  'buildReminders: kind всегда из ' + KINDS.join('/'));
assert(reminders.every(function (r) { return r.orderId && r.title && r.when && r.key; }),
  'buildReminders: есть orderId/title/when/key у каждого');

// Просроченная моя заявка → kind 'overdue'.
const late = DB.orders.find(function (o) {
  return isAssignedToMe(o) && o.date < localToday() && CLOSED.indexOf(o.status) < 0;
});
if (late) {
  const rLate = buildReminders([late]).filter(function (r) { return r.kind !== 'material'; });
  assert.eq(rLate.length ? rLate[0].kind : null, 'overdue', 'просроченная → kind overdue');
} else {
  // Нет просроченной «моей» — создадим временную, чтобы проверить ветку.
  const fake = { id: 9001, client: 'Тест', date: dateShift(localToday(), -2), t1: '10:00',
    status: 'approved', worker: 'Мастер', helpers: [], materials: [] };
  assert.eq(buildReminders([fake])[0].kind, 'overdue', 'просроченная (созданная) → overdue');
}

// Материалы needed → kind 'material'.
const matOrder = { id: 9002, client: 'Материал', date: dateShift(localToday(), 5), t1: '12:00',
  status: 'approved', worker: 'Мастер', helpers: [],
  materials: [{ name: 'Стекло', status: 'needed' }, { name: 'Окно', status: 'bought' }] };
const matRem = buildReminders([matOrder]).filter(function (r) { return r.kind === 'material'; });
assert.eq(matRem.length, 1, 'material: учтены только status=needed (1 из 2)');

// --- 3. Порог remindBeforeH влияет на 'upcoming' ---
const soon = { id: 9003, client: 'Скоро', date: dateShift(localToday(), 0), t1: '23:59',
  status: 'approved', worker: 'Мастер', helpers: [], materials: [] };
DB.settings.remindBeforeH = 1;
const narrow = buildReminders([soon]).filter(function (r) { return r.kind !== 'material'; });
DB.settings.remindBeforeH = 5;
const wide = buildReminders([soon]).filter(function (r) { return r.kind !== 'material'; });
const narrowUpcoming = narrow.filter(function (r) { return r.kind === 'upcoming'; }).length;
const wideUpcoming = wide.filter(function (r) { return r.kind === 'upcoming'; }).length;
assert(wideUpcoming >= narrowUpcoming,
  'remindBeforeH=5 даёт upcoming не меньше, чем при 1 (' + wideUpcoming + '>=' + narrowUpcoming + ')');
DB.settings.remindBeforeH = 2;

// --- 4. crm2_seen: повторно показанное исчезает из списка ---
assert.eq(seenToday('test:123'), false, 'seenToday: новый ключ не помечен');
markSeen('test:123');
assert.eq(seenToday('test:123'), true, 'seenToday: после markSeen помечен');
const realKey = reminders[0].key;
const before = buildReminders(upcoming).length;
markSeen(realKey);
const after = buildReminders(upcoming);
assert.eq(after.length, before - 1, 'crm2_seen: помеченное напоминание исчезло из списка');
assert(!after.some(function (r) { return r.key === realKey; }),
  'crm2_seen: помеченный key не возвращается');
assert(JSON.parse(localStorage.getItem('crm2_seen'))[realKey] === localToday(),
  'crm2_seen: отметка хранится в localStorage с датой сегодня');

// --- 5. requestNotifyPermission ---
assert.eq(requestNotifyPermission(), 'granted', 'requestNotifyPermission: granted при разрешении');
assert.eq(DB.settings.notifyEnabled, true, 'requestNotifyPermission: notifyEnabled=true');
const savedNotif = globalThis.Notification;
globalThis.Notification = undefined;
assert.eq(requestNotifyPermission(), 'unsupported', 'requestNotifyPermission: без API → unsupported');
globalThis.Notification = savedNotif;

// --- 6. showSystemNotification не бросает при denied/unsupported ---
NotifMock.permission = 'granted';
DB.settings.notifyEnabled = true;
assert.eq(showSystemNotification('Заголовок', 'Текст'), true, 'showSystemNotification: granted → true');
assert.eq(NotifMock.last.title, 'Заголовок', 'showSystemNotification: заголовок передан');
NotifMock.permission = 'denied';
assert.eq(showSystemNotification('t', 'b'), false, 'showSystemNotification: denied → false');
const cBefore = NotifMock.count;
assert.eq(showSystemNotification('t', 'b'), false, 'showSystemNotification: denied не создаёт объект');
assert.eq(NotifMock.count, cBefore, 'showSystemNotification: на denied Notification не вызван');
NotifMock.permission = 'granted';
globalThis.Notification = undefined;
assert.eq(showSystemNotification('t', 'b'), false, 'showSystemNotification: unsupported → false');
globalThis.Notification = savedNotif;
// Выключенный тумблер — не уведомляем даже при granted.
DB.settings.notifyEnabled = false;
assert.eq(showSystemNotification('t', 'b'), false, 'showSystemNotification: notifyEnabled=false → false');
DB.settings.notifyEnabled = true;

// --- 7. renderNotificationsBar: счётчик + кнопка разрешения ---
localStorage.removeItem('crm2_seen');
const barHtml = renderNotificationsBar();
assert(barHtml.length > 0, 'renderNotificationsBar: непустой HTML');
assert(barHtml.indexOf('data-notify-enable') >= 0, 'renderNotificationsBar: кнопка data-notify-enable');
assert(/Напоминания:\s*\d+/.test(barHtml), 'renderNotificationsBar: счётчик «Напоминания: N»');
assert(barHtml.indexOf('data-reminder="') >= 0, 'renderNotificationsBar: чипы/строки data-reminder');
assert(barHtml.indexOf('data-remind-dismiss="') >= 0, 'renderNotificationsBar: кнопка data-remind-dismiss');
assert(barHtml.indexOf('onclick') < 0, 'renderNotificationsBar: инлайн-обработчиков нет');

// --- 8. Клик по data-reminder ведёт в карточку заявки (делегирование) ---
function clickAttr(attr, value) {
  const node = { getAttribute: function (a) { return a === attr ? value : null; } };
  const ev = { target: { closest: function (s) {
    return s === '[' + attr + ']' ? node : null;
  } } };
  clickHandlers.forEach(function (fn) { fn(ev); });
}
const goBefore = [state.screen, state.orderId];
clickAttr('data-reminder', '3');
assert.eq(state.screen, 'order', 'клик data-reminder: экран order');
assert.eq(state.orderId, 3, 'клик data-reminder: открыта заявка №3');
void goBefore;

// Клик по data-remind-dismiss скрывает напоминание.
localStorage.removeItem('crm2_seen');
const kDismiss = buildReminders(upcoming)[0].key;
clickAttr('data-remind-dismiss', kDismiss);
assert.eq(seenToday(kDismiss), true, 'клик data-remind-dismiss: напоминание скрыто');

// Клик по data-notify-enable включает уведомления.
NotifMock.permission = 'default';
DB.settings.notifyEnabled = false;
clickAttr('data-notify-enable', '');
assert.eq(DB.settings.notifyEnabled, true, 'клик data-notify-enable: notifyEnabled=true');

// --- 9. Регрессия: без notify.js список заявок не падает (typeof-обёртка) ---
const savedBar = globalThis.renderNotificationsBar;
globalThis.renderNotificationsBar = undefined;
const htmlNoModule = renderOrdersList();
assert(htmlNoModule.indexOf('📋 Заявки') >= 0,
  'регрессия: renderOrdersList работает без renderNotificationsBar');
assert(htmlNoModule.indexOf('data-filter="all"') >= 0,
  'регрессия: без notify.js чипы фильтров на месте');
assert(htmlNoModule.indexOf('data-notify-enable') < 0,
  'регрессия: без notify.js баннер отсутствует');
globalThis.renderNotificationsBar = savedBar;
assert(renderOrdersList().indexOf('data-notify-enable') >= 0,
  'регрессия: с notify.js баннер возвращается');

// --- Дополнительно: scheduleChecks не чаще 60 сек и не дублирует таймер ---
const timersBefore = intervals.length;
scheduleChecks(10); // запрос 10 сек должен быть поднят до минимума 60
assert.eq(intervals.length, timersBefore + 1, 'scheduleChecks: завёл один таймер');
assert(intervals[intervals.length - 1].ms >= 60000,
  'scheduleChecks: интервал не короче 60 сек (' + intervals[intervals.length - 1].ms + 'мс)');
scheduleChecks(10);
assert.eq(intervals.length, timersBefore + 1, 'scheduleChecks: повторный вызов не плодит таймер');
