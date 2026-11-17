/* Смоук Этапа 23: назначение/смена ОСНОВНОГО исполнителя по праву order_assign —
   доменная assignWorker(), кнопка в блоке «Исполнители», модалка выбора,
   конфликт по времени с «Всё равно назначить», снятие исполнителя в пул.
   Клики эмулируются через реальный делегат (ev.target.closest). */
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
loadModule('app/ui-calendar.js'); // checkTimeConflict

setOwnerFlag(false);
login('manager', 'Ирина');
DB.users = [
  { id: 'u1', name: 'Борис', role: 'worker' },
  { id: 'u2', name: 'Вера', role: 'worker' }
];

// Эмуляция клика по элементу с нужным data-атрибутом.
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

function setField(id, value) {
  FIELDS[id] = { value: value };
}

function clearFields() {
  for (const id in FIELDS) delete FIELDS[id];
}

const today = localToday();

// Свежая незакрытая заявка без исполнителя.
function freshOrder(id, worker) {
  return {
    id: id, status: 'new', worker: worker || null, helpers: [], confirm: {},
    date: today, t1: '09:00', t2: '12:00',
    works: [], extras: [], materials: [], history: [], payments: []
  };
}

// --- 1. assignWorker(): базовые ветки ---

let o = freshOrder(900);
DB.orders = [o];

assert.eq(assignWorker(o, ''), false, 'assignWorker: пустое имя → false');
assert.eq(assignWorker(o, null), false, 'assignWorker: null → false');
assert.eq(assignWorker(null, 'Борис'), false, 'assignWorker: нет заявки → false');
assert.eq(o.worker, null, 'assignWorker: отказы не меняют worker');

assert.eq(assignWorker(o, 'Борис'), true, 'assignWorker: назначение → true');
assert.eq(o.worker, 'Борис', 'assignWorker: worker записан');
assert(o.takenAt > 0, 'assignWorker: takenAt проставлен');
assert.eq(o.takenBy, 'Ирина', 'assignWorker: takenBy = назначивший');
assert(o.history.some(function (h) {
  return h.action === 'assign_worker' && h.details === 'Исполнитель назначен: Борис';
}), 'assignWorker: история «назначен»');

assert.eq(assignWorker(o, 'Борис'), false, 'assignWorker: тот же исполнитель → false');
const histLen = o.history.length;
assert.eq(assignWorker(o, 'Вера'), true, 'assignWorker: смена → true');
assert.eq(o.worker, 'Вера', 'assignWorker: worker сменён');
assert.eq(o.history.length, histLen + 1, 'assignWorker: смена пишет одну запись');
assert(o.history[o.history.length - 1].details === 'Исполнитель сменён: Борис → Вера',
  'assignWorker: история «сменён A → B»');

// --- 2. assignWorker(): закрытые статусы ---

['completed', 'paid', 'canceled'].forEach(function (st) {
  const closed = freshOrder(910, null);
  closed.status = st;
  DB.orders = [closed];
  assert.eq(assignWorker(closed, 'Борис'), false, 'assignWorker: ' + st + ' → нельзя');
  assert.eq(closed.worker, null, 'assignWorker: ' + st + ' → worker не тронут');
});

// --- 3. assignWorker(): повышение соисполнителя ---

const promo = freshOrder(920, 'Вера');
promo.helpers = ['Борис', 'Антон'];
promo.confirm = { 'Борис': 'pending', 'Антон': 'ok' };
DB.orders = [promo];
assert.eq(assignWorker(promo, 'Борис'), true, 'assignWorker: соисполнитель повышен');
assert.eq(promo.helpers.indexOf('Борис'), -1, 'assignWorker: убран из helpers');
assert.eq(promo.confirm['Борис'], undefined, 'assignWorker: его подтверждение снято');
assert.eq(promo.helpers.length, 1, 'assignWorker: чужие helpers не тронуты');
assert.eq(promo.confirm['Антон'], 'ok', 'assignWorker: чужой confirm сохранён');

// --- 4. Кнопка в блоке «Исполнители» ---

DB.users = [{ id: 'u1', name: 'Борис', role: 'worker' }];
const noWorkerOrder = freshOrder(930, null);
let html = renderOrderTeamBlock(noWorkerOrder, true);
assert(html.indexOf('data-assign-worker="930"') >= 0, 'team: кнопка назначения есть');
assert(html.indexOf('Назначить исполнителя') >= 0, 'team: подпись «Назначить исполнителя»');

const withWorker = freshOrder(931, 'Борис');
html = renderOrderTeamBlock(withWorker, true);
assert(html.indexOf('data-assign-worker="931"') >= 0, 'team: кнопка смены есть');
assert(html.indexOf('Сменить исполнителя') >= 0, 'team: подпись «Сменить исполнителя»');

assert(renderOrderTeamBlock(withWorker, false).indexOf('data-assign-worker') < 0,
  'team: не editable → кнопки нет');

['completed', 'paid', 'canceled'].forEach(function (st) {
  const done = freshOrder(932, 'Борис');
  done.status = st;
  assert(renderOrderTeamBlock(done, true).indexOf('data-assign-worker') < 0,
    'team: ' + st + ' → кнопки нет');
});

login('worker', 'Фёдор');
assert(renderOrderTeamBlock(withWorker, true).indexOf('data-assign-worker') < 0,
  'team: worker без order_assign → кнопки нет');
login('manager', 'Ирина');

// --- 5. Модалка выбора исполнителя ---

DB.users = [
  { id: 'u1', name: 'Борис', role: 'worker' },
  { id: 'u2', name: 'Вера', role: 'worker' }
];
const modalOrder = freshOrder(940, 'Борис');
DB.orders = [modalOrder];
modalStub.innerHTML = '';
renderAssignWorkerModal(modalOrder);
assert(modalStub.innerHTML.indexOf('aw-name') >= 0, 'модалка: select id="aw-name"');
assert(modalStub.innerHTML.indexOf('data-save-worker="940"') >= 0, 'модалка: кнопка сохранения');
assert(modalStub.innerHTML.indexOf('В пул (снять исполнителя)') >= 0, 'модалка: опция «в пул»');
assert(modalStub.innerHTML.indexOf('Борис — текущий') >= 0, 'модалка: текущий помечен');
assert(modalStub.innerHTML.indexOf('value="Борис" selected') >= 0, 'модалка: selected у текущего');
assert(modalStub.innerHTML.indexOf('Вера') >= 0, 'модалка: другие сотрудники есть');
assert(modalStub.innerHTML.indexOf('Сейчас') >= 0, 'модалка: показывает текущего');

// Нет сотрудников в админке — модалка не открывается.
DB.users = [];
modalStub.innerHTML = '';
renderAssignWorkerModal(modalOrder);
assert.eq(modalStub.innerHTML, '', 'модалка: пустой список сотрудников → не показана');
DB.users = [
  { id: 'u1', name: 'Борис', role: 'worker' },
  { id: 'u2', name: 'Вера', role: 'worker' }
];

// --- 6. doAssignWorker: смена без конфликта ---

modalStub.innerHTML = '';
doAssignWorker(940, 'Вера');
assert.eq(modalOrder.worker, 'Вера', 'doAssignWorker: исполнитель сменён');
assert.eq(window.__assignPending, null, 'doAssignWorker: __assignPending чист');
assert.eq(modalStub.innerHTML, '', 'doAssignWorker: модалка закрыта');

// Тот же исполнитель — без записи в историю.
const hLen = modalOrder.history.length;
doAssignWorker(940, 'Вера');
assert.eq(modalOrder.history.length, hLen, 'doAssignWorker: тот же → история не растёт');

// Несуществующая заявка — тихий выход.
doAssignWorker(99999, 'Борис');
assert(true, 'doAssignWorker: нет заявки → не падает');

// --- 7. doAssignWorker: снятие исполнителя ('') → в пул ---

const relOrder = freshOrder(950, 'Борис');
relOrder.status = 'inwork';
DB.orders = [relOrder];
doAssignWorker(950, '');
assert.eq(relOrder.worker, null, 'снятие: worker обнулён (releaseOrderToPool)');
assert(relOrder.history.some(function (h) { return h.action === 'release_pool'; }),
  'снятие: запись release_pool в истории');

// Статус, где снимать нельзя — отказ.
const blocked = freshOrder(951, 'Борис');
blocked.status = 'completed';
DB.orders = [blocked];
doAssignWorker(951, '');
assert.eq(blocked.worker, 'Борис', 'снятие: completed → worker остался');

// --- 8. doAssignWorker: конфликт по времени → модалка + force ---

DB.orders = [
  freshOrder(960, null),
  { id: 961, status: 'new', worker: 'Борис', date: today, t1: '09:00', t2: '12:00',
    helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [] }
];
const target = DB.orders[0];
modalStub.innerHTML = '';
window.__assignPending = null;
doAssignWorker(960, 'Борис');
assert.eq(target.worker, null, 'конфликт: до подтверждения не назначен');
assert(modalStub.innerHTML.indexOf('Пересечение') >= 0, 'конфликт: модалка показана');
assert(modalStub.innerHTML.indexOf('Всё равно назначить') >= 0, 'конфликт: кнопка подтверждения');
assert(!!window.__assignPending, 'конфликт: данные отложены в __assignPending');
assert.eq(window.__assignPending.id, 960, 'конфликт: pending.id');
assert.eq(window.__assignPending.name, 'Борис', 'конфликт: pending.name');

clickOn('data-force-assign');
assert.eq(target.worker, 'Борис', 'force: назначен вопреки конфликту');
assert.eq(window.__assignPending, null, 'force: __assignPending очищен');
assert.eq(modalStub.innerHTML, '', 'force: модалка закрыта');

// Отмена в модалке конфликта сбрасывает pending.
modalStub.innerHTML = '';
window.__assignPending = { id: 960, name: 'Вера' };
clickOn('data-close');
assert.eq(window.__assignPending, null, 'close: __assignPending сброшен');
modalStub.innerHTML = '';
window.__assignPending = { id: 960, name: 'Вера' };
clickOn('data-modal-overlay');
assert.eq(window.__assignPending, null, 'overlay: __assignPending сброшен');

// Клик по force без pending — закрытие модалки без назначения.
window.__assignPending = null;
modalStub.innerHTML = '<div>x</div>';
const beforeNoPend = target.worker;
clickOn('data-force-assign');
assert.eq(target.worker, beforeNoPend, 'force без pending: назначения нет');
assert.eq(modalStub.innerHTML, '', 'force без pending: модалка закрыта');

// Конфликт не мешает назначить свободного сотрудника.
modalStub.innerHTML = '';
doAssignWorker(960, 'Вера');
assert.eq(target.worker, 'Вера', 'без конфликта: Вера назначена');
assert.eq(modalStub.innerHTML, '', 'без конфликта: модалка не открыта');

// --- 9. Делегат кликов ---

const cardOrder = freshOrder(970, null);
DB.orders = [cardOrder];
modalStub.innerHTML = '';
clickOn('data-assign-worker', 970);
assert(modalStub.innerHTML.indexOf('aw-name') >= 0, 'делегат: клик открыл модалку');

clearFields();
setField('aw-name', 'Борис');
clickOn('data-save-worker', 970);
assert.eq(cardOrder.worker, 'Борис', 'делегат: сохранение назначило исполнителя');

// Клик по кнопке не должен открывать карточку заявки.
assert.eq(state.screen, 'orders', 'делегат: клик не ушёл на карточку');

// Нет права — отказ (worker вместо manager).
login('worker', 'Фёдор');
modalStub.innerHTML = '';
clickOn('data-assign-worker', 970);
assert.eq(modalStub.innerHTML, '', 'делегат: без права модалка не открыта');
login('manager', 'Ирина');

// applyAssignWorker на несуществующую заявку.
assert.eq(applyAssignWorker(99999, 'Борис'), false, 'applyAssignWorker: нет заявки → false');

// --- 10. Экспорты/typeof ---
['assignWorker', 'renderAssignWorkerModal', 'showAssignConflictModal',
 'doAssignWorker', 'applyAssignWorker', 'renderOrderTeamBlock',
 'releaseOrderToPool', 'canReleaseToPool'].forEach(function (n) {
  assert(typeof globalThis[n] === 'function', 'typeof ' + n);
});
