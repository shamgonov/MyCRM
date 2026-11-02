/* CRM2 :: app/core.js — state, роутер экранов, рендер, навигация.
   Зависит от db.js и auth.js. Модули не используют ES-модули: общие глобальные функции. */
'use strict';

// --- Состояние приложения ---

var state = {
  role: null,        // 'admin'|'operator'|'manager'|'worker' (мок-вход, Этап 1)
  user: null,        // имя пользователя
  screen: 'login',   // текущий экран
  orderId: null,     // открытая заявка
  filter: 'all',     // фильтр списка заявок
  calDate: null,     // дата календаря (инициализируется ниже через localToday())
  simOn: false,      // режим симуляции прав (владелец смотрит глазами роли)
  navHistory: []     // история навигации для кнопки «Назад»
};

state.calDate = localToday();

// --- Базовые меню по ролям (профиль добавляется в buildNav при can('profile_view')) ---

const NAVS_BASE = {
  admin: [
    ['orders', '📋', 'Заявки'],
    ['clients', '📇', 'Контрагенты'],
    ['overdue', '⏰', 'Просроченные'],
    ['calendar', '📅', 'Календарь'],
    ['shopping', '🛒', 'Закупки'],
    ['reports', '📊', 'Отчёты'],
    ['admin', '⚙️', 'Админ']
  ],
  operator: [
    ['orders', '📋', 'Заявки'],
    ['calendar', '📅', 'Календарь'],
    ['shopping', '🛒', 'Закупки'],
    ['create', '➕', 'Новая'],
    ['reports', '📊', 'Отчёты']
  ],
  manager: [
    ['orders', '📋', 'Заявки'],
    ['clients', '📇', 'Контрагенты'],
    ['overdue', '⏰', 'Просроченные'],
    ['calendar', '📅', 'Календарь'],
    ['shopping', '🛒', 'Закупки']
  ],
  worker: [
    ['tasks', '🔍', 'Поиск заказов'],
    ['shopping', '🛒', 'Закупки'],
    ['calendar', '📅', 'Календарь']
  ]
};

// buildNav(role): меню роли + «Профиль» при наличии права profile_view.
function buildNav(role) {
  const items = (NAVS_BASE[role] || []).slice();
  if (can('profile_view')) items.push(['profile', '👤', 'Профиль']);
  return items;
}

// --- Навигация ---

function pushNav(screen, id) {
  state.navHistory.push({ screen: state.screen, orderId: state.orderId });
  if (state.navHistory.length > 50) state.navHistory.shift();
  void screen; void id; // в историю пишем предыдущее состояние
}

// go(screen, id): смена экрана + перерисовка. Экран должен быть в карте S.
function go(screen, id) {
  if (typeof S[screen] !== 'function') {
    toast('Экран недоступен: ' + screen);
    return;
  }
  pushNav(screen, id);
  state.screen = screen;
  if (id !== undefined) state.orderId = id;
  render();
}

// goBack(): возврат по истории; на «дне» истории — подтверждение выхода.
function goBack() {
  const prev = state.navHistory.pop();
  if (prev) {
    state.screen = prev.screen;
    state.orderId = prev.orderId;
    render();
    return;
  }
  if (state.role === null) return; // с экрана входа «назад» никуда не уходим
  if (confirm('Выйти из CRM2?')) {
    logout();
    render();
  }
}

// --- Рендер ---

// render(): диспетчер экранов; экран берётся из карты S по state.screen.
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  const fn = S[state.screen] || S.login;
  app.innerHTML = fn();
  renderNav();
}

// renderNavActive(): перерисовка только навигации (подсветка active).
function renderNavActive() {
  renderNav();
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  if (state.role === null) { nav.innerHTML = ''; return; }
  const badge = (typeof navBadge === 'function') ? navBadge() : 0;
  nav.innerHTML = buildNav(state.role).map(function (item) {
    const key = item[0], ico = item[1], label = item[2];
    const active = (state.screen === key) ? ' active' : '';
    const b = (badge && key === 'orders') ? '<span class="nav-badge">' + badge + '</span>' : '';
    return '<button class="nav-btn' + active + '" data-nav="' + key + '">' +
      ico + '<br>' + label + b + '</button>';
  }).join('');
}

// --- Экран входа (мок: телефон + код, Firebase на Этапе 2) ---

function renderLogin() {
  return '<div class="card">' +
    '<h1>CRM2</h1>' +
    '<p class="muted">Сервис окон — вход по телефону</p>' +
    '<label class="field"><span>Телефон</span>' +
    '<input id="login-phone" type="tel" placeholder="+7 900 000-00-00"></label>' +
    '<label class="field"><span>Код из SMS</span>' +
    '<input id="login-code" type="text" inputmode="numeric" placeholder="0000"></label>' +
    '<button class="btn btn-primary btn-block" data-login>Войти</button>' +
    '<p class="small muted">Этап 1: вход моковый, любые телефон и код.</p>' +
    '</div>';
}

// Мок-обработчик входа: телефон+код → роль/имя (детерминированно для смоука).
function doLogin(phone, code) {
  if (!code || String(code).length < 4) return false;
  const isBoss = /\+?7?900/.test(String(phone));
  login(isBoss ? 'admin' : 'worker', isBoss ? 'Владелец' : 'Мастер');
  return true;
}

// --- Заглушки экранов (наполняются на следующих этапах) ---

function renderOrders() {
  return '<h2>Список заявок</h2><p class="muted">Этап 5: список, фильтры, карточки.</p>';
}

const S = {
  login: renderLogin,
  orders: renderOrders,
  clients: function () { return '<h2>Контрагенты</h2>'; },
  overdue: function () { return '<h2>Просроченные</h2>'; },
  calendar: function () { return '<h2>Календарь</h2>'; },
  shopping: function () { return '<h2>Закупки</h2>'; },
  reports: function () { return '<h2>Отчёты</h2>'; },
  admin: function () { return '<h2>Админ</h2>'; },
  tasks: function () { return '<h2>Поиск заказов</h2>'; },
  create: function () { return '<h2>Новая заявка</h2>'; },
  profile: function () { return '<h2>Профиль</h2>'; }
};

// --- Toast ---

let toastTimer = null;
function toast(msg, isError) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
}

// --- Делегирование событий (замена инлайн-обработчикам) ---

document.addEventListener('click', function (ev) {
  const navBtn = ev.target.closest('[data-nav]');
  if (navBtn) { go(navBtn.getAttribute('data-nav')); return; }

  const loginBtn = ev.target.closest('[data-login]');
  if (loginBtn) {
    const phone = (document.getElementById('login-phone') || {}).value || '';
    const code = (document.getElementById('login-code') || {}).value || '';
    if (doLogin(phone, code)) { render(); }
    else { toast('Введите телефон и код (4+ цифр)', true); }
    return;
  }

  const backBtn = ev.target.closest('[data-back]');
  if (backBtn) { goBack(); return; }
});

// --- Старт: каркас гарантирует DOM выше скриптов, поэтому стартуем сразу.

if (state.role === null) state.screen = 'login';
render();
