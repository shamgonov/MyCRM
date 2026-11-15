/* Смоук app/sync.js (Этап 21): sanitize, очередь, orderSave/orderPatch,
   мок Firestore (set/merge:true, update, ошибки, пауза), onSnapshot-merge
   с разрешением по ts, офлайн-регрессия без firebase. */
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
globalThis.addEventListener = function () {}; // window.online у sync.js
globalThis.toast = function () {};

// Мок Firebase ДО загрузки sync.js: авто-initSync() при загрузке модуля
// должен подписаться на мок, а не уйти в локальный режим.
// Режимы: ok — успех; denied — permission-denied; offline — unavailable.
var MOCK = { mode: 'ok', ops: [], snapCb: null };
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
  apps: [{}], // sync.js не должен повторно вызывать initializeApp
  initializeApp: function () {},
  firestore: function () {
    return {
      enablePersistence: function () {},
      collection: function (name) {
        return {
          onSnapshot: function (cb) { MOCK.snapCb = cb; return function () {}; },
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
// firebaseConfig в смоуке не загружаем: apps непустой → initializeApp не нужен.

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/sync.js'); // авто-initSync() подписывает MOCK.snapCb

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// --- 1. sanitize: удаляет undefined рекурсивно (SPEC правило 3) ---

var obj1 = { a: 1, b: undefined, c: { d: 2, e: undefined, f: { g: 3, h: undefined } } };
var cleaned = sanitize(obj1);
assert('a' in cleaned, 'sanitize: a сохранено');
assert(!('b' in cleaned), 'sanitize: b удалён (undefined)');
assert(!('e' in cleaned.c), 'sanitize: e удалён (undefined)');
assert('g' in cleaned.c.f, 'sanitize: g сохранён');
assert(!('h' in cleaned.c.f), 'sanitize: h удалён (undefined)');

var cleanedArr = sanitize([{ a: 1, b: undefined }, { a: 2 }]);
assert.eq(cleanedArr.length, 2, 'sanitize(array): длина');
assert(!('b' in cleanedArr[0]), 'sanitize(array): b удалён');

assert.eq(sanitize(null), null, 'sanitize(null)');
assert.eq(sanitize(undefined), undefined, 'sanitize(undefined)');
assert.eq(sanitize('text'), 'text', 'sanitize(string)');
assert.eq(sanitize(42), 42, 'sanitize(number)');
assert.eq(typeof sanitize(new Date('2024-01-01T00:00:00Z')), 'string', 'sanitize(Date) → ISO');

// --- 2. initSync с моком: true + подписка onSnapshot ---

assert(MOCK.snapCb !== null, 'initSync: onSnapshot подписан при загрузке');
assert.eq(initSync(), true, 'initSync: с моком → true');

// --- 3. queueOperation в offline-режиме: enqueue + ts + save (SPEC 6: пауза) ---

MOCK.mode = 'offline'; MOCK.ops = []; DB.syncQueue = [];
assert(Array.isArray(DB.syncQueue), 'syncQueue: массив после миграции load()');

var op1 = queueOperation({ type: 'save', collection: 'orders', docId: '1', data: { a: 1 } });
assert.eq(op1, true, 'queueOperation: возврат true');
assert.eq(DB.syncQueue.length, 1, 'queueOperation: длина 1 (offline → в очереди)');
assert.eq(DB.syncQueue[0].type, 'save', 'queueOperation: тип save');
assert.eq(DB.syncQueue[0].collection, 'orders', 'queueOperation: коллекция');
assert.eq(DB.syncQueue[0].docId, '1', 'queueOperation: docId');
assert('ts' in DB.syncQueue[0], 'queueOperation: ts задан');
assert.eq(DB.syncQueue[0].data.ts, DB.syncQueue[0].ts, 'queueOperation: ts в данных (для onSnapshot)');

// queueOperation обязан вызвать save(): очередь видна в localStorage.
var persisted = JSON.parse(localStorage.getItem('crm2_db') || '{}');
assert(Array.isArray(persisted.syncQueue) && persisted.syncQueue.length === 1,
  'queueOperation: вызвал save() — очередь в localStorage');
assert.eq(persisted.syncQueue[0].docId, '1', 'queueOperation: сохранённая операция корректна');

assert.eq(queueOperation({ type: 'save', collection: 'orders' }), false,
  'queueOperation: невалидный (нет docId/data) → false');
assert.eq(queueOperation(null), false, 'queueOperation: null → false');

// --- 4. orderSave: операция type:'save' + sanitize + ts ---

MOCK.mode = 'offline'; DB.syncQueue = [];
var osRes = orderSave({ id: 100, client: 'Тест', status: 'new', junk: undefined });
assert.eq(osRes, true, 'orderSave: возврат true');
assert.eq(DB.syncQueue.length, 1, 'orderSave: в очереди (offline)');
assert.eq(DB.syncQueue[0].type, 'save', 'orderSave: type=save');
assert.eq(DB.syncQueue[0].collection, 'orders', 'orderSave: collection=orders');
assert.eq(DB.syncQueue[0].docId, '100', 'orderSave: docId строкой');
assert.eq(DB.syncQueue[0].data.client, 'Тест', 'orderSave: данные');
assert(!('junk' in DB.syncQueue[0].data), 'orderSave: undefined вычищен (SPEC 3)');
assert('ts' in DB.syncQueue[0], 'orderSave: ts в операции (ТЗ)');
assert.eq(orderSave({ client: 'Без ID' }), false, 'orderSave: без id → false');

// --- 5. orderPatch: операция type:'patch' (SPEC 5) ---

MOCK.mode = 'offline'; DB.syncQueue = [];
assert.eq(orderPatch(200, { status: 'completed', note: 'Готово' }), true, 'orderPatch: true');
assert.eq(DB.syncQueue.length, 1, 'orderPatch: в очереди');
assert.eq(DB.syncQueue[0].type, 'patch', 'orderPatch: type=patch');
assert.eq(DB.syncQueue[0].docId, '200', 'orderPatch: docId');
assert.eq(DB.syncQueue[0].data.status, 'completed', 'orderPatch: data.status');
assert('ts' in DB.syncQueue[0], 'orderPatch: ts в операции (ТЗ)');
assert.eq(orderPatch(null, { status: 'new' }), false, 'orderPatch: без id → false');

// --- 6. Успешная отправка: set + merge:true (SPEC 4), update (SPEC 5) ---

MOCK.mode = 'ok'; MOCK.ops = []; DB.syncQueue = [];
orderSave({ id: 10, client: 'OK', status: 'new' });
// queueOperation сам вызывает flushQueue — в ok-режиме операция уходит сразу
assert.eq(MOCK.ops.length, 1, 'mock: save отправлен (queueOperation→flushQueue)');
assert.eq(MOCK.ops[0].t, 'set', 'mock: save → set');
assert.eq(MOCK.ops[0].id, '10', 'mock: docId');
assert.eq(MOCK.ops[0].opts.merge, true, 'mock: merge:true (SPEC 4)');
assert.eq(DB.syncQueue.length, 0, 'mock: очередь пуста после успеха');

MOCK.ops = [];
orderPatch(11, { status: 'completed' });
assert.eq(MOCK.ops.length, 1, 'mock: patch отправлен');
assert.eq(MOCK.ops[0].t, 'update', 'mock: patch → update (SPEC 5)');
assert.eq(MOCK.ops[0].data.status, 'completed', 'mock: patch данные');

// --- 7. permission-denied: пропуск без возврата в очередь ---

MOCK.mode = 'denied'; MOCK.ops = []; DB.syncQueue = [];
orderSave({ id: 99, client: 'X' });
assert.eq(MOCK.ops.length, 1, 'mock: denied — попытка была');
assert.eq(DB.syncQueue.length, 0, 'mock: denied → операция выброшена');

// --- 8. unavailable: возврат в голову + пауза (SPEC 6) ---

MOCK.mode = 'offline'; MOCK.ops = []; DB.syncQueue = [];
orderSave({ id: 88, client: 'Y' });
assert.eq(DB.syncQueue.length, 1, 'mock: unavailable → операция в очереди');
assert.eq(DB.syncQueue[0].docId, '88', 'mock: возврат в голову очереди');

MOCK.ops = [];
flushQueue();
assert.eq(MOCK.ops.length, 0, 'mock: на паузе flushQueue молчит');

// Снятие паузы: новая операция в ok-режиме отправляет и её, и накопленную
MOCK.mode = 'ok';
orderPatch(88, { status: 'inspection' });
assert.eq(DB.syncQueue.length, 0, 'mock: пауза снята, очередь разобрана');
assert.eq(MOCK.ops.length, 2, 'mock: отправлены обе операции');

// --- 9. onSnapshot: merge удалённых изменений + разрешение по ts ---

function fireSnapshot(docs) {
  MOCK.snapCb({
    docChanges: function () {
      return docs.map(function (d) {
        return { type: 'modified', doc: { data: function () { return d; } } };
      });
    }
  });
}

MOCK.mode = 'offline'; // чтобы save() внутри snapshot не сбрасывал очередь в сеть
DB.orders = []; DB.syncQueue = [];

// Новый удалённый документ → добавляется локально
fireSnapshot([{ id: 7, client: 'Cloud', status: 'new', ts: 500 }]);
assert.eq(DB.orders.length, 1, 'snapshot: новый документ добавлен');
assert.eq(DB.orders[0].client, 'Cloud', 'snapshot: данные применены');

// Существование: merge полей (локальные, которых нет в remote, сохраняются)
fireSnapshot([{ id: 7, status: 'approved', ts: 600 }]);
assert.eq(DB.orders[0].client, 'Cloud', 'snapshot: merge — client не стёрт');
assert.eq(DB.orders[0].status, 'approved', 'snapshot: merge — status обновлён');

// Локальная незакоммиченная операция (ts новее remote) → remote НЕ применяем
DB.syncQueue = [{ type: 'save', collection: 'orders', docId: '7', data: { status: 'inwork' }, ts: 900 }];
fireSnapshot([{ id: 7, status: 'canceled', ts: 600 }]);
assert.eq(DB.orders[0].status, 'approved', 'snapshot: older remote отклонён (локальная операция главнее)');

// Remote новее локальной операции → применяем
fireSnapshot([{ id: 7, status: 'canceled', ts: 1500 }]);
assert.eq(DB.orders[0].status, 'canceled', 'snapshot: newer remote применён поверх очереди');

// Документ без id игнорируется
DB.orders = [];
fireSnapshot([{ client: 'без id', ts: 1 }]);
assert.eq(DB.orders.length, 0, 'snapshot: без id — игнор');

// --- 10. Регрессия: без firebase — тихий локальный режим ---

var savedFb = globalThis.firebase;
delete globalThis.firebase;
MOCK.mode = 'ok'; DB.syncQueue = [];
orderSave({ id: 55, client: 'offline' });
assert.eq(DB.syncQueue.length, 1, 'без firebase: операция осталась в очереди');
assert.eq(initSync(), false, 'без firebase: initSync → false');
globalThis.firebase = savedFb;

// --- 11. typeof-регрессии ---

assert(typeof sanitize === 'function', 'typeof sanitize');
assert(typeof queueOperation === 'function', 'typeof queueOperation');
assert(typeof orderSave === 'function', 'typeof orderSave');
assert(typeof orderPatch === 'function', 'typeof orderPatch');
assert(typeof flushQueue === 'function', 'typeof flushQueue');
assert(typeof initSync === 'function', 'typeof initSync');
