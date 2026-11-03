/* Смоук app/ui-calendar.js (Этап 5): фильтры, конфликты, слоты, онлайн, модалка. */
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
globalThis.confirm = function () { return false; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-calendar.js');

const today = localToday();
const tomorrow = dateShift(today, 1);
const in2days = dateShift(today, 2);

// --- state.online: загрузка из localStorage и переключение
assert(loadOnline() === false, 'crm2_online пуст → онлайн выключен');
state.online = true;
lsSet('crm2_online', '1');
assert(loadOnline() === true, 'loadOnline читает «1»');
assert(isOnline() === true, 'isOnline после включения');

// --- getCalendarOrders: дата + сортировка по t1
login('admin', 'Владелец'); // видит все
setOwnerFlag(false);
DB.users = [];
const todayAll = getCalendarOrders(today, 'all', 'all');
assert.eq(todayAll.length, 3, 'на сегодня 3 заявки (сид)');
assert(todayAll[0].t1 <= todayAll[1].t1 && todayAll[1].t1 <= todayAll[2].t1,
  'getCalendarOrders сортирует по t1');
assert.eq(getCalendarOrders(tomorrow, 'all', 'all').length, 1, 'на завтра 1 заявка');
assert.eq(getCalendarOrders(in2days, 'all', 'all').length, 1, 'через 2 дня 1 заявка');
assert.eq(getCalendarOrders(dateShift(today, 99), 'all', 'all').length, 0, 'пустой день');

// --- фильтры по типу: inspection / work
assert.eq(getCalendarOrders(today, 'inspection', 'all').length, 0, 'сегодня осмотров нет');
assert.eq(getCalendarOrders(tomorrow, 'inspection', 'all').length, 1, 'завтра осмотр');
assert.eq(getCalendarOrders(in2days, 'work', 'all').length, 1, 'через 2 дня работа');
assert.eq(getCalendarOrders(today, 'work', 'all').length, 3, 'сегодня все 3 — работы');

// --- viewMode 'my': только isAssignedToMe (входим как Мастер)
login('worker', 'Мастер');
const myAll = getCalendarOrders(today, 'all', 'my');
assert.eq(myAll.length, 1, '«Мой» на сегодня: только заявка Мастера');
assert.eq(myAll[0].worker, 'Мастер', '«Мой» отфильтровал чужое');

// --- checkTimeConflict: у Бориса сегодня две пересекающиеся заявки (14-18 и 17-19)
const conflictProbe = { date: today, t1: '17:00', t2: '19:00', worker: 'Борис' };
const conflicts = checkTimeConflict(conflictProbe);
assert.eq(conflicts.length, 2, 'проба 17-19 пересекает обе заявки Бориса');
assert(conflicts.some(function (c) { return c.client === 'ООО ОкнаСервис'; }) &&
  conflicts.some(function (c) { return c.client === 'Сидоров П.П.'; }),
  'в конфликте обе пересекающиеся заявки');

// касание границ: 19:00-20:00 начинается ровно на стыке с №7 (17-19) — не конфликт
assert.eq(checkTimeConflict({ date: today, t1: '19:00', t2: '20:00', worker: 'Борис' }).length, 0,
  'стыковка вплотную (19:00) — не конфликт');
// другой работник в то же время — не конфликт
assert.eq(checkTimeConflict({ date: today, t1: '17:00', t2: '19:00', worker: 'Мастер' }).length, 0,
  'другой worker в то же время — не конфликт');
// другой день — не конфликт
assert.eq(checkTimeConflict({ date: tomorrow, t1: '17:00', t2: '19:00', worker: 'Борис' }).length, 0,
  'другой день — не конфликт');
// перекрытие с двух сторон
assert.eq(checkTimeConflict({ date: today, t1: '15:00', t2: '16:00', worker: 'Борис' }).length, 1,
  'полное вложение — конфликт');
// битые данные
assert.eq(checkTimeConflict({ date: today, t1: '', t2: '', worker: 'Борис' }).length, 0,
  'пустое время — конфликтов нет');
assert.eq(checkTimeConflict(null).length, 0, 'checkTimeConflict(null) безопасен');

// --- renderCalendar: HTML на сегодня (под воркером — гейты видимости)
state.calDate = today;
state.calView = 'all';
state.calFilter = 'all';
const calHtml = renderCalendar();
assert(calHtml.indexOf('📅 Календарь') >= 0, 'renderCalendar: заголовок');
assert(calHtml.indexOf(today) >= 0, 'renderCalendar: дата today');
assert(calHtml.indexOf('data-cal-shift') >= 0 && calHtml.indexOf('data-cal-today') >= 0,
  'renderCalendar: навигация ‹ сегодня ›');
assert(calHtml.indexOf('data-cal-view="all"') >= 0 && calHtml.indexOf('data-cal-view="my"') >= 0,
  'renderCalendar: табы Общий/Мой');
assert(calHtml.indexOf('data-cal-filter') >= 0, 'renderCalendar: чипы-фильтры');
assert(calHtml.indexOf('data-order=') >= 0, 'renderCalendar: заявки в списке');
assert(calHtml.indexOf('Свободно') >= 0, 'renderCalendar: свободный слот есть');
assert(calHtml.indexOf('data-online-toggle') >= 0, 'renderCalendar: тумблер «На линии»');

// вид «Мой»: одна заявка Мастера
state.calView = 'my';
const calMy = renderCalendar();
assert((calMy.match(/data-order=/g) || []).length === 1, '«Мой»: только одна карточка');
assert(calMy.indexOf('👷 МОЯ') >= 0, '«Мой»: бейдж МОЯ');

// пустой день
state.calDate = dateShift(today, 99);
const calEmpty = renderCalendar();
assert(calEmpty.indexOf('Свободно весь день') >= 0, 'пустой день: «Свободно весь день»');
assert((calEmpty.match(/data-slot=/g) || []).length >= 1, 'пустой день: есть слоты');
state.calDate = today;

// --- renderCalendarDay: строка с временем/номером/клиентом/статусом
const dayRows = renderCalendarDay(todayAll);
assert(dayRows.indexOf('14:00-18:00') >= 0 && dayRows.indexOf('№3') >= 0,
  'renderCalendarDay: время и номер');
assert(dayRows.indexOf('Исп:') >= 0, 'renderCalendarDay: исполнитель');

// цветовое кодирование: просрочка-строка красная, работа зелёная
const overdueRow = renderCalendarDay([{ id: 2, date: dateShift(today, -1), t1: '10:00', t2: '11:00',
  status: 'new', client: 'Просрочка', worker: 'Борис' }]);
assert(overdueRow.indexOf('⚠️') >= 0 && overdueRow.indexOf('badge-danger') >= 0,
  'просрочка: ⚠️ + красный');
const workRow = renderCalendarDay([{ id: 3, date: today, t1: '14:00', t2: '18:00',
  status: 'approved', client: 'Работа', worker: 'Борис', kind: 'work' }]);
assert(workRow.indexOf('🔧') >= 0 && workRow.indexOf('badge-ok') >= 0, 'работа: 🔧 + зелёный');
const inspRow = renderCalendarDay([{ id: 5, date: tomorrow, t1: '10:00', t2: '11:00',
  status: 'inspection', client: 'Осмотр', worker: 'Мастер', examiner: 'Мастер' }]);
assert(inspRow.indexOf('🔍') >= 0 && inspRow.indexOf('badge-info') >= 0, 'осмотр: 🔍 + синий');

// --- freeSlots: разрывы > 30 минут (головной слот до первой заявки тоже считается)
const busyDay = [
  { t1: '09:00', t2: '12:00' },
  { t1: '14:00', t2: '18:00' }
];
const slots = freeSlots(busyDay);
assert.eq(JSON.stringify(slots),
  '[{"t1":"08:00","t2":"09:00"},{"t1":"12:00","t2":"14:00"},{"t1":"18:00","t2":"20:00"}]',
  'freeSlots: голова 08-09, пауза 12-14, хвост 18-20');
const tightDay = [{ t1: '09:00', t2: '12:00' }, { t1: '12:00', t2: '14:00' }];
assert.eq(JSON.stringify(freeSlots(tightDay)),
  '[{"t1":"08:00","t2":"09:00"},{"t1":"14:00","t2":"20:00"}]',
  'без зазора среднего слота нет (голова + хвост)');
assert.eq(freeSlots([{ t1: '09:00', t2: '11:00' }, { t1: '11:30', t2: '14:00' }]).length, 3,
  'ровно 30 минут считается свободным слотом');
const slotHtml = renderFreeSlot({ t1: '12:00', t2: '14:00' });
assert(slotHtml.indexOf('🟢 Свободно 12:00-14:00') >= 0, 'renderFreeSlot: текст слота');
assert(slotHtml.indexOf('data-slot="12:00|14:00"') >= 0, 'renderFreeSlot: data-slot');

// --- showConflictModal: рендер в #modal-container
showConflictModal([{ id: 3, client: 'ООО' }], { date: today, t1: '17:00', t2: '19:00' });
assert(modalStub.innerHTML.indexOf('⚠️') >= 0, 'модалка конфликта: заголовок с ⚠️');
assert(modalStub.innerHTML.indexOf('№3') >= 0, 'модалка конфликта: номера заявок');
assert(modalStub.innerHTML.indexOf('Всё равно взять') >= 0, 'модалка конфликта: кнопка взять');
assert(modalStub.innerHTML.indexOf('data-close') >= 0, 'модалка конфликта: кнопка отмена');
closeModal();

// --- tryCreateOrder: конфликт → модалка и НЕ создание; без конфликта → создание
const before = DB.orders.length;
const probeConflict = { date: today, t1: '17:00', t2: '19:00', worker: 'Борис', client: 'Тест' };
assert(tryCreateOrder(probeConflict) === false, 'tryCreateOrder: конфликт → false');
assert.eq(DB.orders.length, before, 'при конфликте заявка НЕ создана');
assert(modalStub.innerHTML.indexOf('Всё равно взять') >= 0, 'при конфликте открылась модалка');
assert(window.__calPending === null || window.__calPending === undefined,
  'pending-заявка из ui-orders не задействована');
closeModal();

// «Всё равно взять»: pending от ui-orders доходит до finishCreateOrder
const pendingOrder = { date: today, t1: '17:00', t2: '19:00', worker: 'Борис', client: 'Тест' };
window.__calPending = pendingOrder;
finishCreateOrder(pendingOrder);
assert.eq(DB.orders.length, before + 1, '«Всё равно взять» создал заявку');
assert.eq(modalStub.innerHTML, '', 'модалка закрыта после создания');
assert.eq(state.screen, 'orders', 'после создания ушли на список заявок');
window.__calPending = null;

// --- чистое создание без конфликта через tryCreateOrder
const cleanData = { date: tomorrow, t1: '07:00', t2: '08:00', worker: 'Мастер', client: 'Ранняя' };
assert(tryCreateOrder(cleanData) === true, 'tryCreateOrder: без конфликта → true');
assert.eq(DB.orders.length, before + 2, 'чистая заявка создана');
