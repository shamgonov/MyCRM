/* CRM2 :: app/core.js — state, роутер экранов, рендер, навигация.
   Зависит от db.js и auth.js. Модули не используют ES-модули: общие глобальные функции. */
'use strict';

// --- Состояние приложения ---

var state = {
  role: null,        // 'admin'|'operator'|'manager'|'worker' (мок-вход, Этап 1)
  user: null,        // имя пользователя
  uid: null,         // Firebase Auth uid (Этап 14-A; null в мок-режиме)
  screen: 'login',   // текущий экран
  orderId: null,     // открытая заявка
  filter: 'all',     // фильтр списка заявок
  calDate: null,     // дата календаря (инициализируется ниже через localToday())
  simOn: false,      // режим симуляции прав (владелец смотрит глазами роли)
  online: false,     // «На линии» (Этап 5; живёт в localStorage crm2_online)
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
    ['clients', '📇', 'Контрагенты'],
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
    ['tasks', '📝', 'Органайзер'],
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
  nav.innerHTML = '<div class="nav-scroll">' + buildNav(state.role).map(function (item) {
    const key = item[0], ico = item[1], label = item[2];
    const active = (state.screen === key) ? ' active' : '';
    const b = (badge && key === 'orders') ? '<span class="nav-badge">' + badge + '</span>' : '';
    return '<button class="nav-btn' + active + '" data-nav="' + key + '">' +
      ico + '<br><span class="nav-label">' + label + '</span>' + b + '</button>';
  }).join('') + '</div>';
  syncNavScroll(nav);
}

// Центрирует активный пункт в горизонтальной прокрутке (мобильная навигация).
// Guard'ы обязательны: в смоуках nav — стаб без querySelector.
function syncNavScroll(nav) {
  if (!nav || typeof nav.querySelector !== 'function') return;
  const sc = nav.querySelector('.nav-scroll');
  const btn = nav.querySelector('.nav-btn.active');
  if (!sc || !btn) return;
  if (typeof btn.offsetLeft !== 'number' || typeof sc.clientWidth !== 'number') return;
  const target = btn.offsetLeft - (sc.clientWidth - btn.offsetWidth) / 2;
  sc.scrollLeft = Math.max(0, target);
}

// --- Экран входа (тестовый режим: имя + роль, без Firebase Phone Auth;
// Phone Auth недоступен в РФ — auth/operation-not-allowed) ---

function renderLogin() {
  return '<div class="card">' +
    '<h1>CRM2 — Тестовый режим</h1>' +
    '<p class="muted">Сервис окон</p>' +
    '<label class="field"><span>Ваше имя</span>' +
    '<input id="login-name" type="text" placeholder="Например: Дмитрий"></label>' +
    '<label class="field"><span>Роль</span>' +
    '<select id="login-role">' +
      '<option value="admin">Владелец (все права)</option>' +
      '<option value="manager">Менеджер</option>' +
      '<option value="operator">Оператор</option>' +
      '<option value="worker">Мастер</option>' +
    '</select></label>' +
    '<button class="btn btn-primary btn-block" data-test-login>Войти</button>' +
    '<p class="small muted">Данные хранятся в браузере. Для общей базы ' +
      'включите Anonymous Auth в Firebase.</p>' +
    '</div>';
}

// --- Заглушки экранов (наполняются на следующих этапах) ---

// Экран orders/order реализованы в ui-orders.js (грузится после core.js),
// поэтому здесь ленивые обёртки: на момент вызова функции уже определены.
const S = {
  login: renderLogin,
  orders: function () {
    if (typeof renderOrdersList === 'function') return renderOrdersList();
    return '<h2>📋 Заявки</h2><p class="muted">Модуль UI ещё не загружен.</p>';
  },
  order: function () {
    if (typeof renderOrderCard === 'function') return renderOrderCard(state.orderId);
    return '<h2>Заявка</h2><p class="muted">Модуль UI ещё не загружен.</p>';
  },
  calendar: function () {
    if (typeof renderCalendar === 'function') return renderCalendar();
    return '<h2>📅 Календарь</h2><p class="muted">Модуль UI ещё не загружен.</p>';
  },
  clients: function () {
    if (typeof renderClients === 'function') return renderClients();
    return '<h2>📇 Контрагенты</h2><p class="muted">Модуль UI ещё не загружен.</p>';
  },
  overdue: function () {
    // Экран «Требует внимания» (Этап 19) живёт в ui-attention.js — ленивая
    // обёртка, чтобы список заявок работал и без этого модуля.
    if (typeof renderAttention === 'function') return renderAttention();
    return '<h2>⏰ Просроченные заявки</h2>' +
      '<div class="card">' +
        '<p class="muted">Модуль UI ещё не загружен.</p>' +
        '<p class="small">Здесь будут заявки с просроченной датой.</p>' +
      '</div>';
  },
  shopping: function () {
    if (typeof renderGlobalShopping === 'function') return renderGlobalShopping();
    return '<h2>🛒 Закупки</h2><p class="muted">Модуль UI ещё не загружен.</p>';
  },
  reports: function () {
    if (typeof renderReports === 'function') return renderReports();
    return '<h2>📊 Отчёты</h2>' +
      '<div class="card">' +
        '<p class="muted">Экран в разработке (Этап 10).</p>' +
        '<p class="small">Здесь будет аналитика по прибыли и эффективности.</p>' +
      '</div>';
  },
  admin: function () {
    if (typeof renderAdmin === 'function') return renderAdmin();
    return '<h2>⚙️ Администрирование</h2>' +
      '<p class="muted">Модуль UI ещё не загружен.</p>';
  },
  // Органайзер задач (Этап 20) живёт в ui-tasks.js — ленивая обёртка.
  // Пункт меню worker называется «Поиск заказов», но экран — общий органайзер.
  tasks: function () {
    if (typeof renderTasks === 'function') return renderTasks();
    return '<h2>📝 Органайзер</h2><p class="muted">Модуль UI ещё не загружен.</p>';
  },
  create: function () { return '<h2>Новая заявка</h2>'; },
  // Профиль (Этап 20) живёт в ui-profile.js; «🚪 Выйти» (data-logout) обрабатывает core.js.
  profile: function () {
    if (typeof renderProfile === 'function') return renderProfile();
    return '<h2>👤 Профиль</h2>' +
      '<div class="card">' +
        '<p class="muted">Модуль UI ещё не загружен.</p>' +
        '<button class="btn btn-primary" data-logout style="margin-top:12px">🚪 Выйти</button>' +
      '</div>';
  }
};
// const не создаёт свойства window (в отличие от var/function) — экспорт для
// отладки из консоли и внешних модулей; роутер ниже использует лексическую S.
window.S = S;

// --- Модалки: оверлей поверх текущего экрана (#modal-container в index.html) ---

function showModal(html) {
  const host = document.getElementById('modal-container');
  if (!host) { toast('Модалки недоступны', true); return; }
  host.innerHTML =
    '<div class="overlay" data-modal-overlay><div class="modal">' + html + '</div></div>';
}

function closeModal() {
  const host = document.getElementById('modal-container');
  if (host) host.innerHTML = '';
}

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

  const testLoginBtn = ev.target.closest('[data-test-login]');
  if (testLoginBtn) {
    const nameEl = document.getElementById('login-name');
    const roleEl = document.getElementById('login-role');
    const name = nameEl ? nameEl.value.trim() : '';
    const role = roleEl ? roleEl.value : 'worker';
    if (!name) { toast('Введите имя', true); return; }
    login(role, name);
    // Если Firebase доступен — анонимный вход для синхронизации (Этап 14-B);
    // без него приложение работает локально, ошибка не блокирует вход.
    if (typeof firebase !== 'undefined' && firebase.auth) {
      try {
        firebase.auth().signInAnonymously().catch(function (e) {
          console.warn('Anonymous auth недоступен:', e && e.code);
        });
      } catch (e) {
        console.warn('Anonymous auth недоступен:', e && e.message);
      }
    }
    render();
    return;
  }

  const backBtn = ev.target.closest('[data-back]');
  if (backBtn) { goBack(); return; }

  const logoutBtn = ev.target.closest('[data-logout]');
  if (logoutBtn) {
    if (confirm('Выйти из CRM2?')) {
      logout();
      render();
    }
    return;
  }
});

// --- Старт: все модули подключены обычными <script>, ждём готовности DOM
// (ui-orders.js идёт после core.js, поэтому первый render откладывается).

// Тестовый режим: восстановление сессии после перезагрузки страницы,
// чтобы F5 не выкидывал на экран входа (сессию сохраняет login() из auth.js).
function restoreTestSession() {
  if (state.role !== null || typeof lsGet !== 'function') return false;
  try {
    const saved = JSON.parse(lsGet('crm2_test_user', '') || 'null');
    if (saved && saved.role && saved.name) { login(saved.role, saved.name); return true; }
  } catch (e) { /* битая запись — остаёмся на экране входа */ }
  return false;
}
restoreTestSession();

if (state.role === null) state.screen = 'login';
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', render);
} else {
  render();
}
