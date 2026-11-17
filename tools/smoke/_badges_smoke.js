/* Смоук Этапа 27: бейджи итогов звонка/тегов на заявках (renderOrderBadges,
   callResultBadgeVariant) + счётчики событий в навигации (navBadge(key),
   метки «просмотрено» в go(), рендер nav-badge в renderNav). */
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
loadModule('app/ui-attention.js'); // attentionGroups, CALL_BRANCHES

setOwnerFlag(false);
login('admin', 'Владелец');

function baseOrder(over) {
  var o = Object.assign({
    id: 1, client: 'Клиент', status: 'new', worker: null, helpers: [],
    confirm: {}, tags: [], date: localToday(), t1: '09:00', t2: '12:00',
    works: [], extras: [], materials: [], history: [], createdAt: Date.now()
  }, over || {});
  return o;
}

// --- 1. renderOrderBadges: пусто → '' ---

assert.eq(renderOrderBadges(baseOrder({ history: [], tags: [] })), '',
  '1: без истории и тегов → пустая строка');
assert.eq(renderOrderBadges(null), '', '1: null → пустая строка');

// --- 2. Теги → жёлтые чипы ---

var htmlTags = renderOrderBadges(baseOrder({ tags: ['Стекло'] }));
assert(htmlTags.indexOf('Стекло') >= 0, '2: тег отображён');
assert(htmlTags.indexOf('badge') >= 0, '2: класс badge');
assert(htmlTags.indexOf('var(--accent-soft)') >= 0, '2: фон accent-soft');
// Экранирование тега (XSS-регрессия).
assert(renderOrderBadges(baseOrder({ tags: ['<b>x</b>'] })).indexOf('&lt;b&gt;') >= 0,
  '2: тег экранирован');

// --- 3. Итог звонка → бейдж 📞 ---

var oCall = baseOrder({ history: [
  { ts: 1, action: 'create', details: 'создана' },
  { ts: 2, action: 'call_result', details: '📞 Не дозвонился — перезвон через 2 ч.' }
] });
var htmlCall = renderOrderBadges(oCall);
assert(htmlCall.indexOf('📞') >= 0, '3: есть бейдж звонка');
assert(htmlCall.indexOf('Не дозвонился') >= 0, '3: текст итога (эмодзи-префикс срезан)');
assert(htmlCall.indexOf('var(--warn)') >= 0, '3: «не дозвонился» → warn');
// Берётся ПОСЛЕДНИЙ call_result.
var oTwo = baseOrder({ history: [
  { ts: 1, action: 'call_result', details: '❌ Отказ' },
  { ts: 2, action: 'call_result', details: '✅ Согласована смета' }
] });
var htmlTwo = renderOrderBadges(oTwo);
assert(htmlTwo.indexOf('Согласована смета') >= 0, '3: взят последний call_result');
assert(htmlTwo.indexOf('Отказ') === -1, '3: старый итог не показан');

// --- 4. «Отказ» → danger ---

var htmlDenied = renderOrderBadges(baseOrder({
  history: [{ ts: 1, action: 'call_result', details: '❌ Отказ' }]
}));
assert(htmlDenied.indexOf('var(--danger)') >= 0, '4: отказ → danger');

// --- 5. callResultBadgeVariant: таблица цветов ---

assert.eq(callResultBadgeVariant('📞 Не дозвонился'), 'var(--warn)', '5: не дозвонился → warn');
assert.eq(callResultBadgeVariant('🔄 Перезвонить позже'), 'var(--warn)', '5: перезвонить → warn');
assert.eq(callResultBadgeVariant('📞 Не дозвонился — перезвон через 2 ч.'), 'var(--warn)',
  '5: ветка с перезвоном → warn');
assert.eq(callResultBadgeVariant('❌ Отказ'), 'var(--danger)', '5: отказ → danger');
assert.eq(callResultBadgeVariant('✅ Согласована смета'), 'var(--accent)', '5: согласие → accent');
assert.eq(callResultBadgeVariant(''), 'var(--accent)', '5: пусто → accent (дефолт)');
assert.eq(callResultBadgeVariant(null), 'var(--accent)', '5: null → accent');

// --- 6. Бейджи в списке заявок ---

DB.orders = [baseOrder({ id: 10, tags: ['Фурнитура'], history: [
  { ts: 5, action: 'call_result', details: '🔄 Перезвонить позже — перезвон через 24 ч.' }
] })];
var listHtml = renderOrderListItem(DB.orders[0]);
assert(listHtml.indexOf('Фурнитура') >= 0, '6: список — тег виден');
assert(listHtml.indexOf('Перезвонить позже') >= 0, '6: список — итог звонка виден');
assert(listHtml.indexOf('data-order="10"') >= 0, '6: список — карточка кликабельна (регрессия)');

// --- 7. Бейджи на карточке (вкладка «Основное») ---

var mainHtml = renderOrderTabMain(DB.orders[0]);
assert(mainHtml.indexOf('Фурнитура') >= 0, '7: карточка — тег виден');
assert(mainHtml.indexOf('Перезвонить позже') >= 0, '7: карточка — итог звонка виден');

// --- 8. navBadge('orders'): пустой пул → 0 ---

DB.orders = [];
lsSet('crm2_seen_pool', '0');
assert.eq(navBadge('orders'), 0, '8: пустой пул → 0');

// --- 9. Новая пул-заявка → 1; занятая/закрытая не считается ---

DB.orders = [
  baseOrder({ id: 20, worker: null, status: 'new', createdAt: Date.now() }),
  baseOrder({ id: 21, worker: 'Борис', status: 'new', createdAt: Date.now() }),
  baseOrder({ id: 22, worker: null, status: 'paid', createdAt: Date.now() }),
  baseOrder({ id: 23, worker: null, status: 'new', createdAt: 1000 }) // старая
];
lsSet('crm2_seen_pool', String(Date.now() - 5000));
assert.eq(navBadge('orders'), 1, '9: одна свежая пул-заявка → 1');

// --- 10. go('orders') гасит счётчик ---

go('orders');
assert.eq(navBadge('orders'), 0, '10: после входа на экран → 0');
// Просроченная «старая» заявка не всплывает снова.
assert.eq(navBadge('orders'), 0, '10: повторный вызов остаётся 0');

// --- 11. navBadge('overdue'): пустые группы → 0 ---

DB.orders = [baseOrder({
  id: 30, worker: 'Борис', status: 'paid', date: localToday(),
  history: [], tags: []
})];
assert.eq(navBadge('overdue'), 0, '11: нет событий → 0');

// --- 12. Непустые группы + свежая история → >0 ---

DB.orders = [{
  id: 31, client: 'Просрочка', status: 'new', worker: 'Борис', helpers: [],
  confirm: {}, tags: [], date: dateShift(localToday(), -3), t1: '', t2: '',
  works: [], extras: [], materials: [], payments: [],
  history: [{ ts: Date.now(), action: 'status', to: 'new' }],
  createdAt: Date.now()
}];
lsSet('crm2_seen_attention', '0');
assert(navBadge('overdue') > 0, '12: свежая история в «внимательной» заявке → >0');

// --- 13. go('overdue') гасит счётчик ---

go('overdue');
assert.eq(navBadge('overdue'), 0, '13: после входа на экран → 0');

// --- 14. Прочие ключи → 0 ---

['admin', 'calendar', 'clients', 'shopping', 'reports', 'tasks', 'profile', 'no-such'].forEach(function (k) {
  assert.eq(navBadge(k), 0, '14: navBadge(' + k + ') → 0');
});
// До входа — всегда 0.
var savedRole = state.role;
state.role = null;
assert.eq(navBadge('orders'), 0, '14: без роли → 0');
state.role = savedRole;

// --- 15. Регрессия без firebase (локальный режим) ---

// navBadge/renderOrderBadges не используют firebase — проверяем явно.
var savedFb = globalThis.firebase;
delete globalThis.firebase;
assert.eq(typeof globalThis.firebase, 'undefined', '15: firebase удалён из контекста');
assert(navBadge('orders') >= 0, '15: navBadge без firebase не падает');
assert(renderOrderBadges(baseOrder({ tags: ['Тег'] })).indexOf('Тег') >= 0,
  '15: renderOrderBadges без firebase не падает');
if (savedFb) globalThis.firebase = savedFb;

// --- 16. renderNav(): nav-badge появляется/исчезает ---

DB.orders = [baseOrder({ id: 40, worker: null, status: 'new', createdAt: Date.now() })];
lsSet('crm2_seen_pool', '0');
state.screen = 'calendar';
renderNav();
assert(navStub.innerHTML.indexOf('nav-badge') >= 0, '16: свежая пул-заявка → badge в навигации');
assert(navStub.innerHTML.indexOf('nav-badge">1<') >= 0, '16: значение счётчика 1');

go('orders');
renderNav();
assert(navStub.innerHTML.indexOf('nav-badge') === -1, '16: после просмотра — badge убран');

// Бейдж не мешает активной подсветке (регрессия).
assert(navStub.innerHTML.indexOf('nav-btn active') >= 0, '16: active-пункт на месте');

// --- 17. applyCallResult интегрирован: реальный итог даёт бейдж ---

DB.orders = [baseOrder({ id: 50, status: 'new', worker: 'Борис' })];
var o50 = DB.orders[0];
var res17 = applyCallResult(o50, 'no_answer');
assert(res17.ok === true, '17: applyCallResult(no_answer) ok');
var html17 = renderOrderBadges(o50);
assert(html17.indexOf('📞') >= 0, '17: после звонка есть бейдж');
assert(html17.indexOf('var(--warn)') >= 0, '17: «не дозвонился» → warn');

res17 = applyCallResult(o50, 'approved');
assert(res17.ok === true, '17: applyCallResult(approved) ok');
html17 = renderOrderBadges(o50);
assert(html17.indexOf('Согласована смета') >= 0, '17: бейдж переехал на последний итог');
assert(html17.indexOf('var(--accent)') >= 0, '17: согласие → accent');

// --- 18. Экспорты/typeof ---

['renderOrderBadges', 'callResultBadgeVariant', 'stripLeadingEmoji',
 'navBadge', 'renderNav', 'attentionGroups'].forEach(function (n) {
  assert(typeof globalThis[n] === 'function', 'typeof ' + n);
});
