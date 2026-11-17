/* Смоук Этапа 28: свёрнутый обзор карточки заявки (renderOrderListItemCollapsed)
   с разворачиванием (renderOrderListItemExpanded). Свёрнутая карточка — краткий
   обзор (клиент, дата/время, статус, исполнитель, бейджи); клик разворачивает
   (телефон, адрес, кнопки «Свернуть»/«Открыть»). Делегаты data-expand-order /
   data-collapse-order / data-open-order. */
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
var clickHandlers = [];

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
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

// Эмуляция клика: target.closest совпадает только с запрашиваемым атрибутом.
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

function baseOrder(over) {
  return Object.assign({
    id: 1, client: 'Иванова А.', phone: '+79001234567',
    city: 'Екатеринбург', address: 'Ленина, 1',
    status: 'new', worker: 'Борис', helpers: [], confirm: {}, tags: [],
    date: '2026-11-20', t1: '09:00', t2: '12:00',
    works: [], extras: [], materials: [], payments: [], history: [],
    createdAt: Date.now()
  }, over || {});
}

// --- 1. По умолчанию карточка свёрнута (есть data-expand-order) ---

var o1 = baseOrder({ id: 101 });
var collapsed = renderOrderListItem(o1);
assert(collapsed.indexOf('data-expand-order="101"') >= 0,
  '1: свёрнутая карточка имеет data-expand-order');
assert(collapsed.indexOf('order-card-collapsed') >= 0, '1: класс order-card-collapsed');
assert(collapsed.indexOf('data-collapse-order') < 0,
  '1: свёрнутая НЕ имеет data-collapse-order');
assert(collapsed.indexOf('data-open-order') < 0,
  '1: свёрнутая НЕ имеет data-open-order');
// data-order сохраняется (регрессия переходов/счётчиков).
assert(collapsed.indexOf('data-order="101"') >= 0, '1: свёрнутая сохранила data-order');

// --- 2. Свёрнутая содержит краткий обзор ---

assert(collapsed.indexOf('Иванова') >= 0, '2: свёрнутая — клиент');
assert(collapsed.indexOf('101') >= 0, '2: свёрнутая — номер заявки');
assert(collapsed.indexOf('2026-11-20') >= 0, '2: свёрнутая — дата');
assert(collapsed.indexOf('09:00') >= 0 && collapsed.indexOf('12:00') >= 0,
  '2: свёрнутая — время t1/t2');
assert(collapsed.indexOf('Борис') >= 0, '2: свёрнутая — исполнитель');
// Статус present (метка статуса new = «Новая»).
assert(collapsed.indexOf('Новая') >= 0, '2: свёрнутая — метка статуса');
assert(collapsed.indexOf('badge') >= 0, '2: свёрнутая — класс статуса');

// --- 3. Свёрнутая НЕ содержит телефон/адрес/кнопки развёрнутого вида ---

assert(collapsed.indexOf('tel:') < 0, '3: свёрнутая без телефона-ссылки');
assert(collapsed.indexOf('+79001234567') < 0, '3: свёрнутая без номера телефона');
assert(collapsed.indexOf('Ленина') < 0, '3: свёрнутая без адреса');
assert(collapsed.indexOf('Свернуть') < 0, '3: свёрнутая без кнопки «Свернуть»');
assert(collapsed.indexOf('Открыть') < 0, '3: свёрнутая без кнопки «Открыть»');

// --- 4. EXPANDED → развёрнутый вид (collapse/open присутствуют) ---

EXPANDED_ORDERS[101] = true;
var expanded = renderOrderListItem(o1);
assert(expanded.indexOf('data-collapse-order="101"') >= 0,
  '4: развёрнутая имеет data-collapse-order');
assert(expanded.indexOf('data-open-order="101"') >= 0,
  '4: развёрнутая имеет data-open-order');
assert(expanded.indexOf('order-card-expanded') >= 0, '4: класс order-card-expanded');
assert(expanded.indexOf('data-expand-order') < 0,
  '4: развёрнутая НЕ имеет data-expand-order');

// --- 5. Развёрнутая содержит телефон, адрес, кнопки ---

assert(expanded.indexOf('tel:+79001234567') >= 0, '5: развёрнутая — телефон ссылкой tel:');
assert(expanded.indexOf('Ленина') >= 0, '5: развёрнутая — адрес');
assert(expanded.indexOf('Свернуть') >= 0, '5: развёрнутая — кнопка «Свернуть»');
assert(expanded.indexOf('Открыть') >= 0, '5: развёрнутая — кнопка «Открыть»');
assert(expanded.indexOf('Борис') >= 0, '5: развёрнутая — исполнитель');
assert(expanded.indexOf('Иванова') >= 0, '5: развёрнутая — клиент');

// --- 6. Клик data-expand-order → EXPANDED[id]=true + render() ---

delete EXPANDED_ORDERS[101];
DB.orders = [baseOrder({ id: 202 })];
go('orders');
appStub.innerHTML = '';
clickOn('data-expand-order', 202);
assert.eq(EXPANDED_ORDERS[202], true, '6: клик развернул карточку 202');
assert(appStub.innerHTML.indexOf('data-collapse-order="202"') >= 0,
  '6: render() перерисовал в развёрнутый вид');

// --- 7. Клик data-collapse-order → EXPANDED[id] удалён + render() ---

clickOn('data-collapse-order', 202);
assert(EXPANDED_ORDERS[202] === undefined, '7: клик свернул карточку 202');
assert(appStub.innerHTML.indexOf('data-expand-order="202"') >= 0,
  '7: render() перерисовал в свёрнутый вид');

// --- 8. Клик data-open-order → go('order', id) ---

EXPANDED_ORDERS[202] = true;
clickOn('data-open-order', 202);
assert.eq(state.screen, 'order', '8: клик «Открыть» → экран order');
assert.eq(state.orderId, 202, '8: клик «Открыть» → state.orderId = id');

// --- 9. Регрессия: без firebase карточка рендерится, бейджи на месте ---

delete globalThis.firebase;
var oTagged = baseOrder({
  id: 303, tags: ['Фурнитура'], history: [
    { ts: 5, action: 'call_result', details: '🔄 Перезвонить позже — перезвон через 24 ч.' }
  ]
});
var regCollapsed = renderOrderListItem(oTagged);
assert(regCollapsed.indexOf('data-expand-order="303"') >= 0,
  '9: без firebase свёрнутая рендерится');
assert(regCollapsed.indexOf('Фурнитура') >= 0, '9: без firebase тег виден');
assert(regCollapsed.indexOf('Перезвонить позже') >= 0, '9: без firebase итог звонка виден');

EXPANDED_ORDERS[303] = true;
var regExpanded = renderOrderListItem(oTagged);
assert(regExpanded.indexOf('data-open-order="303"') >= 0,
  '9: без firebase развёрнутая рендерится');
assert(regExpanded.indexOf('Фурнитура') >= 0, '9: без firebase бейдж в развёрнутой');

// --- 10. Разные заявки разворачиваются независимо ---

delete EXPANDED_ORDERS[303];
DB.orders = [baseOrder({ id: 401 }), baseOrder({ id: 402 })];
EXPANDED_ORDERS[401] = true;
var e401 = renderOrderListItem(DB.orders[0]);
var e402 = renderOrderListItem(DB.orders[1]);
assert(e401.indexOf('data-collapse-order="401"') >= 0, '10: 401 развёрнута');
assert(e402.indexOf('data-expand-order="402"') >= 0, '10: 402 осталась свёрнута');
