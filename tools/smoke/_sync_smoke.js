/* Смоук app/sync.js (Этап 21): sanitize, очередь, orderSave/orderPatch,
   регрессия без firebase, мок-отправка (merge:true, ошибки, пауза). */
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
var clickHandlers = [];
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
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 0; };
// Toast-мок для проверок permission-denied
globalThis.toast = function () {};

// 1. Локальный режим без firebase
loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/sync.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// --- 1. sanitize: удаляет undefined рекурсивно (SPEC правило 3) ---

var obj1 = { a: 1, b: undefined, c: { d: 2, e: undefined, f: { g: 3, h: undefined } } };
var cleaned = sanitize(obj1);
assert('a' in cleaned, 'sanitize: a сохранено');
assert(!('b' in cleaned), 'sanitize: b удалён (undefined)');
assert('c' in cleaned, 'sanitize: c сохранён');
assert(!('e' in cleaned.c), 'sanitize: e удалён (undefined)');
assert('f' in cleaned.c, 'sanitize: f сохранён');
assert('g' in cleaned.c.f, 'sanitize: g сохранён');
assert(!('h' in cleaned.c.f), 'sanitize: h удалён (undefined)');

var arr = [{ a: 1, b: undefined }, { a: 2 }];
var cleanedArr = sanitize(arr);
assert.eq(cleanedArr.length, 2, 'sanitize(array): длина');
assert(!('b' in cleanedArr[0]), 'sanitize(array): b удалён');

// Примитивы и Date
assert.eq(sanitize(null), null, 'sanitize(null)');
assert.eq(sanitize(undefined), undefined, 'sanitize(undefined)');
assert.eq(sanitize('text'), 'text', 'sanitize(string)');
assert.eq(sanitize(42), 42, 'sanitize(number)');
var d = new Date('2024-01-01T00:00:00Z');
assert.eq(typeof sanitize(d), 'string', 'sanitize(Date) → ISO string');

// --- 2. queueOperation: добавляет запись в DB.syncQueue и вызывает save ---

assert(Array.isArray(DB.syncQueue), 'syncQueue: инициализирован как массив');
assert.eq(DB.syncQueue.length, 0, 'syncQueue: пуст');

var op1 = queueOperation({ type: 'save', collection: 'orders', docId: '1', data: { a: 1 } });
assert.eq(op1, true, 'queueOperation: возврат true');
assert.eq(DB.syncQueue.length, 1, 'queueOperation: длина 1');
assert.eq(DB.syncQueue[0].type, 'save', 'queueOperation: тип save');
assert.eq(DB.syncQueue[0].collection, 'orders', 'queueOperation: коллекция');
assert.eq(DB.syncQueue[0].docId, '1', 'queueOperation: docId');
assert('ts' in DB.syncQueue[0], 'queueOperation: ts задан');

var op2 = queueOperation({ type: 'patch', collection: 'orders', docId: '2', data: { b: 2 } });
assert.eq(op2, true, 'queueOperation: patch');
assert.eq(DB.syncQueue.length, 2, 'queueOperation: длина 2');

var bad = queueOperation({ type: 'save', collection: 'orders' });
assert.eq(bad, false, 'queueOperation: невалидный → false');

// --- 3. orderSave: формирует операцию с type: 'save' ---

DB.syncQueue = [];
var order = { id: 100, client: 'Тест', status: 'new', works: [], extras: [], materials: [], history: [], payments: [] };
var osRes = orderSave(order);
assert.eq(osRes, true, 'orderSave: возврат true');
assert.eq(DB.syncQueue.length, 1, 'orderSave: очередь 1');
assert.eq(DB.syncQueue[0].type, 'save', 'orderSave: type=save');
assert.eq(DB.syncQueue[0].collection, 'orders', 'orderSave: collection=orders');
assert.eq(DB.syncQueue[0].docId, '100', 'orderSave: docId=100');
assert('id' in DB.syncQueue[0].data, 'orderSave: data содержит id');
assert.eq(DB.syncQueue[0].data.client, 'Тест', 'orderSave: data содержит client');

var badOrder = { client: 'Без ID' };
assert.eq(orderSave(badOrder), false, 'orderSave: без id → false');

// --- 4. orderPatch: формирует операцию с type: 'patch' ---

DB.syncQueue = [];
var opPatch = orderPatch(200, { status: 'completed', note: 'Готово' });
assert.eq(opPatch, true, 'orderPatch: возврат true');
assert.eq(DB.syncQueue.length, 1, 'orderPatch: очередь 1');
assert.eq(DB.syncQueue[0].type, 'patch', 'orderPatch: type=patch');
assert.eq(DB.syncQueue[0].docId, '200', 'orderPatch: docId=200');
assert.eq(DB.syncQueue[0].data.status, 'completed', 'orderPatch: data.status');
assert.eq(orderPatch(null, { status: 'new' }), false, 'orderPatch: без id → false');

// --- 5. flushQueue: локальный режим (без firebase) ---

DB.syncQueue = [
  { type: 'save', collection: 'orders', docId: '1', data: { a: 1 }, ts: Date.now() },
  { type: 'patch', collection: 'orders', docId: '2', data: { b: 2 }, ts: Date.now() }
];
flushQueue();
assert.eq(DB.syncQueue.length, 2, 'flushQueue: без firebase очередь не очищается');

// --- 6. initSync: без firebase возвращает false ---

assert.eq(initSync(), false, 'initSync: без firebase → false');

// --- 7. Мок Firebase: отправка (merge:true), ошибки, пауза и снятие паузы ---
// Единый объект с переключаемым режимом MOCK.mode; thenable синхронный,
// поэтому все проверки детерминированы без ожидания микротасок.
// Помнить: queueOperation() сам вызывает flushQueue() после enqueue.

var MOCK = { mode: 'ok', ops: [] };
function mockThen(fail) {
  return {
    then: function (ok, onErr) {
      if (fail) { if (onErr) onErr(fail); }
      else { ok(); }
      return { then: function () {} };
    }
  };
}
globalThis.firebase = {
  apps: [{}], // initSync не должен повторно вызывать initializeApp
  initializeApp: function () {},
  firestore: function () {
    return {
      enablePersistence: function () {},
      collection: function (name) {
        return {
          doc: function (id) {
            return {
              set: function (data, opts) {
                MOCK.ops.push({ t: 'set', coll: name, id: id, data: data, opts: opts || {} });
                if (MOCK.mode === 'denied') return mockThen({ code: 'permission-denied' });
                if (MOCK.mode === 'offline') return mockThen({ code: 'unavailable' });
                return mockThen(null);
              },
              update: function (data) {
                MOCK.ops.push({ t: 'update', coll: name, id: id, data: data });
                if (MOCK.mode === 'denied') return mockThen({ code: 'permission-denied' });
                if (MOCK.mode === 'offline') return mockThen({ code: 'unavailable' });
                return mockThen(null);
              }
            };
          }
        };
      }
    };
  }
};

// 7.1 Успешная отправка: set + merge:true (SPEC правило 4)
MOCK.mode = 'ok'; MOCK.ops = []; DB.syncQueue = [];
orderSave({ id: 10, client: 'OK', status: 'new' });
assert.eq(MOCK.ops.length, 1, 'mock: save отправлен сразу (queueOperation→flushQueue)');
assert.eq(MOCK.ops[0].t, 'set', 'mock: save → set');
assert.eq(MOCK.ops[0].id, '10', 'mock: docId строкой');
assert.eq(MOCK.ops[0].opts.merge, true, 'mock: merge:true (SPEC 4)');
assert.eq(DB.syncQueue.length, 0, 'mock: очередь пуста после успеха');

// 7.2 patch → update (SPEC правило 5)
MOCK.ops = [];
orderPatch(11, { status: 'completed' });
assert.eq(MOCK.ops.length, 1, 'mock: patch отправлен');
assert.eq(MOCK.ops[0].t, 'update', 'mock: patch → update (SPEC 5)');
assert.eq(MOCK.ops[0].data.status, 'completed', 'mock: patch данные');

// 7.3 sanitize до отправки: undefined не уходит в Firestore
MOCK.ops = [];
orderSave({ id: 12, client: 'S', junk: undefined });
assert(!('junk' in MOCK.ops[0].data), 'mock: undefined вычищен (SPEC 3)');

// 7.4 permission-denied: пропуск без возврата в очередь (toast, не пауза)
MOCK.mode = 'denied'; MOCK.ops = []; DB.syncQueue = [];
orderSave({ id: 99, client: 'X' });
assert.eq(MOCK.ops.length, 1, 'mock: denied попытка была');
assert.eq(DB.syncQueue.length, 0, 'mock: denied → операция выброшена из очереди');

// 7.5 unavailable: возврат в голову очереди + пауза (SPEC правило 6)
MOCK.mode = 'offline'; MOCK.ops = []; DB.syncQueue = [];
orderSave({ id: 88, client: 'Y' });
assert.eq(DB.syncQueue.length, 1, 'mock: unavailable → очередь сохранила операцию');
assert.eq(DB.syncQueue[0].docId, '88', 'mock: операция вернулась в голову');

// 7.6 На паузе новые попытки не уходят, пока сеть не вернётся
MOCK.ops = [];
flushQueue();
assert.eq(MOCK.ops.length, 0, 'mock: на паузе flushQueue ничего не шлёт');

// 7.7 Снятие паузы: новая операция в режиме ok отправляет и её, и накопленную
MOCK.mode = 'ok';
orderPatch(88, { status: 'inspection' });
assert.eq(DB.syncQueue.length, 0, 'mock: пауза снята, очередь разобрана');
assert.eq(MOCK.ops.length, 2, 'mock: отправлены обе операции (88 + новая)');

// 7.8 Нет firebase — тихий локальный режим (регрессия)
var savedFb = globalThis.firebase;
delete globalThis.firebase;
DB.syncQueue = [];
orderSave({ id: 55, client: 'offline' });
assert.eq(DB.syncQueue.length, 1, 'без firebase: операция осталась в очереди');
assert.eq(initSync(), false, 'без firebase: initSync → false');
globalThis.firebase = savedFb;

// --- 8. typeof-регрессии ---

assert(typeof sanitize === 'function', 'typeof sanitize');
assert(typeof queueOperation === 'function', 'typeof queueOperation');
assert(typeof orderSave === 'function', 'typeof orderSave');
assert(typeof orderPatch === 'function', 'typeof orderPatch');
assert(typeof flushQueue === 'function', 'typeof flushQueue');
assert(typeof initSync === 'function', 'typeof initSync');
