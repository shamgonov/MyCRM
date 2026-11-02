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
assert.eq(NAVS_BASE.admin.length, 7, 'admin: 7 пунктов меню');
assert.eq(NAVS_BASE.operator.length, 5, 'operator: 5 пунктов');
assert.eq(NAVS_BASE.manager.length, 5, 'manager: 5 пунктов');
assert.eq(NAVS_BASE.worker.length, 3, 'worker: 3 пункта');
assert.eq(NAVS_BASE.admin[0][0], 'orders', 'admin первый пункт — orders');
assert.eq(NAVS_BASE.admin[6][0], 'admin', 'admin последний пункт — админ');
assert.eq(NAVS_BASE.operator[3][0], 'create', 'operator имеет «Новая»');
assert.eq(NAVS_BASE.worker[0][0], 'tasks', 'worker первый пункт — поиск заказов');
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
assert(appEl.innerHTML.indexOf('Список заявок') >= 0, 'render(orders) — заглушка списка');
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