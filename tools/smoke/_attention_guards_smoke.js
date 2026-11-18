/* Смоук Этапа 41: гарды ui-attention.js.
   1) Baseline: renderAttention() байт-в-байт прежний.
   2) Нет saveOrderLocal → applyCallResult отказ, DB не изменён, toast.
   3) Нет transitionOrder → отказ, DB не изменён (callbackAt тоже).
   4) Нет orderDisplayNumber / STATUS_LABELS / statusBadgeClass → фолбэки.
   5) Исключение внутри блока → try/catch + console.error ровно 1 раз.
   6) Делегат data-save-callback без saveOrderLocal → toast, DB не изменён. */
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
var FIELDS = {};
var clickHandlers = [];

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn) {
    if (type === 'click') clickHandlers.push(fn);
  },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 0; };
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-attention.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

var today = localToday();

// Заявки для групп «внимания»: перезвон, просрочка, без исполнителя, материалы.
// normalizeOrder сразу приводим — иначе снимок JSON «до» отличается служебными
// полями, которые добавляет сам normalizeOrder.
function seedOrders() {
  DB.orders = [
    {
      id: 900, client: 'Перезвон', status: 'new', worker: '', date: today,
      t1: '09:00', t2: '10:00', phone: '', address: '',
      helpers: [], confirm: {}, materials: [], works: [], extras: [],
      history: [], payments: [], tags: [], callbackAt: Date.now() - 3600000
    },
    {
      id: 901, client: 'Просрочка', status: 'inwork', worker: 'Мастер',
      date: '2020-01-01', t1: '09:00', t2: '10:00', phone: '', address: '',
      helpers: [], confirm: {}, materials: [{ name: 'Гвозди', status: 'needed' }],
      works: [], extras: [], history: [], payments: [], tags: [], callbackAt: null
    }
  ];
  DB.orders.forEach(function (o) { normalizeOrder(o); });
}

// --- 1. Baseline renderAttention() ---

seedOrders();
var baseline = renderAttention();
assert(baseline.length > 0, '1: renderAttention вернул разметку');
assert(baseline.indexOf('<h2>⚠️ Требует внимания</h2>') === 0, '1: заголовок экрана первым');
assert(baseline.indexOf('📞 Нужен перезвон') >= 0, '1: блок перезвона есть');
assert(baseline.indexOf('⚠️ Просрочено') >= 0, '1: блок просрочки есть');
assert(baseline.indexOf('🧱 Материалы к закупке') >= 0, '1: блок материалов есть');
assert(baseline.indexOf('data-attention-order="900"') >= 0, '1: строка заявки 900 кликабельна');
assert(baseline.indexOf('№900') >= 0, '1: номер заявки через orderDisplayNumber');
assert(baseline.indexOf('>Новая<') >= 0, '1: статус через STATUS_LABELS');
assert(baseline.indexOf('badge') >= 0, '1: класс бейджа через statusBadgeClass');
assert(baseline.indexOf('onclick') < 0, '1: инлайн-обработчиков нет');

// Повторный вызов — тот же результат (функция чистая относительно DB).
assert.eq(renderAttention(), baseline, '1: renderAttention детерминирован');

// --- 2. Нет saveOrderLocal → отказ, DB не изменён ---

var toasts = [];
globalThis.toast = function (msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); };

seedOrders();
var o900 = DB.orders[0];
var before = JSON.stringify(o900);

var savedSave = globalThis.saveOrderLocal;
globalThis.saveOrderLocal = undefined;
toasts = [];
var res2 = applyCallResult(o900, 'later_2h');
assert.eq(res2.ok, false, '2: без saveOrderLocal → ok = false');
assert.eq(res2.text, '', '2: без saveOrderLocal → text пустой (toast уже показан)');
assert(toasts.length === 1 && toasts[0].msg.indexOf('Модуль данных недоступен') >= 0,
  '2: toast «Модуль данных недоступен»');
assert(toasts[0].err === true, '2: toast помечен как ошибка');
assert.eq(JSON.stringify(o900), before, '2: заявка в DB не изменена');
assert.eq(o900.history.length, 0, '2: история не пополнилась');
globalThis.saveOrderLocal = savedSave;

// Тот же гард для ветки «завтра» — мутации не происходит.
seedOrders();
o900 = DB.orders[0];
before = JSON.stringify(o900);
globalThis.saveOrderLocal = undefined;
toasts = [];
var res2b = applyCallResult(o900, 'later_tomorrow');
assert.eq(res2b.ok, false, '2: later_tomorrow без saveOrderLocal → отказ');
assert.eq(JSON.stringify(o900), before, '2: later_tomorrow не изменил заявку');
globalThis.saveOrderLocal = savedSave;

// --- 3. Нет transitionOrder → отказ, DB не изменён ---

seedOrders();
o900 = DB.orders[0];
before = JSON.stringify(o900);

var savedTransition = globalThis.transitionOrder;
globalThis.transitionOrder = undefined;
toasts = [];
var res3 = applyCallResult(o900, 'inspection');
assert.eq(res3.ok, false, '3: без transitionOrder → ok = false');
assert.eq(res3.text, '', '3: без transitionOrder → text пустой');
assert(toasts.length === 1 && toasts[0].msg.indexOf('Модуль данных недоступен') >= 0,
  '3: toast «Модуль данных недоступен»');
assert.eq(JSON.stringify(o900), before, '3: заявка не изменена (callbackAt тоже)');
assert.eq(o900.history.length, 0, '3: история не пополнилась');
assert.eq(o900.status, 'new', '3: статус не изменён');

// Ветка «отказ» — тот же отказ, причина не пишется.
seedOrders();
o900 = DB.orders[0];
before = JSON.stringify(o900);
globalThis.transitionOrder = undefined;
toasts = [];
var res3b = applyCallResult(o900, 'canceled');
assert.eq(res3b.ok, false, '3: canceled без transitionOrder → отказ');
assert.eq(JSON.stringify(o900), before, '3: canceled не изменил заявку');
globalThis.transitionOrder = savedTransition;

// --- 4. Фолбэки renderAttentionBlock ---

seedOrders();
var savedNum = globalThis.orderDisplayNumber;
var savedBadge = globalThis.statusBadgeClass;

globalThis.orderDisplayNumber = undefined;
globalThis.statusBadgeClass = undefined;

var html4 = renderAttention();
assert(html4.indexOf('№900') >= 0, '4: без orderDisplayNumber номер = id');
assert(html4.indexOf('class="badge"') >= 0, '4: без statusBadgeClass класс = badge');
assert(html4.indexOf('<h2>⚠️ Требует внимания</h2>') === 0, '4: экран всё равно отрисован');

globalThis.orderDisplayNumber = savedNum;
globalThis.statusBadgeClass = savedBadge;

// Фолбэк не ломает и модалки итога звонка.
seedOrders();
globalThis.orderDisplayNumber = undefined;
renderCallResultModal(DB.orders[0]);
assert(modalStub.innerHTML.indexOf('Итог звонка: №900') >= 0,
  '4: модалка итога звонка без orderDisplayNumber');
renderCustomCallbackModal(DB.orders[0]);
assert(modalStub.innerHTML.indexOf('Перезвонить: №900') >= 0,
  '4: модалка перезвона без orderDisplayNumber');
globalThis.orderDisplayNumber = savedNum;

// --- 5. Исключение внутри блока → try/catch + console.error ровно 1 раз ---

seedOrders();
var errCalls = [];
var savedError = console.error;
console.error = function () { errCalls.push(Array.prototype.slice.call(arguments)); };

var savedGroups = globalThis.attentionGroups;
globalThis.attentionGroups = function () { throw new Error('boom'); };
errCalls = [];
var html5 = renderAttention();
assert.eq(errCalls.length, 1, '5: console.error вызван ровно 1 раз');
assert.eq(errCalls[0][0], 'ATTENTION render failed:', '5: префикс сообщения об ошибке');
assert(errCalls[0][1] instanceof Error, '5: вторым аргументом сам объект ошибки');
assert(html5.indexOf('<h2>⚠️ Требует внимания</h2>') === 0, '5: заголовок на месте');
assert(html5.indexOf('Не удалось отобразить экран') >= 0, '5: сообщение об ошибке в разметке');
assert(html5.indexOf('boom') >= 0, '5: текст ошибки показан');

// Ошибка не «протекла»: следующий вызов с рабочими данными снова нормален.
globalThis.attentionGroups = savedGroups;
errCalls = [];
var html5b = renderAttention();
assert.eq(errCalls.length, 0, '5: после восстановления console.error не вызывается');
assert.eq(html5b, baseline, '5: восстановленный рендер = baseline');
console.error = savedError;

// Ошибка, брошенная строкой (не Error), тоже перехватывается.
seedOrders();
console.error = function () {};
globalThis.attentionGroups = function () { throw 'строка'; };
var html5c = renderAttention();
assert(html5c.indexOf('строка') >= 0, '5: не-Error исключение тоже перехвачено');
globalThis.attentionGroups = savedGroups;
console.error = savedError;

// --- 6. Делегат data-save-callback без saveOrderLocal ---

seedOrders();
var co = DB.orders[0];
co.callbackAt = null;
var beforeCb = JSON.stringify(co);

FIELDS['cc-date'] = { value: '2030-05-05' };
FIELDS['cc-time'] = { value: '12:30' };
globalThis.saveOrderLocal = undefined;
toasts = [];
modalStub.innerHTML = 'заглушка';

function fireClick(attrs) {
  var node = {
    getAttribute: function (a) {
      return Object.prototype.hasOwnProperty.call(attrs, a) ? String(attrs[a]) : null;
    },
    closest: function (sel) {
      var m = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
      if (!m) return null;
      if (!Object.prototype.hasOwnProperty.call(attrs, m[1])) return null;
      if (m[2] !== undefined && String(attrs[m[1]]) !== m[2]) return null;
      return node;
    }
  };
  var ev = { target: node };
  clickHandlers.forEach(function (fn) { fn(ev); });
}

fireClick({ 'data-save-callback': 900 });
assert(toasts.length === 1 && toasts[0].msg.indexOf('Модуль данных недоступен') >= 0,
  '6: без saveOrderLocal → toast, не падение');
assert.eq(JSON.stringify(co), beforeCb, '6: callbackAt не выставлен, DB не изменена');
globalThis.saveOrderLocal = savedSave;

// С рабочим saveOrderLocal делегат снова сохраняет.
seedOrders();
co = DB.orders[0];
FIELDS['cc-date'] = { value: '2030-05-05' };
FIELDS['cc-time'] = { value: '12:30' };
toasts = [];
fireClick({ 'data-save-callback': 900 });
assert(co.callbackAt > 0, '6: с saveOrderLocal callbackAt выставлен');
assert(toasts.some(function (t) { return t.msg.indexOf('Перезвон: 2030-05-05 12:30') >= 0; }),
  '6: toast о назначенном перезвоне');

// --- 7. Регрессия: остальные ветки работают как раньше ---

seedOrders();
var res7 = applyCallResult(DB.orders[0], 'later_1h');
assert.eq(res7.ok, true, '7: later_1h без гардов → ok');
assert.eq(res7.text, 'Перезвон через 1 ч.', '7: текст ветки later_1h');
assert(DB.orders[0].callbackAt > Date.now(), '7: callbackAt в будущем');

seedOrders();
var res7b = applyCallResult(DB.orders[0], 'unknown_branch');
assert.eq(res7b.ok, false, '7: неизвестная ветка → отказ');
assert.eq(res7b.text, 'Неизвестная ветка', '7: текст про неизвестную ветку');

assert.eq(applyCallResult(null, 'later_1h').text, 'Нет заявки', '7: null → «Нет заявки»');
