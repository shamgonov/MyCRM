/* Смоук Этапа 14: пул, «Взять в работу», подтверждение соисполнителя, Q4 переход inwork→postponed. */
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
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
  },
  addEventListener: function () {}
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');

setOwnerFlag(false);
DB.users = [];
login('worker', 'Фёдор');

// --- 1. Q4: inwork → postponed разрешён ---
const wOrder = {
  id: 100, status: 'inwork', worker: 'Фёдор',
  works: [], extras: [], materials: [], history: []
};
DB.orders = [wOrder];
const ok = transitionOrder(100, 'postponed');
assert(ok === true, 'Q4: inwork → postponed разрешён');
assert.eq(wOrder.status, 'postponed', 'Q4: статус изменился');
assert(wOrder.history.some(function (h) { return h.action === 'status' && h.to === 'postponed'; }),
  'Q4: переход записан в историю');

// --- 2. isAssignedToMe + подтверждение: pending = «своя», no = «чужая» ---
const pending = { id: 101, worker: 'А', helpers: ['Фёдор'], confirm: { 'Фёдор': 'pending' } };
const confirmed = { id: 102, worker: 'А', helpers: ['Фёдор'], confirm: { 'Фёдор': 'ok' } };
const refused = { id: 103, worker: 'А', helpers: ['Фёдор'], confirm: { 'Фёдор': 'no' } };
const noConfirm = { id: 104, worker: 'А', helpers: ['Фёдор'], confirm: {} };

assert(isAssignedToMe(pending) === true, 'helper pending → assigned');
assert(isAssignedToMe(confirmed) === true, 'helper ok → assigned');
assert(isAssignedToMe(refused) === false, 'helper no → НЕ assigned');
assert(isAssignedToMe(noConfirm) === true, 'helper без confirm → pending по умолчанию');

// --- 3. canTakeOrder + showTakeBtn: без worker и подходящий статус ---
const freeOrder = { id: 200, status: 'new', worker: null, helpers: [] };
const inspectionOrder = { id: 201, status: 'inspection', worker: null, helpers: [] };
const approvedOrder = { id: 202, status: 'approved', worker: null, helpers: [] };
const busyOrder = { id: 203, status: 'new', worker: 'Борис', helpers: [] };
const estOrder = { id: 204, status: 'estimate', worker: null, helpers: [] };

assert(canTakeOrder(freeOrder) === true, 'canTakeOrder: new без worker');
assert(canTakeOrder(inspectionOrder) === true, 'canTakeOrder: inspection без worker');
assert(canTakeOrder(approvedOrder) === true, 'canTakeOrder: approved без worker');
assert(canTakeOrder(busyOrder) === false, 'canTakeOrder: с worker нельзя');
assert(canTakeOrder(estOrder) === false, 'canTakeOrder: estimate нельзя');

// --- 4. showTakeBtn: можно взять + не я в ней ---
assert(showTakeBtn(freeOrder) === true, 'showTakeBtn: free → кнопка');
assert(showTakeBtn(busyOrder) === false, 'showTakeBtn: занят → нет кнопки');
assert(showTakeBtn(pending) === false, 'showTakeBtn: уже helper → нет кнопки');

// --- 5. hiddenTakeFromMe: скрывает из пула ---
assert(hiddenTakeFromMe(freeOrder) === false, 'hiddenTakeFromMe: свободная видна');
assert(hiddenTakeFromMe(pending) === true, 'hiddenTakeFromMe: pending соисл. скрыта');
assert(hiddenTakeFromMe(confirmed) === true, 'hiddenTakeFromMe: подтверждённый соисл. скрыт');
assert(hiddenTakeFromMe(refused) === false, 'hiddenTakeFromMe: отказался → видна');

// --- 6. getPoolOrders + isPoolOrder ---
DB.orders = [freeOrder, inspectionOrder, approvedOrder, busyOrder, estOrder];
const pool = getPoolOrders();
assert.eq(pool.length, 3, 'getPoolOrders: 3 свободные заявки');
assert(isPoolOrder(freeOrder) === true, 'isPoolOrder: new виден');
assert(isPoolOrder(busyOrder) === false, 'isPoolOrder: с worker не виден');
assert(isPoolOrder(estOrder) === false, 'isPoolOrder: estimate не виден');

// --- 7. takeOrder: назначение worker, takenAt, takenBy, история ---
const takeable = { id: 300, status: 'new', worker: null, helpers: [],
  works: [], extras: [], materials: [], history: [] };
const res = takeOrder(takeable);
assert(res.ok === true, 'takeOrder: успех');
assert.eq(takeable.worker, 'Фёдор', 'takeOrder: worker установлен');
assert(takeable.takenAt > 0, 'takeOrder: takenAt проставлен');
assert.eq(takeable.takenBy, 'Фёдор', 'takeOrder: takenBy = текущий пользователь');
assert(takeable.history.some(function (h) { return h.action === 'take'; }),
  'takeOrder: запись в истории');

// Повторное взятие — ошибка.
const taken = { id: 301, status: 'new', worker: null, helpers: [],
  works: [], extras: [], materials: [], history: [] };
takeOrder(taken);
const res2 = takeOrder(taken);
assert(res2.ok === false, 'takeOrder: повторная ошибка');
assert(res2.reason === 'Исполнитель уже назначен', 'takeOrder: причина ошибки');

// --- 8. assignHelper + confirmHelper ---
const assignTarget = { id: 400, status: 'approved', worker: 'Фёдор', helpers: [],
  works: [], extras: [], materials: [], history: [] };
assert(assignHelper(assignTarget, 'Вера') === true, 'assignHelper: добавлен');
assert.eq(assignTarget.helpers.length, 1, 'assignHelper: helpers[0] = Вера');
assert.eq(assignTarget.confirm['Вера'], 'pending', 'assignHelper: confirm=pending');

assert(assignHelper(assignTarget, 'Фёдор') === false, 'assignHelper: тот же пользователь отказан');
assert(assignHelper(assignTarget, 'Вера') === false, 'assignHelper: дубликат отказан');

// Подтверждение ok.
assert(confirmHelper(assignTarget, 'Вера', 'ok') === true, 'confirmHelper: ok');
assert.eq(assignTarget.confirm['Вера'], 'ok', 'confirmHelper: confirm=ok');
assert(assignTarget.history.some(function (h) {
  return h.action === 'confirm_helper' && h.details.indexOf('подтвердил') >= 0;
}), 'confirmHelper: ok → история');

// Повторное подтверждение — ошибка (уже не pending).
assert(confirmHelper(assignTarget, 'Вера', 'ok') === false, 'confirmHelper: повтор ok → false');

// Новый соисполнитель и отказ.
assignTarget.helpers = [];
assignTarget.confirm = {};
assignHelper(assignTarget, 'Борис');
assert(confirmHelper(assignTarget, 'Борис', 'no') === true, 'confirmHelper: no');
assert(assignTarget.helpers.length === 0, 'confirmHelper no: удалён из helpers');
assert(assignTarget.confirm['Борис'] === undefined, 'confirmHelper no: confirm удалён');
assert(assignTarget.history.some(function (h) {
  return h.action === 'confirm_helper' && h.details.indexOf('отказался') >= 0;
}), 'confirmHelper no: история');

// --- 9. canViewOrder: пул видим всем ---
login('worker', 'Фёдор');
assert(canViewOrder(freeOrder) === true, 'worker видит пул-заявку без orders_view_all');
assert(canViewOrder(busyOrder) === false, 'worker НЕ видит занятую пул-заявку');

// --- 10. normalizeOrder: confirm — объект ---
const bare = { id: 500, works: [], extras: [], materials: [], history: [], payments: [] };
normalizeOrder(bare);
assert(bare.confirm !== null && typeof bare.confirm === 'object' && !Array.isArray(bare.confirm),
  'normalizeOrder: confirm = {}');
