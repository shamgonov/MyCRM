/* Смоук app/auth.js (Этап 1): can() по ролям, deviceId стабилен, effectiveRole. */
'use strict';

// localStorage-стаб + чистый DB, затем db.js и auth.js в общем контексте.
globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
loadModule('app/db.js');
loadModule('app/auth.js');

// state — минимальный стаб (полный появится в core.js, ШАГ 3).
globalThis.state = {
  role: null, user: null, simOn: false, screen: 'login',
  orderId: null, filter: 'all', navHistory: []
};

// --- deviceId: генерация и стабильность
const id1 = deviceId();
assert(/^dev-\d+$/.test(id1), 'deviceId генерируется как dev-<timestamp>');
assert.eq(deviceId(), id1, 'deviceId стабилен между вызовами');
assert.eq(lsGet('crm2_device', null), id1, 'deviceId сохранён в localStorage');

// --- PERMS_CATALOG: 21 право из старой CRM
assert.eq(PERMS_CATALOG.length, 21, 'PERMS_CATALOG содержит 21 право');
const keys = PERMS_CATALOG.map(function (p) { return p.key; });
assert.eq(new Set(keys).size, 21, 'ключи прав уникальны');
assert(keys.indexOf('all') >= 0 && keys.indexOf('reports_view') >= 0 &&
  keys.indexOf('profile_view') >= 0, 'каталог содержит ключевые права');

// --- BUILTIN_ROLES
assert.eq(BUILTIN_ROLES.admin.length, 1, 'admin — одна запись');
assert.eq(BUILTIN_ROLES.admin[0], 'all', 'admin = [all]');
assert(BUILTIN_ROLES.operator.indexOf('order_create') >= 0, 'operator может создавать заявки');
assert(BUILTIN_ROLES.manager.indexOf('order_assign') >= 0, 'manager назначает исполнителей');
assert(BUILTIN_ROLES.worker.indexOf('order_view_all') < 0, 'worker НЕ видит все заявки');

// --- rolesOf
assert.eq(JSON.stringify(rolesOf({ roles: ['manager', 'worker'] })), '["manager","worker"]',
  'rolesOf берёт массив roles');
assert.eq(JSON.stringify(rolesOf({ role: 'worker' })), '["worker"]',
  'rolesOf оборачивает одиночную role');
assert.eq(JSON.stringify(rolesOf(null)), '[]', 'rolesOf(null) = []');

// --- unionPermsFor
assert(unionPermsFor(['operator']).indexOf('order_create') >= 0,
  'unionPermsFor: право из builtin-роли');
assert(unionPermsFor([]).length === 0, 'unionPermsFor([]) = []');
ROLES.custom = { perms: ['reports_view'] };
assert(unionPermsFor(['custom']).indexOf('reports_view') >= 0,
  'unionPermsFor читает кастомную роль из ROLES');

// --- can() для разных ролей
setOwnerFlag(false);
state.role = 'worker';
assert(!can('order_view_all'), 'worker: can(order_view_all) = false');
assert(can('shopping_buy'), 'worker: can(shopping_buy) = true');
assert(!can('all'), 'worker: can(all) = false');

state.role = 'admin';
assert(can('order_delete'), 'admin: can(order_delete) = true (all)');

state.role = 'manager';
assert(can('order_assign') && !can('settings_edit'), 'manager: assign да, settings нет');

// --- владелец устройства
setOwnerFlag(true);
assert(can('settings_edit'), 'owner-устройство: can() = true для любого права');
assert(isOwner() === true, 'isOwner() читает флаг');

// --- режим симуляции (simOn): права владельца гаснут
state.simOn = true;
assert(!can('settings_edit'), 'simOn: can() = false даже у owner-устройства');
assert(uiOwner() === false, 'simOn: uiOwner() = false');
state.simOn = false;
assert(uiOwner() === true, 'без simOn: uiOwner() = true');
setOwnerFlag(false);

// --- myPerms / adminLike / effectiveRole
DB.users = [{ id: deviceId(), name: 'Иван', role: 'worker', roles: ['manager', 'worker'] }];
state.role = 'worker';
assert(myPerms().indexOf('order_assign') >= 0, 'myPerms: объединение ролей из DB.users');
assert.eq(effectiveRole(), 'manager', 'effectiveRole: старшая из roles (manager)');
assert(adminLike() === false, 'обычный сотрудник не adminLike');

DB.users = [];
state.role = 'admin';
assert.eq(effectiveRole(), 'admin', 'effectiveRole: fallback на state.role');
assert(adminLike() === true, 'adminLike: state.role=admin');

// --- login/logout
login('worker', 'Фёдор');
assert.eq(state.role, 'worker', 'login задаёт роль');
assert.eq(state.user, 'Фёдор', 'login задаёт имя');
assert.eq(state.uid, null, 'login без uid → state.uid = null (мок-режим)');
assert.eq(state.screen, 'tasks', 'login worker → экран tasks');
login('operator', 'Мария');
assert.eq(state.screen, 'orders', 'login operator → экран orders');
logout();
assert.eq(state.role, null, 'logout сбрасывает роль');
assert.eq(state.user, null, 'logout сбрасывает имя');
assert.eq(state.screen, 'login', 'logout возвращает на экран входа');

// --- Тестовый режим: сессия crm2_test_user (переживает перезагрузку)
login('worker', 'Пётр');
assert.eq(lsGet('crm2_test_user', ''), JSON.stringify({ role: 'worker', name: 'Пётр' }),
  'login: сессия сохранена в crm2_test_user');
logout();
assert.eq(lsGet('crm2_test_user', ''), '', 'logout: сессия очищена');

// --- Этап 14-A: uid-ключ, userRecord, Phone Auth без SDK (мок-ветка) ---

// login принимает третий аргумент — uid Firebase Auth.
login('manager', 'Анна', 'uid-abc');
assert.eq(state.uid, 'uid-abc', 'login с uid → state.uid сохранён');
logout();
assert.eq(state.uid, null, 'logout сбрасывает state.uid');

// userRecord(): приоритет uid над deviceId.
setOwnerFlag(false);
DB.users = [
  { id: 'dev-worker', uid: '', deviceId: 'other-dev', name: 'Мастер', role: 'worker' },
  { id: 'u-1', uid: 'uid-abc', deviceId: '', name: 'Анна', role: 'manager' }
];
state.uid = 'uid-abc';
assert.eq(userRecord().name, 'Анна', 'userRecord: находит по uid');
state.uid = 'no-such-uid';
assert.eq(userRecord(), null, 'userRecord: неизвестный uid и нет deviceId-записи → null');
state.uid = null;
assert.eq(userRecord(), null, 'userRecord: без uid пусто (deviceId другого устройства)');

// myPerms/effectiveRole идут за uid-записью.
state.uid = 'uid-abc';
state.role = 'worker';
assert(myPerms().indexOf('order_assign') >= 0, 'myPerms: права из uid-записи (manager)');
assert.eq(effectiveRole(), 'manager', 'effectiveRole: uid-запись (manager)');
state.uid = null;

// Phone Auth без SDK: недоступен, функции не падают (мок-фолбэк).
assert.eq(authPhoneAvailable(), false, 'authPhoneAvailable: без SDK → false');
assert.eq(requestPhoneOtp('+79000000000'), false, 'requestPhoneOtp: без SDK → false');
assert.eq(confirmPhoneOtp('123456'), false, 'confirmPhoneOtp: без подтверждения → false');
assert.eq(isOtpSent(), false, 'isOtpSent: по умолчанию false');

// applyAuthedUser(): запись по uid → её роль/имя; нет записи → worker-гость.
state.uid = null;
DB.users = [{ id: 'u-1', uid: 'uid-abc', name: 'Анна', role: 'manager' }];
assert.eq(applyAuthedUser({ uid: 'uid-abc', phoneNumber: '+79001112233' }), true,
  'applyAuthedUser: uid найден');
assert.eq(state.uid, 'uid-abc', 'applyAuthedUser: state.uid сохранён');
assert.eq(state.user, 'Анна', 'applyAuthedUser: state.user из users/{uid}');
assert.eq(state.role, 'manager', 'applyAuthedUser: роль из записи');
assert.eq(applyAuthedUser({ uid: 'ghost', phoneNumber: '+79005554433' }), true,
  'applyAuthedUser: неизвестный uid → вход гостем');
assert.eq(state.role, 'worker', 'applyAuthedUser: гость → worker');
assert.eq(state.user, '+79005554433', 'applyAuthedUser: гость → имя из телефона');
assert.eq(applyAuthedUser(null), false, 'applyAuthedUser(null) → false');
logout();
DB.users = [];

// --- PIN
assert(savePinLocal('1234') === true, 'PIN 4 цифры принимается');
assert(savePinLocal('12a4') === false, 'PIN с буквой отклоняется');
assert(savePinLocal('12345678') === true, 'PIN до 8 цифр принимается');
assert(savePinLocal('123456789') === false, 'PIN длиннее 8 отклоняется');
savePinLocal('4321');
assert(checkPin('4321') === true, 'checkPin верный PIN');
assert(checkPin('1111') === false, 'checkPin неверный PIN');
resetPin();
assert(checkPin('4321') === false, 'resetPin очищает PIN');
