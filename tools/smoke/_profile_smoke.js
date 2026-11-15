/* Смоук app/ui-profile.js (Этап 20): профиль пользователя, PIN, график работы,
   уведомления, выход. */
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
// Мок Notification: permission='prompt' → в профиле видна кнопка включения.
globalThis.Notification = function () {};
globalThis.Notification.permission = 'prompt';
globalThis.Notification.requestPermission = function (cb) {
  globalThis.Notification.permission = 'granted';
  if (cb) cb('granted');
};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-profile.js');

setOwnerFlag(false);
// currentUserRecord ищет запись по имени — сидим пользователя с телефоном.
DB.users = [{ id: 'dev-owner', name: 'Владелец', role: 'admin', phone: '+7 900 000-00-00' }];
login('admin', 'Владелец');

// --- 1. renderProfile ---
var html = renderProfile();
assert(html.indexOf('👤 Профиль') >= 0, 'profile: заголовок');
assert(html.indexOf('Владелец') >= 0, 'profile: имя');
assert(html.indexOf('Админ') >= 0, 'profile: роль');
assert(html.indexOf('PIN') >= 0, 'profile: PIN-блок');
assert(html.indexOf('Сменить PIN') >= 0, 'profile: кнопка смены PIN');
assert(html.indexOf('График работы') >= 0, 'profile: график');
assert(html.indexOf('✎ Редактировать') >= 0, 'profile: кнопка редактирования графика');
assert(html.indexOf('Выйти') >= 0, 'profile: кнопка выхода');
assert(html.indexOf('data-logout') >= 0, 'profile: data-logout');
assert(html.indexOf('data-change-pin') >= 0, 'profile: data-change-pin');
assert(html.indexOf('data-edit-schedule') >= 0, 'profile: data-edit-schedule');
assert(html.indexOf('data-profile-notify') >= 0, 'profile: data-profile-notify');

// --- 2. PIN ---
// Чистый PIN перед тестами
lsSet('crm2_pin', '');

assert.eq(pinStatusText(), '— PIN не установлен —', 'pinStatus: не установлен');

// Установка PIN
var pinRes = savePinLocal('1234');
assert.eq(pinRes, true, 'savePin: возврат true');
assert.eq(checkPin('1234'), true, 'checkPin: верный PIN');
assert.eq(checkPin('0000'), false, 'checkPin: неверный PIN');
assert.eq(pinStatusText(), '✅ PIN установлен', 'pinStatus: установлен');

// Проверка: wrong PIN
assert.eq(savePinLocal('12'), false, 'savePin: короткий → false');
assert.eq(savePinLocal('123456789'), false, 'savePin: длинный → false');
assert.eq(savePinLocal('abcd'), false, 'savePin: буквы → false');

// Снятие PIN (пустые поля)
savePinLocal('');
assert.eq(lsGet('crm2_pin', ''), '', 'savePin(пусто): PIN снят');
assert.eq(pinStatusText(), '— PIN не установлен —', 'pinStatus: снят');

// --- 3. renderPinModal ---
renderPinModal();
assert(modalStub.innerHTML.indexOf('Смена PIN') >= 0, 'pinModal: заголовок');
assert(modalStub.innerHTML.indexOf('pin-new') >= 0, 'pinModal: pin-new');
assert(modalStub.innerHTML.indexOf('pin-confirm') >= 0, 'pinModal: pin-confirm');
assert(modalStub.innerHTML.indexOf('data-save-pin') >= 0, 'pinModal: data-save-pin');

// --- 4. Schedule ---
var def = defaultSchedule();
assert('Mon' in def, 'defaultSchedule: Mon');
assert('Sun' in def, 'defaultSchedule: Sun');
assert.eq(def.Mon.from, '09:00', 'defaultSchedule: Mon.from');
assert.eq(def.Mon.to, '18:00', 'defaultSchedule: Mon.to');
assert.eq(def.Sun.off, true, 'defaultSchedule: Sun.off');
assert.eq(def.Sat.off, false, 'defaultSchedule: Sat.off');

var s = schedule();
assert('Mon' in s, 'schedule: Mon');
assert('Sun' in s, 'schedule: Sun');
assert.eq(s.Mon.from, '09:00', 'schedule: Mon.from');
assert.eq(s.Sun.off, true, 'schedule: Sun.off');

// --- 5. renderScheduleBlock ---
var schHtml = renderScheduleBlock();
assert(schHtml.indexOf('График работы') >= 0, 'scheduleBlock: заголовок');
assert(schHtml.indexOf('Пн') >= 0, 'scheduleBlock: Пн');
assert(schHtml.indexOf('Вс') >= 0, 'scheduleBlock: Вс');
assert(schHtml.indexOf('выходной') >= 0, 'scheduleBlock: выходной (Sun)');
assert(schHtml.indexOf('data-edit-schedule') >= 0, 'scheduleBlock: кнопка редактирования');

// --- 6. renderScheduleModal ---
renderScheduleModal();
assert(modalStub.innerHTML.indexOf('График работы') >= 0, 'scheduleModal: заголовок');
assert(modalStub.innerHTML.indexOf('sch-Mon-from') >= 0, 'scheduleModal: Mon-from');
assert(modalStub.innerHTML.indexOf('sch-Mon-to') >= 0, 'scheduleModal: Mon-to');
assert(modalStub.innerHTML.indexOf('sch-Mon-off') >= 0, 'scheduleModal: Mon-off');
assert(modalStub.innerHTML.indexOf('sch-Sun-off') >= 0, 'scheduleModal: Sun-off');
assert(modalStub.innerHTML.indexOf('data-save-schedule') >= 0, 'scheduleModal: data-save-schedule');

// --- 7. saveSchedule ---
var customSchedule = {
  Mon: { from: '08:00', to: '17:00', off: false },
  Tue: { from: '09:00', to: '18:00', off: false },
  Wed: { from: '09:00', to: '18:00', off: false },
  Thu: { from: '09:00', to: '18:00', off: false },
  Fri: { from: '09:00', to: '18:00', off: false },
  Sat: { from: '10:00', to: '14:00', off: false },
  Sun: { from: '09:00', to: '18:00', off: true }
};
var saved = saveSchedule(customSchedule);
assert.eq(saved.Mon.from, '08:00', 'saveSchedule: Mon.from');
assert.eq(saved.Sun.off, true, 'saveSchedule: Sun.off');
assert.eq(schedule().Mon.from, '08:00', 'schedule(): обновлён из DB');

// --- 8. currentUserRecord ---
var rec = currentUserRecord();
assert(rec, 'currentUserRecord: найден');
assert.eq(rec.name, 'Владелец', 'currentUserRecord: имя совпадает');
assert.eq(rec.role, 'admin', 'currentUserRecord: роль');

// --- 9. notifyStatusText ---
var ns = notifyStatusText();
assert(typeof ns === 'string', 'notifyStatusText: строка');
assert(ns.length > 0, 'notifyStatusText: не пустая');

// --- 10. WEEK_DAYS ---
assert.eq(WEEK_DAYS.length, 7, 'WEEK_DAYS: 7 дней');
assert.eq(WEEK_DAYS[0][0], 'Mon', 'WEEK_DAYS: Mon');
assert.eq(WEEK_DAYS[0][1], 'Пн', 'WEEK_DAYS: Пн');
assert.eq(WEEK_DAYS[6][0], 'Sun', 'WEEK_DAYS: Sun');
assert.eq(WEEK_DAYS[6][1], 'Вс', 'WEEK_DAYS: Вс');

// --- 11. typeof-регрессии ---
assert(typeof renderProfile === 'function', 'typeof renderProfile');
assert(typeof renderPinModal === 'function', 'typeof renderPinModal');
assert(typeof renderScheduleBlock === 'function', 'typeof renderScheduleBlock');
assert(typeof renderScheduleModal === 'function', 'typeof renderScheduleModal');
assert(typeof saveSchedule === 'function', 'typeof saveSchedule');
assert(typeof schedule === 'function', 'typeof schedule');
assert(typeof defaultSchedule === 'function', 'typeof defaultSchedule');
assert(typeof pinStatusText === 'function', 'typeof pinStatusText');
assert(typeof notifyStatusText === 'function', 'typeof notifyStatusText');
