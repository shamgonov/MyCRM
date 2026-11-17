/* Смоук app/ui-orders.js (Этап 4): список, фильтры, карточка, модалка, создание. */
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
const FIELDS = {};
const clickHandlers = [];
globalThis.document = {
  readyState: 'loading', // чтобы boot пошёл через DOMContentLoaded-ветку
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
};
globalThis.confirm = function () { return false; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; }; // заглушает таймер toast'ов

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-estimate.js'); // Этап 6: вкладка «Смета» живёт здесь

// --- Вход как worker «Мастер»: видит только свои, у seed есть «его» заявки
setOwnerFlag(false);
DB.users = [];
login('worker', 'Мастер');

// --- renderOrdersList: строка с заголовком, чипами, карточками
const listHtml = renderOrdersList();
assert(typeof listHtml === 'string' && listHtml.indexOf('📋 Заявки') >= 0,
  'renderOrdersList: заголовок «Заявки»');
assert(listHtml.indexOf('data-filter="all"') >= 0 && listHtml.indexOf('data-filter="mine"') >= 0,
  'renderOrdersList: чипы-фильтры на месте');
assert(listHtml.indexOf('data-create-modal') >= 0, 'renderOrdersList: кнопка ➕');
assert(listHtml.indexOf('data-order=') >= 0, 'renderOrdersList: есть карточки заявок');
// Этап 14: без orders_view_all worker видит свои + свободные из пула (Иванова — new без worker).
assert.eq(listHtml.split('data-order=').length - 1, 5,
  'worker: 4 свои + 1 из пула = 5 видимых карточек');
assert(listHtml.indexOf('👷 МОЯ') >= 0, 'бейдж «МОЯ» у заявки Мастера');
assert(listHtml.indexOf('list-item mine') >= 0, '«моя» карточка помечена');
assert(listHtml.indexOf('data-take-order=') >= 0, 'worker: у пул-заявки есть кнопка «Взять»');

// --- фильтр «Сегодня»: считаем по ВИДИМОМУ воркером подмножеству
state.filter = 'today';
const todayHtml = renderOrdersList();
const todayCount = (todayHtml.match(/data-order=/g) || []).length;
const expectedToday = DB.orders.filter(function (o) {
  return canViewOrder(o) && orderPassesFilter(o, 'today');
}).length;
assert.eq(todayCount, expectedToday, 'фильтр «Сегодня» = видимые заявки с датой сегодня');

// --- фильтр «Мои»: worker=Мастер + helpers содержит Мастера
state.filter = 'mine';
const mineHtml = renderOrdersList();
const mineCount = (mineHtml.match(/data-order=/g) || []).length;
const expectedMine = DB.orders.filter(function (o) { return isAssignedToMe(o); }).length;
assert.eq(mineCount, expectedMine, 'фильтр «Мои» = isAssignedToMe');
assert.eq(expectedMine, 4, 'у Мастера 4 «мои» заявки (worker+helper, с Этапа 5)');

// --- фильтр «Просрочка»: формула на конкретных объектах (роль не важна)
assert(orderPassesFilter({ date: dateShift(localToday(), -1), status: 'new' }, 'overdue') === true,
  'просрочка: новая на вчера проходит');
assert(orderPassesFilter({ date: dateShift(localToday(), -1), status: 'completed' }, 'overdue') === false,
  'просрочка: завершённая не проходит');
assert(orderPassesFilter({ date: dateShift(localToday(), -1), status: 'paid' }, 'overdue') === false,
  'просрочка: оплаченная не проходит');
assert(orderPassesFilter({ date: dateShift(localToday(), -1), status: 'canceled' }, 'overdue') === false,
  'просрочка: отменённая не проходит');
assert(orderPassesFilter({ date: localToday(), status: 'new' }, 'overdue') === false,
  'просрочка: сегодняшняя не проходит');
// Этап 14: свободная заявка Ивановой (вчера, new, без worker) видима через пул → в просрочке.
state.filter = 'overdue';
const overdueHtml = renderOrdersList();
assert.eq((overdueHtml.match(/data-order=/g) || []).length, 1,
  'worker: просрочка = 1 (свободная заявка из пула)');
state.filter = 'pool';
const poolHtml = renderOrdersList();
assert(poolHtml.indexOf('data-filter="pool"') >= 0, 'чип «Пул» на месте');
assert.eq((poolHtml.match(/data-order=/g) || []).length, 1, 'пул worker: только свободные');
state.filter = 'all';

// --- admin видит все 4 заявки (гейт orders_view_all)
login('admin', 'Владелец');
const adminList = renderOrdersList();
const adminCount = (adminList.match(/data-order=/g) || []).length;
assert.eq(adminCount, 7, 'admin видит все 7 заявок (гейт)');

// обратно worker для карточечных проверок
login('worker', 'Мастер');

// --- renderOrderCard: табы, клиент, смета
const myOrder = DB.orders.find(function (o) { return o.worker === 'Мастер'; });
const cardHtml = renderOrderCard(myOrder.id);
assert(cardHtml.indexOf('Заявка №' + myOrder.id) >= 0, 'карточка: заголовок с номером');
assert(cardHtml.indexOf('data-tab="main"') >= 0 && cardHtml.indexOf('data-tab="estimate"') >= 0 &&
  cardHtml.indexOf('data-tab="materials"') >= 0 && cardHtml.indexOf('data-tab="journal"') >= 0,
  'карточка: 4 таба');
// Этап 29: вкладки обёрнуты в скролл-контейнер (order-tabs-scroll).
assert(cardHtml.indexOf('order-tabs-scroll') >= 0, 'карточка: вкладки в order-tabs-scroll');
assert(cardHtml.indexOf('tel:') >= 0, 'карточка: телефон ссылкой tel:');
assert(cardHtml.indexOf('Исполнители') >= 0, 'карточка: блок исполнителей');
assert(cardHtml.indexOf('data-back') >= 0, 'карточка: кнопка «Назад»');

// worker может править свою открытую, но не закрытую
assert(cardHtml.indexOf('data-edit-order') >= 0, 'worker видит ✎ на своей открытой заявке');
const doneOrder = DB.orders.find(function (o) { return o.status === 'completed'; });
const doneCard = renderOrderCard(doneOrder.id);
assert(doneCard.indexOf('data-edit-order') < 0, 'worker НЕ видит ✎ на completed');

// --- Этап 31: ✎ открывает модалку редактирования и сохраняет правки ---
function clickOn(attr, value) {
  const node = {
    value: value === undefined || value === null ? '' : String(value),
    getAttribute: function (n) { return n === attr ? String(value) : null; },
    closest: function (selector) { return selector === '[' + attr + ']' ? node : null; }
  };
  clickHandlers.forEach(function (fn) { fn({ target: node }); });
}

modalStub.innerHTML = '';
clickOn('data-edit-order', myOrder.id);
assert(modalStub.innerHTML.indexOf('Редактировать заявку') >= 0,
  'Э31: ✎ открыла модалку редактирования');
assert(modalStub.innerHTML.indexOf('eo-client') >= 0, 'Э31: модалка — поле клиента');
assert(modalStub.innerHTML.indexOf('eo-date') >= 0, 'Э31: модалка — поле даты');
assert(modalStub.innerHTML.indexOf('value="' + escapeHtml(myOrder.client) + '"') >= 0,
  'Э31: модалка предзаполнена текущим клиентом');
assert(modalStub.innerHTML.indexOf('onclick') < 0, 'Э31: инлайн-обработчиков нет');

FIELDS['eo-client'] = { value: 'Новый Клиент Э31' };
FIELDS['eo-phone'] = { value: '+79990009900' };
FIELDS['eo-address'] = { value: 'Строителей, 7' };
FIELDS['eo-date'] = { value: '2027-03-01' };
FIELDS['eo-t1'] = { value: '13:00' };
FIELDS['eo-t2'] = { value: '16:00' };
const clientBefore = myOrder.client;
clickOn('data-save-edit-order', myOrder.id);
assert.eq(myOrder.client, 'Новый Клиент Э31', 'Э31: клиент обновлён');
assert.eq(myOrder.phone, '+79990009900', 'Э31: телефон обновлён');
assert.eq(myOrder.date, '2027-03-01', 'Э31: дата обновлена');
assert.eq(myOrder.t1, '13:00', 'Э31: время с обновлено');
assert(myOrder.history.some(function (h) { return h.action === 'edit'; }),
  'Э31: правка записана в историю');
assert.eq(modalStub.innerHTML, '', 'Э31: модалка закрыта после сохранения');
assert(clientBefore !== myOrder.client, 'Э31: значение реально изменилось');

// Пустой клиент — сохранение отклонено, данные не испорчены.
FIELDS['eo-client'] = { value: '' };
clickOn('data-save-edit-order', myOrder.id);
assert.eq(myOrder.client, 'Новый Клиент Э31', 'Э31: пустой клиент — не перезаписал');

// --- вкладка «Смета»
ORD_TAB = 'estimate';
const estHtml = renderOrderCard(myOrder.id);
assert(estHtml.indexOf('Итого') >= 0, 'смета: итог');
assert(estHtml.indexOf(money(calculateOrderTotal(myOrder))) >= 0,
  'смета: итог совпадает с calculateOrderTotal');
const estDone = renderOrderCard(doneOrder.id);
assert(estDone.indexOf('est-row done') >= 0, 'смета: skipped-работа зачёркнута');
ORD_TAB = 'main';

// --- журнал
ORD_TAB = 'journal';
const journalHtml = renderOrderCard(myOrder.id);
assert(journalHtml.indexOf('Мок-заявка') >= 0 || journalHtml.indexOf('создана') >= 0 ||
  journalHtml.indexOf('Статус') >= 0, 'журнал показывает историю');
ORD_TAB = 'main';

// --- модалка создания
renderCreateOrderModal();
assert(modalStub.innerHTML.indexOf('Новая заявка') >= 0, 'модалка открылась (шапка)');
assert(modalStub.innerHTML.indexOf('nc-client') >= 0 &&
  modalStub.innerHTML.indexOf('nc-t2') >= 0, 'модалка: поля клиента и времени');
assert(modalStub.innerHTML.indexOf('data-save-order') >= 0, 'модалка: кнопка «Создать»');
closeModal();
assert.eq(modalStub.innerHTML, '', 'closeModal очищает оверлей');

// --- go('order', id): роутер передаёт id в карточку
appStub.innerHTML = '';
go('order', myOrder.id);
assert.eq(state.screen, 'order', 'go(order) ставит экран order');
assert.eq(state.orderId, myOrder.id, 'go(order, id) сохраняет id');
assert(appStub.innerHTML.indexOf('Заявка №' + myOrder.id) >= 0,
  'render() вывел карточку через S.order');

// --- заявка не найдена
const nf = renderOrderCard(99999);
assert(nf.indexOf('не найдена') >= 0, 'карточка: «Заявка не найдена»');
