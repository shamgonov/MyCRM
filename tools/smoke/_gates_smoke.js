/* Смоук app/gates.js (Этап 3): права на просмотр/правку, назначение, пул. */
'use strict';

globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
globalThis.document = {
  getElementById: function () { return null; },
  addEventListener: function () {}
};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');

// --- Фикстуры
const ORDER_OTHER = { id: 1, worker: 'Борис', helpers: ['Вера'], status: 'inwork' };
const ORDER_MINE = { id: 2, worker: 'Фёдор', helpers: [], status: 'inwork' };
const ORDER_HELPER = { id: 3, worker: 'Борис', helpers: ['Фёдор'], status: 'inwork' };
const ORDER_FREE = { id: 4, worker: null, helpers: [], status: 'new' };
const ORDER_DONE = { id: 5, worker: 'Фёдор', helpers: [], status: 'paid' };

// Вход как worker Фёдор: прав orders_* нет (только calendar_own/shopping/profile)
setOwnerFlag(false);
DB.users = [];
login('worker', 'Фёдор');

// --- isAssignedToMe: worker и helpers (правило SPEC 8)
assert(isAssignedToMe(ORDER_MINE) === true, 'isAssignedToMe: я worker');
assert(isAssignedToMe(ORDER_HELPER) === true, 'isAssignedToMe: я в helpers');
assert(isAssignedToMe(ORDER_OTHER) === false, 'isAssignedToMe: чужая заявка');
assert(isAssignedToMe(null) === false, 'isAssignedToMe(null) безопасен');

// --- canViewOrder: worker без права видит только свои
assert(canViewOrder(ORDER_MINE) === true, 'canViewOrder: свою можно');
assert(canViewOrder(ORDER_HELPER) === true, 'canViewOrder: свою по helper можно');
assert(canViewOrder(ORDER_OTHER) === false, 'canViewOrder: чужую worker НЕ видит');

// --- canEditOrder: свою открытую можно, закрытую нельзя, чужую нельзя
assert(canEditOrder(ORDER_MINE) === true, 'canEditOrder: свою inwork можно');
assert(canEditOrder(ORDER_DONE) === false, 'canEditOrder: свою paid нельзя');
assert(canEditOrder(ORDER_OTHER) === false, 'canEditOrder: чужую нельзя');

// --- admin видит и правит всё (право orders_view_all/orders_edit через алиасы)
login('admin', 'Владелец');
assert(can('orders_view_all') === true, 'admin имеет orders_view_all');
assert(canViewOrder(ORDER_OTHER) === true, 'admin видит чужую');
assert(canEditOrder(ORDER_OTHER) === true, 'admin правит чужую');
assert(canEditOrder(ORDER_DONE) === true, 'admin правит даже paid');

// --- manager: право edit есть, view_all есть
login('manager', 'Мария');
assert(can('orders_view_all') && can('orders_edit'), 'manager: view_all + edit');
assert(canViewOrder(ORDER_OTHER) === true, 'manager видит чужую');
assert(canEditOrder(ORDER_OTHER) === true, 'manager правит чужую');

// --- canTakeOrder: только new/inspection/approved и без worker
login('worker', 'Фёдор');
assert(canTakeOrder(ORDER_FREE) === true, 'canTakeOrder: new без worker можно взять');
const ORDER_TAKEN = { id: 6, worker: 'Борис', helpers: [], status: 'new' };
assert(canTakeOrder(ORDER_TAKEN) === false, 'canTakeOrder: с worker нельзя');
assert(canTakeOrder(ORDER_MINE) === false, 'canTakeOrder: inwork нельзя');
assert(canTakeOrder({ id: 7, worker: null, status: 'estimate' }) === false,
  'canTakeOrder: estimate нельзя');

// --- showTakeBtn: можно взять и я не приписан
assert(showTakeBtn(ORDER_FREE) === true, 'showTakeBtn: new без worker — кнопка есть');
assert(showTakeBtn(ORDER_MINE) === false, 'showTakeBtn: уже исполнитель — нет кнопки');
assert(showTakeBtn(ORDER_HELPER) === false, 'showTakeBtn: уже helper — нет кнопки');
assert(showTakeBtn(ORDER_TAKEN) === false, 'showTakeBtn: занято Борисом — нет кнопки');

// --- hiddenTakeFromMe: из пула скрываются мои (worker ИЛИ helper) — правило SPEC 7
assert(hiddenTakeFromMe(ORDER_MINE) === true, 'hiddenTakeFromMe: моя (worker) скрыта из пула');
assert(hiddenTakeFromMe(ORDER_HELPER) === true, 'hiddenTakeFromMe: моя (helper) скрыта из пула');
assert(hiddenTakeFromMe(ORDER_OTHER) === false, 'hiddenTakeFromMe: чужая остаётся в пуле');
assert(hiddenTakeFromMe(ORDER_FREE) === false, 'hiddenTakeFromMe: свободная в пуле');
