/* Смоук Этапа 24: общая база справочников — generic-слой sync.js
   (collectionSave/collectionDelete/settingsSave/applyRemoteCollection/
   applyRemoteSettings/startCollectionListeners) и ветка delete в pump(). */
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
globalThis.clearTimeout = function () {};
globalThis.addEventListener = function () {};
globalThis.toast = function () {};

// Мок Firebase ДО загрузки sync.js (паттерн _sync_smoke): onSnapshot-колбэки
// коллекций в snapCbs, doc-колбэки в docSnapCbs, шпионы set/update/delete в ops.
function mockThen(fail) {
  return {
    then: function (ok, onErr) {
      if (fail) { if (onErr) onErr(fail); }
      else { ok(); }
      return { then: function () {} };
    }
  };
}
var MOCK = { mode: 'ok', ops: [], snapCbs: {}, docSnapCbs: {} };
globalThis.firebase = {
  apps: [{}],
  initializeApp: function () {},
  firestore: function () {
    return {
      enablePersistence: function () {},
      collection: function (name) {
        return {
          onSnapshot: function (cb) { MOCK.snapCbs[name] = cb; return function () {}; },
          doc: function (id) {
            return {
              onSnapshot: function (cb) { MOCK.docSnapCbs[name + '/' + id] = cb; return function () {}; },
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
              },
              delete: function () {
                MOCK.ops.push({ t: 'delete', coll: name, id: id });
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

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
// Этап 14-B: для старта слушателей и отправки нужен подтверждённый доступ.
state.cloudStatus = 'approved';
state.cloudActive = true;
loadModule('app/sync.js'); // авто-initSync(): orders + справочники + settings/org

setOwnerFlag(false);
login('admin', 'Владелец');

// Снимок коллекции в формате Firestore QuerySnapshot (forEach по докам).
function fireCollSnap(name, docs) {
  MOCK.snapCbs[name]({
    forEach: function (cb) {
      docs.forEach(function (d) { cb({ data: function () { return d; } }); });
    }
  });
}

// --- 1. collectionSave: форма операции + ts в данных ---

MOCK.mode = 'offline'; MOCK.ops = []; DB.syncQueue = [];
DB.clients = [];
assert.eq(collectionSave('clients', { id: 5, name: 'X' }), true, 'collectionSave: true');
assert.eq(DB.syncQueue.length, 1, 'collectionSave: операция в очереди (offline)');
var op1 = DB.syncQueue[0];
assert.eq(op1.type, 'save', 'collectionSave: type=save');
assert.eq(op1.collection, 'clients', 'collectionSave: collection');
assert.eq(op1.docId, '5', 'collectionSave: docId — строка id');
assert.eq(op1.data.name, 'X', 'collectionSave: данные в операции');
assert(typeof op1.data.ts === 'number', 'collectionSave: data.ts — число');
assert.eq(collectionSave('clients', { name: 'без id' }), false, 'collectionSave: без id → false');
assert.eq(collectionSave('clients', null), false, 'collectionSave: null → false');

// --- 2. collectionDelete: type=delete + реальный doc.delete() после flush ---

assert.eq(collectionDelete('clients', 5), true, 'collectionDelete: true');
var delOp = DB.syncQueue[DB.syncQueue.length - 1];
assert.eq(delOp.type, 'delete', 'collectionDelete: type=delete');
assert.eq(delOp.docId, '5', 'collectionDelete: docId');
assert.eq(collectionDelete('clients', null), false, 'collectionDelete: null id → false');
// Режим ok: новое collectionDelete снимает паузу и утаскивает всю очередь →
// delete-ветка pump() должна вызвать doc.delete().
MOCK.mode = 'ok';
collectionDelete('clients', 6);
var delCalls = MOCK.ops.filter(function (o) { return o.t === 'delete' && o.coll === 'clients'; });
assert.eq(delCalls.length, 2, 'pump delete: doc.delete() вызван для обеих операций');
assert.eq(delCalls[0].id, '5', 'pump delete: id первой операции');
assert.eq(DB.syncQueue.length, 0, 'pump delete: очередь разобрана');

// --- 3. settingsSave: whitelist общих ключей, личные не уходят ---

MOCK.mode = 'offline'; MOCK.ops = []; DB.syncQueue = [];
DB.settings.schedule = { Mon: ['09:00-18:00'] };
DB.settings.notifyEnabled = true;
DB.settings.digestShownToday = '2026-11-17';
assert.eq(settingsSave(), true, 'settingsSave: true');
var sOp = DB.syncQueue[DB.syncQueue.length - 1];
assert.eq(sOp.collection, 'settings', 'settingsSave: collection=settings');
assert.eq(sOp.docId, 'org', 'settingsSave: docId=org');
assert('executorMode' in sOp.data, 'settingsSave: executorMode в срезе');
assert('rewardPctDefault' in sOp.data, 'settingsSave: rewardPctDefault в срезе');
assert(Array.isArray(sOp.data.tagPresets), 'settingsSave: tagPresets в срезе');
assert(!('schedule' in sOp.data), 'settingsSave: schedule НЕ синхронизируется');
assert(!('notifyEnabled' in sOp.data), 'settingsSave: notifyEnabled НЕ синхронизируется');
assert(!('digestShownToday' in sOp.data), 'settingsSave: digestShownToday НЕ синхронизируется');

// settingsSharedSlice — чистый срез без мутации DB.settings.
var slice = settingsSharedSlice();
assert.eq(slice.warehouseAddress, DB.settings.warehouseAddress, 'slice: общее значение');
assert(!('schedule' in slice), 'slice: без личных ключей');

// --- 4. applyRemoteCollection: merge с учётом pending-операций ---

// 4a. Первый непустой снимок заменяет массив (локальное без pending уходит).
MOCK.mode = 'ok'; DB.syncQueue = [];
DB.suppliers = [{ id: 'a', name: 'Local' }];
applyRemoteCollection('suppliers', [{ id: 'b', name: 'R1' }, { id: 'c', name: 'R2' }]);
assert.eq(DB.suppliers.length, 2, 'applyCollection: снимок заменяет массив');
assert(DB.suppliers.some(function (x) { return x.id === 'b'; }), 'applyCollection: remote принят');
assert(!DB.suppliers.some(function (x) { return x.id === 'a'; }), 'applyCollection: локальное без pending удалено');

// 4b. Локальная pending save свежее remote → локальная запись сохраняется.
DB.tasks = [{ id: 't1', title: 'Local', ts: 900 }];
DB.syncQueue = [{ type: 'save', collection: 'tasks', docId: 't1', data: { ts: 1000 }, ts: 1000 }];
applyRemoteCollection('tasks', [{ id: 't1', title: 'Remote', ts: 500 }]);
assert.eq(DB.tasks.length, 1, 'applyCollection: pending save — одна запись');
assert.eq(DB.tasks[0].title, 'Local', 'applyCollection: older remote пропущен, локальное главнее');

// pending save защищает локальную версию в принципе (код ТЗ: несохранённые
// локальные правки живут поверх удалённого снимка), а без pending remote
// перекрывает локальное значение всегда.
DB.tasks = [{ id: 't1', title: 'Local', ts: 900 }];
DB.syncQueue = [];
applyRemoteCollection('tasks', [{ id: 't1', title: 'Remote', ts: 1500 }]);
assert.eq(DB.tasks[0].title, 'Remote', 'applyCollection: remote без pending перекрывает локальное');

// 4c. Pending delete → запись исчезает даже при живом remote.
DB.templates = [{ id: 'tp', name: 'X' }];
DB.syncQueue = [{ type: 'delete', collection: 'templates', docId: 'tp', data: {}, ts: 1000 }];
applyRemoteCollection('templates', [{ id: 'tp', name: 'X', ts: 500 }]);
assert.eq(DB.templates.length, 0, 'applyCollection: pending delete удаляет запись');

// --- 5. Сид: первый ПУСТОЙ снимок при локальных данных → загрузка локального ---

MOCK.mode = 'offline'; DB.syncQueue = [];
DB.clients = [{ id: 10, name: 'Клиент10' }, { id: 11, name: 'Клиент11' }];
fireCollSnap('clients', []); // слушатель clients: docs=[]
assert.eq(DB.clients.length, 2, 'сид: локальные клиенты не стёрты');
var seedOps = DB.syncQueue.filter(function (o) { return o.collection === 'clients'; });
assert.eq(seedOps.length, 2, 'сид: оба клиента поставлены в очередь загрузки');
assert.eq(seedOps[0].docId, '10', 'сид: docId первой операции');

// --- 6. applyRemoteSettings: whitelist-мердж, личное не трогается ---

MOCK.mode = 'ok'; DB.syncQueue = [];
DB.settings.executorMode = 'phys';
DB.settings.rewardPctDefault = 0;
var mySchedule = DB.settings.schedule;
applyRemoteSettings({
  executorMode: 'legal', rewardPctDefault: 15,
  schedule: { Mon: ['00:00'] }, notifyEnabled: false, digestShownToday: '1999-01-01',
  ts: 5
});
assert.eq(DB.settings.executorMode, 'legal', 'applySettings: общее применено');
assert.eq(DB.settings.rewardPctDefault, 15, 'applySettings: rewardPctDefault применён');
assert.eq(DB.settings.schedule, mySchedule, 'applySettings: личный schedule не тронут');
assert.eq(DB.settings.notifyEnabled, true, 'applySettings: notifyEnabled не перезаписан');
assert.eq(DB.settings.digestShownToday, '2026-11-17', 'applySettings: digestShownToday не перезаписан');

// Pending settings-операция свежее remote → remote пропускается.
DB.settings.executorMode = 'phys';
DB.syncQueue = [{ type: 'save', collection: 'settings', docId: 'org', data: {}, ts: 100000 }];
applyRemoteSettings({ executorMode: 'legal', ts: 50 });
assert.eq(DB.settings.executorMode, 'phys', 'applySettings: older remote отклонён');
DB.syncQueue = [];

// --- 7. Слушатели: подписки на справочники + doc settings/org ---

assert.eq(typeof MOCK.snapCbs.clients, 'function', 'listeners: clients подписан');
assert.eq(typeof MOCK.snapCbs.suppliers, 'function', 'listeners: suppliers подписан');
assert.eq(typeof MOCK.snapCbs.tasks, 'function', 'listeners: tasks подписан');
assert.eq(typeof MOCK.snapCbs.templates, 'function', 'listeners: templates подписан');
assert.eq(typeof MOCK.snapCbs.priceList, 'function', 'listeners: priceList подписан');
assert.eq(typeof MOCK.snapCbs.users, 'function', 'listeners: users подписан');
assert.eq(typeof MOCK.docSnapCbs['settings/org'], 'function', 'listeners: settings/org подписан');

// Снимок через слушатель доходит до DB (priceList ещё не loaded, docs есть).
MOCK.mode = 'ok'; DB.syncQueue = [];
DB.priceList = [];
fireCollSnap('priceList', [{ id: 7, name: 'Стекло 2мм', basePrice: 500 }]);
assert.eq(DB.priceList.length, 1, 'слушатель priceList: данные в DB');
assert.eq(DB.priceList[0].name, 'Стекло 2мм', 'слушатель priceList: содержимое');

// doc('org') без документа и без loaded → первичный settingsSave (сид настроек).
MOCK.mode = 'offline'; DB.syncQueue = [];
MOCK.docSnapCbs['settings/org']({ exists: false });
var orgOps = DB.syncQueue.filter(function (o) { return o.collection === 'settings'; });
assert.eq(orgOps.length, 1, 'слушатель settings: пустой org → settingsSave сид');

// doc('org') с документом → применение.
MOCK.mode = 'ok'; DB.syncQueue = [];
DB.settings.executorMode = 'phys';
MOCK.docSnapCbs['settings/org']({
  exists: true,
  data: function () { return { executorMode: 'self_employed', ts: 99999999999 }; }
});
assert.eq(DB.settings.executorMode, 'self_employed', 'слушатель settings: документ применён');

// --- 8. Регрессия локального режима: без firebase ничего не падает ---

var savedFb = globalThis.firebase;
delete globalThis.firebase;
MOCK.mode = 'ok'; DB.syncQueue = [];
assert.eq(collectionSave('clients', { id: 99, name: 'Офлайн' }), true, 'без firebase: collectionSave не падает');
assert.eq(DB.syncQueue.length, 1, 'без firebase: операция осталась в очереди');
assert.eq(startCollectionListeners(), false, 'без firebase: listeners → false');
assert.eq(settingsSave(), true, 'без firebase: settingsSave не падает');
var o8 = saveOrderLocal({ id: 123, client: 'X', works: [], extras: [], materials: [], history: [] });
assert(!!o8, 'без firebase: saveOrderLocal работает');
assert.eq(DB.orders.some(function (x) { return x.id === 123; }), true, 'без firebase: заявка сохранена локально');
globalThis.firebase = savedFb;

// --- 9. pendingOpFor ---

DB.syncQueue = [
  { type: 'save', collection: 'clients', docId: '1', data: {}, ts: 1 },
  { type: 'delete', collection: 'settings', docId: 'org', data: {}, ts: 2 }
];
assert.eq(pendingOpFor('settings', 'org').type, 'delete', 'pendingOpFor: находит пару');
assert.eq(pendingOpFor('clients', '2'), null, 'pendingOpFor: нет пары → null');

// --- 10. Экспорты/typeof ---

['settingsSharedSlice', 'collectionSave', 'collectionDelete', 'settingsSave',
 'pendingOpFor', 'seedCollectionUpload', 'applyRemoteCollection',
 'applyRemoteSettings', 'startCollectionListeners'].forEach(function (n) {
  assert(typeof globalThis[n] === 'function', 'typeof ' + n);
});
