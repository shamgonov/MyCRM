/* Смоук Этапа 38: live-поиск с debounce.
   1) debounce(fn, 300) — вызов откладывается на 300ms, повторный ввод
      сбрасывает таймер (мок setTimeout/clearTimeout).
   2) Контрагенты: поиск по имени/телефону/адресу + «Ничего не найдено».
   3) Поставщики (вкладка) и админка: поиск по названию/телефону/адресу.
   4) Прайс (админка): поиск по названию/категории/ед. изм.
   5) Заявки: поиск по клиенту/номеру/мастеру, ORD_FILTER не меняется.
   6) Очистка ✕ возвращает полный список; без запроса список полный. */
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
var clickHandlers = [];
var inputHandlers = [];

// Мок таймеров: позволяет проверять debounce без ожидания.
var timers = [];
var timerSeq = 0;
globalThis.setTimeout = function (fn, ms) {
  timerSeq++;
  timers.push({ id: timerSeq, fn: fn, ms: ms, alive: true });
  return timerSeq;
};
globalThis.clearTimeout = function (id) {
  timers.forEach(function (t) { if (t.id === id) t.alive = false; });
};
// Прогон всех живых таймеров (как истёкшее время).
function flushTimers() {
  var pending = timers.filter(function (t) { return t.alive; });
  pending.forEach(function (t) { t.alive = false; t.fn(); });
  return pending.length;
}

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn) {
    if (type === 'click') clickHandlers.push(fn);
    if (type === 'input') inputHandlers.push(fn);
  }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-clients.js');
loadModule('app/ui-admin.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// Эмуляция клика по data-атрибуту.
function clickOn(attr, value) {
  var target = {
    value: value === undefined || value === null ? '' : String(value),
    getAttribute: function (n) { return n === attr ? String(value) : null; },
    closest: function (selector) {
      return selector === '[' + attr + ']' ? target : null;
    }
  };
  clickHandlers.forEach(function (fn) { fn({ target: target }); });
}

// Эмуляция ввода в поле поиска: прогоняем input-делегаты + таймеры.
function typeSearch(id, value) {
  var el = { id: id, value: value };
  inputHandlers.forEach(function (fn) { fn({ target: el }); });
  return flushTimers();
}

// --- 1. debounce: отложенный вызов и сброс таймера ---

var calls = [];
var d = debounce(function (a, b) { calls.push(a + '/' + b); }, 300);
assert(typeof d === 'function', '1: debounce возвращает функцию');

d('x', 1);
assert.eq(calls.length, 0, '1: до истечения 300ms fn не вызвана');
var lastTimer = timers[timers.length - 1];
assert.eq(lastTimer.ms, 300, '1: задержка 300ms передана в setTimeout');

// Повторный вызов сбрасывает предыдущий таймер (debounce, не throttle).
d('x', 2);
var alive = timers.filter(function (t) { return t.alive; });
assert.eq(alive.length, 1, '1: повторный вызов сбросил прошлый таймер');
assert(lastTimer.alive === false, '1: предыдущий таймер отменён');

flushTimers();
assert.eq(calls.length, 1, '1: fn вызвана один раз после 300ms');
assert.eq(calls[0], 'x/2', '1: переданы аргументы последнего вызова');

// --- 2. Контрагенты: поиск по имени ---

DB.clients = [
  { id: 1, name: 'Иванов Иван', kind: 'person', phone: '+79001112233', address: 'ул. Мира 1', city: 'Москва', orderIds: [] },
  { id: 2, name: 'Петров Пётр', kind: 'person', phone: '+79004445566', address: 'ул. Ленина 2', city: 'Пермь', orderIds: [] },
  { id: 3, name: 'ООО Ромашка', kind: 'company', phone: '+73430001122', address: 'пр. Космонавтов 5', city: 'Екатеринбург', orderIds: [] }
];

CL_TAB = 'list';
CL_SEARCH = '';
var fullList = renderClients();
assert(fullList.indexOf('Иванов Иван') >= 0 && fullList.indexOf('Петров Пётр') >= 0 &&
       fullList.indexOf('ООО Ромашка') >= 0, '11: без поиска список полный');

CL_SEARCH = 'иван';
var byName = renderClients();
assert(byName.indexOf('Иванов Иван') >= 0, '2: поиск по имени находит Иванова');
assert(byName.indexOf('Петров Пётр') < 0, '2: нерелевантный контрагент скрыт');

// --- 3. Контрагенты: поиск по телефону ---

CL_SEARCH = '7900';
var byPhone = renderClients();
assert(byPhone.indexOf('Иванов Иван') >= 0, '3: поиск по телефону находит Иванова');
assert(byPhone.indexOf('Петров Пётр') >= 0, '3: второй с 7900 тоже найден');
assert(byPhone.indexOf('ООО Ромашка') < 0, '3: городской номер не совпал с 7900');

// Поиск по адресу.
CL_SEARCH = 'космонавтов';
assert(renderClients().indexOf('ООО Ромашка') >= 0, '3: поиск по адресу находит юрлицо');

// --- 4. Контрагенты: «Ничего не найдено» ---

CL_SEARCH = 'несуществующийзапрос';
var empty = renderClients();
assert(empty.indexOf('Ничего не найдено') >= 0, '4: пустой результат — подсказка');
assert(empty.indexOf('несуществующийзапрос') >= 0, '4: в подсказке виден запрос');
assert(empty.indexOf('Иванов Иван') < 0, '4: при пустом результате карточек нет');

// --- 5. Поставщики: вкладка в контрагентах ---

DB.suppliers = [
  { id: 's1', name: 'МеталлБаза', phone: '+73430001122', address: 'Черметов 1', hours: 'пн-пт', note: '' },
  { id: 's2', name: 'СтеклоПром', phone: '+73439998877', address: 'Стекольная 9', hours: 'пн-сб', note: '' }
];
CL_TAB = 'suppliers';
SUP_SEARCH = '';
assert(renderClients().indexOf('МеталлБаза') >= 0 &&
       renderClients().indexOf('СтеклоПром') >= 0, '11: поставщики без поиска — все');

SUP_SEARCH = 'стекло';
var supFiltered = renderClients();
assert(supFiltered.indexOf('СтеклоПром') >= 0, '5: поиск поставщика по названию');
assert(supFiltered.indexOf('МеталлБаза') < 0, '5: нерелевантный поставщик скрыт');

SUP_SEARCH = '73439998877';
assert(renderClients().indexOf('СтеклоПром') >= 0, '5: поиск поставщика по телефону');

SUP_SEARCH = 'неттакого';
assert(renderClients().indexOf('Ничего не найдено') >= 0, '5: пустой результат поставщиков');
SUP_SEARCH = '';

// --- 6. Админка: поиск по поставщикам ---

ADMIN_TAB = 'suppliers';
ADMIN_SUP_SEARCH = '';
var adminSupFull = renderAdmin();
assert(adminSupFull.indexOf('МеталлБаза') >= 0 && adminSupFull.indexOf('СтеклоПром') >= 0,
  '6: админка без поиска показывает всех поставщиков');
assert(adminSupFull.indexOf('id="sup-search"') >= 0, '10: поле sup-search с id');

ADMIN_SUP_SEARCH = 'металл';
var adminSupFiltered = renderAdmin();
assert(adminSupFiltered.indexOf('МеталлБаза') >= 0, '6: админка фильтрует по названию');
assert(adminSupFiltered.indexOf('СтеклоПром') < 0, '6: нерелевантный скрыт в админке');

// Два экрана поставщиков имеют независимые запросы (не общая переменная).
CL_TAB = 'suppliers';
SUP_SEARCH = '';
assert(renderClients().indexOf('СтеклоПром') >= 0,
  '6: запрос админки не фильтрует вкладку «Поставщики»');
ADMIN_SUP_SEARCH = '';
CL_TAB = 'list';

// --- 7. Админка: поиск по прайсу ---

DB.priceList = [
  { id: 1, name: 'Стеклопакет 2-камерный', category: 'Окна', basePrice: 5000, unit: 'м2', defaultQty: 1 },
  { id: 2, name: 'Монтаж окна', category: 'Работы', basePrice: 2000, unit: 'шт', defaultQty: 1 }
];
ADMIN_TAB = 'price';
PRICE_SEARCH = '';
var priceFull = renderAdmin();
assert(priceFull.indexOf('Стеклопакет') >= 0 && priceFull.indexOf('Монтаж окна') >= 0,
  '11: прайс без поиска полный');
assert(priceFull.indexOf('id="admin-price-search"') >= 0, '10: поле admin-price-search с id');

PRICE_SEARCH = 'стекло';
var priceFiltered = renderAdmin();
assert(priceFiltered.indexOf('Стеклопакет') >= 0, '7: поиск прайса по названию');
assert(priceFiltered.indexOf('Монтаж окна') < 0, '7: нерелевантная позиция скрыта');

// Поиск по единице измерения.
PRICE_SEARCH = 'м2';
assert(renderAdmin().indexOf('Стеклопакет') >= 0, '7: поиск прайса по ед. изм.');

PRICE_SEARCH = 'нетпозиции';
assert(renderAdmin().indexOf('Ничего не найдено') >= 0, '7: пустой результат прайса');
PRICE_SEARCH = '';

// Регрессия коллизии id: поле #price-search принадлежит модалке
// ui-estimate.js (Этап 17) и не должно менять PRICE_SEARCH админки.
typeSearch('price-search', 'монтаж');
assert.eq(PRICE_SEARCH, '', '7: модальный #price-search не трогает PRICE_SEARCH');
assert(renderAdmin().indexOf('Стеклопакет') >= 0, '7: прайс админки остался нефильтрованным');

// --- 8. Заявки: поиск по клиенту и номеру ---

DB.orders = [
  { id: 101, client: 'Смирнов Алексей', status: 'new', worker: 'Мастер 1', date: '2026-01-01',
    t1: '09:00', phone: '+79001112233', address: 'Мира 1', helpers: [], confirm: {}, tags: [],
    works: [], extras: [], materials: [], payments: [], history: [], createdAt: Date.now() },
  { id: 123, client: 'Кузнецов Пётр', status: 'new', worker: 'Мастер 2', date: '2026-01-02',
    t1: '10:00', phone: '+79004445566', address: 'Ленина 2', helpers: [], confirm: {}, tags: [],
    works: [], extras: [], materials: [], payments: [], history: [], createdAt: Date.now() }
];
state.filter = 'all';
ORD_SEARCH = '';
var ordFull = renderOrdersList();
assert(ordFull.indexOf('Смирнов Алексей') >= 0 && ordFull.indexOf('Кузнецов Пётр') >= 0,
  '11: заявки без поиска — все');
assert(ordFull.indexOf('id="ord-search"') >= 0, '10: поле ord-search с id');

ORD_SEARCH = 'смирнов';
var ordByClient = renderOrdersList();
assert(ordByClient.indexOf('Смирнов Алексей') >= 0, '7: поиск заявки по клиенту');
assert(ordByClient.indexOf('Кузнецов Пётр') < 0, '7: нерелевантная заявка скрыта');

ORD_SEARCH = '123';
var ordByNumber = renderOrdersList();
assert(ordByNumber.indexOf('Кузнецов Пётр') >= 0, '8: поиск заявки по номеру 123');
assert(ordByNumber.indexOf('Смирнов Алексей') < 0, '8: заявка 101 не совпала с 123');

// Поиск по мастеру.
ORD_SEARCH = 'мастер 2';
assert(renderOrdersList().indexOf('Кузнецов Пётр') >= 0, '8: поиск по мастеру');

ORD_SEARCH = 'ничегонет';
assert(renderOrdersList().indexOf('Ничего не найдено') >= 0, '8: пустой результат заявок');

// ORD_FILTER не подменяется поиском (семантика фильтров сохранена).
ORD_SEARCH = 'смирнов';
state.filter = 'mine';
var ordFiltered = renderOrdersList();
assert(state.filter === 'mine', '8: state.filter не изменён поиском');
assert(ordFiltered.indexOf('Смирнов Алексей') < 0 ||
       ordFiltered.indexOf('Ничего не найдено') >= 0,
  '8: фильтр «Мои» продолжает действовать вместе с поиском');
ORD_SEARCH = '';
state.filter = 'all';

// --- 9. Очистка ✕ возвращает полный список ---

CL_TAB = 'list';
CL_SEARCH = 'иван';
assert(renderClients().indexOf('Петров Пётр') < 0, '9: до очистки список отфильтрован');
clickOn('data-clear-search');
assert.eq(CL_SEARCH, '', '9: клик ✕ сбросил CL_SEARCH');
assert(renderClients().indexOf('Петров Пётр') >= 0, '9: после очистки список восстановлен');

CL_TAB = 'suppliers';
SUP_SEARCH = 'стекло';
clickOn('data-clear-sup-tab-search');
assert.eq(SUP_SEARCH, '', '9: клик ✕ сбросил SUP_SEARCH');
assert(renderClients().indexOf('МеталлБаза') >= 0, '9: поставщики восстановлены');
CL_TAB = 'list';

ADMIN_TAB = 'suppliers';
ADMIN_SUP_SEARCH = 'металл';
clickOn('data-clear-sup-search');
assert.eq(ADMIN_SUP_SEARCH, '', '9: клик ✕ сбросил ADMIN_SUP_SEARCH');

ADMIN_TAB = 'price';
PRICE_SEARCH = 'стекло';
clickOn('data-clear-price-search');
assert.eq(PRICE_SEARCH, '', '9: клик ✕ сбросил PRICE_SEARCH');

ORD_SEARCH = 'смирнов';
clickOn('data-clear-ord-search');
assert.eq(ORD_SEARCH, '', '9: клик ✕ сбросил ORD_SEARCH');

// --- 10. Разметка поля поиска ---

CL_SEARCH = 'иван';
var searchHtml = renderClients();
assert(searchHtml.indexOf('type="search"') >= 0, '10: поле поиска type=search');
assert(searchHtml.indexOf('placeholder="🔍 Поиск по имени') >= 0, '10: плейсхолдер задан');
assert(searchHtml.indexOf('class="search-row"') >= 0, '10: обёртка .search-row');
assert(searchHtml.indexOf('value="иван"') >= 0, '10: введённый запрос сохраняется');
assert(searchHtml.indexOf('onclick') < 0 && searchHtml.indexOf('oninput') < 0,
  '10: инлайн-обработчиков нет');
CL_SEARCH = '';

// --- 11. Делегирование input: ввод через событие меняет состояние ---

CL_TAB = 'list';
CL_SEARCH = '';
var fired = typeSearch('cl-search', 'петров');
// По одному debounce-таймеру на модуль (clients, admin, orders) — 3 шт.
assert.eq(fired, 3, '11: по таймеру на каждый input-делегат (3 модуля)');
assert.eq(CL_SEARCH, 'петров', '11: ввод через input-событие записан в CL_SEARCH');
assert(renderClients().indexOf('Петров Пётр') >= 0, '11: список отфильтрован по вводу');
assert(renderClients().indexOf('Иванов Иван') < 0, '11: нерелевантный скрыт после ввода');

typeSearch('ord-search', 'кузнецов');
assert.eq(ORD_SEARCH, 'кузнецов', '11: ввод в ord-search записан в ORD_SEARCH');

// Ввод в чужое поле не ломает состояние поиска.
typeSearch('cl-name', 'случайный текст');
assert.eq(CL_SEARCH, 'петров', '11: чужое поле не меняет CL_SEARCH');
assert.eq(ORD_SEARCH, 'кузнецов', '11: чужое поле не меняет ORD_SEARCH');
