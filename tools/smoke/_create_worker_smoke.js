/* Смоук Этапа 22: выбор исполнителя при создании заявки (nc-worker),
   отдача готовой заявки в общий пул (releaseOrderToPool), защита DB.seq от
   коллизии id между браузерами (bumpSeqToMaxOrderId).
   Проверки идут через реальный делегат кликов (эмуляция ev.target.closest),
   а не через прямой вызов внутренней логики. */
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
// Поля модалки создания: id → элемент. getElementById отдаёт только то,
// что сюда положили, остальное — null (код к null готов).
const FIELDS = {};
const clickHandlers = [];

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-calendar.js'); // checkTimeConflict + data-force-order
loadModule('app/sync.js');        // bumpSeqToMaxOrderId (без firebase → локально)

setOwnerFlag(false);

// Эмуляция клика: target с нужным data-атрибутом; closest совпадает только
// с этим селектором, поэтому делегаты проходят по всем своим веткам как в браузере.
function clickOn(attr, value) {
  const target = {
    value: (value === undefined || value === null) ? '' : String(value),
    getAttribute: function (n) { return n === attr ? String(value) : null; },
    closest: function (selector) {
      return selector === '[' + attr + ']' ? target : null;
    }
  };
  clickHandlers.forEach(function (fn) { fn({ target: target }); });
}

// Заполняет поля модалки «Новая заявка».
function fillForm(fields) {
  for (const id in FIELDS) delete FIELDS[id];
  for (const id in fields) FIELDS[id] = { value: fields[id] };
}

const today = localToday();

// --- 1. buildWorkerOptions: состав и выбор по умолчанию ---

DB.users = [
  { id: 'u1', name: 'Владелец', role: 'admin' },
  { id: 'u2', name: 'Мастер', role: 'worker' }
];

login('worker', 'Фёдор');
let opts = buildWorkerOptions();
assert(opts.indexOf('В общий пул (без исполнителя)') >= 0, 'worker: есть опция «в пул»');
assert(opts.indexOf('value="self" selected') >= 0, 'worker: по умолчанию выбрано «Себе»');
assert(opts.indexOf('Себе (Фёдор)') >= 0, 'worker: «Себе» подписана именем');
assert(opts.indexOf('value="Мастер"') < 0, 'worker без order_assign: чужих имён нет');
assert(opts.indexOf('value="" selected') < 0, 'worker: пул НЕ выбран по умолчанию');

login('admin', 'Владелец');
opts = buildWorkerOptions();
assert(opts.indexOf('value="" selected') >= 0, 'admin: по умолчанию выбран пул');
assert(opts.indexOf('value="Мастер"') >= 0, 'admin с order_assign: сотрудники в списке');
assert(opts.indexOf('value="Владелец"') < 0, 'admin: себя не выбрать опцией имени');
assert(opts.indexOf('Себе (Владелец)') >= 0, 'admin: опция «Себе» с текущим именем');

// --- 2. Создание в пул: nc-worker='' → worker=null, заявка в пуле ---

login('worker', 'Фёдор');
DB.orders = []; DB.seq = 0; DB.syncQueue = [];
modalStub.innerHTML = '';
fillForm({
  'nc-client': 'Иван', 'nc-phone': '+79001234567', 'nc-address': 'Ленина 1',
  'nc-date': today, 'nc-t1': '09:00', 'nc-t2': '12:00', 'nc-worker': ''
});
clickOn('data-save-order');
assert.eq(DB.orders.length, 1, 'пул: заявка создана');
const poolOrder = DB.orders[0];
assert.eq(poolOrder.worker, null, 'пул: worker === null');
assert(isPoolOrder(poolOrder) === true, 'пул: isPoolOrder → true');
assert.eq(modalStub.innerHTML.indexOf('Пересечение'), -1, 'пул: конфликт не проверяется');

// canViewOrder для ДРУГОГО worker-пользователя (без orders_view_all).
login('worker', 'Мария');
assert(canViewOrder(poolOrder) === true, 'пул: другой worker видит заявку');
assert(canTakeOrder(poolOrder) === true, 'пул: другой worker может взять');

// --- 3. Создание «Себе»: nc-worker='self' → worker === state.user ---

login('worker', 'Фёдор');
DB.orders = []; DB.syncQueue = [];
fillForm({
  'nc-client': 'Пётр', 'nc-date': today, 'nc-t1': '09:00', 'nc-t2': '12:00',
  'nc-worker': 'self'
});
clickOn('data-save-order');
assert.eq(DB.orders.length, 1, 'self: заявка создана');
assert.eq(DB.orders[0].worker, 'Фёдор', 'self: worker = текущий пользователь');
assert(isPoolOrder(DB.orders[0]) === false, 'self: заявка не в пуле');

// --- 4. Назначение другого сотрудника (admin с order_assign) ---

login('admin', 'Владелец');
DB.orders = []; DB.syncQueue = [];
fillForm({
  'nc-client': 'Сидор', 'nc-date': today, 'nc-t1': '09:00', 'nc-t2': '12:00',
  'nc-worker': 'Мастер'
});
clickOn('data-save-order');
assert.eq(DB.orders[0].worker, 'Мастер', 'assign: worker из выбранной опции');

// --- 5. Конфликт по времени — только для назначенного исполнителя ---

login('worker', 'Фёдор');
DB.orders = [{
  id: 1, client: 'Занят', status: 'new', worker: 'Фёдор',
  date: today, t1: '09:00', t2: '12:00',
  works: [], extras: [], materials: [], history: [], helpers: []
}];
DB.syncQueue = [];
modalStub.innerHTML = '';
fillForm({
  'nc-client': 'Конфликт', 'nc-date': today, 'nc-t1': '10:00', 'nc-t2': '11:00',
  'nc-worker': 'self'
});
clickOn('data-save-order');
assert.eq(DB.orders.length, 1, 'конфликт: заявка НЕ создана сразу');
assert(modalStub.innerHTML.indexOf('Пересечение') >= 0, 'конфликт: показана модалка');
window.__calPending = null;

// Тот же интервал, но в пул — конфликта нет (исполнитель ещё не назначен).
modalStub.innerHTML = '';
fillForm({
  'nc-client': 'В пул', 'nc-date': today, 'nc-t1': '10:00', 'nc-t2': '11:00',
  'nc-worker': ''
});
clickOn('data-save-order');
assert.eq(DB.orders.length, 2, 'конфликт: пул-заявка в это же время создана');
assert.eq(DB.orders[1].worker, null, 'конфликт: пул-заявка без исполнителя');

// «Всё равно взять» доводит до конца назначение с конфликтом.
modalStub.innerHTML = '';
fillForm({
  'nc-client': 'Упорный', 'nc-date': today, 'nc-t1': '10:00', 'nc-t2': '11:00',
  'nc-worker': 'self'
});
clickOn('data-save-order');
assert.eq(DB.orders.length, 2, 'force: до подтверждения не создана');
assert(!!window.__calPending, 'force: данные отложены в __calPending');
clickOn('data-force-order');
assert.eq(DB.orders.length, 3, 'force: «Всё равно взять» создал заявку');
assert.eq(DB.orders[2].worker, 'Фёдор', 'force: исполнитель сохранён');
assert.eq(window.__calPending, null, 'force: __calPending очищен');

// Пустой клиент — создание отклонено (регресс существующей валидации).
DB.orders = [];
fillForm({ 'nc-client': '   ', 'nc-date': today, 'nc-worker': '' });
clickOn('data-save-order');
assert.eq(DB.orders.length, 0, 'валидация: пустой клиент не создаёт заявку');

// --- 6. canReleaseToPool + releaseOrderToPool ---

const rel = {
  id: 500, status: 'inwork', worker: 'Фёдор', takenAt: 111, takenBy: 'Фёдор',
  works: [], extras: [], materials: [], history: [], helpers: []
};
DB.orders = [rel];
assert(canReleaseToPool(rel) === true, 'release: inwork с worker → можно');
assert.eq(releaseOrderToPool(500), true, 'release: вызов успешен');
assert.eq(rel.worker, null, 'release: worker сброшен');
assert.eq(rel.takenAt, null, 'release: takenAt сброшен');
assert.eq(rel.takenBy, null, 'release: takenBy сброшен');
assert(rel.history.some(function (h) {
  return h.action === 'release_pool' && h.details === 'Заявка возвращена в общий пул';
}), 'release: запись release_pool в истории');
assert(isPoolOrder(rel) === false, 'release: inwork в пул не попадает (статус)');

transitionOrder(500, 'completed');
assert(canReleaseToPool(rel) === false, 'release: completed → нельзя');
rel.status = 'paid';
assert(canReleaseToPool(rel) === false, 'release: paid → нельзя');
rel.status = 'canceled';
assert(canReleaseToPool(rel) === false, 'release: canceled → нельзя');
rel.status = 'new'; rel.worker = null;
assert(canReleaseToPool(rel) === false, 'release: без worker нечего отдавать');
// Чужая закрытая/недоступная заявка — отказ без изменений.
DB.orders = [{ id: 501, status: 'new', worker: 'Борис', works: [], extras: [],
  materials: [], history: [] }];
assert.eq(releaseOrderToPool(9999), false, 'release: нет такой заявки → false');

// --- 7. Кнопка «Отдать в пул» в блоке исполнителей ---

const shown = { id: 502, status: 'inwork', worker: 'Фёдор', helpers: [],
  confirm: {}, works: [], extras: [], materials: [], history: [] };
let html = renderOrderTeamBlock(shown, true);
assert(html.indexOf('data-release-pool="502"') >= 0, 'team: кнопка «Отдать в пул» есть');
assert(html.indexOf('Отдать в пул') >= 0, 'team: подпись кнопки');
assert(renderOrderTeamBlock(shown, false).indexOf('data-release-pool') < 0,
  'team: не editable → кнопки нет');
const noWorker = { id: 503, status: 'new', worker: null, helpers: [], confirm: {},
  works: [], extras: [], materials: [], history: [] };
assert(renderOrderTeamBlock(noWorker, true).indexOf('data-release-pool') < 0,
  'team: без worker кнопки нет');
const closed = { id: 504, status: 'paid', worker: 'Фёдор', helpers: [], confirm: {},
  works: [], extras: [], materials: [], history: [] };
assert(renderOrderTeamBlock(closed, true).indexOf('data-release-pool') < 0,
  'team: paid → кнопки нет');

// Клик по кнопке внутри карточки обрабатывается делегатом (не открывает заявку).
DB.orders = [{ id: 505, status: 'approved', worker: 'Фёдор', helpers: [], confirm: {},
  works: [], extras: [], materials: [], history: [] }];
const beforeScreen = state.screen;
clickOn('data-release-pool', 505);
assert.eq(DB.orders[0].worker, null, 'делегат: клик снял исполнителя');
assert.eq(state.screen, beforeScreen, 'делегат: клик не открыл карточку заявки');

// --- 8. Модалка создания содержит select nc-worker ---

renderCreateOrderModal();
assert(modalStub.innerHTML.indexOf('nc-worker') >= 0, 'модалка: select id="nc-worker"');
assert(modalStub.innerHTML.indexOf('Исполнитель') >= 0, 'модалка: подпись «Исполнитель»');
assert(modalStub.innerHTML.indexOf('В общий пул') >= 0, 'модалка: опция пула видна');
const posWorker = modalStub.innerHTML.indexOf('nc-worker');
const posClient = modalStub.innerHTML.indexOf('nc-client');
assert(posWorker >= 0 && posWorker < posClient, 'модалка: выбор исполнителя ПЕРЕД клиентом');

// --- 9. bumpSeqToMaxOrderId: защита id от коллизии между браузерами ---

DB.seq = 5;
DB.orders = [{ id: 42 }, { id: 7 }, { id: '100' }, { id: null }, {}];
assert.eq(bumpSeqToMaxOrderId(), 100, 'seq: поднят до максимального id');
assert.eq(DB.seq, 100, 'seq: записан в DB.seq');
DB.seq = 200;
DB.orders = [{ id: 3 }, { id: 9 }];
assert.eq(bumpSeqToMaxOrderId(), 200, 'seq: не понижается');
DB.seq = 0;
DB.orders = [];
assert.eq(bumpSeqToMaxOrderId(), 0, 'seq: пустой список → без изменений');
DB.orders = [{ id: 'abc' }, { id: NaN }];
assert.eq(bumpSeqToMaxOrderId(), 0, 'seq: нечисловые id игнорируются');

// --- 10. Экспорты/typeof ---
['buildWorkerOptions', 'canReleaseToPool', 'releaseOrderToPool',
 'renderCreateOrderModal', 'renderOrderTeamBlock'].forEach(function (n) {
  assert(typeof globalThis[n] === 'function', 'typeof ' + n);
});
