/* Смоук app/core.js (Этап 1): go()/render(), NAVS_BASE, buildNav, pushNav/goBack. */
'use strict';

// DOM-стаб: document с getElementById-стабом и addEventListener-стабом.
globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
globalThis.document = {
  getElementById: function () { return null; },
  addEventListener: function () {}
};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');     // renderOrdersList требует canViewOrder
loadModule('app/orders.js');    // STATUS_TRANSITIONS для таба статуса
loadModule('app/ui-orders.js'); // экраны orders/order (Этап 4)

// --- state: стартовый контракт
assert.eq(state.screen, 'login', 'state.screen стартует с login');
assert(state.role === null && state.user === null, 'state.role/user стартуют null');
assert.eq(state.filter, 'all', 'state.filter = all');
assert(state.calDate === localToday(), 'state.calDate = localToday()');
assert(state.simOn === false, 'state.simOn = false');
assert(Array.isArray(state.navHistory) && state.navHistory.length === 0,
  'state.navHistory пуста');

// --- NAVS_BASE: структура и состав
assert.eq(Object.keys(NAVS_BASE).length, 4, 'NAVS_BASE: 4 роли');
// Этап 25.1: органайзер доступен всем ролям (был только у worker).
assert.eq(NAVS_BASE.admin.length, 8, 'admin: 8 пунктов меню');
assert.eq(NAVS_BASE.operator.length, 7, 'operator: 7 пунктов');
assert.eq(NAVS_BASE.manager.length, 6, 'manager: 6 пунктов');
assert.eq(NAVS_BASE.worker.length, 3, 'worker: 3 пункта');
assert.eq(NAVS_BASE.admin[0][0], 'orders', 'admin первый пункт — orders');
assert.eq(NAVS_BASE.admin[7][0], 'admin', 'admin последний пункт — admin');
assert.eq(NAVS_BASE.operator[1][0], 'clients', 'operator имеет «Контрагенты» (Этап 16)');
assert.eq(NAVS_BASE.operator[4][0], 'create', 'operator имеет «Новая»');
assert.eq(NAVS_BASE.worker[0][0], 'tasks', 'worker первый пункт — поиск заказов');
['admin', 'operator', 'manager'].forEach(function (r) {
  assert(NAVS_BASE[r].some(function (i) { return i[0] === 'tasks'; }),
    r + ': пункт «Органайзер» добавлен (Этап 25.1)');
});
NAVS_BASE.worker.forEach(function (it) {
  assert(Array.isArray(it) && it.length === 3, 'пункт меню — [key, ico, label]');
});

// --- buildNav: профиль добавляется по праву
setOwnerFlag(false);
DB.users = [];
assert.eq(buildNav('worker').length, 3, 'buildNav(worker) без профиля: 3 пункта');
assert(buildNav('worker').some(function (i) { return i[0] === 'profile'; }) === false,
  'worker без права profile_view — без профиля');
setOwnerFlag(true);
assert.eq(buildNav('worker').length, 4, 'buildNav с правом: +Профиль');
assert(buildNav('worker').some(function (i) { return i[0] === 'profile'; }) === true,
  'buildNav добавляет profile');
setOwnerFlag(false);

// --- go(): смена экрана и orderId
go('orders', 101);
assert.eq(state.screen, 'orders', 'go(orders) меняет экран');
assert.eq(state.orderId, 101, 'go(orders, 101) сохраняет orderId');
go('calendar');
assert.eq(state.screen, 'calendar', 'go(calendar) меняет экран');
assert.eq(state.orderId, 101, 'orderId сохраняется без явного id');

// go() на несуществующий экран: state не меняется, история не растёт
assert.eq(state.navHistory.length, 2, 'два успешных go() = две записи истории');
go('no-such-screen');
assert.eq(state.screen, 'calendar', 'go(неизвестный) отклоняется с toast');
assert.eq(state.navHistory.length, 2, 'go(неизвестный) не добавляет в историю');

// --- pushNav/goBack
go('orders');
assert.eq(state.navHistory[state.navHistory.length - 1].screen, 'calendar',
  'pushNav пишет предыдущий экран');
goBack();
assert.eq(state.screen, 'calendar', 'goBack возвращает на calendar');
goBack();
assert.eq(state.screen, 'orders', 'goBack возвращает на orders');

// --- render(): контракт «до входа» и «после входа»
const appEl = { innerHTML: '' };
const navEl = { innerHTML: '' };
globalThis.document.getElementById = function (id) {
  if (id === 'app') return appEl;
  if (id === 'nav') return navEl;
  return null;
};

state.role = null;
state.screen = 'login';
render();
assert(appEl.innerHTML.indexOf('CRM2') >= 0, 'render(login) выводит экран входа');
assert.eq(navEl.innerHTML, '', 'до входа навигация пуста (контракт)');

login('admin', 'Владелец');
render();
assert(appEl.innerHTML.indexOf('📋 Заявки') >= 0, 'render(orders) выводит список заявок (Этап 4)');
assert(navEl.innerHTML.length > 0, 'после входа nav заполнен');
assert(navEl.innerHTML.indexOf('Профиль') >= 0, 'admin-навигация содержит Профиль');
assert(navEl.innerHTML.indexOf('active') >= 0, 'активный пункт подсвечен');

// renderNavActive() перерисовывает навигацию
navEl.innerHTML = '';
renderNavActive();
assert(navEl.innerHTML.length > 0, 'renderNavActive() заполнил #nav');

// --- Карта S: все экраны-заглушки на месте
['login', 'orders', 'clients', 'overdue', 'calendar', 'shopping', 'reports',
 'admin', 'tasks', 'create', 'profile'].forEach(function (k) {
  assert(typeof S[k] === 'function', 'S.' + k + ' — функция');
});

// --- Тестовый экран входа: имя + роль, без Phone Auth (реgression-контракт)
logout();                                  // чистим и state, и сессию
state.role = null;
state.screen = 'login';
render();
const loginHtml = appEl.innerHTML;
assert(loginHtml.indexOf('Тестовый режим') >= 0, 'вход: заголовок «CRM2 — Тестовый режим»');
assert(loginHtml.indexOf('login-name') >= 0, 'вход: поле id="login-name"');
assert(loginHtml.indexOf('Например: Дмитрий') >= 0, 'вход: placeholder имени');
assert(loginHtml.indexOf('login-role') >= 0, 'вход: select id="login-role"');
assert(loginHtml.indexOf('data-test-login') >= 0, 'вход: кнопка data-test-login');
['admin', 'manager', 'operator', 'worker'].forEach(function (r) {
  assert(loginHtml.indexOf('value="' + r + '"') >= 0, 'вход: опция роли ' + r);
});
assert(loginHtml.indexOf('Владелец (все права)') >= 0, 'вход: подпись роли admin');
assert(loginHtml.indexOf('Anonymous Auth') >= 0, 'вход: подпись про Anonymous Auth');
// Phone Auth со screens убран (auth/operation-not-allowed в РФ).
assert(loginHtml.indexOf('login-phone') < 0, 'вход: поле телефона больше нет');
assert(loginHtml.indexOf('login-code') < 0, 'вход: поле SMS-кода больше нет');
assert(loginHtml.indexOf('recaptcha-container') < 0, 'вход: #recaptcha-container убран');

// --- Мобильная навигация: скролл-обёртка и центрирование активного пункта
// Проверяем на заполненной навигации: рендерим под ролью admin.
login('admin', 'Владелец');
render();
assert(navEl.innerHTML.indexOf('nav-scroll') >= 0, 'nav: обёртка nav-scroll для горизонтального скролла');
assert(navEl.innerHTML.indexOf('nav-label') >= 0, 'nav: подписи обёрнуты в span.nav-label');
// data-nav совместим со старым делегатом (регрессия контракта).
assert(navEl.innerHTML.indexOf('data-nav="orders"') >= 0, 'nav: data-nav на месте');
const fakeScroll = { clientWidth: 360, scrollLeft: 0 };
const fakeBtn = { offsetLeft: 300, offsetWidth: 72 };
const fakeNav = { querySelector: function (s) {
  if (s === '.nav-scroll') return fakeScroll;
  if (s === '.nav-btn.active') return fakeBtn;
  return null;
} };
syncNavScroll(fakeNav);
assert.eq(fakeScroll.scrollLeft, 156, 'syncNavScroll: активный пункт по центру (300-(360-72)/2)');
fakeBtn.offsetLeft = 10;
syncNavScroll(fakeNav);
assert.eq(fakeScroll.scrollLeft, 0, 'syncNavScroll: scrollLeft не уходит в минус');
syncNavScroll(null);
syncNavScroll({});
assert(true, 'syncNavScroll: безопасен на стабах без querySelector');
logout();

// --- restoreTestSession(): сессия переживает перезагрузку страницы
assert.eq(lsGet('crm2_test_user', ''), '', 'logout: сессия crm2_test_user очищена');
state.role = null;
assert.eq(restoreTestSession(), false, 'restoreTestSession: пусто → false');
assert.eq(state.role, null, 'restoreTestSession: пусто → остаёмся на входе');
lsSet('crm2_test_user', JSON.stringify({ role: 'manager', name: 'Ольга' }));
assert.eq(restoreTestSession(), true, 'restoreTestSession: есть сессия → true');
assert.eq(state.role, 'manager', 'restoreTestSession: восстановлена роль');
assert.eq(state.user, 'Ольга', 'restoreTestSession: восстановлено имя');
assert.eq(state.screen, 'orders', 'restoreTestSession: экран по роли (manager→orders)');
lsSet('crm2_test_user', 'не-json');
state.role = null;
assert.eq(restoreTestSession(), false, 'restoreTestSession: битая запись → false без падения');
lsSet('crm2_test_user', '');

// --- Этап 25: чип статуса синхронизации в render() (после входа) ---
// sync.js в этом смоуке НЕ загружен → renderSyncStatus сам отдаёт 'local'.
loadModule('app/ui-sync.js');
login('admin', 'Владелец');
state.screen = 'orders';
render();
assert(appEl.innerHTML.indexOf('id="sync-status"') >= 0,
  'Этап 25: после входа чип синхронизации в #app');
logout();
state.role = null;
state.screen = 'login';
render();
assert(appEl.innerHTML.indexOf('id="sync-status"') === -1,
  'Этап 25: на экране входа чипа нет');