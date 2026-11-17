/* Смоук Этапа 25: индикатор статуса синхронизации.
   syncStatus() (режимы local/noaccess/offline/sending/error/ok), хуки
   refreshSyncStatus в sync.js, чип renderSyncStatus/renderSyncChip,
   модалка renderSyncDetailsModal (12 операций → 10 строк + «ещё 2»),
   делегаты data-sync-open / data-sync-flush, регрессия без firebase.
   Мок Firebase — как в _sync_smoke.js: синхронные thenable, режимы
   ok|denied|offline. */
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
// Фейковый #sync-status для refreshSyncStatus: null = элемента нет.
var syncHost = null;
var clickHandlers = [];

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    if (id === 'sync-status') return syncHost;
    return null;
  },
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.addEventListener = function () {}; // window.online у sync.js
globalThis.toast = function () {};

// Мок Firebase ДО загрузки sync.js.
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
  apps: [{}],
  initializeApp: function () {},
  firestore: function () {
    return {
      enablePersistence: function () {},
      collection: function (name) {
        return {
          onSnapshot: function () { return function () {}; },
          doc: function (id) {
            return {
              onSnapshot: function () { return function () {}; },
              set: function (data, opts) {
                MOCK.ops.push({ t: 'set', coll: name, id: id });
                if (MOCK.mode === 'denied') return mockThen({ code: 'permission-denied' });
                if (MOCK.mode === 'offline') return mockThen({ code: 'unavailable' });
                return mockThen(null);
              },
              update: function () {
                MOCK.ops.push({ t: 'update', coll: name, id: id });
                if (MOCK.mode === 'denied') return mockThen({ code: 'permission-denied' });
                if (MOCK.mode === 'offline') return mockThen({ code: 'unavailable' });
                return mockThen(null);
              },
              delete: function () {
                MOCK.ops.push({ t: 'delete', coll: name, id: id });
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
// Этап 14-B: слушатели/отправка требуют подтверждённого доступа.
state.cloudStatus = 'approved';
state.cloudActive = true;
loadModule('app/sync.js');
loadModule('app/ui-sync.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

function setQueue(n) {
  DB.syncQueue = [];
  for (var i = 1; i <= n; i++) {
    DB.syncQueue.push({ type: 'save', collection: 'orders', docId: String(i),
      data: { id: i }, ts: 1000 + i });
  }
}

// --- 1. Без firebase → mode 'local' + pending = длина очереди ---

var savedFb = globalThis.firebase;
delete globalThis.firebase;
setQueue(3);
var s1 = syncStatus();
assert.eq(s1.mode, 'local', '1: без firebase → local');
assert.eq(s1.pending, 3, '1: pending = длина очереди');
globalThis.firebase = savedFb;

// --- 2. Firebase + cloudStatus 'pending' → 'noaccess' ---

state.cloudStatus = 'pending';
assert.eq(syncStatus().mode, 'noaccess', '2: pending → noaccess');
state.cloudStatus = 'approved'; state.cloudActive = true;

// --- 3. Режимы по флагам: offline / sending / error / ok ---

SYNC_PAUSED = true;
assert.eq(syncStatus().mode, 'offline', '3: SYNC_PAUSED → offline');
SYNC_PAUSED = false;

SYNC_FLUSHING = true;
assert.eq(syncStatus().mode, 'sending', '3: SYNC_FLUSHING → sending');
SYNC_FLUSHING = false;

SYNC_LAST_ERROR = 'x';
assert.eq(syncStatus().mode, 'error', '3: SYNC_LAST_ERROR → error');
SYNC_LAST_ERROR = '';
assert.eq(syncStatus().mode, 'ok', '3: всё чисто → ok');

// --- 4. navigator.onLine = false → 'offline' ---

var savedNav = globalThis.navigator;
globalThis.navigator = { onLine: false };
assert.eq(syncStatus().mode, 'offline', '4: onLine=false → offline');
globalThis.navigator = savedNav;
assert.eq(syncStatus().mode, 'ok', '4: сеть вернулась → ok');

// --- 5. queueOperation в offline-режиме: pending растёт, syncStatus совпадает ---

MOCK.mode = 'offline'; MOCK.ops = []; setQueue(0);
queueOperation({ type: 'save', collection: 'orders', docId: '71', data: { a: 1 } });
assert.eq(syncStatus().pending, 1, '5: offline → операция осталась в очереди');
assert.eq(MOCK.ops.length, 1, '5: попытка отправки была');
queueOperation({ type: 'patch', collection: 'orders', docId: '72', data: { b: 2 } });
assert.eq(syncStatus().pending, 2, '5: вторая операция накоплена');

// --- 6. Успешная отправка: pending 0, lastOk > 0, lastError '' ---

MOCK.mode = 'ok'; MOCK.ops = []; SYNC_PAUSED = false; // снятие паузы = новое изменение/online
flushQueue();
assert.eq(syncStatus().pending, 0, '6: очередь разобрана');
assert.eq(MOCK.ops.length, 2, '6: обе операции отправлены');
var s6 = syncStatus();
assert(s6.lastOk > 0, '6: lastOk зафиксирован');
assert.eq(s6.lastError, '', '6: lastError пустой');
assert.eq(s6.mode, 'ok', '6: режим ok');

// --- 7. permission-denied: операция выброшена, lastError непустой, error ---

MOCK.mode = 'denied'; MOCK.ops = []; setQueue(0);
queueOperation({ type: 'save', collection: 'orders', docId: '73', data: { c: 3 } });
assert.eq(syncStatus().pending, 0, '7: denied → операция выброшена из очереди');
assert.eq(MOCK.ops.length, 1, '7: попытка отправки была');
var s7 = syncStatus();
assert(s7.lastError !== '', '7: lastError записан');
assert.eq(s7.mode, 'error', '7: режим error после отказа');

// Успех чистит ошибку (проверено в 6 — повторяем коротко).
MOCK.mode = 'ok'; setQueue(0);
queueOperation({ type: 'save', collection: 'orders', docId: '74', data: { d: 4 } });
assert.eq(syncStatus().lastError, '', '7: успех очистил lastError');
assert.eq(syncStatus().mode, 'ok', '7: снова ok');

// --- 8. Чип renderSyncStatus ---

setQueue(0);
SYNC_PAUSED = false; SYNC_FLUSHING = false; SYNC_LAST_ERROR = '';
var chipOff = renderSyncStatus();
assert(chipOff.indexOf('id="sync-status"') >= 0, '8: обёртка id="sync-status"');
assert(chipOff.indexOf('data-sync-open') >= 0, '8: чип с data-sync-open');
assert(chipOff.indexOf('onclick') === -1, '8: инлайн-обработчиков нет');
assert(chipOff.indexOf('☁️') >= 0 && chipOff.indexOf('В облаке') >= 0, '8: ok → ☁️ «В облаке»');
assert(chipOff.indexOf('в очереди') === -1, '8: pending=0 → счётчика нет');

setQueue(4);
assert(renderSyncStatus().indexOf('· 4 в очереди') >= 0, '8: pending>0 → счётчик «4 в очереди»');

state.cloudStatus = 'pending';
assert(renderSyncStatus().indexOf('⏳ Нет доступа') >= 0, '8: noaccess → ⏳ «Нет доступа»');
state.cloudStatus = 'approved';

SYNC_PAUSED = true;
assert(renderSyncStatus().indexOf('📴 Офлайн') >= 0, '8: offline → 📴');
SYNC_PAUSED = false;

SYNC_LAST_ERROR = 'unavailable';
assert(renderSyncStatus().indexOf('⚠️ Ошибка') >= 0, '8: error → ⚠️');
SYNC_LAST_ERROR = '';

// local → счётчик тоже показывается (данные копятся локально).
delete globalThis.firebase;
setQueue(2);
assert(renderSyncStatus().indexOf('🔌 Локально · 2 в очереди') >= 0,
  '8: local → счётчик виден');
globalThis.firebase = savedFb;
setQueue(0);

// syncStatusMeta: все режимы покрыты
assert.eq(syncStatusMeta('local').label, 'Локально', 'meta: local');
assert.eq(syncStatusMeta('noaccess').label, 'Нет доступа', 'meta: noaccess');
assert.eq(syncStatusMeta('offline').label, 'Офлайн', 'meta: offline');
assert.eq(syncStatusMeta('sending').label, 'Отправка…', 'meta: sending');
assert.eq(syncStatusMeta('error').label, 'Ошибка', 'meta: error');
assert.eq(syncStatusMeta('ok').label, 'В облаке', 'meta: ok');

// --- 9. refreshSyncStatus ---

syncHost = null;
refreshSyncStatus();
assert(true, '9: без элемента #sync-status — тихо выходит');

syncHost = { innerHTML: '' };
setQueue(5);
refreshSyncStatus();
assert(syncHost.innerHTML.indexOf('data-sync-open') >= 0, '9: обновил innerHTML чипа');
assert(syncHost.innerHTML.indexOf('· 5 в очереди') >= 0, '9: счётчик актуален');
assert(syncHost.innerHTML.indexOf('id="sync-status"') === -1,
  '9: без обёртки (только чип внутри)');
setQueue(0);

// --- 10. Модалка деталей ---

setQueue(12);
modalStub.innerHTML = '';
renderSyncDetailsModal();
var md = modalStub.innerHTML;
assert(md.indexOf('Синхронизация') >= 0, '10: заголовок модалки');
assert(md.indexOf('…и ещё 2') >= 0, '10: 12 операций → «ещё 2»');
assert(md.indexOf('В очереди: 12') >= 0, '10: количество операций');
assert(md.indexOf('data-sync-flush') >= 0, '10: approved → кнопка отправки');
assert(md.indexOf('data-close') >= 0, '10: кнопка «Закрыть»');
// Показаны первые 10 (docId 10 есть, 11 — нет).
assert(md.indexOf('orders/10') >= 0, '10: строка 10 показана');
assert(md.indexOf('orders/11') === -1, '10: строка 11 не показана');

setQueue(0);
modalStub.innerHTML = '';
renderSyncDetailsModal();
assert(modalStub.innerHTML.indexOf('Очередь пуста') >= 0, '10: пустая очередь — заглушка');

// local / noaccess → кнопки отправки нет, есть подсказка.
delete globalThis.firebase;
modalStub.innerHTML = '';
renderSyncDetailsModal();
assert(modalStub.innerHTML.indexOf('data-sync-flush') === -1, '10: local → без кнопки отправки');
assert(modalStub.innerHTML.indexOf('Firebase SDK недоступен') >= 0, '10: local → подсказка');
globalThis.firebase = savedFb;

state.cloudStatus = 'pending';
modalStub.innerHTML = '';
renderSyncDetailsModal();
assert(modalStub.innerHTML.indexOf('data-sync-flush') === -1, '10: noaccess → без кнопки отправки');
assert(modalStub.innerHTML.indexOf('не подтверждён владельцем') >= 0, '10: noaccess → подсказка');
state.cloudStatus = 'approved';

// Ошибка и последняя отправка в модалке.
SYNC_LAST_ERROR = 'permission-denied';
modalStub.innerHTML = '';
renderSyncDetailsModal();
assert(modalStub.innerHTML.indexOf('Последняя ошибка: permission-denied') >= 0,
  '10: текст ошибки в модалке');
SYNC_LAST_ERROR = '';
assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(syncFmtTime(0)), '10: syncFmtTime форматирует ts');

// --- 11. Делегаты кликов ---

function clickOn(attr) {
  var target = {
    value: '',
    getAttribute: function (n) { return n === attr ? '' : null; },
    closest: function (selector) {
      return selector === '[' + attr + ']' ? target : null;
    }
  };
  clickHandlers.forEach(function (fn) { fn({ target: target }); });
}

modalStub.innerHTML = '';
clickOn('data-sync-open');
assert(modalStub.innerHTML.indexOf('Синхронизация') >= 0, '11: клик по чипу открыл модалку');

// «Отправить сейчас»: approved + ok-режим → очередь уходит, модалка закрыта.
MOCK.mode = 'ok'; MOCK.ops = []; setQueue(0);
queueOperation({ type: 'save', collection: 'orders', docId: '91', data: { e: 5 } });
// отправка уже произошла в queueOperation — копивим вторую, чтобы было что слать
MOCK.mode = 'offline';
queueOperation({ type: 'save', collection: 'orders', docId: '92', data: { f: 6 } });
assert.eq(syncStatus().pending, 1, '11: операция накоплена в offline');
MOCK.mode = 'ok'; SYNC_PAUSED = false;
syncHost = { innerHTML: '' };
modalStub.innerHTML = '<div>открыто</div>';
var opsBeforeFlush = MOCK.ops.length;
clickOn('data-sync-flush');
assert.eq(MOCK.ops.length - opsBeforeFlush, 1,
  '11: клик отправил накопленное (одна новая отправка)');
assert.eq(MOCK.ops[MOCK.ops.length - 1].id, '92', '11: ушла накопленная операция');
assert.eq(modalStub.innerHTML, '', '11: модалка закрыта');
assert(syncHost.innerHTML.indexOf('data-sync-open') >= 0, '11: чип обновлён после отправки');

// --- 12. Регрессия: без firebase ничего не падает ---

delete globalThis.firebase;
assert.eq(syncStatus().mode, 'local', '12: без firebase → local');
assert(renderSyncStatus().indexOf('🔌') >= 0, '12: чип рендерится без firebase');
syncHost = { innerHTML: '' };
refreshSyncStatus();
assert(syncHost.innerHTML.length > 0, '12: refreshSyncStatus без firebase не падает');
modalStub.innerHTML = '';
renderSyncDetailsModal();
assert(modalStub.innerHTML.indexOf('Синхронизация') >= 0, '12: модалка открывается без firebase');
globalThis.firebase = savedFb;

// --- 13. Хук refreshSyncStatus в sync.js: queueOperation обновляет чип ---

syncHost = { innerHTML: '' };
setQueue(0);
MOCK.mode = 'offline';
queueOperation({ type: 'save', collection: 'orders', docId: '99', data: { g: 7 } });
assert(syncHost.innerHTML.indexOf('· 1 в очереди') >= 0,
  '13: queueOperation → чип обновлён хуком (без полного render)');
MOCK.mode = 'ok'; SYNC_PAUSED = false;
flushQueue();
assert(syncHost.innerHTML.indexOf('в очереди') === -1,
  '13: finishFlush → чип обновлён, счётчик ушёл');

// --- 14. Экспорты/typeof ---

['syncStatus', 'syncStatusMeta', 'renderSyncChip', 'renderSyncStatus',
 'refreshSyncStatus', 'renderSyncDetailsModal', 'syncSendHint',
 'syncFmtTime'].forEach(function (n) {
  assert(typeof globalThis[n] === 'function', 'typeof ' + n);
});
