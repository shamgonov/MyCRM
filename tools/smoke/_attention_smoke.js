/* Смоук Этапа 19: экран «Требует внимания», «Итог звонка», дайджест 08:30. */
'use strict';

globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
const appStub = { innerHTML: '' };
const navStub = { innerHTML: '' };
const modalStub = { innerHTML: '' };
// Поля модалки выбора даты/времени перезвона: id → { value }.
const FIELDS = {};
const clickHandlers = [];
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
globalThis.setInterval = function () { return 0; };

// Мок Notification: КОНСТРУКТОР (notify.js делает new Notification(...)).
function NotifMock(title, opts) {
  NotifMock.last = { title: title, opts: opts };
  NotifMock.count++;
}
NotifMock.permission = 'granted';
NotifMock.count = 0;
NotifMock.last = null;
NotifMock.requestPermission = function (cb) {
  NotifMock.permission = 'granted';
  if (cb) cb('granted');
};
globalThis.Notification = NotifMock;

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-attention.js');
loadModule('app/notify.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

function fireClick(attr, value) {
  const node = {
    getAttribute: function (a) { return a === attr ? value : null; },
    value: ''
  };
  const ev = { target: { closest: function (s) { return s === '[' + attr + ']' ? node : null; } } };
  clickHandlers.forEach(function (fn) { fn(ev); });
}

const today = localToday();

// --- 1. normalizeOrder: callbackAt = null ---
const bare = { id: 1, works: [], extras: [], materials: [], history: [], payments: [] };
normalizeOrder(bare);
assert('callbackAt' in bare, 'normalizeOrder: поле callbackAt задано');
assert.eq(bare.callbackAt, null, 'normalizeOrder: callbackAt = null');

// --- 2. Матрица: new → postponed разрешён (нужен ветке «Отложено») ---
assert(STATUS_TRANSITIONS.new.indexOf('postponed') >= 0, 'new → postponed разрешён');

// --- 3. isCallbackDue ---
const dueOrder = { id: 10, status: 'new', callbackAt: Date.now() - 1000, client: 'Х', date: today,
  worker: '', helpers: [], materials: [], works: [], extras: [], history: [], payments: [] };
assert.eq(isCallbackDue(dueOrder, Date.now()), true, 'isCallbackDue: срок наступил → true');
assert.eq(isCallbackDue(dueOrder, Date.now() - 10000), false, 'isCallbackDue: срок не наступил → false');
assert.eq(isCallbackDue({ id: 11, status: 'new', callbackAt: null }, Date.now()), false,
  'isCallbackDue: без callbackAt → false');
assert.eq(isCallbackDue({ id: 12, status: 'completed', callbackAt: 1 }, Date.now()), false,
  'isCallbackDue: closed статус → false');
assert.eq(isCallbackDue({ id: 13, status: 'inspection', callbackAt: 1 }, Date.now()), true,
  'isCallbackDue: inspection → true');

// --- 4. attentionGroups: шесть групп наполнены ---
DB.orders = [
  // перезвон + просрочка + без исполнителя
  { id: 20, client: 'А', status: 'new', worker: '', date: today, t1: '09:00', t2: '10:00',
    callbackAt: Date.now() - 5000, helpers: [], confirm: {}, materials: [], works: [], extras: [],
    history: [], payments: [] },
  // остаток к оплате (paid 500 из 2000)
  { id: 21, client: 'Б', status: 'completed', worker: 'А', date: today, t1: '', t2: '',
    helpers: [], confirm: {}, works: [{ name: 'Р', qty: 1, price: 2000, coeff: 1 }],
    extras: [], materials: [], history: [], payments: [{ id: 1, sum: 500 }] },
  // материалы к закупке
  { id: 22, client: 'В', status: 'inwork', worker: 'А', date: today, t1: '', t2: '',
    helpers: [], confirm: {}, works: [], extras: [], history: [], payments: [],
    materials: [{ name: 'М1', status: 'needed', qty: 1, price: 10 }, { name: 'М2', status: 'bought' }] },
  // соисполнитель ждёт подтверждения
  { id: 23, client: 'Г', status: 'approved', worker: 'А', date: today, t1: '', t2: '',
    helpers: ['Вера'], confirm: { Вера: 'pending' }, works: [], extras: [], materials: [],
    history: [], payments: [] }
];

const groups = attentionGroups();
assert.eq(groups.callback.length, 1, 'groups.callback: 1 заявка (№20)');
assert.eq(groups.overdue.length, 0, 'groups.overdue: пуст (все на сегодня)');
assert.eq(groups.noWorker.length, 1, 'groups.noWorker: 1 заявка (№20)');
assert.eq(groups.balance.length, 1, 'groups.balance: 1 заявка (№21)');
assert.eq(groups.materials.length, 1, 'groups.materials: 1 заявка (№22)');
assert.eq(groups.confirm.length, 1, 'groups.confirm: 1 заявка (№23)');
assert.eq(groups.balance[0].note, 'остаток 1 500 ₽', 'groups.balance: note со суммой');
assert.eq(groups.materials[0].note, '1 поз. к закупке', 'groups.materials: note с числом');
assert(groups.confirm[0].note.indexOf('Вера') >= 0, 'groups.confirm: note с именем');

// Просрочка: дата вчера.
DB.orders.push({ id: 24, client: 'Д', status: 'inwork', worker: 'А',
  date: dateShift(today, -2), t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [],
  materials: [], history: [], payments: [] });
assert.eq(attentionGroups().overdue.length, 1, 'groups.overdue: вчерашняя inwork → 1');
// Closed статусы в просрочку не попадают.
DB.orders.push({ id: 25, client: 'Е', status: 'paid', worker: 'А',
  date: dateShift(today, -5), t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [],
  materials: [], history: [], payments: [] });
assert.eq(attentionGroups().overdue.length, 1, 'groups.overdue: paid игнорируется');

// --- 5. renderAttention: экран с блоками ---
const attHtml = renderAttention();
assert(attHtml.indexOf('Требует внимания') >= 0, 'renderAttention: заголовок');
assert(attHtml.indexOf('📞 Нужен перезвон') >= 0, 'renderAttention: блок перезвона');
assert(attHtml.indexOf('💰 Остаток к оплате') >= 0, 'renderAttention: блок остатка');
assert(attHtml.indexOf('🧱 Материалы к закупке') >= 0, 'renderAttention: блок материалов');
assert(attHtml.indexOf('❓ Ждёт подтверждения') >= 0, 'renderAttention: блок подтверждения');
assert(attHtml.indexOf('data-attention-order="20"') >= 0, 'renderAttention: строка №20');
assert(attHtml.indexOf('onclick') < 0, 'renderAttention: инлайн-обработчиков нет');

// Пустой экран — «всё под контролем».
DB.orders = [];
const emptyHtml = renderAttention();
assert(emptyHtml.indexOf('Всё под контролем') >= 0, 'renderAttention: пусто → сообщение');
assert(emptyHtml.indexOf('data-attention-order') < 0, 'renderAttention: пусто → блоков нет');

// --- 6. renderCallResultModal: 6 кнопок-веток ---
const callOrder = { id: 30, client: 'ЗвонКлиент', phone: '+7 900 000-00-00', status: 'new',
  worker: '', date: today, t1: '09:00', t2: '10:00', helpers: [], confirm: {}, works: [],
  extras: [], materials: [], history: [], payments: [], payments: [] };
DB.orders = [callOrder];
renderCallResultModal(callOrder);
const modalHtml = modalStub.innerHTML;
assert(modalHtml.indexOf('Итог звонка') >= 0, 'callModal: заголовок');
CALL_BRANCHES.forEach(function (b) {
  assert(modalHtml.indexOf(b[1]) >= 0, 'callModal: кнопка ' + b[0]);
  assert(modalHtml.indexOf('data-call-result="' + b[0] + '"') >= 0, 'callModal: data для ' + b[0]);
});
assert.eq(CALL_BRANCHES.length, 11, 'callModal: ровно 11 веток');
assert(modalHtml.indexOf('onclick') < 0, 'callModal: инлайн-обработчиков нет');
closeModal();

// --- 7. applyCallResult: ветки ---
// 7.1 «Не дозвонился» → callbackAt = +2 ч и история.
state.orderId = 30;
const r1 = applyCallResult(callOrder, 'no_answer');
assert.eq(r1.ok, true, 'no_answer: ok');
assert(callOrder.callbackAt > Date.now() + 1.9 * 3600000, 'no_answer: callbackAt ≈ +2 ч');
assert(callOrder.callbackAt < Date.now() + 2.1 * 3600000, 'no_answer: callbackAt не дальше 2 ч');
assert(callOrder.history.some(function (h) {
  return h.action === 'call_result' && h.details.indexOf('Не дозвонился') >= 0;
}), 'no_answer: запись call_result в историю');
assert.eq(callOrder.status, 'new', 'no_answer: статус не изменён');

// 7.2 «Перезвонить через 1 час» → callbackAt ≈ +1 ч.
const r2 = applyCallResult(callOrder, 'later_1h');
assert.eq(r2.ok, true, 'later_1h: ok');
assert(callOrder.callbackAt > Date.now() + 0.9 * 3600000, 'later_1h: callbackAt ≈ +1 ч');
assert(callOrder.callbackAt < Date.now() + 1.1 * 3600000, 'later_1h: callbackAt в пределах 1 ч');

// 7.3 «Перезвонить через 2 часа» → callbackAt ≈ +2 ч.
const r2h = applyCallResult(callOrder, 'later_2h');
assert.eq(r2h.ok, true, 'later_2h: ok');
assert(callOrder.callbackAt > Date.now() + 1.9 * 3600000, 'later_2h: callbackAt ≈ +2 ч');
assert(callOrder.callbackAt < Date.now() + 2.1 * 3600000, 'later_2h: callbackAt в пределах 2 ч');

// 7.4 «Перезвонить через 4 часа» → callbackAt ≈ +4 ч.
const r4h = applyCallResult(callOrder, 'later_4h');
assert.eq(r4h.ok, true, 'later_4h: ok');
assert(callOrder.callbackAt > Date.now() + 3.9 * 3600000, 'later_4h: callbackAt ≈ +4 ч');
assert(callOrder.callbackAt < Date.now() + 4.1 * 3600000, 'later_4h: callbackAt в пределах 4 ч');

// 7.5 «Перезвонить через 24 часа» → callbackAt ≈ +24 ч.
const r24h = applyCallResult(callOrder, 'later_24h');
assert.eq(r24h.ok, true, 'later_24h: ok');
assert(callOrder.callbackAt > Date.now() + 23 * 3600000, 'later_24h: callbackAt ≈ +24 ч');
assert(callOrder.callbackAt < Date.now() + 25 * 3600000, 'later_24h: callbackAt в пределах 24 ч');

// 7.6 «Перезвонить завтра» → callbackAt = tomorrowAt9().
const rTomorrow = applyCallResult(callOrder, 'later_tomorrow');
assert.eq(rTomorrow.ok, true, 'later_tomorrow: ok');
assert.eq(rTomorrow.text, 'Перезвон завтра в 09:00', 'later_tomorrow: текст toast');
const tm9 = tomorrowAt9();
assert(callOrder.callbackAt >= tm9 - 1000, 'later_tomorrow: callbackAt ≈ завтра 09:00');
assert(callOrder.callbackAt <= tm9 + 1000, 'later_tomorrow: callbackAt ≈ завтра 09:00');
assert(callOrder.status === 'new', 'later_tomorrow: статус не изменён');

// 7.7 «Выбрать дату и время» → открывает модалку, callbackAt не меняется.
const cbOrderBefore = callOrder.callbackAt;
const rCustom = applyCallResult(callOrder, 'later_custom');
assert.eq(rCustom.ok, true, 'later_custom: ok');
assert.eq(rCustom.text, '', 'later_custom: пустой текст toast');
assert(callOrder.callbackAt === cbOrderBefore, 'later_custom: callbackAt не изменился');
assert(modalStub.innerHTML.indexOf('cc-date') >= 0, 'later_custom: модалка с cc-date');
assert(modalStub.innerHTML.indexOf('cc-time') >= 0, 'later_custom: модалка с cc-time');
assert(modalStub.innerHTML.indexOf('data-save-callback') >= 0, 'later_custom: кнопка data-save-callback');
closeModal();

// 7.3 «Согласована смета» → approved + сброс callbackAt.
const r3 = applyCallResult(callOrder, 'approved');
assert.eq(r3.ok, true, 'approved: ok');
assert.eq(callOrder.status, 'approved', 'approved: статус изменён');
assert.eq(callOrder.callbackAt, null, 'approved: callbackAt сброшен');
assert(callOrder.history.some(function (h) { return h.action === 'call_result'; }),
  'approved: история звонка сохранена');
assert(callOrder.history.some(function (h) {
  return h.action === 'status' && h.to === 'approved';
}), 'approved: переход записан в журнал');

// 7.4 «Договорились об осмотре» из new.
const inspOrder = { id: 31, client: 'Осмотр', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [] };
DB.orders.push(inspOrder);
assert.eq(applyCallResult(inspOrder, 'inspection').ok, true, 'inspection: ok');
assert.eq(inspOrder.status, 'inspection', 'inspection: статус изменён');

// 7.5 «Отложено» из new (новый переход Этапа 19).
assert.eq(applyCallResult(inspOrder, 'postponed').ok, false, 'postponed: из inspection нельзя');
const postOrder = { id: 32, client: 'Отлож', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [] };
DB.orders.push(postOrder);
assert.eq(applyCallResult(postOrder, 'postponed').ok, true, 'postponed: из new ok');
assert.eq(postOrder.status, 'postponed', 'postponed: статус изменён');

// 7.6 «Отказ» → canceled с причиной.
const cancelOrder = { id: 33, client: 'Отказ', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [] };
DB.orders.push(cancelOrder);
const r6 = applyCallResult(cancelOrder, 'canceled');
assert.eq(r6.ok, true, 'canceled: ok');
assert.eq(cancelOrder.status, 'canceled', 'canceled: статус изменён');
assert(cancelOrder.history.some(function (h) {
  return h.action === 'status' && h.to === 'canceled' && h.reason === 'Отказ клиента';
}), 'canceled: причина перехода записана');

// 7.7 Неизвестная ветка / null.
assert.eq(applyCallResult(cancelOrder, 'no_such').ok, false, 'неизвестная ветка → ok=false');
assert.eq(applyCallResult(null, 'later_1h').ok, false, 'null заявка → ok=false');

// --- 8. Делегат data-call-result (клик по кнопке в модалке) ---
const delOrder = { id: 40, client: 'Делегат', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [] };
DB.orders = [delOrder];
state.orderId = 40;
fireClick('data-call-result', 'no_answer');
assert(delOrder.callbackAt > Date.now(), 'делегат no_answer: callbackAt проставлен');
assert(delOrder.history.some(function (h) { return h.action === 'call_result'; }),
  'делегат no_answer: история записана');

// --- 8.1 Делегат data-save-callback: валидная дата/время ---
const cbDelOrder = { id: 41, client: 'ДатаКолл', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [] };
DB.orders = [cbDelOrder];
state.orderId = 41;
const futureDate = (function () {
  var d = new Date();
  d.setDate(d.getDate() + 3);
  var mm = String(d.getMonth() + 1); if (mm.length < 2) mm = '0' + mm;
  var dd = String(d.getDate()); if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
})();
FIELDS['cc-date'] = { value: futureDate };
FIELDS['cc-time'] = { value: '14:30' };
fireClick('data-save-callback', '41');
assert(cbDelOrder.callbackAt > Date.now(),
  'делегат save-callback: callbackAt > now');
assert(cbDelOrder.history.some(function (h) {
  return h.action === 'call_result' && h.details.indexOf('📅 Перезвон ' + futureDate + ' в 14:30') >= 0;
}), 'делегат save-callback: история записана');
assert.eq(modalStub.innerHTML, '', 'делегат save-callback: модалка закрыта');

// --- 8.2 Делегат data-save-callback: прошедшая дата → callbackAt не меняется ---
const pastCbOrder = { id: 42, client: 'Мимо', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [], callbackAt: null };
DB.orders = [pastCbOrder];
state.orderId = 42;
FIELDS['cc-date'] = { value: '2020-01-01' };
FIELDS['cc-time'] = { value: '09:00' };
fireClick('data-save-callback', '42');
assert.eq(pastCbOrder.callbackAt, null,
  'делегат save-callback: прошедшая дата → callbackAt не изменился');

// --- 8.3 Делегат data-save-callback: пустая дата → callbackAt не меняется ---
const emptyCbOrder = { id: 43, client: 'Пусто', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [], callbackAt: null };
DB.orders = [emptyCbOrder];
state.orderId = 43;
FIELDS['cc-date'] = { value: '' };
FIELDS['cc-time'] = { value: '' };
fireClick('data-save-callback', '43');
assert.eq(emptyCbOrder.callbackAt, null,
  'делегат save-callback: пустые поля → callbackAt не изменился');

// --- 8.4 tomorrowAt9: корректность ---
const t9 = tomorrowAt9();
assert(t9 > Date.now(), 'tomorrowAt9: больше текущего времени');
assert(t9 < Date.now() + 48 * 3600000, 'tomorrowAt9: меньше +48 ч');
const t9d = new Date(t9);
assert.eq(t9d.getHours(), 9, 'tomorrowAt9: час = 9');
assert.eq(t9d.getMinutes(), 0, 'tomorrowAt9: минуты = 0');

// --- 8.5 renderCustomCallbackModal: HTML содержит нужные элементы ---
const customOrder = { id: 44, client: 'Модалка', status: 'new', worker: '', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [] };
renderCustomCallbackModal(customOrder);
assert(modalStub.innerHTML.indexOf('cc-date') >= 0, 'renderCustomCallbackModal: cc-date');
assert(modalStub.innerHTML.indexOf('cc-time') >= 0, 'renderCustomCallbackModal: cc-time');
assert(modalStub.innerHTML.indexOf('data-save-callback="44"') >= 0,
  'renderCustomCallbackModal: data-save-callback="44"');
assert(modalStub.innerHTML.indexOf('onclick') < 0,
  'renderCustomCallbackModal: инлайн-обработчиков нет');
closeModal();

// Переход с экрана «Требует внимания» в карточку заявки.
state.screen = 'overdue';
state.orderId = null;
fireClick('data-attention-order', '40');
assert.eq(state.screen, 'order', 'делегат data-attention-order: открыта карточка');
assert.eq(state.orderId, 40, 'делегат data-attention-order: id заявки');

// --- 9. buildReminders: kind 'callback' ---
localStorage.removeItem('crm2_seen');
const cbOrder = { id: 50, client: 'Перезвон', status: 'new', worker: 'Владелец',
  date: today, t1: '10:00', t2: '11:00', helpers: [], confirm: {}, works: [], extras: [],
  materials: [], history: [], payments: [], callbackAt: Date.now() - 60000 };
DB.orders = [cbOrder];
const cbRem = buildReminders([]).filter(function (r) { return r.kind === 'callback'; });
assert.eq(cbRem.length, 1, 'buildReminders: kind callback найден');
assert.eq(cbRem[0].orderId, 50, 'buildReminders: callback на нужную заявку');
assert.eq(REMINDER_LABELS.callback, '📞 Перезвонить', 'REMINDER_LABELS: подпись callback');

// Будущий callbackAt → напоминания нет.
cbOrder.callbackAt = Date.now() + 3600000;
assert.eq(buildReminders([]).filter(function (r) { return r.kind === 'callback'; }).length, 0,
  'buildReminders: будущий callbackAt неreminder');

// Статус estimate (не new/inspection) → напоминания нет.
cbOrder.callbackAt = Date.now() - 1000;
cbOrder.status = 'estimate';
assert.eq(buildReminders([]).filter(function (r) { return r.kind === 'callback'; }).length, 0,
  'buildReminders: estimate не даёт callback');
cbOrder.status = 'new';

// --- 10. Дайджест 08:30: одно сводное уведомление ---
DB.settings.notifyEnabled = true;
NotifMock.count = 0;
NotifMock.last = null;
DB.settings.digestShownToday = '';
const at0830 = new Date(2026, 10, 15, 8, 30, 0, 0);
const digestRes = maybeDigest(at0830);
assert(digestRes > 0, 'digest: 08:30 → отправлено позиций: ' + digestRes);
assert.eq(NotifMock.count, 1, 'digest: ровно ОДНО сводное уведомление');
assert(NotifMock.last.title.indexOf('дайджест') >= 0, 'digest: заголовок «дайджест»');
assert(NotifMock.last.opts.body.indexOf('📋 Дайджест:') === 0, 'digest: текст начинается со сводки');
assert(DB.settings.digestShownToday === localToday(), 'digest: digestShownToday = сегодня');

// Повтор в тот же день — молчим.
NotifMock.count = 0;
assert.eq(maybeDigest(at0830), null, 'digest: повторный вызов за день → null');
assert.eq(NotifMock.count, 0, 'digest: повтор не шлёт уведомлений');

// Вне окна 08:30 ± 5 мин — молчим.
DB.settings.digestShownToday = '';
NotifMock.count = 0;
assert.eq(maybeDigest(new Date(2026, 10, 15, 9, 0, 0, 0)), null, 'digest: 09:00 вне окна');
assert.eq(maybeDigest(new Date(2026, 10, 15, 8, 20, 0, 0)), null, 'digest: 08:20 вне окна');
assert.eq(NotifMock.count, 0, 'digest: вне окна уведомлений нет');
// Граница окна (08:35) — внутри.
assert(maybeDigest(new Date(2026, 10, 15, 8, 35, 0, 0)) !== null, 'digest: 08:35 в окне');

// buildDigestText: подписи без эмодзи, счётчики по kind.
const txt = buildDigestText([
  { kind: 'overdue' }, { kind: 'overdue' }, { kind: 'callback' }, { kind: 'balance' }
]);
assert(txt.indexOf('2 просрочено') >= 0, 'digestText: счётчик overdue, получено: ' + txt);
assert(txt.indexOf('1 перезвонить') >= 0, 'digestText: счётчик callback');
assert(txt.indexOf('1 остаток') >= 0, 'digestText: счётчик balance');
assert.eq(buildDigestText([]), '', 'digestText: пусто → пустая строка');

// --- 11. notifyTick: сброс callbackAt после показа (звонковый kind) ---
DB.settings.digestShownToday = localToday(); // не мешаем дайджесту
cbOrder.callbackAt = Date.now() - 1000;
localStorage.removeItem('crm2_seen');
NotifMock.count = 0;
const ticked = notifyTick();
assert(ticked >= 1, 'notifyTick: обработано напоминаний: ' + ticked);
assert.eq(cbOrder.callbackAt, null, 'notifyTick: callbackAt сброшен после показа');
assert(cbOrder.history.length >= 0, 'notifyTick: заявка цела');

// --- 12. Кнопка «Итог звонка» в карточке (только new/inspection) ---
const newCard = { id: 60, client: 'Карточка', status: 'new', worker: 'Владелец', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [], tags: [] };
DB.orders = [newCard];
const cardHtml = renderOrderTabMain(newCard);
assert(cardHtml.indexOf('data-call-result="start"') >= 0, 'карточка new: кнопка «Итог звонка»');
assert(cardHtml.indexOf('📞 Итог звонка') >= 0, 'карточка new: текст кнопки');

const workCard = { id: 61, client: 'Вработе', status: 'inwork', worker: 'Владелец', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [], tags: [] };
assert(renderOrderTabMain(workCard).indexOf('data-call-result') < 0,
  'карточка inwork: кнопки «Итог звонка» нет');

const inspCard = { id: 62, client: 'ОсмотрК', status: 'inspection', worker: 'Владелец', date: today,
  t1: '', t2: '', helpers: [], confirm: {}, works: [], extras: [], materials: [], history: [],
  payments: [], tags: [] };
assert(renderOrderTabMain(inspCard).indexOf('data-call-result="start"') >= 0,
  'карточка inspection: кнопка есть');

// Делегат кнопки открывает модалку.
state.orderId = 60;
const savedModal = modalStub.innerHTML;
modalStub.innerHTML = '';
// fireClick для точного селектора [data-call-result="start"].
(function () {
  const node = { getAttribute: function () { return null; } };
  const ev = { target: { closest: function (s) {
    return s === '[data-call-result="start"]' ? node : null;
  } } };
  clickHandlers.forEach(function (fn) { fn(ev); });
})();
assert(modalStub.innerHTML.indexOf('Итог звонка') >= 0, 'делегат start: открыта модалка');
void savedModal;
closeModal();

// --- 13. Регрессия: без ui-attention.js экран не падает (typeof-обёртка) ---
const savedAttention = globalThis.renderAttention;
const savedCallModal = globalThis.renderCallResultModal;
globalThis.renderAttention = undefined;
const stubHtml = S.overdue();
assert(stubHtml.indexOf('Просроченные заявки') >= 0, 'регрессия: S.overdue без модуля → заглушка');
assert(stubHtml.indexOf('Модуль UI ещё не загружен') >= 0, 'регрессия: заглушка с текстом');
globalThis.renderAttention = savedAttention;
assert(S.overdue().indexOf('Требует внимания') >= 0, 'регрессия: с модулем — новый экран');

// Карточка без модуля: кнопка остаётся, клик даёт toast, а не исключение.
globalThis.renderCallResultModal = undefined;
state.orderId = 60;
(function () {
  const node = { getAttribute: function () { return null; } };
  const ev = { target: { closest: function (s) {
    return s === '[data-call-result="start"]' ? node : null;
  } } };
  clickHandlers.forEach(function (fn) { fn(ev); });
})();
assert(true, 'регрессия: клик «Итог звонка» без модуля не падает');
globalThis.renderCallResultModal = savedCallModal;

// --- 14. Сид Этапа 19: у «Иванова М.С.» наступивший callbackAt ---
// Чистим локальную базу: load() без данных заново сеет мок-заявки.
localStorage.removeItem('crm2_db');
DB = load();
const seeded = (DB.orders || []).find(function (o) { return o.client === 'Иванова М.С.'; });
assert(!!seeded, 'seed: заявка Иванова М.С. есть');
assert(seeded.callbackAt > 0, 'seed: callbackAt проставлен');
assert(seeded.callbackAt < Date.now(), 'seed: callbackAt в прошлом (напоминание сработает)');
assert(isCallbackDue(seeded, Date.now()), 'seed: заявка попадает в «Нужен перезвон»');
