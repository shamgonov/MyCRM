/* CRM2 :: app/auth.js — deviceId, роли, права can(), PIN (локальный, Этап 1).
   Зависит от db.js (lsGet/lsSet, DB). Firestore-роли подключаются на Этапе 2. */
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
  return Object.keys(set);
}

function myPerms() {
  // simOn (режим симуляции) гасит права владельца-устройства: смотрим как роль.
  if (isOwner() && !isSim()) return ['all'];
  const me = (typeof DB !== 'undefined' && DB) ? (DB.users || []).find((u) => u.id === deviceId()) : null;
  return unionPermsFor(rolesOf(me || { role: state.role }));
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
  const roles = rolesOf((typeof DB !== 'undefined' && DB)
    ? (DB.users || []).find((u) => u.id === deviceId())
    : null);
  const pool = roles.length ? roles : [state.role];
  for (const r of ROLE_RANK) {
    if (pool.indexOf(r) >= 0) return r;
  }
  return pool[0] || null;
}

// --- Вход/выход (мок, Этап 1; телефон+код — с Firebase на Этапе 2) ---

function login(role, name) {
  state.role = role;
  state.user = name;
  state.screen = (role === 'worker') ? 'tasks' : 'orders';
  state.navHistory = [];
}

function logout() {
  state.role = null;
  state.user = null;
  state.screen = 'login';
  state.orderId = null;
  state.filter = 'all';
  state.navHistory = [];
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
