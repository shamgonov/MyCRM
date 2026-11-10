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
  if (!Array.isArray(o.payments)) o.payments = [];
  return o;
}

// calculateOrderTotal(o): ЕДИНАЯ база суммы заявки для сметы, документов и отчётов
// (решение Q3): работы (не skipped, с коэффициентом) + доп.работы (agreed);
// материалы включаются в сумму клиента только при matsInTotal.
function calculateOrderTotal(o) {
  if (!o) return 0;
  let total = 0;
  (o.works || []).forEach(function (w) {
    if (w.skipped) return;
    total += (Number(w.qty) || 0) * (Number(w.price) || 0) * (Number(w.coeff) || 1);
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
  o.payments = Array.isArray(o.payments) ? o.payments : [];
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

// --- Деньги заявки (Этап 12) ---
// Выручка = единая база calculateOrderTotal (Q3); оплачено = сумма o.payments.

function orderRevenue(o) {
  return calculateOrderTotal(o);
}

function orderPaid(o) {
  if (!o || !Array.isArray(o.payments)) return 0;
  return o.payments.reduce(function (s, p) { return s + (Number(p.sum) || 0); }, 0);
}

function orderBalance(o) {
  return orderRevenue(o) - orderPaid(o);
}

// addPayment(o, data): платёж с валидацией суммы; запись в историю.
function addPayment(o, data) {
  if (!o || !data) return null;
  const sum = Number(data.sum);
  if (!isFinite(sum) || sum <= 0) return null;
  normalizeOrder(o);
  const pay = {
    id: (o.payments.length ? Math.max.apply(null, o.payments.map(function (p) {
      return Number(p.id) || 0;
    })) : 0) + 1,
    sum: sum,
    date: data.date || localToday(),
    method: data.method || 'cash',
    by: state.user,
    note: data.note || ''
  };
  o.payments.push(pay);
  o.history.push({
    ts: Date.now(), by: state.user, action: 'payment',
    details: 'Платёж ' + sum + ' ₽ (' + pay.method + ')' + (pay.note ? ' — ' + pay.note : '')
  });
  saveOrderLocal(o);
  return pay;
}

function removePayment(o, paymentId) {
  if (!o || !Array.isArray(o.payments)) return false;
  const idx = o.payments.findIndex(function (p) { return p.id === paymentId; });
  if (idx < 0) return false;
  const removed = o.payments.splice(idx, 1)[0];
  normalizeOrder(o);
  o.history.push({
    ts: Date.now(), by: state.user, action: 'payment',
    details: 'Платёж удалён: ' + (Number(removed.sum) || 0) + ' ₽'
  });
  saveOrderLocal(o);
  return true;
}

// --- Доля исполнителя (Этап 13, решение Q2: reward — расход компании) ---

// Процент заявки: локальный override o.rewardPct, иначе общий DB.settings.rewardPctDefault.
// 0 означает «выключено» явно, поэтому переопределение проверяем на заданность, а не на truthy.
function orderRewardPct(o) {
  const local = o ? o.rewardPct : null;
  if (local !== null && local !== undefined && local !== '' && isFinite(Number(local))) {
    return Number(local);
  }
  const global = (DB && DB.settings) ? Number(DB.settings.rewardPctDefault) : 0;
  return isFinite(global) ? global : 0;
}

// Доля исполнителя в рублях от выручки заявки.
function orderReward(o) {
  const pct = orderRewardPct(o);
  if (!pct) return 0;
  return Math.round(orderRevenue(o) * pct / 100);
}
