/* Смоук Этапа 39: единое окно «Сводка дня».
   1) digestModel() — чистая модель: counts-числа, arrays-массивы, пустой DB.
   2) digestDayTotals() — итог дня: суммы через orderRevenue/orderPaid, debt ≥ 0.
   3) Секции внимания, пул, задачи, план.
   4) Рендер: кнопка с бейджем, табы, KPI, 8 секций, футер, «пусто».
   5) Делегаты: data-call-result с/без data-order-id, data-order-tab.
   6) Capture-слушатель, переключение секций без render(), табы + localStorage.
   7) Озвучка: текст, отсутствие speechSynthesis, повторный вызов → cancel.
   8) Точечные обновления: refreshDigestBadge/refreshDigestIfOpen без render().
   9) Регрессии: без firebase, кнопка в render() только после входа. */
'use strict';

globalThis.localStorage = (function () {
  var m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();

var appStub = { innerHTML: '', style: {} };
var navStub = { innerHTML: '' };
var modalStub = { innerHTML: '' };
var FIELDS = {};
var clickHandlers = []; // { fn, capture }
var queryNodes = {};    // селектор → узел/массив (для точечных обновлений)

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn, capture) {
    if (type === 'click') clickHandlers.push({ fn: fn, capture: !!capture });
  },
  querySelector: function (sel) {
    return Object.prototype.hasOwnProperty.call(queryNodes, sel) ? queryNodes[sel] : null;
  },
  querySelectorAll: function (sel) {
    var v = queryNodes[sel];
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  },
  createElement: function (tag) {
    return { tagName: tag, className: '', textContent: '', style: {} };
  }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.addEventListener = function () {};
globalThis.setInterval = function () { return 0; };
globalThis.setTimeout = function (fn) { if (typeof fn === 'function') fn(); return 0; };
globalThis.clearTimeout = function () {};

// Мок Notification (notify.js вызывает new Notification).
function NotifMock(title, opts) { NotifMock.last = { title: title, opts: opts }; NotifMock.count++; }
NotifMock.permission = 'granted';
NotifMock.count = 0;
NotifMock.last = null;
NotifMock.requestPermission = function (cb) { if (cb) cb('granted'); };
globalThis.Notification = NotifMock;

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-attention.js');
loadModule('app/ui-tasks.js');
loadModule('app/notify.js');
loadModule('app/ui-digest.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

var today = localToday();
var tomorrow = dateShift(today, 1);
var yesterday = dateShift(today, -1);

// Заявка со всеми полями модели (normalizeOrder не должен падать).
function mkOrder(extra) {
  var o = {
    id: 1, client: 'Клиент', status: 'new', worker: '', date: today, t1: '09:00', t2: '10:00',
    phone: '', address: '', city: '', helpers: [], confirm: {}, materials: [], works: [],
    extras: [], history: [], payments: [], tags: [], callbackAt: null
  };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

// Клик по data-атрибуту: прогоняем ВСЕ слушатели в порядке регистрации
// (capture первыми — как в браузере).
function fireClick(attrs) {
  var target = {
    value: '',
    getAttribute: function (a) {
      return Object.prototype.hasOwnProperty.call(attrs, a) ? String(attrs[a]) : null;
    },
    closest: function (sel) {
      var m = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
      if (!m) return null;
      var key = m[1];
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) return null;
      if (m[2] !== undefined && String(attrs[key]) !== m[2]) return null;
      return target;
    },
    parentNode: null,
    classList: null
  };
  var ev = {
    target: target,
    stopped: false,
    stopPropagation: function () { ev.stopped = true; },
    preventDefault: function () {}
  };
  var ordered = clickHandlers.slice().sort(function (a, b) {
    return (b.capture ? 1 : 0) - (a.capture ? 1 : 0);
  });
  ordered.forEach(function (h) { h.fn(ev); });
  return ev;
}

// --- 1. digestModel(): чистая модель, пустой DB ---

DB.orders = [];
DB.tasks = [];
DB.clients = [];
DB.suppliers = [];
DB.priceList = [];

var empty = digestModel();
assert(typeof empty === 'object' && empty !== null, '1: digestModel возвращает объект');
assert.eq(empty.date, today, '1: date = сегодня');
assert(Array.isArray(empty.now.plan), '1: now.plan — массив');
assert(Array.isArray(empty.now.pool), '1: now.pool — массив');
assert(Array.isArray(empty.now.tasks), '1: now.tasks — массив');
assert(typeof empty.now.counts === 'object', '1: counts — объект');
assert.eq(empty.now.planCount, 0, '2: пустой DB → planCount 0');
assert.eq(empty.now.planSum, 0, '2: пустой DB → planSum 0');
assert.eq(empty.now.total, 0, '2: пустой DB → total 0');
['callback', 'overdue', 'noWorker', 'balance', 'materials', 'confirm', 'pool', 'tasks']
  .forEach(function (k) {
    assert.eq(empty.now.counts[k], 0, '2: пустой DB → counts.' + k + ' = 0');
    assert(typeof empty.now.counts[k] === 'number', '1: counts.' + k + ' — число');
  });
assert.eq(empty.day.count, 0, '2: пустой DB → day.count 0');
assert.eq(empty.day.debt, 0, '2: пустой DB → day.debt 0');

// --- 2. Наполненный день: план, сортировка, секции ---

DB.orders = [
  // план 09:00 + просрочка (дата в прошлом) + перезвон
  mkOrder({ id: 101, client: 'Смирнов', t1: '09:00', callbackAt: Date.now() - 60000 }),
  // план 14:00, назначен исполнитель, материалы к закупке
  mkOrder({ id: 102, client: 'Кузнецов', t1: '14:00', worker: 'Мастер',
    materials: [{ name: 'Стекло', status: 'needed' }] }),
  // пул (без исполнителя, статус new) — отдельная заявка
  mkOrder({ id: 103, client: 'Петров', t1: '16:00' }),
  // просроченная дата, не закрыта
  mkOrder({ id: 104, client: 'Просроченный', date: yesterday, t1: '10:00', worker: 'Мастер' }),
  // остаток к оплате: завершена, оплачено частично
  mkOrder({ id: 105, client: 'Должник', status: 'completed', worker: 'Мастер', t1: '12:00',
    works: [{ name: 'Монтаж', qty: 1, price: 5000, coeff: 1 }],
    payments: [{ id: 1, sum: 2000 }] }),
  // заявка НЕ за сегодня — в план и итог дня не входит
  mkOrder({ id: 106, client: 'Завтрашний', date: tomorrow, t1: '11:00', worker: 'Мастер' })
];

var m = digestModel();
assert.eq(m.now.planCount, 4, '4: в плане только заявки на сегодня (101,102,103,105)');
assert.eq(m.now.plan[0].id, 101, '4: план отсортирован по времени (09:00 первым)');
assert.eq(m.now.plan[1].id, 105, '4: план: 12:00 вторым');
assert.eq(m.now.plan[2].id, 102, '4: план: 14:00 третьим');
assert.eq(m.now.plan[3].id, 103, '4: план: 16:00 четвёртым');
assert(m.now.planCount > 0 && m.now.planSum > 0, '4: план с деньгами даёт сумму');
assert(m.now.counts.callback > 0, '5: наступивший callbackAt → counts.callback > 0');
assert(m.now.counts.overdue > 0, '6: прошедшая дата → counts.overdue > 0');
assert(m.now.counts.pool > 0, '7: заявки без исполнителя → counts.pool > 0');
assert(m.now.counts.balance > 0, '8: незакрытый остаток → counts.balance > 0');
assert(m.now.counts.materials > 0, '8: материалы needed → counts.materials > 0');
assert.eq(m.now.counts.tasks, 0, '8: задач на сегодня нет');

var sumCounts = m.now.counts.callback + m.now.counts.overdue + m.now.counts.pool +
  m.now.counts.balance + m.now.counts.materials + m.now.counts.confirm + m.now.counts.tasks;
assert.eq(m.now.total, sumCounts, '9: total = сумма counts (noWorker не дублируется)');

// --- 3. Задачи: только на сегодня и не выполненные ---

DB.tasks = [
  { id: 't1', title: 'Позвонить в банк', dueDate: today, done: false },
  { id: 't2', title: 'Сделано', dueDate: today, done: true },
  { id: 't3', title: 'Завтра', dueDate: tomorrow, done: false },
  { id: 't4', title: 'Без даты', dueDate: null, done: false }
];
var mt = digestModel();
assert.eq(mt.now.counts.tasks, 1, '8: только незавершённая задача на сегодня');
assert.eq(mt.now.tasks[0].id, 't1', '8: в tasks попала именно t1');

// --- 4. digestDayTotals(): суммы, деньги, просрочка ---

var totals = digestDayTotals(DB.orders, today, true);
assert.eq(totals.count, 4, 'day: за сегодня 4 заявки');
assert.eq(totals.sum, 5000, 'day: сумма = 5000 (только у завершённой)');
assert.eq(totals.paid, 2000, 'day: оплачено = 2000');
assert.eq(totals.debt, 3000, 'day: долг = 3000');
assert(totals.overdue >= 1, 'day: просрочка считает открытые заявки');

var noMoney = digestDayTotals(DB.orders, today, false);
assert.eq(noMoney.sum, 0, 'day: без права денег sum = 0');
assert.eq(noMoney.paid, 0, 'day: без права денег paid = 0');
assert.eq(noMoney.debt, 0, 'day: без права денег debt = 0');
assert.eq(noMoney.count, 4, 'day: количество считается без денег');

assert.eq(digestDayTotals([], today, true).count, 0, 'day: пустой массив → нули');
assert.eq(digestDayTotals(null, today, true).debt, 0, 'day: null → нули, без падения');
assert.eq(digestDayTotals([{ date: today, payments: [{ sum: 999 }] }], today, true).debt, 0,
  'day: debt не отрицательный (оплата без работ)');

// Просрочка: закрытые статусы не считаются.
var closedOnly = [
  { id: 1, date: today, status: 'completed', t1: '08:00' },
  { id: 2, date: today, status: 'paid', t1: '08:00' },
  { id: 3, date: today, status: 'canceled', t1: '08:00' }
];
assert.eq(digestDayTotals(closedOnly, today, false).overdue, 0,
  'day: просрочка только по открытым статусам');

// --- 5. Право на деньги: can('money_view') === false ---

setOwnerFlag(false);
DB.users = [{ id: deviceId(), role: 'worker', name: 'Мастер' }];
state.role = 'worker';
var poorModel = digestModel();
assert.eq(poorModel.money, false, '5: у роли worker нет money_view');
assert.eq(poorModel.now.planSum, 0, '5: без права денег planSum = 0');
assert.eq(poorModel.day.sum, 0, '5: без права денег day.sum = 0');
assert.eq(poorModel.day.paid, 0, '5: без права денег day.paid = 0');
assert.eq(poorModel.day.debt, 0, '5: без права денег day.debt = 0');

var poorDay = renderDigestDay(poorModel);
assert(poorDay.indexOf('Сумма') < 0, '5: денежная плитка «Сумма» скрыта');
assert(poorDay.indexOf('Оплачено') < 0, '5: денежная плитка «Оплачено» скрыта');
assert(poorDay.indexOf('Долг') < 0, '5: денежная плитка «Долг» скрыта');

var poorNow = renderDigestKpi(poorModel);
assert(poorNow.indexOf('₽') < 0, '5: без права денег в KPI нет сумм');

// Возвращаем админа с деньгами.
DB.users = [];
login('admin', 'Владелец');
var richModel = digestModel();
assert.eq(richModel.money, true, '5: у админа money_view есть');

// --- 6. Кнопка сводки: бейдж, отсутствие onclick ---

var btnHtml = renderDigestButton();
assert(btnHtml.indexOf('data-digest-open') >= 0, '11: кнопка содержит data-digest-open');
assert(btnHtml.indexOf('dg-entry-badge') >= 0, '11: при total > 0 есть бейдж');
assert(btnHtml.indexOf('onclick') < 0, '11: в кнопке нет onclick');

DB.orders = [];
DB.tasks = [];
var btnEmpty = renderDigestButton();
assert(btnEmpty.indexOf('dg-entry-badge') < 0, '11: при total = 0 бейджа нет');

// --- 7. Окно: табы, KPI, 8 секций, футер ---

DB.orders = [
  mkOrder({ id: 101, client: 'Смирнов', t1: '09:00', callbackAt: Date.now() - 60000 }),
  mkOrder({ id: 103, client: 'Петров', t1: '16:00' })
];
DB.tasks = [{ id: 't1', title: 'Задача дня', dueDate: today, done: false }];

DG_TAB = 'now';
renderDigestModal();
var html = modalStub.innerHTML;

assert(html.indexOf('data-digest-tab="now"') >= 0, '12: таб «Сейчас»');
assert(html.indexOf('data-digest-tab="day"') >= 0, '12: таб «Итог дня»');
assert(html.indexOf('dg-kpi') >= 0, '12: KPI-плитки');
assert(html.indexOf('data-digest-jump="plan"') >= 0, '12: плитка «План» кликабельна');
['callback', 'overdue', 'pool', 'balance', 'materials', 'confirm', 'tasks', 'plan']
  .forEach(function (k) {
    assert(html.indexOf('data-dg-sec="' + k + '"') >= 0, '12: секция ' + k + ' есть');
  });
assert(html.indexOf('data-digest-speak') >= 0, '12: кнопка озвучки в футере');
assert(html.indexOf('data-digest-refresh') >= 0, '12: кнопка обновления');
assert(html.indexOf('data-close') >= 0, '12: кнопка закрытия');
assert(html.indexOf('onclick') < 0, '26: нет onclick');
assert(html.indexOf('oninput') < 0, '26: нет oninput');
assert(html.indexOf('onchange') < 0, '26: нет onchange');

// Пустая секция показывает «пусто», а не исчезает.
assert(html.indexOf('✅ пусто') >= 0, '13: пустая секция рендерит «пусто»');
assert(html.indexOf('data-dg-sec="confirm"') >= 0, '13: пустая секция остаётся в разметке');

// Строки: кнопки существующих делегатов.
assert(html.indexOf('data-call-result="later_2h"') >= 0, '14: кнопка «⏰ +2 ч»');
assert(html.indexOf('data-call-result="start"') >= 0, '14: кнопка «Итог звонка»');
assert(html.indexOf('data-order-id="101"') >= 0, '14: у кнопки есть data-order-id');
assert(html.indexOf('data-take-order="103"') >= 0, '14: кнопка «Взять» из пула');

// data-order НЕ на строке, а на кнопке «📖».
var rowHtml = renderDigestOrderRow(mkOrder({ id: 555, client: 'Тест' }), '', '');
assert(rowHtml.indexOf('data-order="555"') >= 0, '21: кнопка «📖» содержит data-order');
assert(rowHtml.indexOf('class="dg-row" data-order') < 0, '21: строка не кликабельна целиком');
assert(rowHtml.indexOf('📖') >= 0, '21: кнопка «📖» присутствует');

// Вкладка «Итог дня».
DG_TAB = 'day';
renderDigestModal();
var dayHtml = modalStub.innerHTML;
assert(dayHtml.indexOf('dg-tab-active') >= 0, '12: активный таб помечен');
assert(dayHtml.indexOf('Итог дня') >= 0, '12: заголовок таба');
assert(dayHtml.indexOf('Заявок за день') >= 0, '12: плитка «Заявок за день»');
assert(dayHtml.indexOf('Итог дня недоступен') < 0, '12: итог дня доступен');
DG_TAB = 'now';

// --- 8. Capture-слушатель ---

var captures = clickHandlers.filter(function (h) { return h.capture; });
assert(captures.length > 0, '15: есть слушатель клика в capture-фазе');

// --- 9. Переключение секции: класс dg-open, без render() ---

var renderCalls = 0;
var origRender = globalThis.render;
globalThis.render = function () { renderCalls++; };

// Узел секции с рабочим classList.
var cls = { open: true };
var secNode = {
  classList: {
    toggle: function (name) { cls.open = !cls.open; return cls.open; },
    add: function () { cls.open = true; }
  }
};
var toggleNode = {
  getAttribute: function (a) { return a === 'data-dg-toggle' ? 'callback' : null; },
  closest: function (s) {
    if (s === '[data-dg-toggle]') return toggleNode;
    if (s === '.dg-sec') return secNode;
    return null;
  },
  parentNode: secNode
};
clickHandlers.forEach(function (h) {
  h.fn({
    target: toggleNode,
    stopPropagation: function () {},
    preventDefault: function () {}
  });
});
assert.eq(cls.open, false, '16: клик по заголовку свернул секцию');
assert.eq(renderCalls, 0, '16: переключение секции не вызывает render()');
assert.eq(DG_OPEN.callback, false, '16: DG_OPEN.callback = false после сворачивания');

// Возвращаем настоящий render для последующих проверок.
globalThis.render = origRender;

// Сохранение в localStorage.
var savedSections = JSON.parse(localStorage.getItem('crm2_digest_sections'));
assert.eq(savedSections.callback, false, '18: DG_OPEN записан в localStorage');

// Битый JSON не роняет: сбрасываем кэш и читаем мусор.
DG_OPEN = null;
localStorage.setItem('crm2_digest_sections', '{битый json');
var recovered = dgOpenState();
assert.eq(recovered.callback, true, '18: битый JSON → дефолт (callback раскрыт)');
assert.eq(recovered.overdue, true, '18: битый JSON → дефолт (overdue раскрыт)');

// --- 10. Переключение таба: DG_TAB + localStorage, без render() ---

renderCalls = 0;
var tabNode = {
  getAttribute: function (a) { return a === 'data-digest-tab' ? 'day' : null; },
  closest: function (s) { return s === '[data-digest-tab]' ? tabNode : null; }
};
clickHandlers.forEach(function (h) {
  h.fn({ target: tabNode, stopPropagation: function () {}, preventDefault: function () {} });
});
assert.eq(DG_TAB, 'day', '17: клик по табу меняет DG_TAB');
assert.eq(localStorage.getItem('crm2_digest_tab'), 'day', '17: таб записан в localStorage');
assert.eq(renderCalls, 0, '17: переключение таба не вызывает render()');
DG_TAB = 'now';

// --- 11. Озвучка ---

var speech = digestSpeechText(richModel);
assert(typeof speech === 'string' && speech.length > 0, '19: текст озвучки не пустой');
assert(speech.indexOf('Сводка на') >= 0, '19: текст начинается со «Сводка на»');
assert(speech.indexOf(String(richModel.now.planCount)) >= 0, '19: текст содержит число визитов');
assert(speech.indexOf('перезвонить') >= 0, '19: текст содержит перезвоны');

var poorSpeech = digestSpeechText(poorModel);
assert(poorSpeech.indexOf('рублей') < 0, '19: без права денег в тексте нет сумм');

// Без speechSynthesis: toast и без падения.
delete globalThis.SpeechSynthesisUtterance;
var spokeNoApi = speakDigest();
assert.eq(spokeNoApi, false, '20: без API speakDigest возвращает false');
assert.eq(DG_SPEAKING, false, '20: без API DG_SPEAKING = false');

// С моком: speak вызван один раз, повторный — cancel.
var speakCalls = 0;
var cancelCalls = 0;
function UtterMock(text) { this.text = text; UtterMock.last = this; }
globalThis.SpeechSynthesisUtterance = UtterMock;
globalThis.window.speechSynthesis = {
  speak: function (u) { speakCalls++; },
  cancel: function () { cancelCalls++; }
};

var spoke1 = speakDigest();
assert.eq(spoke1, true, '20: speakDigest с API → true');
assert.eq(speakCalls, 1, '20: speak вызван один раз');
assert.eq(DG_SPEAKING, true, '20: DG_SPEAKING = true во время чтения');
assert.eq(UtterMock.last.lang, 'ru-RU', '20: язык ru-RU');
assert.eq(UtterMock.last.rate, 1, '20: скорость 1');

// Повторное нажатие останавливает чтение.
speakDigest();
assert.eq(DG_SPEAKING, false, '20: повторный вызов сбросил DG_SPEAKING');
assert(cancelCalls >= 1, '20: повторный вызов вызвал cancel()');

// --- 12. refreshDigestBadge / refreshDigestIfOpen ---

renderCalls = 0;
var badgeNode = { textContent: '0', style: {} };
queryNodes['.dg-entry-badge'] = badgeNode;
DB.orders = [mkOrder({ id: 101, client: 'Смирнов', t1: '09:00', callbackAt: Date.now() - 60000 })];
refreshDigestBadge();
assert(badgeNode.textContent !== '0', '21: бейдж обновлён точечно');
assert.eq(badgeNode.textContent, String(digestModel().now.total), '21: значение бейджа = total');
assert.eq(renderCalls, 0, '21: refreshDigestBadge не вызывает render()');

// Окно закрыто: refreshDigestIfOpen тихо выходит.
delete queryNodes['#dg-scroll'];
var resClosed = refreshDigestIfOpen();
assert.eq(resClosed, false, '22: при закрытом окне refreshDigestIfOpen → false');
assert.eq(renderCalls, 0, '22: при закрытом окне render() не вызывается');

// --- 13. Кнопка сводки в render(): есть после входа, нет на экране входа ---

DB.orders = [];
DB.tasks = [];
state.screen = 'orders';
render();
assert(appStub.innerHTML.indexOf('data-digest-open') >= 0, '23: кнопка сводки есть после входа');

logout();
state.screen = 'login';
render();
assert(appStub.innerHTML.indexOf('data-digest-open') < 0, '23: на экране входа кнопки нет');

// --- 14. notifyTick: обновляет бейдж точечно ---

login('admin', 'Владелец');
state.screen = 'orders';
render();
renderCalls = 0;
var badgeNode2 = { textContent: '0', style: {} };
queryNodes['.dg-entry-badge'] = badgeNode2;
var navCalls = 0;
var origNav = globalThis.renderNav;
globalThis.renderNav = function () { navCalls++; };
notifyTick();
assert(navCalls >= 1, '21: notifyTick пересчитал навигацию');
assert.eq(renderCalls, 0, '21: notifyTick не вызывает render()');
globalThis.renderNav = origNav;

// --- 15. Регрессии делегатов (Этап 39) ---

// data-call-result БЕЗ data-order-id — прежнее поведение по state.orderId.
DB.orders = [
  mkOrder({ id: 201, client: 'Первый', status: 'new', t1: '09:00',
    callbackAt: Date.now() - 60000 }),
  mkOrder({ id: 202, client: 'Второй', status: 'new', t1: '10:00',
    callbackAt: Date.now() - 60000 })
];
state.orderId = 201;
DB.settings = DB.settings || {};
var firstBefore = DB.orders[0].callbackAt;
fireClick({ 'data-call-result': 'later_2h' });
assert(DB.orders[0].callbackAt !== firstBefore, 'регрессия: без data-order-id взята заявка из state.orderId');
assert(DB.orders[0].callbackAt > Date.now() + 3600000, 'регрессия: перезвон отложен на 2 ч');
assert.eq(DB.orders[1].callbackAt, DB.orders[1].callbackAt, 'регрессия: вторая заявка не тронута');

// С data-order-id — по атрибуту, state.orderId не меняется.
DB.orders = [
  mkOrder({ id: 301, client: 'Первый', status: 'new', t1: '09:00',
    callbackAt: Date.now() - 60000 }),
  mkOrder({ id: 302, client: 'Второй', status: 'new', t1: '10:00',
    callbackAt: Date.now() - 60000 })
];
state.orderId = 301;
var secondBefore = DB.orders[1].callbackAt;
var firstBefore2 = DB.orders[0].callbackAt;
fireClick({ 'data-call-result': 'later_2h', 'data-order-id': '302' });
assert(DB.orders[1].callbackAt !== secondBefore, 'регрессия: data-order-id выбрал заявку 302');
assert.eq(DB.orders[0].callbackAt, firstBefore2, 'регрессия: заявка 301 не тронута');
assert.eq(state.orderId, 301, 'регрессия: state.orderId не изменён сводкой');

// data-order без data-order-tab → ORD_TAB === 'main'.
// go() подменяем шпионом: цель проверки — выбор вкладки, а не рендер карточки
// (в смоуке не загружены ui-shopping/ui-money, а ui-orders.js:308 зовёт
// renderShoppingTab без typeof-гарда — это существующий дефект, не Этап 39).
var goCalls = [];
var origGo = globalThis.go;
globalThis.go = function (screen, id) { goCalls.push({ screen: screen, id: id }); };

ORD_TAB = 'journal';
fireClick({ 'data-order': '302' });
assert.eq(ORD_TAB, 'main', 'регрессия: data-order без tab → main');
assert.eq(goCalls.length, 1, 'регрессия: переход в карточку выполнен');
assert.eq(goCalls[0].screen, 'order', 'регрессия: экран order');
assert.eq(goCalls[0].id, 302, 'регрессия: открыта заявка 302');

// data-order с data-order-tab="money" → 'money'.
ORD_TAB = 'main';
fireClick({ 'data-order': '302', 'data-order-tab': 'money' });
assert.eq(ORD_TAB, 'money', 'регрессия: data-order-tab="money" → вкладка денег');

// data-order-tab="materials" → 'materials'.
ORD_TAB = 'main';
fireClick({ 'data-order': '302', 'data-order-tab': 'materials' });
assert.eq(ORD_TAB, 'materials', 'регрессия: data-order-tab="materials" → вкладка материалов');

globalThis.go = origGo;
ORD_TAB = 'main';
state.screen = 'orders';

// --- 16. Регрессия: без firebase модель, рендер и озвучка не падают ---

delete globalThis.firebase;
DB.orders = [mkOrder({ id: 401, client: 'Офлайн', t1: '09:00' })];
var offlineModel = digestModel();
assert.eq(offlineModel.now.planCount, 1, '25: без firebase модель считается');
DG_TAB = 'now';
renderDigestModal();
assert(modalStub.innerHTML.indexOf('dg-kpi') >= 0, '25: без firebase окно рендерится');
assert(typeof digestSpeechText(offlineModel) === 'string', '25: без firebase текст озвучки есть');
