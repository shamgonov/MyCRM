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

  // Удалённые изменения коллекции orders → локальный DB (merge-подобно).
  try {
    firestore.collection('orders').onSnapshot(function (snapshot) {
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
    console.error('initSync: подписка — ' + e.message);
    return false;
  }

  return true;
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
  if (SYNC_FLUSHING || SYNC_PAUSED) return;
  if (!Array.isArray(DB.syncQueue) || !DB.syncQueue.length) return;
  SYNC_FLUSHING = true;
  pump();
}

// pump(): берёт голову очереди и отправляет; по результату берёт следующую.
function pump() {
  if (!DB.syncQueue.length) { finishFlush(); return; }
  var op = DB.syncQueue.shift(); // SPEC правило 6: снять ДО отправки
  var p = null;
  try {
    var ref = firebase.firestore().collection(op.collection).doc(op.docId);
    if (op.type === 'save') {
      p = ref.set(op.data, { merge: true }); // SPEC правило 4
    } else if (op.type === 'patch') {
      p = ref.update(op.data);               // SPEC правило 5
    } else {
      console.warn('flushQueue: неизвестный тип — ' + op.type);
      p = Promise.resolve(); // пропускаем
    }
  } catch (e) {
    handleFlushError(e, op);
    return;
  }
  if (p && typeof p.then === 'function') {
    p.then(function () { pump(); }, function (e) { handleFlushError(e, op); });
  } else {
    pump(); // мок без Promise — считаем успехом
  }
}

function handleFlushError(e, op) {
  var code = e && e.code;
  if (code === 'permission-denied') {
    toast('Нет прав на синхронизацию', true);
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
}

// --- 5. Старт ---

// Возобновление отправки при возвращении сети.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', function () {
    SYNC_PAUSED = false;
    flushQueue();
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

// Автозапуск: в браузере с SDK включаем realtime-подписку; без SDK — false,
// приложение продолжает работать локально (это штатный офлайн-режим).
initSync();
