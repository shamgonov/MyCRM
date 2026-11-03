/* CRM2 :: app/orders.js — доменная логика заявок: статусы, переходы, расчёты.
   Работает с локальным DB.orders (sync.js подключим на Этапе 2+).
   Зависит от db.js (DB) и auth.js (state). */
'use strict';

const ORDER_STATUSES = [
  'new', 'inspection', 'estimate', 'approved', 'inwork', 'paused',
  'waiting', 'postponed', 'completed', 'paid', 'canceled'
];

// Матрица переходов (SPEC: статусы и переходы, включая ветку C без осмотра).
const STATUS_TRANSITIONS = {
  new: ['inspection', 'approved', 'canceled'],        // approved = ветка C (цена и аванс по телефону)
  inspection: ['estimate', 'canceled'],               // осмотрщик составил смету
  estimate: ['approved', 'postponed', 'canceled'],    // клиент согласовал | отложил | отмена
  approved: ['inwork', 'canceled'],                   // назначен worker, тот принял
  inwork: ['paused', 'completed', 'canceled'],
  paused: ['inwork', 'canceled'],                     // возобновить
  waiting: ['inwork', 'canceled'],
  postponed: ['estimate', 'approved', 'canceled'],    // возврат после отложения
  completed: ['paid', 'canceled'],
  paid: [],
  canceled: []
};

// normalizeOrder(o): гарантия наличия обязательных коллекций (правило SPEC 3 — без undefined).
function normalizeOrder(o) {
  if (!o) return o;
  if (!Array.isArray(o.works)) o.works = [];
  if (!Array.isArray(o.extras)) o.extras = [];
  if (!Array.isArray(o.materials)) o.materials = [];
  if (!Array.isArray(o.history)) o.history = [];
  return o;
}

// calculateOrderTotal(o): работы (не skipped) + доп.работы (agreed);
// материалы включаются в сумму клиента только при matsInTotal.
function calculateOrderTotal(o) {
  if (!o) return 0;
  let total = 0;
  (o.works || []).forEach(function (w) {
    if (w.skipped) return;
    total += (Number(w.qty) || 0) * (Number(w.price) || 0);
  });
  (o.extras || []).forEach(function (x) {
    if (x.status !== 'agreed') return;
    total += (Number(x.qty) || 0) * (Number(x.price) || 0);
  });
  if (o.matsInTotal) {
    (o.materials || []).forEach(function (m) {
      total += (Number(m.qty) || 0) * (Number(m.price) || 0);
    });
  }
  return total;
}

// saveOrderLocal(o): вставка/замена в DB.orders + сохранение (глобальный save() из db.js).
// Новая заявка получает id из счётчика DB.seq.
function saveOrderLocal(o) {
  if (!o) return null;
  const idx = (DB.orders || []).findIndex(function (x) { return x.id === o.id; });
  if (idx >= 0) {
    DB.orders[idx] = o;
  } else {
    if (o.id === undefined || o.id === null) {
      DB.seq = (DB.seq || 0) + 1;
      o.id = DB.seq;
    }
    DB.orders.push(o);
  }
  save();
  return o;
}

// createOrder(data): дефолты + история создания + сохранение.
function createOrder(data) {
  const o = Object.assign({}, data || {});
  o.status = o.status || 'new';
  o.works = Array.isArray(o.works) ? o.works : [];
  o.extras = Array.isArray(o.extras) ? o.extras : [];
  o.materials = Array.isArray(o.materials) ? o.materials : [];
  o.history = Array.isArray(o.history) ? o.history : [];
  o.helpers = Array.isArray(o.helpers) ? o.helpers : [];
  o.createdAt = Date.now();
  o.createdBy = state.user;
  o.history.push({ ts: Date.now(), by: state.user, action: 'create', details: 'Заявка создана' });
  return saveOrderLocal(o);
}

// transitionOrder(id, newStatus, reason): переход по матрице STATUS_TRANSITIONS
// с записью в историю. Возвращает true при успехе.
function transitionOrder(id, newStatus, reason) {
  const o = (DB.orders || []).find(function (x) { return x.id === id; });
  if (!o) return false;
  if (ORDER_STATUSES.indexOf(newStatus) < 0) return false;
  const allowed = STATUS_TRANSITIONS[o.status] || [];
  if (allowed.indexOf(newStatus) < 0) return false;
  const old = o.status;
  o.status = newStatus;
  normalizeOrder(o);
  o.history.push({
    ts: Date.now(),
    by: state.user,
    action: 'status',
    from: old,
    to: newStatus,
    reason: reason || ''
  });
  saveOrderLocal(o);
  return true;
}
