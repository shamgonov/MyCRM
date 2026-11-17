/* Смоук Микро-этапа: точечный таймер обратного отсчёта до визита/перезвона.
   renderCountdownBadge() рендерит плейсхолдер с data-target; updateAllCountdowns()
   меняет только textContent/className найденных .countdown-timer — БЕЗ render(). */
'use strict';

globalThis.localStorage = (function () {
  var m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();

var appStub = { innerHTML: '' };
var navStub = { innerHTML: '' };
var modalStub = { innerHTML: '' };
// Мок-элементы, которые вернёт querySelectorAll('.countdown-timer').
var queryResults = [];
// Заведённые интервалы: { fn, ms }.
var intervals = [];

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
  },
  querySelectorAll: function (sel) {
    return sel === '.countdown-timer' ? queryResults : [];
  },
  addEventListener: function () {}
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function (fn, ms) {
  intervals.push({ fn: fn, ms: ms });
  return intervals.length;
};
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

function baseOrder(over) {
  return Object.assign({
    id: 1, client: 'Клиент', phone: '', city: 'Екатеринбург', address: 'Ленина, 1',
    status: 'new', worker: 'Борис', helpers: [], confirm: {}, tags: [],
    date: '2099-12-31', t1: '09:00', t2: '12:00', callbackAt: null,
    works: [], extras: [], materials: [], payments: [], history: [],
    createdAt: Date.now()
  }, over || {});
}

// Мок DOM-элемента countdown-timer для updateAllCountdowns().
function mockTimerEl(target, type) {
  var attrs = { 'data-target': String(target), 'data-type': type };
  return {
    textContent: '',
    className: 'countdown-timer',
    getAttribute: function (n) {
      return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null;
    }
  };
}

// --- 1. Будущий callbackAt → data-target + data-type=callback ---

var cbFuture = baseOrder({ id: 10, callbackAt: Date.now() + 3600000 });
var html1 = renderCountdownBadge(cbFuture);
assert(html1.indexOf('data-type="callback"') >= 0, '1: тип callback');
assert(html1.indexOf('data-target="' + cbFuture.callbackAt + '"') >= 0, '1: data-target = callbackAt');
assert(html1.indexOf('countdown-timer') >= 0, '1: класс countdown-timer');
assert(html1.indexOf('до перезвона') >= 0, '1: текст «до перезвона»');
assert(html1.indexOf('cd-callback-10') >= 0, '1: id элемента cd-callback-10');

// --- 2. Прошедший callbackAt → countdown-overdue ---

var cbPast = baseOrder({ id: 11, callbackAt: Date.now() - 60000 });
var html2 = renderCountdownBadge(cbPast);
assert(html2.indexOf('countdown-overdue') >= 0, '2: прошедший callback → overdue');
assert(html2.indexOf('Перезвон просрочен') >= 0, '2: текст «Перезвон просрочен»');

// --- 3. Нет даты/времени и нет callbackAt → пустая строка ---

assert.eq(renderCountdownBadge(baseOrder({ date: '', t1: '', callbackAt: null })), '',
  '3: без даты/времени → пусто');
assert.eq(renderCountdownBadge(null), '', '3: null → пусто');

// --- 3.1 Визит: есть date+t1, статус рабочий → data-type=visit ---

var visitFuture = baseOrder({ id: 12, callbackAt: null, date: '2099-12-31', t1: '09:00' });
var htmlVisit = renderCountdownBadge(visitFuture);
assert(htmlVisit.indexOf('data-type="visit"') >= 0, '3.1: тип visit');
assert(htmlVisit.indexOf('до визита') >= 0, '3.1: текст «до визита»');
assert(htmlVisit.indexOf('countdown-ok') >= 0, '3.1: далёкий визит → countdown-ok');

// --- 3.2 Терминальный статус → визитный бейдж не показываем ---

assert.eq(renderCountdownBadge(baseOrder({ id: 13, status: 'completed', callbackAt: null })), '',
  '3.2: completed → пусто');
assert.eq(renderCountdownBadge(baseOrder({ id: 14, status: 'paid', callbackAt: null })), '',
  '3.2: paid → пусто');
assert.eq(renderCountdownBadge(baseOrder({ id: 15, status: 'canceled', callbackAt: null })), '',
  '3.2: canceled → пусто');

// --- 4. updateAllCountdowns: +3 ч (в окне 2–24ч) → warn + «3 ч. 0 мин.» ---
// Буфер +5 сек: между созданием цели и обновлением проходят миллисекунды,
// floor((3ч − Δ)/60000) иначе даст 179 мин («2 ч. 59 мин.») — flaky-проверка.

var elWarn = mockTimerEl(Date.now() + 3 * 3600000 + 5000, 'visit');
queryResults = [elWarn];
updateAllCountdowns();
assert(elWarn.className.indexOf('countdown-warn') >= 0, '4: +3ч → countdown-warn');
assert(elWarn.textContent.indexOf('3 ч. 0 мин.') >= 0,
  '4: текст «3 ч. 0 мин.» (получено: ' + elWarn.textContent + ')');

// --- 4.1 updateAllCountdowns: +1 ч (<= 2ч) → danger ---

var elDanger = mockTimerEl(Date.now() + 3600000 + 5000, 'visit');
queryResults = [elDanger];
updateAllCountdowns();
assert(elDanger.className.indexOf('countdown-danger') >= 0, '4.1: +1ч → countdown-danger');
assert(elDanger.textContent.indexOf('1 ч. 0 мин.') >= 0,
  '4.1: текст «1 ч. 0 мин.» (получено: ' + elDanger.textContent + ')');

// --- 5. updateAllCountdowns: прошедший target → overdue ---

var elOver = mockTimerEl(Date.now() - 120000, 'visit');
queryResults = [elOver];
updateAllCountdowns();
assert(elOver.className.indexOf('countdown-overdue') >= 0, '5: прошедший → countdown-overdue');
assert(elOver.textContent.indexOf('Визит просрочен') >= 0, '5: текст «Визит просрочен»');

// --- 5.1 updateAllCountdowns: callback overdue → «Перезвон просрочен» ---

var elOverCb = mockTimerEl(Date.now() - 120000, 'callback');
queryResults = [elOverCb];
updateAllCountdowns();
assert(elOverCb.textContent.indexOf('Перезвон просрочен') >= 0,
  '5.1: callback overdue → «Перезвон просрочен»');

// --- 5.2 updateAllCountdowns: далёкий (>24ч) → countdown-ok ---

var elOk = mockTimerEl(Date.now() + 48 * 3600000, 'visit');
queryResults = [elOk];
updateAllCountdowns();
assert(elOk.className.indexOf('countdown-ok') >= 0, '5.2: >24ч → countdown-ok');
assert(elOk.textContent.indexOf('д.') >= 0, '5.2: формат «д.» для суток');

// --- 6. setInterval заведён ровно один раз (не дублируется) ---

var timersBefore = intervals.length;
startCountdownTicker();
assert.eq(intervals.length, timersBefore, '6: повторный startCountdownTicker не плодит таймер');
// Ищем наш минутный интервал среди заведённых.
var minute = intervals.filter(function (x) { return x.ms === 60000; });
assert(minute.length >= 1, '6: интервал 60000 мс заведён');
assert(!!globalThis.window.__countdownInterval, '6: window.__countdownInterval установлен');

// --- 7. Регрессия: updateAllCountdowns НЕ вызывает render() ---

var savedRender = globalThis.render;
globalThis.__renderCalled = false;
globalThis.render = function () { globalThis.__renderCalled = true; };
queryResults = [mockTimerEl(Date.now() + 3600000, 'visit')];
updateAllCountdowns();
assert.eq(globalThis.__renderCalled, false, '7: updateAllCountdowns не зовёт render()');
globalThis.render = savedRender;

// --- 8. Гард: нет querySelectorAll → не падает ---

var savedQSA = document.querySelectorAll;
document.querySelectorAll = undefined;
var guardRes = (function () {
  try { updateAllCountdowns(); return 'ok'; } catch (e) { return 'throw'; }
})();
assert.eq(guardRes, 'ok', '8: без querySelectorAll updateAllCountdowns не падает');
document.querySelectorAll = savedQSA;

// --- 9. Бейдж встроен в список и карточку ---

DB.orders = [baseOrder({ id: 20, callbackAt: Date.now() + 3600000 })];
var listHtml = renderOrderListItem(DB.orders[0]);
assert(listHtml.indexOf('countdown-timer') >= 0, '9: свёрнутый список содержит таймер');
EXPANDED_ORDERS[20] = true;
var expHtml = renderOrderListItem(DB.orders[0]);
assert(expHtml.indexOf('countdown-timer') >= 0, '9: развёрнутый список содержит таймер');
delete EXPANDED_ORDERS[20];
var tabHtml = renderOrderTabMain(DB.orders[0]);
assert(tabHtml.indexOf('countdown-timer') >= 0, '9: renderOrderTabMain содержит таймер');

// --- 10. formatCountdown: границы формата ---

assert.eq(formatCountdown(3600000), '1 ч. 0 мин.', '10: ровно час');
assert.eq(formatCountdown(12 * 60000), '12 мин.', '10: минуты');
assert.eq(formatCountdown(25 * 3600000), '1 д. 1 ч.', '10: сутки+час');
assert.eq(formatCountdown(0), '0 мин.', '10: ноль');
assert.eq(formatCountdown(-5000), '0 мин.', '10: отрицательное → 0 мин.');
