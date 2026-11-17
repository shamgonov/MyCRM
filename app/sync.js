/* CRM2 :: app/sync.js — синхронизация с Firebase Firestore (Этап 21).
   Двусторонняя синхронизация: локальные изменения → очередь → Firestore;
   удалённые изменения (onSnapshot) → локальный DB.
   Офлайн-очередь: сетевая ошибка возвращает операцию в голову очереди и
   ставит очередь на паузу до нового изменения или события «online».
   Зависит: db.js (DB, save), core.js (toast); firebase-config.js — лениво
   (typeof): без объекта firebase приложение молча работает локально. */
'use strict';

// Флаги защиты от рекурсии: save() → flushQueue() → save() → ...
var SYNC_FLUSHING = false; // идёт отправка — вложенные flushQueue игнорируем
var SYNC_PAUSED = false;   // сетевая ошибка — пауза до новой операции/online
// Статус для UI-индикатора (Этап 25).
var SYNC_LAST_ERROR = '';  // текст последней ошибки ('' = нет)
var SYNC_LAST_OK = 0;      // ts последней успешной отправки

// --- 1. Инициализация ---

// initSync(): нет Firebase SDK — false (локальный режим, без ошибок).
function initSync() {
  if (typeof firebase === 'undefined') return false;
  try {
    // firebase-config.js уже вызывает initializeApp при загрузке страницы;
    // повторяем только если приложение ещё не создано (иначе "already app").
    if (!firebase.apps || !firebase.apps.length) {
      if (typeof firebaseConfig === 'undefined') return false;
      firebase.initializeApp(firebaseConfig);
    }
  } catch (e) {
    console.error('initSync: initializeApp — ' + e.message);
    return false;
  }

  var firestore = null;
  try {
    firestore = firebase.firestore();
    if (firestore.enablePersistence) {
      firestore.enablePersistence({ synchronizeTabs: true });
    }
  } catch (e) {
    // Persistence может быть недоступна (private mode) — работаем без неё.
  }
  if (!firestore) return false;

  // Этап 14-B: подписки НЕ запускаются автоматически — только после
  // подтверждения доступа (syncAccessChanged → startOrdersListener).
  // Без cloudApproved() приложение остаётся локальным, очередь копится.
  if (typeof cloudApproved !== 'function' || cloudApproved()) {
    ORDERS_LISTENERS_ALLOWED = true;
    startOrdersListener();
    startCollectionListeners();
  }

  return true;
}

// --- 1.5 Подписки (Этап 14-B: идемпотентные, с гардом) ---

var ORDERS_LISTENERS_ALLOWED = false; // initSync сработал — слушатели разрешены
var ORDERS_SNAPSHOT_ON = false;

// startOrdersListener(): onSnapshot('orders') → merge в DB.orders.
function startOrdersListener() {
  if (ORDERS_SNAPSHOT_ON) return false;
  if (typeof firebase === 'undefined' || !firebase.firestore) return false;
  if (!ORDERS_LISTENERS_ALLOWED &&
      (typeof cloudApproved !== 'function' || !cloudApproved())) return false;
  ORDERS_SNAPSHOT_ON = true;
  try {
    firebase.firestore().collection('orders').onSnapshot(function (snapshot) {
      if (!snapshot || typeof snapshot.docChanges !== 'function') return;
      snapshot.docChanges().forEach(function (change) {
        if (change.type === 'removed') return; // удаления в Этапе 21 не синхронизируем
        var remote = change.doc.data();
        if (!remote || remote.id === undefined || remote.id === null) return;
        var idx = (DB.orders || []).findIndex(function (o) {
          return Number(o.id) === Number(remote.id);
        });
        // Незакоммиченная операция по этой заявке важнее облачной копии,
        // НО если удалённая версия новее её (remote.ts > op.ts) — облако главнее.
        var pending = null;
        (DB.syncQueue || []).forEach(function (op) {
          if (op.docId === String(remote.id)) pending = op;
        });
        if (pending && Number(remote.ts || 0) <= Number(pending.ts || 0)) return;
        if (idx >= 0) {
          DB.orders[idx] = sanitize(Object.assign({}, DB.orders[idx], remote));
        } else {
          DB.orders.push(sanitize(remote));
        }
        // Коллизия id между браузерами: счётчик обязан обогнать любой id из
        // облака, иначе новый локальный id затрёт чужую заявку в Firestore.
        // Поднимаем ДО save(), чтобы новое значение seq попало в localStorage.
        bumpSeqToMaxOrderId();
        save();
      });
    }, function (err) {
      console.error('initSync: onSnapshot — ' + (err && err.message));
      if (err && err.code === 'permission-denied') toast('Нет прав на синхронизацию', true);
    });
  } catch (e) {
    ORDERS_SNAPSHOT_ON = false;
    console.error('initSync: подписка — ' + e.message);
    return false;
  }
  return true;
}

// Смена статуса доступа (Этап 14-B): подтверждён → слушатели + разблокировка
// очереди; не подтверждён → локальный режим, очередь копится (SYNC_PAUSED).
var SYNC_LISTENERS_ON = false;
function syncAccessChanged() {
  if (typeof cloudApproved !== 'function') return;
  if (cloudApproved()) {
    SYNC_PAUSED = false;
    if (!SYNC_LISTENERS_ON) {
      SYNC_LISTENERS_ON = true;
      ORDERS_LISTENERS_ALLOWED = true;
      startOrdersListener();
      startCollectionListeners();
    }
    flushQueue();
  } else {
    SYNC_PAUSED = true;
  }
  // Этап 25: доступ мог переключить режим индикатора (noaccess ↔ ok).
  if (typeof refreshSyncStatus === 'function') refreshSyncStatus();
  if (typeof render === 'function' && typeof state !== 'undefined' && state.role) render();
}

// --- 2.1 Сводка статуса для UI-индикатора (Этап 25) ---

// syncStatus(): чистая функция (без DOM) — режим, очередь, ошибки.
// mode: 'local'|'noaccess'|'offline'|'sending'|'error'|'ok'
function syncStatus() {
  var pending = (typeof DB !== 'undefined' && DB && Array.isArray(DB.syncQueue)) ? DB.syncQueue.length : 0;
  var online = (typeof navigator === 'undefined' || navigator.onLine !== false);
  var hasCloud = (typeof firebase !== 'undefined' && !!firebase.firestore);
  var approved = (typeof cloudApproved === 'function') ? cloudApproved() : false;
  var mode;
  if (!hasCloud) mode = 'local';
  else if (!approved) mode = 'noaccess';
  else if (!online || SYNC_PAUSED) mode = 'offline';
  else if (SYNC_FLUSHING) mode = 'sending';
  else if (SYNC_LAST_ERROR) mode = 'error';
  else mode = 'ok';
  return { mode: mode, pending: pending, online: online, approved: approved,
           lastError: SYNC_LAST_ERROR, lastOk: SYNC_LAST_OK };
}

// --- 2. Утилиты ---

// sanitize(obj): рекурсивно удаляет ключи со значением undefined (SPEC правило 3).
// Firestore отказывается писать undefined — чистим перед каждой операцией.
function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj instanceof Date) return obj.toISOString ? obj.toISOString() : String(obj);
  var cleaned = {};
  for (var k in obj) {
    if (!obj.hasOwnProperty(k)) continue;
    var v = obj[k];
    if (v === undefined) continue;
    cleaned[k] = sanitize(v);
  }
  return cleaned;
}

// bumpSeqToMaxOrderId(): счётчик id не должен отставать от id, приехавших из
// облака. Иначе два браузера выдадут одинаковый id новой заявке и вторая
// перезапишет первую в Firestore (set с merge по docId = id).
function bumpSeqToMaxOrderId() {
  var maxId = 0;
  (DB.orders || []).forEach(function (o) {
    var n = Number(o && o.id);
    if (isFinite(n) && n > maxId) maxId = n;
  });
  DB.seq = Math.max(DB.seq || 0, maxId);
  return DB.seq;
}

// --- 3. Очередь операций ---

// queueOperation(op): добавляет операцию (ts — метка времени), сохраняет
// локально и запускает отправку. Возвращает true при приёме в очередь.
function queueOperation(op) {
  if (!op || !op.type || !op.collection || !op.docId || !op.data) {
    console.warn('queueOperation: невалидная операция', op);
    return false;
  }
  // Метка времени: момент создания операции (orderSave/orderPatch передают ts;
  // прямые вызовы queueOperation получают её здесь).
  if (!op.ts) op.ts = Date.now();
  // Метка времени в самих данных: удалённый документ несёт ts, и onSnapshot
  // может корректно решить, что главнее — облачная копия или локальная очередь.
  if (op.data && typeof op.data === 'object' && !Array.isArray(op.data)) {
    op.data.ts = op.ts;
  }
  if (!Array.isArray(DB.syncQueue)) DB.syncQueue = [];
  DB.syncQueue.push(op);
  SYNC_PAUSED = false; // новое локальное изменение — пробуем отправлять снова
  save();       // очередь переживает перезагрузку (SPEC: офлайн-очередь)
  flushQueue();
  // Индикатор статуса (Этап 25): очередь изменилась — обновляем чип.
  if (typeof refreshSyncStatus === 'function') refreshSyncStatus();
  return true;
}

// orderSave(o): полная запись заявки (SPEC правило 4 — set + merge:true).
function orderSave(o) {
  if (!o || o.id === undefined || o.id === null) return false;
  return queueOperation({
    type: 'save',
    collection: 'orders',
    docId: String(o.id),
    data: sanitize(o),
    ts: Date.now()
  });
}

// orderPatch(id, fields): частичное обновление (SPEC правило 5).
function orderPatch(id, fields) {
  if (id === undefined || id === null || !fields) return false;
  return queueOperation({
    type: 'patch',
    collection: 'orders',
    docId: String(id),
    data: sanitize(fields),
    ts: Date.now()
  });
}

// --- 4. Отправка очереди ---

// flushQueue(): отправляет операции строго по одной (SPEC правило 6: голова
// очереди снимается ДО отправки). Рекурсия через save() гасится флагом.
function flushQueue() {
  if (typeof firebase === 'undefined') return; // локальный режим — очередь ждёт
  // Этап 14-B: без подтверждённого доступа очередь копится локально.
  if (typeof cloudApproved === 'function' && !cloudApproved()) {
    SYNC_PAUSED = true;
    return;
  }
  if (SYNC_FLUSHING || SYNC_PAUSED) return;
  if (!Array.isArray(DB.syncQueue) || !DB.syncQueue.length) return;
  SYNC_FLUSHING = true;
  pump();
}

// pump(): берёт голову очереди и отправляет; по результату берёт следующую.
function pump() {
  // access мог измениться (fired/pending) во время отправки — встаём на паузу
  // ДО извлечения операции, чтобы ничего не потерять.
  if (typeof cloudApproved === 'function' && !cloudApproved()) {
    SYNC_PAUSED = true;
    if (SYNC_FLUSHING) finishFlush();
    return;
  }
  if (!DB.syncQueue.length) { finishFlush(); return; }
  var op = DB.syncQueue.shift(); // SPEC правило 6: снять ДО отправки
  var p = null;
  try {
    var ref = firebase.firestore().collection(op.collection).doc(op.docId);
    if (op.type === 'save') {
      p = ref.set(op.data, { merge: true }); // SPEC правило 4
    } else if (op.type === 'patch') {
      p = ref.update(op.data);               // SPEC правило 5
    } else if (op.type === 'delete') {
      p = ref.delete();
    } else {
      console.warn('flushQueue: неизвестный тип — ' + op.type);
      p = Promise.resolve(); // пропускаем
    }
  } catch (e) {
    handleFlushError(e, op);
    return;
  }
  if (p && typeof p.then === 'function') {
    p.then(function () {
      // Этап 25: операция ушла в облако — фиксируем успех для индикатора.
      SYNC_LAST_ERROR = ''; SYNC_LAST_OK = Date.now();
      pump();
    }, function (e) { handleFlushError(e, op); });
  } else {
    SYNC_LAST_ERROR = ''; SYNC_LAST_OK = Date.now();
    pump(); // мок без Promise — считаем успехом
  }
}

function handleFlushError(e, op) {
  var code = e && e.code;
  // Этап 25: текст последней ошибки для индикатора (паузу не трогаем —
  // её семантика ниже: unavailable → unshift+пауза, denied → пропуск).
  SYNC_LAST_ERROR = String((e && (e.code || e.message)) || 'Ошибка');
  if (code === 'permission-denied') {
    toast('Нет прав на синхронизацию', true);
    if (typeof refreshSyncStatus === 'function') refreshSyncStatus();
    pump(); // пропускаем операцию, продолжаем очередь
    return;
  }
  // Сетевые ошибки: операция возвращается в голову очереди, отправка на паузу
  // до нового изменения (queueOperation) или события «online».
  DB.syncQueue.unshift(op);
  SYNC_PAUSED = true;
  finishFlush();
}

function finishFlush() {
  SYNC_FLUSHING = false;
  save(); // фиксируем состояние очереди; вложенный flushQueue пустой — no-op
  // Этап 25: очередь/флаги изменились — обновляем чип без полного render().
  if (typeof refreshSyncStatus === 'function') refreshSyncStatus();
}

// --- 4.5 Общая база справочников (Этап 24) ---
// collections: clients/suppliers/tasks/templates/priceList/users + settings/org.
// Личные ключи settings (schedule, notifyEnabled, digestShownToday) НЕ синхронизируем.

var SYNC_COLLECTIONS = ['clients', 'suppliers', 'tasks', 'templates', 'priceList', 'users'];
var SETTINGS_SHARED = ['executorMode', 'executorPhys', 'executorSelfEmployed', 'executorLegal',
  'rewardPctDefault', 'tagPresets', 'warehouseAddress', 'remindBeforeH', 'docCounter'];
var SYNC_LOADED = {};

// Личные ключи (schedule, notifyEnabled, digestShownToday) НЕ синхронизируем.
function settingsSharedSlice() {
  var out = {};
  var s = (typeof DB !== 'undefined' && DB && DB.settings) ? DB.settings : {};
  SETTINGS_SHARED.forEach(function (k) { if (s[k] !== undefined) out[k] = s[k]; });
  return out;
}

function collectionSave(name, obj) {
  if (!obj || obj.id === undefined || obj.id === null) return false;
  queueOperation({ type: 'save', collection: name, docId: String(obj.id), data: sanitize(obj), ts: Date.now() });
  return true;
}

function collectionDelete(name, id) {
  if (id === undefined || id === null) return false;
  queueOperation({ type: 'delete', collection: name, docId: String(id), data: {}, ts: Date.now() });
  return true;
}

function settingsSave() {
  queueOperation({ type: 'save', collection: 'settings', docId: 'org', data: sanitize(settingsSharedSlice()), ts: Date.now() });
  return true;
}

function pendingOpFor(collection, docId) {
  var q = (DB && DB.syncQueue) ? DB.syncQueue : [];
  for (var i = 0; i < q.length; i++) {
    if (q[i].collection === collection && q[i].docId === docId) return q[i];
  }
  return null;
}

// Первое пустое облако + локальные данные → залить локальное (сид/миграция).
function seedCollectionUpload(name) {
  var list = (DB && DB[name]) ? DB[name] : [];
  list.forEach(function (item) {
    if (item && item.id !== undefined && item.id !== null) {
      queueOperation({ type: 'save', collection: name, docId: String(item.id), data: sanitize(item), ts: Date.now() });
    }
  });
}

function applyRemoteCollection(name, docs) {
  if (!DB) return;
  if (!Array.isArray(DB[name])) DB[name] = [];
  if (!SYNC_LOADED[name]) {
    SYNC_LOADED[name] = true;
    if (!docs.length && DB[name].length) { seedCollectionUpload(name); return; }
  }
  var pending = {};
  (DB.syncQueue || []).forEach(function (op) {
    if (op.collection === name) pending[op.docId] = op;
  });
  var byId = {};
  docs.forEach(function (d) {
    var op = pending[String(d.id)];
    if (op && Number(d.ts || 0) <= Number(op.ts || 0)) return; // локальная правка свежее
    byId[String(d.id)] = d;
  });
  // Несентые локальные правки живут поверх удалённого снимка.
  DB[name].forEach(function (local) {
    var key = String(local.id);
    var op = pending[key];
    if (op && op.type !== 'delete') byId[key] = local;
    if (op && op.type === 'delete') delete byId[key];
  });
  DB[name] = Object.keys(byId).map(function (k) { return byId[k]; });
  save();
}

function applyRemoteSettings(data) {
  if (!DB || !data) return;
  var op = pendingOpFor('settings', 'org');
  if (op && Number(data.ts || 0) <= Number(op.ts || 0)) return;
  if (!DB.settings) DB.settings = {};
  SETTINGS_SHARED.forEach(function (k) {
    if (data[k] !== undefined) DB.settings[k] = data[k];
  });
  save();
}

function startCollectionListeners() {
  if (typeof firebase === 'undefined' || !firebase.firestore) return false;
  var fs = firebase.firestore();
  SYNC_COLLECTIONS.forEach(function (name) {
    // Этап 14-B: мастер по правилам не читает чужие users/*; свой документ он
    // и так слушает через watchMyAccess(). Подписка упала бы permission-denied.
    if (name === 'users' && typeof state !== 'undefined' &&
        state.cloudRole === 'worker') return;
    fs.collection(name).onSnapshot(function (snap) {
      var docs = [];
      snap.forEach(function (doc) { docs.push(doc.data()); });
      applyRemoteCollection(name, docs);
    }, function (err) { console.warn('sync ' + name + ':', err.code || err.message); });
  });
  fs.collection('settings').doc('org').onSnapshot(function (doc) {
    if (doc.exists) applyRemoteSettings(doc.data());
    else if (!SYNC_LOADED.settings) { SYNC_LOADED.settings = true; settingsSave(); }
  }, function (err) { console.warn('sync settings:', err.code || err.message); });
  return true;
}

// --- 5. Старт ---

// Возобновление отправки при возвращении сети.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', function () {
    SYNC_PAUSED = false;
    flushQueue();
    // Этап 25: сеть вернулась — чип должен перекраситься сразу.
    if (typeof refreshSyncStatus === 'function') refreshSyncStatus();
  });
}

// Экспорт до автозапуска: db.js уже мог вызвать window.flushQueue из save().
window.initSync = initSync;
window.sanitize = sanitize;
window.bumpSeqToMaxOrderId = bumpSeqToMaxOrderId;
window.queueOperation = queueOperation;
window.orderSave = orderSave;
window.orderPatch = orderPatch;
window.flushQueue = flushQueue;
window.collectionSave = collectionSave;
window.collectionDelete = collectionDelete;
window.settingsSave = settingsSave;
window.settingsSharedSlice = settingsSharedSlice;
window.applyRemoteCollection = applyRemoteCollection;
window.applyRemoteSettings = applyRemoteSettings;
window.startCollectionListeners = startCollectionListeners;
window.startOrdersListener = startOrdersListener;
window.syncAccessChanged = syncAccessChanged;
window.syncStatus = syncStatus;

// Автозапуск: в браузере с SDK включаем realtime-подписку; без SDK — false,
// приложение продолжает работать локально (это штатный офлайн-режим).
initSync();
