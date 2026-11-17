/* Смоук Этапа 28: статус «📅 Перенос», transferOrder (дата/время/причина +
   история), вкладка «Журнал» как хронология с иконками, модалка переноса и
   её делегаты. Матрица переходов: вход в transfer из рабочих статусов,
   возврат обратно. */
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
// Поля модалки переноса: id → элемент { value }.
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
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

function clickOn(attr, value) {
  var target = {
    value: value === undefined || value === null ? '' : String(value),
    getAttribute: function (n) { return n === attr ? String(value) : null; },
    closest: function (selector) {
      return selector === '[' + attr + ']' ? target : null;
    }
  };
  clickHandlers.forEach(function (fn) { fn({ target: target }); });
}

function freshOrder(id, status) {
  return {
    id: id, client: 'Клиент ' + id, phone: '', city: 'Екатеринбург',
    address: 'Ленина 1', date: localToday(), t1: '09:00', t2: '12:00',
    status: status || 'new', worker: 'Борис', helpers: [], confirm: {}, tags: [],
    works: [], extras: [], materials: [], payments: [], history: [],
    createdAt: Date.now()
  };
}

// --- 1. Матрица переходов: transfer во всех рабочих статусах ---

['new', 'inspection', 'estimate', 'approved', 'inwork'].forEach(function (st) {
  assert((STATUS_TRANSITIONS[st] || []).indexOf('transfer') >= 0,
    '1. из «' + st + '» можно в transfer');
});
assert.eq(STATUS_TRANSITIONS.transfer.length, 6, '1. transfer: 6 выходов');
['new', 'inspection', 'estimate', 'approved', 'inwork', 'canceled'].forEach(function (st) {
  assert(STATUS_TRANSITIONS.transfer.indexOf(st) >= 0, '1. transfer → ' + st);
});
// Закрытые статусы в transfer не входят.
assert((STATUS_TRANSITIONS.completed || []).indexOf('transfer') < 0,
  '1. из completed в transfer нельзя');
assert((STATUS_TRANSITIONS.paid || []).indexOf('transfer') < 0, '1. из paid нельзя');
assert((STATUS_TRANSITIONS.canceled || []).indexOf('transfer') < 0, '1. из canceled нельзя');
assert(ORDER_STATUSES.indexOf('transfer') >= 0, '1. transfer в ORDER_STATUSES');

// --- 2. transitionOrder в transfer и обратно ---

DB.orders = [freshOrder(100, 'new')];
assert.eq(transitionOrder(100, 'transfer'), true, '2. new → transfer через матрицу');
assert.eq(DB.orders[0].status, 'transfer', '2. статус стал transfer');
assert(DB.orders[0].history.some(function (h) {
  return h.action === 'status' && h.to === 'transfer';
}), '2. переход записан в историю');

assert.eq(transitionOrder(100, 'inwork'), true, '2. transfer → inwork (возврат в работу)');
assert.eq(DB.orders[0].status, 'inwork', '2. статус вернулся в inwork');

DB.orders = [freshOrder(101, 'completed')];
assert.eq(transitionOrder(101, 'transfer'), false, '2. completed → transfer запрещено');
assert.eq(DB.orders[0].status, 'completed', '2. статус не изменён');

// --- 3. STATUS_LABELS ---

assert(STATUS_LABELS.transfer.indexOf('Перенос') >= 0, '3. метка «Перенос»');
assert(STATUS_LABELS.transfer.indexOf('📅') >= 0, '3. метка со значком календаря');

// --- 4. transferOrder: дата/время/статус/история/сохранение ---

DB.orders = [freshOrder(110, 'new')];
DB.orders[0].date = '2026-11-20';
DB.orders[0].t1 = '09:00';
DB.orders[0].t2 = '12:00';
var o110 = DB.orders[0];

assert.eq(transferOrder(o110, {
  date: '2026-12-05', t1: '14:00', t2: '16:00', reason: 'клиент в отъезде'
}), true, '4. transferOrder → true');
assert.eq(o110.status, 'transfer', '4. статус transfer');
assert.eq(o110.date, '2026-12-05', '4. дата обновлена');
assert.eq(o110.t1, '14:00', '4. t1 обновлён');
assert.eq(o110.t2, '16:00', '4. t2 обновлён');

var tr = o110.history.filter(function (h) { return h.action === 'transfer'; })[0];
assert(!!tr, '4. запись action=transfer в истории');
assert(tr.details.indexOf('2026-11-20') >= 0, '4. details содержит СТАРУЮ дату');
assert(tr.details.indexOf('2026-12-05') >= 0, '4. details содержит НОВУЮ дату');
assert(tr.details.indexOf('клиент в отъезде') >= 0, '4. причина в details');
assert.eq(tr.by, 'Владелец', '4. автор записи');

// Сохранение: transferOrder обязан записать в localStorage (saveOrderLocal).
var persisted = JSON.parse(localStorage.getItem('crm2_db') || '{}');
var pOrder = (persisted.orders || []).filter(function (x) { return Number(x.id) === 110; })[0];
assert(pOrder && pOrder.date === '2026-12-05', '4. перенос пережил save()');
assert(pOrder.status === 'transfer', '4. статус сохранён локально');

// Без причины — details корректен без «Причина:».
DB.orders = [freshOrder(111, 'approved')];
transferOrder(DB.orders[0], { date: '2026-12-10' });
var tr2 = DB.orders[0].history.filter(function (h) { return h.action === 'transfer'; })[0];
assert(tr2.details.indexOf('Причина') < 0, '4. без причины — приписки нет');
assert.eq(DB.orders[0].t1, '', '4. пустые t1/t2 нормализуются в ""');

// Перенос из transfer повторно — тоже разрешён (дату двигают несколько раз).
DB.orders = [freshOrder(112, 'transfer')];
assert.eq(transferOrder(DB.orders[0], { date: '2026-12-20' }), true,
  '4. повторный перенос из transfer → true');
assert.eq(DB.orders[0].history.filter(function (h) {
  return h.action === 'transfer';
}).length, 1, '4. вторая запись переноса добавлена');

// --- 5. transferOrder: отказы ---

assert.eq(transferOrder(null, { date: '2026-12-01' }), false, '5. null → false');
DB.orders = [freshOrder(120, 'new')];
assert.eq(transferOrder(DB.orders[0], {}), false, '5. без date → false');
assert.eq(transferOrder(DB.orders[0], { date: '' }), false, '5. пустая date → false');
assert.eq(DB.orders[0].status, 'new', '5. отказ не изменил статус');

['completed', 'paid', 'canceled'].forEach(function (st) {
  DB.orders = [freshOrder(130, st)];
  assert.eq(transferOrder(DB.orders[0], { date: '2026-12-01' }), false,
    '5. ' + st + ' → false');
  assert.eq(DB.orders[0].status, st, '5. ' + st + ' не тронут');
});

// Нет права на редактирование (worker, заявка не его) → false.
login('worker', 'Фёдор');
DB.orders = [freshOrder(140, 'new')];
assert.eq(transferOrder(DB.orders[0], { date: '2026-12-01' }), false,
  '5. чужая заявка без права → false');
assert.eq(DB.orders[0].status, 'new', '5. статус не изменён');
// Своя незакрытая заявка — можно.
DB.orders = [freshOrder(141, 'new')];
DB.orders[0].worker = 'Фёдор';
assert.eq(transferOrder(DB.orders[0], { date: '2026-12-01' }), true,
  '5. своя заявка → true');
login('admin', 'Владелец');

// Перенос забирает заявку из пула (worker=null + status=transfer → не пул).
DB.orders = [freshOrder(150, 'new')];
DB.orders[0].worker = null;
assert(isPoolOrder(DB.orders[0]) === true, '5. до переноса — в пуле');
transferOrder(DB.orders[0], { date: '2026-12-15' });
assert(isPoolOrder(DB.orders[0]) === false, '5. после переноса вне пула (не рабочий статус)');

// --- 6. Журнал = хронология с иконками ---

DB.orders = [{
  id: 160, client: 'Хронология', status: 'transfer', date: '2026-12-05',
  worker: 'Борис', helpers: [], confirm: {}, tags: [],
  works: [], extras: [], materials: [], payments: [],
  history: [
    { ts: 1000, by: 'Владелец', action: 'create', details: 'Заявка создана' },
    { ts: 2000, by: 'Владелец', action: 'status', from: 'new', to: 'approved' },
    { ts: 3000, by: 'Владелец', action: 'call_result', details: '✅ Согласована смета' },
    { ts: 4000, by: 'Мастер', action: 'transfer', details: 'Перенесено с A на B' },
    { ts: 5000, by: 'Владелец', action: 'payment', details: 'Платёж 500 ₽ (cash)' }
  ]
}];
var jrn = renderOrderTabJournal(DB.orders[0]);
assert(jrn.indexOf('Хронология заявки') >= 0, '6. заголовок хронологии');
assert(jrn.indexOf('➕') >= 0, '6. иконка create');
assert(jrn.indexOf('🔄') >= 0, '6. иконка status');
assert(jrn.indexOf('📞') >= 0, '6. иконка call_result');
assert(jrn.indexOf('📅') >= 0, '6. иконка transfer');
assert(jrn.indexOf('💳') >= 0, '6. иконка payment');
assert(jrn.indexOf('Перенесено с A на B') >= 0, '6. детали переноса показаны');
assert(jrn.indexOf('Статус: Новая → Согласована') >= 0, '6. переход статуса по-русски');
// Сортировка: новые сверху (payment раньше create в разметке).
assert(jrn.indexOf('Платёж') < jrn.indexOf('Заявка создана'), '6. сортировка от новых к старым');
// Автор записи виден.
assert(jrn.indexOf('Мастер') >= 0, '6. автор события');

// Пустая история — понятная заглушка.
var emptyJrn = renderOrderTabJournal({ id: 161, history: [] });
assert(emptyJrn.indexOf('История пуста') >= 0, '6. пустая история → заглушка');
// История без поля — тоже не падает.
assert(renderOrderTabJournal({ id: 162 }).indexOf('История пуста') >= 0,
  '6. history undefined → заглушка');

// --- 7. Кнопка «📅 Перенести» на вкладке «Основное» ---

DB.orders = [freshOrder(170, 'new')];
var mainHtml = renderOrderTabMain(DB.orders[0]);
assert(mainHtml.indexOf('data-transfer-order="170"') >= 0, '7. кнопка переноса есть');
assert(mainHtml.indexOf('Перенести') >= 0, '7. подпись кнопки');

// В закрытых статусах и уже в переносе кнопки нет.
['completed', 'paid', 'canceled', 'transfer'].forEach(function (st) {
  var h = renderOrderTabMain(freshOrder(171, st));
  assert(h.indexOf('data-transfer-order') < 0, '7. ' + st + ' → кнопки нет');
});
// Нет права (worker, чужая) — кнопки нет.
login('worker', 'Фёдор');
assert(renderOrderTabMain(freshOrder(172, 'new')).indexOf('data-transfer-order') < 0,
  '7. без права на редактирование — кнопки нет');
login('admin', 'Владелец');

// --- 8. Модалка переноса ---

DB.orders = [freshOrder(180, 'approved')];
DB.orders[0].date = '2026-11-20';
DB.orders[0].t1 = '09:00';
DB.orders[0].t2 = '12:00';
modalStub.innerHTML = '';
renderTransferModal(DB.orders[0]);
var md = modalStub.innerHTML;
assert(md.indexOf('id="tr-date"') >= 0, '8. поле даты');
assert(md.indexOf('id="tr-t1"') >= 0, '8. поле времени с');
assert(md.indexOf('id="tr-t2"') >= 0, '8. поле времени по');
assert(md.indexOf('id="tr-reason"') >= 0, '8. поле причины');
assert(md.indexOf('data-save-transfer="180"') >= 0, '8. кнопка сохранения');
assert(md.indexOf('data-close') >= 0, '8. кнопка отмены');
assert(md.indexOf('2026-11-20') >= 0, '8. текущая дата показана и в value');
assert(md.indexOf('onclick') < 0, '8. инлайн-обработчиков нет');

// --- 9. applyTransferFromModal читает поля формы ---

for (var k in FIELDS) delete FIELDS[k];
FIELDS['tr-date'] = { value: '2026-12-25' };
FIELDS['tr-t1'] = { value: '10:00' };
FIELDS['tr-t2'] = { value: '13:00' };
FIELDS['tr-reason'] = { value: 'праздники' };
modalStub.innerHTML = '<div>x</div>';
assert.eq(applyTransferFromModal('180'), true, '9. применение из модалки → true');
var o180 = findOrderById(180);
assert.eq(o180.date, '2026-12-25', '9. дата взята из поля');
assert.eq(o180.t1, '10:00', '9. t1 из поля');
assert.eq(o180.status, 'transfer', '9. статус transfer');
assert(o180.history.some(function (h) {
  return h.action === 'transfer' && h.details.indexOf('праздники') >= 0;
}), '9. причина из поля в истории');
assert.eq(modalStub.innerHTML, '', '9. модалка закрыта после успеха');

// Пустая дата — отказ с подсказкой, заявка не тронута.
DB.orders = [freshOrder(181, 'new')];
FIELDS['tr-date'] = { value: '   ' };
assert.eq(applyTransferFromModal('181'), false, '9. пустая дата → false');
assert.eq(DB.orders[0].status, 'new', '9. статус не изменён');
// Несуществующая заявка — false без падения.
assert.eq(applyTransferFromModal('999999'), false, '9. нет заявки → false');

// --- 10. Делегаты кликов ---

DB.orders = [freshOrder(190, 'inwork')];
modalStub.innerHTML = '';
clickOn('data-transfer-order', 190);
assert(modalStub.innerHTML.indexOf('tr-date') >= 0, '10. клик открыл модалку');

FIELDS['tr-date'] = { value: '2027-01-10' };
FIELDS['tr-t1'] = { value: '' };
FIELDS['tr-t2'] = { value: '' };
FIELDS['tr-reason'] = { value: '' };
clickOn('data-save-transfer', 190);
assert.eq(findOrderById(190).status, 'transfer', '10. сохранение применило перенос');
assert.eq(modalStub.innerHTML, '', '10. модалка закрыта');

// Клик по кнопке внутри карточки не должен уводить на саму карточку (регрессия).
state.screen = 'order';
state.orderId = 190;
clickOn('data-transfer-order', 190);
assert.eq(state.screen, 'order', '10. клик не сменил экран');

// --- 11. Регрессия без Firebase (локальный режим) ---

var savedFb = globalThis.firebase;
delete globalThis.firebase;
DB.orders = [freshOrder(200, 'new')];
assert.eq(transferOrder(DB.orders[0], { date: '2026-12-30' }), true,
  '11. без firebase перенос работает');
assert.eq(DB.orders[0].status, 'transfer', '11. статус без firebase обновлён');
assert(jarnSafe(), '11. журнал без firebase не падает');
function jarnSafe() { return renderOrderTabJournal(DB.orders[0]).length > 0; }
if (savedFb) globalThis.firebase = savedFb;

// --- 12. Перенос не ломает SPEC-семантику статусов ---

// Обычные переходы прежних статусов не изменились (регрессия матрицы).
assert.eq(STATUS_TRANSITIONS.new.indexOf('inspection') >= 0, true, '12. new→inspection');
assert.eq(STATUS_TRANSITIONS.inwork.indexOf('completed') >= 0, true, '12. inwork→completed');
assert.eq(STATUS_TRANSITIONS.inwork.indexOf('postponed') >= 0, true, '12. Q4 inwork→postponed');
assert.eq(STATUS_TRANSITIONS.completed.indexOf('paid') >= 0, true, '12. completed→paid');
assert.eq(STATUS_TRANSITIONS.paid.length, 0, '12. paid — финальный');

// --- 13. Экспорты/typeof ---

['transferOrder', 'renderTransferModal', 'applyTransferFromModal',
 'renderOrderTabJournal', 'findOrderById'].forEach(function (n) {
  assert(typeof globalThis[n] === 'function', 'typeof ' + n);
});
