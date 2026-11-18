/* CRM2 :: app/core.js — state, роутер экранов, рендер, навигация.
   Зависит от db.js и auth.js. Модули не используют ES-модули: общие глобальные функции. */
'use strict';

// --- Состояние приложения ---

var state = {
  role: null,        // 'admin'|'operator'|'manager'|'worker' (мок-вход, Этап 1)
  user: null,        // имя пользователя
  uid: null,         // Firebase Auth uid (Этап 14-A; null в мок-режиме)
  cloudRole: null,   // Этап 14-B: роль из users/{uid} ('owner'|'admin'|...)
  cloudStatus: null, // Этап 14-B: 'approved' | 'pending' | 'fired'
  cloudActive: true, // Этап 14-B: флаг active из users/{uid}
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
    ['tasks', '📝', 'Органайзер'],
    ['admin', '⚙️', 'Админ']
  ],
  operator: [
    ['orders', '📋', 'Заявки'],
    ['clients', '📇', 'Контрагенты'],
    ['calendar', '📅', 'Календарь'],
    ['shopping', '🛒', 'Закупки'],
    ['create', '➕', 'Новая'],
    ['reports', '📊', 'Отчёты'],
    ['tasks', '📝', 'Органайзер']
  ],
  manager: [
    ['orders', '📋', 'Заявки'],
    ['clients', '📇', 'Контрагенты'],
    ['overdue', '⏰', 'Просроченные'],
    ['calendar', '📅', 'Календарь'],
    ['shopping', '🛒', 'Закупки'],
    ['tasks', '📝', 'Органайзер']
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
  // Этап 27: вход на экран гасит его счётчик событий («просмотрено»).
  if (screen === 'orders') lsSet('crm2_seen_pool', String(Date.now()));
  if (screen === 'overdue') lsSet('crm2_seen_attention', String(Date.now()));
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
  // Этап 26: padding-bottom гарантируется, чтобы контент не перекрывался
  // нижней навигацией. Гард обязателен: в смоуках #app — стаб без style.
  if (app.style) {
    app.style.paddingBottom = 'calc(var(--nav-h) + 8px + env(safe-area-inset-bottom))';
  }
  const fn = S[state.screen] || S.login;
  // Баннер статуса облачного доступа (Этап 14-B) — над содержимым экрана.
  const banner = (typeof renderAccessBanner === 'function') ? renderAccessBanner() : '';
  // Индикатор статуса синхронизации (Этап 25): показываем только после входа.
  const syncChip = (typeof renderSyncStatus === 'function' && state.role) ? renderSyncStatus() : '';
  // Кнопка «Сводка дня» (Этап 39): на экране входа её нет.
  const dgBtn = (typeof renderDigestButton === 'function' && state.role) ? renderDigestButton() : '';
  app.innerHTML = banner + syncChip + dgBtn + fn();
  renderNav();
  // Точечная инициализация таймеров обратного отсчёта (Микро-этап): меняем
  // только текст/класс уже отрендеренных span.countdown-timer, без render().
  updateAllCountdowns();
}

// --- Таймер обратного отсчёта (Микро-этап) ---
// Обновляет ТЕКСТ и КЛАСС элементов .countdown-timer по их data-target.
// Никакого render()/перерисовки экранов: только точечные DOM-записи.
// Гарды обязательны: в смоук-контекстах нет setInterval/querySelectorAll.
function updateAllCountdowns() {
  if (typeof document === 'undefined' || !document ||
      typeof document.querySelectorAll !== 'function') return 0;
  var nodes = document.querySelectorAll('.countdown-timer');
  if (!nodes || !nodes.length) return 0;
  var now = Date.now();
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var target = Number(el.getAttribute('data-target'));
    if (!target) continue;
    var type = el.getAttribute('data-type') || 'visit';
    var diff = target - now;
    el.textContent = (typeof countdownLabel === 'function')
      ? countdownLabel(type, diff)
      : (diff <= 0 ? 'просрочено' : String(Math.ceil(diff / 60000)) + ' мин.');
    el.className = 'countdown-timer ' + ((typeof countdownVariantClass === 'function')
      ? countdownVariantClass(diff)
      : (diff <= 0 ? 'countdown-overdue' : 'countdown-ok'));
  }
  return nodes.length;
}

// Запуск интервала раз в минуту. Повторный вызов не плодит дубликаты.
function startCountdownTicker() {
  if (typeof setInterval !== 'function') return null;
  if (typeof window !== 'undefined' && window.__countdownInterval) {
    return window.__countdownInterval;
  }
  var id = setInterval(function () { updateAllCountdowns(); }, 60000);
  if (typeof window !== 'undefined') window.__countdownInterval = id;
  return id;
}

startCountdownTicker();

// renderNavActive(): перерисовка только навигации (подсветка active).
// --- Счётчики событий на пунктах навигации (Этап 27) ---

// navBadge(key): число новых событий для пункта меню ('' экран → 0).
// «Новые» = появились/изменились после последнего входа на экран
// (метку «просмотрено» пишет go(), ключи crm2_seen_pool / crm2_seen_attention).
// core.js грузится раньше ui-orders/ui-attention — внешние функции через typeof.
function navBadge(key) {
  if (!state.role || typeof DB === 'undefined' || !DB) return 0;

  if (key === 'orders') {
    if (typeof isPoolOrder !== 'function') return 0;
    var lastSeen = Number(lsGet('crm2_seen_pool', '0')) || 0;
    return (DB.orders || []).filter(function (o) {
      if (!isPoolOrder(o)) return false;
      return Number(o.createdAt || 0) > lastSeen;
    }).length;
  }

  if (key === 'overdue') {
    if (typeof attentionGroups !== 'function') return 0;
    var g = attentionGroups();
    var KEYS = ['callback', 'overdue', 'noWorker', 'balance', 'materials', 'confirm'];
    var total = 0;
    var maxTs = 0;
    KEYS.forEach(function (k) {
      (g[k] || []).forEach(function (it) {
        total++;
        var h = (it && it.o && it.o.history) || [];
        for (var i = h.length - 1; i >= 0; i--) {
          var ts = Number(h[i] && h[i].ts) || 0;
          if (ts > maxTs) maxTs = ts;
        }
      });
    });
    var seen = Number(lsGet('crm2_seen_attention', '0')) || 0;
    return maxTs > seen ? total : 0;
  }

  return 0;
}

function renderNavActive() {
  renderNav();
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  if (state.role === null) { nav.innerHTML = ''; return; }
  nav.innerHTML = '<div class="nav-scroll">' + buildNav(state.role).map(function (item) {
    const key = item[0], ico = item[1], label = item[2];
    const active = (state.screen === key) ? ' active' : '';
    const b = (typeof navBadge === 'function') ? navBadge(key) : 0;
    const badgeHtml = b > 0 ? '<span class="nav-badge">' + b + '</span>' : '';
    return '<button class="nav-btn' + active + '" data-nav="' + key + '">' +
      ico + '<br><span class="nav-label">' + label + '</span>' + badgeHtml + '</button>';
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
        firebase.auth().signInAnonymously()
          .then(function () {
            return typeof ensureMyUserDoc === 'function' ? ensureMyUserDoc(name) : null;
          })
          .then(function () {
            if (typeof watchMyAccess === 'function') watchMyAccess();
            render();
          })
          .catch(function (e) {
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

// Debounce для live-поиска (Этап 38): откладывает вызов fn на ms после
// последнего события — при вводе текста перерисовка идёт не на каждую букву.
function debounce(fn, ms) {
  var timer = null;
  return function () {
    var args = arguments;
    var ctx = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
  };
}
window.debounce = debounce;

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
// В браузере core.js идёт раньше auth.js (login ещё не определён) — вызов
// гардится typeof; повторный вызов в бут-блоке ниже не нужен.
if (typeof login === 'function') restoreTestSession();

if (state.role === null) state.screen = 'login';
// core.js грузится раньше auth.js: восстановление сессии (login из auth.js)
// и облачной идентичности выполняем на DOMContentLoaded, когда все модули
// определены. Синхронный вызов выше остаётся для смоуков (порядок db→auth→core).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    if (state.role === null) restoreTestSession();
    if (typeof resumeCloudSession === 'function') resumeCloudSession();
    if (state.role === null) state.screen = 'login';
    render();
  });
} else {
  if (state.role === null) restoreTestSession();
  if (typeof resumeCloudSession === 'function') resumeCloudSession();
  render();
}

// Service worker: network-first для кода (см. sw.js). Только на https/localhost.
if (typeof navigator !== 'undefined' && navigator.serviceWorker &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
