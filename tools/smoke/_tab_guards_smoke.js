/* Смоук Этапа 40: typeof-гарды на межмодульные вызовы вкладок карточки заявки.
   1) Baseline: HTML всех шести вкладок не изменился (снапшот Этапа 40).
   2) Отсутствующий модуль вкладки → заглушка «временно недоступен», карточка жива.
   3) Шапка, лента вкладок и data-tab на месте даже без модулей.
   4) Переключение на вкладку без модуля и обратно на «Основное».
   5) Исключение внутри вкладки → «Не удалось отобразить», console.error ровно 1 раз.
   6) ordTabUnavailable/ordTabFailed экранируют вход.
   7) Внутренние вкладки main/journal работают без внешних модулей.
   8) Регрессия без firebase.
   9) Нет инлайн-обработчиков в новом HTML. */
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
var FIELDS = {};

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function () {},
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 0; };
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-estimate.js');
loadModule('app/ui-shopping.js');
loadModule('app/ui-docs.js');
loadModule('app/ui-money.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

var today = localToday();
DB.orders = [{
  id: 900, client: 'Снапшот', status: 'inwork', worker: 'Мастер', date: today,
  t1: '10:00', t2: '12:00', phone: '+79000000000', address: 'Адрес 1', city: 'Город',
  helpers: [], confirm: {}, materials: [], works: [], extras: [], history: [],
  payments: [], tags: [], callbackAt: null
}];

var TABS = ['main', 'estimate', 'materials', 'docs', 'money', 'journal'];

// Эталонные длины HTML, снятые ДО правки (Этап 40, ШАГ 0).
var BASELINE_LEN = {
  main: 2585, estimate: 1272, materials: 744, docs: 830, money: 1493, journal: 646
};

// --- 1. Baseline: при всех модулях HTML прежний ---

TABS.forEach(function (tab) {
  ORD_TAB = tab;
  var html = renderOrderCard(900);
  assert.eq(html.length, BASELINE_LEN[tab], '1: ' + tab + ' — длина HTML как до правки');
  assert(html.indexOf('временно недоступен') < 0, '1: ' + tab + ' — заглушки нет в норме');
  assert(html.indexOf('Не удалось отобразить') < 0, '1: ' + tab + ' — ошибки нет в норме');
});

// --- 2. Отсутствующий модуль вкладки → заглушка, карточка жива ---

// Ожидаемый заголовок заглушки для каждой внешней вкладки.
var EXTERNAL = [
  ['estimate', 'renderEstimateTab', 'Смета'],
  ['materials', 'renderShoppingTab', 'Материалы'],
  ['docs', 'renderDocsTab', 'Документы'],
  ['money', 'renderMoneyTab', 'Деньги']
];

var savedFns = {};
EXTERNAL.forEach(function (pair) {
  savedFns[pair[1]] = globalThis[pair[1]];
});

EXTERNAL.forEach(function (pair) {
  var tab = pair[0];
  var fnName = pair[1];
  var title = pair[2];

  globalThis[fnName] = undefined;

  ORD_TAB = tab;
  var html = '';
  var threw = null;
  try { html = renderOrderCard(900); } catch (e) { threw = e; }

  assert.eq(threw, null, '2: ' + tab + ' без модуля — не бросает');
  assert(typeof html === 'string' && html.length > 0, '2: ' + tab + ' — HTML вернулся');
  assert(html.indexOf('временно недоступен') >= 0, '2: ' + tab + ' — заглушка «временно недоступен»');
  assert(html.indexOf(title) >= 0, '2: ' + tab + ' — в заглушке заголовок «' + title + '»');

  // 3. Шапка и лента вкладок на месте.
  assert(html.indexOf('Заявка №900') >= 0, '3: ' + tab + ' — шапка карточки на месте');
  assert(html.indexOf('data-tab="main"') >= 0, '3: ' + tab + ' — лента вкладок на месте');
  assert(html.indexOf('data-tab="journal"') >= 0, '3: ' + tab + ' — все табы на месте');

  // 9. Никаких инлайн-обработчиков.
  assert(html.indexOf('onclick') < 0 && html.indexOf('oninput') < 0 &&
    html.indexOf('onchange') < 0, '9: ' + tab + ' — нет инлайн-обработчиков');

  globalThis[fnName] = savedFns[fnName];
});

// --- 4. Переключение на вкладку без модуля и обратно на «Основное» ---

globalThis.renderShoppingTab = undefined;
ORD_TAB = 'materials';
var broken = renderOrderCard(900);
assert(broken.indexOf('временно недоступен') >= 0, '4: вкладка без модуля — заглушка');

ORD_TAB = 'main';
var backToMain = renderOrderCard(900);
assert.eq(backToMain.length, BASELINE_LEN.main, '4: возврат на «Основное» — прежний HTML');
assert(backToMain.indexOf('временно недоступен') < 0, '4: на «Основном» заглушки нет');
globalThis.renderShoppingTab = savedFns.renderShoppingTab;

// --- 5. Исключение внутри вкладки → заглушка + console.error ровно 1 раз ---

var consoleErrors = [];
var realConsole = (typeof console !== 'undefined') ? console : null;
var realErr = realConsole ? realConsole.error : null;
if (realConsole) {
  realConsole.error = function () {
    consoleErrors.push(Array.prototype.slice.call(arguments));
  };
}

var origShopping = globalThis.renderShoppingTab;
globalThis.renderShoppingTab = function () { throw new Error('сломанный модуль'); };

ORD_TAB = 'materials';
var failHtml = '';
var failThrew = null;
try { failHtml = renderOrderCard(900); } catch (e) { failThrew = e; }

assert.eq(failThrew, null, '5: исключение во вкладке не роняет карточку');
assert(failHtml.indexOf('Не удалось отобразить вкладку') >= 0,
  '5: показано «Не удалось отобразить вкладку»');
assert(failHtml.indexOf('сломанный модуль') >= 0, '5: текст ошибки попал в заглушку');
assert(failHtml.indexOf('Заявка №900') >= 0, '5: шапка карточки жива при исключении');
assert.eq(consoleErrors.length, 1, '5: console.error вызван ровно 1 раз');
assert(consoleErrors.length && String(consoleErrors[0][0]).indexOf('ORD_TAB render failed') >= 0,
  '5: в логе есть маркер «ORD_TAB render failed»');
assert(consoleErrors.length && consoleErrors[0][1] === 'materials',
  '5: в логе указана проблемная вкладка');

globalThis.renderShoppingTab = origShopping;
if (realConsole && realErr) realConsole.error = realErr;

// --- 6. Экранирование входа в заглушках ---

var xssTitle = ordTabUnavailable('<script>alert(1)</script>');
assert(xssTitle.indexOf('<script>') < 0, '6: заголовок заглушки экранирован');
assert(xssTitle.indexOf('&lt;script&gt;') >= 0, '6: заголовок превращён в entities');

var xssErr = ordTabFailed('X', { message: '<img src=x onerror=alert(1)>' });
assert(xssErr.indexOf('<img') < 0, '6: текст ошибки экранирован');
assert(xssErr.indexOf('&lt;img') >= 0, '6: текст ошибки превращён в entities');

// Без message — не падает и не печатает "undefined".
var plainErr = ordTabFailed('X', 'простая строка');
assert(plainErr.indexOf('простая строка') >= 0, '6: строка-ошибка отображается');
assert(ordTabFailed('X', null).indexOf('null') >= 0, '6: null → строка "null", без падения');

// --- 7. Внутренние вкладки работают без всех внешних модулей ---

globalThis.renderEstimateTab = undefined;
globalThis.renderShoppingTab = undefined;
globalThis.renderDocsTab = undefined;
globalThis.renderMoneyTab = undefined;

ORD_TAB = 'main';
var onlyMain = renderOrderCard(900);
assert.eq(onlyMain.length, BASELINE_LEN.main, '7: main работает без внешних модулей');
assert(onlyMain.indexOf('временно недоступен') < 0, '7: main не показывает заглушку');

ORD_TAB = 'journal';
var onlyJournal = renderOrderCard(900);
assert.eq(onlyJournal.length, BASELINE_LEN.journal, '7: journal работает без внешних модулей');
assert(onlyJournal.indexOf('временно недоступен') < 0, '7: journal не показывает заглушку');

// Каждая внешняя вкладка в этих условиях даёт заглушку, а не падение.
EXTERNAL.forEach(function (pair) {
  ORD_TAB = pair[0];
  var h = renderOrderCard(900);
  assert(h.indexOf('временно недоступен') >= 0,
    '7: ' + pair[0] + ' без модуля — заглушка (все внешние удалены)');
});

globalThis.renderEstimateTab = savedFns.renderEstimateTab;
globalThis.renderShoppingTab = savedFns.renderShoppingTab;
globalThis.renderDocsTab = savedFns.renderDocsTab;
globalThis.renderMoneyTab = savedFns.renderMoneyTab;

// --- 8. Регрессия: без firebase ---

globalThis.firebase = undefined;
globalThis.renderMoneyTab = undefined;
ORD_TAB = 'money';
var noFb = '';
var noFbThrew = null;
try { noFb = renderOrderCard(900); } catch (e) { noFbThrew = e; }
assert.eq(noFbThrew, null, '8: без firebase вкладка без модуля не бросает');
assert(noFb.indexOf('временно недоступен') >= 0, '8: без firebase заглушка на месте');
assert(noFb.indexOf('Заявка №900') >= 0, '8: без firebase шапка карточки на месте');

globalThis.renderMoneyTab = savedFns.renderMoneyTab;
ORD_TAB = 'money';
var restored = renderOrderCard(900);
assert.eq(restored.length, BASELINE_LEN.money, '8: после возврата модуля HTML прежний');
ORD_TAB = 'main';
