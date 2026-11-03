/* Смоук app/orders.js (Этап 3): createOrder, normalizeOrder, расчёт, переходы. */
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
loadModule('app/orders.js');

// --- ORDER_STATUSES: полный состав из SPEC
assert.eq(ORDER_STATUSES.length, 11, 'ORDER_STATUSES: 11 статусов');
['new', 'inspection', 'estimate', 'approved', 'inwork', 'paused', 'waiting',
 'postponed', 'completed', 'paid', 'canceled'].forEach(function (s) {
  assert(ORDER_STATUSES.indexOf(s) >= 0, 'статус ' + s + ' в списке');
});

// --- STATUS_TRANSITIONS: ключевая матрица из SPEC
assert.eq(STATUS_TRANSITIONS.new.length, 3, 'new → 3 перехода (включая ветку C)');
assert(STATUS_TRANSITIONS.new.indexOf('approved') >= 0, 'ветка C: new → approved');
assert(STATUS_TRANSITIONS.new.indexOf('inspection') >= 0, 'new → inspection');
assert(STATUS_TRANSITIONS.estimate.indexOf('approved') >= 0, 'estimate → approved');
assert(STATUS_TRANSITIONS.estimate.indexOf('postponed') >= 0, 'estimate → postponed');
assert.eq(JSON.stringify(STATUS_TRANSITIONS.paid), '[]', 'paid — терминальный');
assert.eq(JSON.stringify(STATUS_TRANSITIONS.canceled), '[]', 'canceled — терминальный');
assert(STATUS_TRANSITIONS.inwork.indexOf('paused') >= 0, 'inwork → paused');
assert(STATUS_TRANSITIONS.paused.indexOf('inwork') >= 0, 'paused → inwork (возобновить)');
assert(STATUS_TRANSITIONS.completed.indexOf('paid') >= 0, 'completed → paid');
assert(STATUS_TRANSITIONS.approved.indexOf('inwork') >= 0, 'approved → inwork');

// --- normalizeOrder
const raw = { id: 9, client: 'Тест' };
normalizeOrder(raw);
assert(Array.isArray(raw.works) && Array.isArray(raw.extras) &&
  Array.isArray(raw.materials) && Array.isArray(raw.history),
  'normalizeOrder добавляет 4 коллекции');
assert.eq(normalizeOrder(null), null, 'normalizeOrder(null) безопасен');

// --- createOrder
login('worker', 'Фёдор');
const created = createOrder({ client: 'Иванов', address: 'Ленина 1' });
assert.eq(created.status, 'new', 'createOrder: статус new');
assert.eq(created.createdBy, 'Фёдор', 'createOrder: createdBy = текущий пользователь');
assert(typeof created.createdAt === 'number', 'createOrder: createdAt = Date.now()');
assert.eq(created.history.length, 1, 'createOrder: запись в истории о создании');
assert(created.id >= 1, 'createOrder: id назначен из seq');
assert(DB.orders.length >= 1, 'createOrder: заявка в DB.orders');
assert.eq(DB.seq, created.id, 'DB.seq синхронизирован');

// Вторая заявка получает следующий id
const created2 = createOrder({ client: 'Петров' });
assert.eq(created2.id, created.id + 1, 'createOrder: id инкрементальный');

// --- calculateOrderTotal
const ord = {
  id: 100,
  works: [
    { title: 'Регулировка', qty: 2, price: 500, skipped: false },
    { title: 'Замена стекла', qty: 1, price: 3000, skipped: true },
    { title: 'Уплотнитель', qty: 3, price: 200 }
  ],
  extras: [
    { name: 'Подоконник', qty: 1, price: 1000, status: 'agreed' },
    { name: 'Откосы', qty: 2, price: 500, status: 'pending_agree' },
    { name: 'Москитка', qty: 1, price: 700, status: 'rejected' }
  ],
  materials: [
    { name: 'Силикон', qty: 2, price: 300 }
  ],
  matsInTotal: false
};
// works: 2*500 + 0 (skipped) + 3*200 = 1600; extras agreed: 1000; материалы не считаем.
assert.eq(calculateOrderTotal(ord), 2600,
  'расчёт: skipped пропущен, только agreed extras, материалы выключены');
ord.matsInTotal = true;
// + материалы 2*300 = 600 → 3200
assert.eq(calculateOrderTotal(ord), 3200, 'расчёт: matsInTotal включает материалы');
assert.eq(calculateOrderTotal(null), 0, 'расчёт null = 0');
assert.eq(calculateOrderTotal({}), 0, 'расчёт пустой заявки = 0');

// --- transitionOrder: валидный переход пишет историю
state.user = 'Борис';
assert(transitionOrder(created.id, 'inspection') === true, 'переход new → inspection разрешён');
assert.eq(created.status, 'inspection', 'статус изменился');
const h = created.history[created.history.length - 1];
assert.eq(h.action, 'status', 'история: action=status');
assert.eq(h.from, 'new', 'история: from=new');
assert.eq(h.to, 'inspection', 'история: to=inspection');
assert.eq(h.by, 'Борис', 'история: by=текущий пользователь');
assert(typeof h.ts === 'number', 'история: ts = Date.now()');

// --- transitionOrder: запрещённые переходы
assert(transitionOrder(created.id, 'paid') === false, 'inspection → paid запрещён');
assert.eq(created.status, 'inspection', 'статус не изменился при отказе');
assert.eq(created.history.length, 2, 'запрещённый переход НЕ пишет историю');

// --- transitionOrder: полный цикл до paid + ветка C
assert(transitionOrder(created.id, 'estimate') === true, 'inspection → estimate');
assert(transitionOrder(created.id, 'approved') === true, 'estimate → approved');
assert(transitionOrder(created.id, 'inwork') === true, 'approved → inwork');
assert(transitionOrder(created.id, 'paused') === true, 'inwork → paused');
assert(transitionOrder(created.id, 'inwork') === true, 'paused → inwork (возобновить)');
assert(transitionOrder(created.id, 'completed') === true, 'inwork → completed');
assert(transitionOrder(created.id, 'paid') === true, 'completed → paid');
assert(transitionOrder(created.id, 'inwork') === false, 'paid терминальный');

// --- ветка C без осмотра
const fast = createOrder({ client: 'Срочный' });
assert(transitionOrder(fast.id, 'approved') === true, 'ветка C: new → approved');

// --- несуществующая заявка
assert(transitionOrder(999999, 'paid') === false, 'transitionOrder: нет заявки → false');
assert(transitionOrder(created.id, 'no-such-status') === false, 'неизвестный статус → false');

// --- saveOrderLocal: замена существующей
created2.client = 'Петров-Иванов';
saveOrderLocal(created2);
assert(DB.orders.length >= 3, 'saveOrderLocal не дублирует записи');
assert(DB.orders.filter(function (x) { return x.id === created2.id; }).length === 1,
  'saveOrderLocal: ровно одна запись с этим id');
assert.eq(DB.orders.find(function (x) { return x.id === created2.id; }).client,
  'Петров-Иванов', 'saveOrderLocal заменил по id');

// --- персистентность через save/load
saveOrderLocal(created);
DB = null;
load();
assert(DB.orders.length >= 3, 'после load() все заявки на месте');
assert.eq(DB.orders.find(function (x) { return x.id === created.id; }).status, 'paid',
  'статус пережил персистентность');
