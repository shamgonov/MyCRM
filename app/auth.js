/* CRM2 :: app/auth.js — deviceId, роли, права can(), PIN (локальный, Этап 1).
   Этап 14-A: реальный вход по телефону через Firebase Phone Auth (compat).
   Если firebase.auth() недоступен (офлайн, смоуки, SDK не загрузился) —
   молча остаётся мок-вход doLogin() из core.js.
   Зависит от db.js (lsGet/lsSet, DB). */
'use strict';

// --- deviceId ---

function deviceId() {
  let id = lsGet('crm2_device', null);
  if (!id) {
    id = 'dev-' + Date.now();
    lsSet('crm2_device', id);
  }
  return id;
}

// --- Флаг владельца устройства (владелец компании на этом устройстве) ---

function isOwner() {
  return lsGet('crm2_owner', '0') === '1';
}

function setOwnerFlag(v) {
  lsSet('crm2_owner', v ? '1' : '0');
}

// --- Роли и права ---

// Каталог прав из старой CRM (21 право).
const PERMS_CATALOG = [
  { key: 'all', label: 'Полный доступ' },
  { key: 'order_view_all', label: 'Просмотр всех заявок' },
  { key: 'order_create', label: 'Создание заявок' },
  { key: 'order_edit', label: 'Редактирование заявок' },
  { key: 'order_delete', label: 'Удаление заявок' },
  { key: 'order_assign', label: 'Назначение исполнителей' },
  { key: 'order_status', label: 'Смена статуса заявки' },
  { key: 'order_docs', label: 'Смета и документы' },
  { key: 'money_view', label: 'Просмотр денег' },
  { key: 'money_edit', label: 'Ввод оплат' },
  { key: 'shopping_view', label: 'Просмотр закупок' },
  { key: 'shopping_buy', label: 'Закупки' },
  { key: 'shopping_refund', label: 'Компенсации и брак' },
  { key: 'clients_view', label: 'Просмотр контрагентов' },
  { key: 'clients_edit', label: 'Редактирование контрагентов' },
  { key: 'calendar_all', label: 'Общий календарь' },
  { key: 'calendar_own', label: 'Мой календарь' },
  { key: 'reports_view', label: 'Отчёты' },
  { key: 'users_manage', label: 'Управление сотрудниками' },
  { key: 'settings_edit', label: 'Настройки организации' },
  { key: 'profile_view', label: 'Профиль' }
];

// Встроенные роли: admin — все права, остальные — перечисление.
const BUILTIN_ROLES = {
  admin: ['all'],
  operator: [
    'order_view_all', 'order_create', 'order_edit', 'order_status', 'order_docs',
    'money_view', 'money_edit', 'shopping_view', 'shopping_buy',
    'clients_view', 'clients_edit', 'calendar_all', 'calendar_own',
    'reports_view', 'profile_view'
  ],
  manager: [
    'order_view_all', 'order_create', 'order_edit', 'order_assign', 'order_status',
    'order_docs', 'money_view', 'shopping_view', 'shopping_buy', 'shopping_refund',
    'clients_view', 'clients_edit', 'calendar_all', 'calendar_own',
    'reports_view', 'users_manage', 'profile_view'
  ],
  worker: [
    'calendar_own', 'shopping_view', 'shopping_buy', 'profile_view'
  ]
};

// Кэш ролей; заполняется из Firestore на Этапе 2.
const ROLES = {};

function rolesOf(e) {
  if (!e) return [];
  if (Array.isArray(e.roles) && e.roles.length) return e.roles.slice();
  return e.role ? [e.role] : [];
}

function unionPermsFor(roleIds) {
  const set = {};
  (roleIds || []).forEach((r) => {
    const perms = (ROLES[r] && ROLES[r].perms) || BUILTIN_ROLES[r] || [];
    perms.forEach((p) => { set[p] = true; });
  });
  // Алиасы: в старой CRM права зовутся order_*, гейты Этапа 3 — orders_*.
  if (set.order_view_all) set.orders_view_all = true;
  if (set.order_edit) set.orders_edit = true;
  return Object.keys(set);
}

// userRecord(): запись сотрудника в DB.users. Этап 14-A: при авторизованном
// state.uid ищем по uid (документ users/{uid} в Firestore), иначе — по deviceId
// (локальный/мок-режим). deviceId остаётся полем записи.
function userRecord() {
  if (typeof DB === 'undefined' || !DB || !DB.users) return null;
  const uid = (typeof state !== 'undefined' && state && state.uid) || null;
  if (uid) {
    const byUid = DB.users.find(function (u) { return u.uid === uid || u.id === uid; });
    if (byUid) return byUid;
  }
  return DB.users.find(function (u) { return u.id === deviceId(); }) || null;
}

function myPerms() {
  // simOn (режим симуляции) гасит права владельца-устройства: смотрим как роль.
  if (isOwner() && !isSim()) return ['all'];
  return unionPermsFor(rolesOf(userRecord() || { role: state.role }));
}

function can(p) {
  if (isOwner() && !isSim()) return true;
  const perms = myPerms();
  return perms.indexOf('all') >= 0 || perms.indexOf(p) >= 0;
}

function isSim() {
  return !!(typeof state !== 'undefined' && state && state.simOn);
}

function adminLike() {
  return uiOwner() || state.role === 'admin' || state.user === 'Владелец';
}

function uiOwner() {
  return isOwner() && !isSim();
}

// Старшая роль по порядку старшинства.
const ROLE_RANK = ['admin', 'manager', 'operator', 'worker'];

function effectiveRole() {
  const roles = rolesOf(userRecord());
  const pool = roles.length ? roles : [state.role];
  for (const r of ROLE_RANK) {
    if (pool.indexOf(r) >= 0) return r;
  }
  return pool[0] || null;
}

// --- Вход/выход (мок, Этап 1; телефон+код — с Firebase на Этапе 2) ---

function login(role, name, uid) {
  state.role = role;
  state.user = name;
  state.uid = uid || null; // Этап 14-A: uid Firebase Auth (null в мок-режиме)
  state.screen = (role === 'worker') ? 'tasks' : 'orders';
  state.navHistory = [];
  // Тестовый режим: сессия в localStorage для восстановления при F5.
  try {
    lsSet('crm2_test_user', JSON.stringify({ role: role, name: name }));
  } catch (e) { /* localStorage недоступен */ }
}

function logout() {
  // Реальный вход: выходим и из Firebase (если SDK доступен).
  if (state.uid && typeof firebase !== 'undefined' && firebase.auth) {
    try { firebase.auth().signOut(); } catch (e) { /* офлайн — локальный выход важнее */ }
  }
  state.role = null;
  state.user = null;
  state.uid = null;
  state.screen = 'login';
  state.orderId = null;
  state.filter = 'all';
  state.navHistory = [];
  // Тестовый режим: сессия больше не должна восстанавливаться при F5.
  try {
    lsSet('crm2_test_user', '');
  } catch (e) { /* localStorage недоступен */ }
}

// --- Этап 14-A: Firebase Phone Auth (compat) ---

// authPhoneAvailable(): доступен ли реальный вход по SMS.
// Нужны SDK, метод signInWithPhoneNumber и контейнер reCAPTCHA на странице.
function authPhoneAvailable() {
  return typeof firebase !== 'undefined' && !!firebase && !!firebase.auth &&
    typeof firebase.auth().signInWithPhoneNumber === 'function';
}

var AUTH_CONFIRMATION = null; // результат signInWithPhoneNumber (для confirm)

// applyAuthedUser(user): по uid находит запись сотрудника (DB.users, куда
// sync/админка кладут users/{uid}) и входит; записи нет — worker-гость.
function applyAuthedUser(user) {
  const uid = user && user.uid ? String(user.uid) : '';
  if (!uid) return false;
  let rec = (typeof DB !== 'undefined' && DB && DB.users)
    ? DB.users.find(function (u) { return u.uid === uid || u.id === uid; })
    : null;
  if (rec) {
    login(effectiveRoleFor(rec), rec.name || user.phoneNumber || uid, uid);
  } else {
    login('worker', user.phoneNumber || 'Сотрудник', uid);
  }
  return true;
}

// effectiveRoleFor(rec): старшая роль записи (без зависимости от state).
function effectiveRoleFor(rec) {
  const roles = rolesOf(rec);
  for (const r of ROLE_RANK) {
    if (roles.indexOf(r) >= 0) return r;
  }
  return roles[0] || 'worker';
}

// isOtpSent(): SMS-код запрошен, ждём подтверждения (второй клик «Войти»).
function isOtpSent() { return !!AUTH_CONFIRMATION; }

// requestPhoneOtp(phone): отправка SMS-кода. true — код отправлен;
// false — недоступен (звонящий должен уйти на мок-вход); строка — ошибка.
function requestPhoneOtp(phone) {
  if (!authPhoneAvailable()) return false;
  const appVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
    size: 'invisible'
  });
  return firebase.auth().signInWithPhoneNumber(String(phone), appVerifier)
    .then(function (confirmation) {
      AUTH_CONFIRMATION = confirmation;
      return true;
    })
    .catch(function (e) {
      AUTH_CONFIRMATION = null;
      return (e && e.message) ? String(e.message) : 'Ошибка отправки кода';
    });
}

// confirmPhoneOtp(code): проверка SMS-кода. true — вход выполнен;
// false — подтверждения нет (мок-ветка); строка — ошибка.
function confirmPhoneOtp(code) {
  if (!AUTH_CONFIRMATION) return false;
  return AUTH_CONFIRMATION.confirm(String(code))
    .then(function (user) {
      AUTH_CONFIRMATION = null;
      return applyAuthedUser(user) ? true : 'Пользователь не определён';
    })
    .catch(function (e) {
      return (e && e.message) ? String(e.message) : 'Неверный код';
    });
}

// --- PIN (локальная заглушка; PBKDF2 отложим) ---

function savePinLocal(pin) {
  if (!pin) { lsSet('crm2_pin', ''); return; }
  if (!/^\d{4,8}$/.test(String(pin))) return false;
  lsSet('crm2_pin', String(pin));
  return true;
}

function checkPin(pin) {
  const saved = lsGet('crm2_pin', '');
  return !!saved && saved === String(pin);
}

function resetPin() {
  lsSet('crm2_pin', '');
}

deviceId();
