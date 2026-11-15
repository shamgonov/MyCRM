/* CRM2 :: app/ui-profile.js — экран «👤 Профиль» (Этап 20): данные пользователя,
   локальный PIN (auth.js), график работы (DB.settings.schedule), уведомления
   (notify.js), выход. Кнопка «🚪 Выйти» (data-logout) обрабатывается в core.js —
   здесь только рендер, повторного обработчика нет (иначе было бы двойное confirm).
   Зависит: db.js, auth.js, core.js; notify.js — лениво (typeof). */
'use strict';

// Дни недели графика: ключ — ISO-английский (Mon..Sun), порядок — с понедельника.
const WEEK_DAYS = [
  ['Mon', 'Пн'], ['Tue', 'Вт'], ['Wed', 'Ср'], ['Thu', 'Чт'],
  ['Fri', 'Пт'], ['Sat', 'Сб'], ['Sun', 'Вс']
];

// Подписи ролей: локальный словарь — ui-admin.js с ROLE_LABELS может не загрузиться.
const PROFILE_ROLE_LABELS = {
  admin: 'Админ', manager: 'Менеджер', operator: 'Оператор', worker: 'Мастер'
};

// --- График работы (DB.settings.schedule) ---

// defaultSchedule(): копия эталонного графика из defaultData().settings.schedule.
function defaultSchedule() {
  const src = (defaultData().settings && defaultData().settings.schedule) || {};
  const out = {};
  WEEK_DAYS.forEach(function (d) {
    const day = src[d[0]] || { from: '09:00', to: '18:00', off: false };
    out[d[0]] = { from: day.from, to: day.to, off: !!day.off };
  });
  return out;
}

// schedule(): нормализованный график из DB.settings (недостающие дни — из эталона).
function schedule() {
  const s = (DB && DB.settings && DB.settings.schedule) || {};
  const out = {};
  WEEK_DAYS.forEach(function (d) {
    const day = s[d[0]];
    if (!day || typeof day !== 'object') {
      out[d[0]] = defaultSchedule()[d[0]];
      return;
    }
    out[d[0]] = {
      from: /^\d{2}:\d{2}$/.test(String(day.from || '')) ? String(day.from) : '09:00',
      to: /^\d{2}:\d{2}$/.test(String(day.to || '')) ? String(day.to) : '18:00',
      off: !!day.off
    };
  });
  return out;
}

// saveSchedule(obj): кладёт график в DB.settings и сохраняет.
function saveSchedule(obj) {
  if (!DB.settings || typeof DB.settings !== 'object') DB.settings = {};
  DB.settings.schedule = obj;
  save();
  return DB.settings.schedule;
}

// --- Данные пользователя ---

// currentUserRecord(): запись в DB.users по имени (id там синтетические — dev-*).
function currentUserRecord() {
  const name = (state && state.user) || '';
  return (DB.users || []).find(function (u) { return u.name === name; }) || null;
}

// pinStatusText(): текст статуса PIN для блока.
function pinStatusText() {
  return lsGet('crm2_pin', '') ? '✅ PIN установлен' : '— PIN не установлен —';
}

// --- Рендер блоков ---

function renderProfileDataBlock() {
  const rec = currentUserRecord();
  const role = state && state.role ? state.role : '';
  return '<div class="card info-block">' +
      '<h4>Данные</h4>' +
      '<div>Имя: <b>' + escapeHtml((state && state.user) || '—') + '</b></div>' +
      '<div>Роль: <span class="badge">' + escapeHtml(PROFILE_ROLE_LABELS[role] || role || '—') + '</span></div>' +
      '<div>Телефон: ' + (rec && rec.phone
        ? '<a href="tel:' + escapeHtml(rec.phone) + '">' + escapeHtml(rec.phone) + '</a>'
        : '<span class="muted">не указан</span>') + '</div>' +
      (isSim() ? '<div class="small badge-warn">Режим симуляции прав</div>' : '') +
    '</div>';
}

function renderPinBlock() {
  return '<div class="card info-block">' +
      '<h4>🔑 PIN-код</h4>' +
      '<div id="pin-status">' + escapeHtml(pinStatusText()) + '</div>' +
      '<p class="small muted">PIN хранится только на этом устройстве (4–8 цифр). ' +
      'Оставьте поля пустыми, чтобы снять PIN.</p>' +
      '<button class="btn" data-change-pin>Сменить PIN</button>' +
    '</div>';
}

// renderScheduleBlock(): таблица дней недели + кнопка редактирования.
function renderScheduleBlock() {
  const s = schedule();
  const rows = WEEK_DAYS.map(function (d) {
    const day = s[d[0]];
    const val = day.off
      ? '<span class="badge">выходной</span>'
      : escapeHtml(day.from + '–' + day.to);
    return '<div class="est-row"><span>' + d[1] + '</span><span>' + val + '</span></div>';
  }).join('');

  return '<div class="card info-block">' +
      '<div class="spread"><h4>🗓 График работы</h4>' +
        '<button class="btn" data-edit-schedule>✎ Редактировать</button></div>' +
      '<div id="schedule-rows">' + rows + '</div>' +
    '</div>';
}

// Статус системных уведомлений (текст) — по notifyEnabled и нативному разрешению.
function notifyStatusText() {
  const enabled = !!(DB.settings && DB.settings.notifyEnabled);
  if (typeof Notification === 'undefined' || !Notification) {
    return 'Браузер не поддерживает уведомления';
  }
  const perm = Notification.permission;
  if (perm === 'granted' && enabled) return '✅ Включены';
  if (perm === 'denied') return '⛔ Запрещены браузером';
  if (enabled) return '✅ Включены';
  return '⚪ Выключены';
}

function renderNotifyBlock() {
  const canAsk = (typeof Notification !== 'undefined' && Notification &&
    Notification.permission !== 'granted');
  const btn = canAsk
    ? '<button class="btn" data-profile-notify>🔔 Разрешить уведомления</button>'
    : '';
  return '<div class="card info-block">' +
      '<h4>🔔 Уведомления</h4>' +
      '<div id="notify-status">' + escapeHtml(notifyStatusText()) + '</div>' +
      '<p class="small muted">Напоминания визитов, перезвонов и остатков; ' +
      'утренний дайджест в 08:30.</p>' +
      btn +
    '</div>';
}

// renderProfile(): главный экран профиля (S.profile).
function renderProfile() {
  return '<h2>👤 Профиль</h2>' +
    renderProfileDataBlock() +
    renderPinBlock() +
    renderScheduleBlock() +
    renderNotifyBlock() +
    '<div class="card" style="margin-top:8px">' +
      '<button class="btn btn-danger btn-block" data-logout>🚪 Выйти</button>' +
    '</div>';
}

// --- Модалки ---

// renderPinModal(): смена локального PIN (savePinLocal из auth.js).
function renderPinModal() {
  showModal(
    '<h3>🔑 Смена PIN</h3>' +
    '<label class="field"><span>Новый PIN</span>' +
      '<input id="pin-new" type="password" inputmode="numeric" autocomplete="off" placeholder="4–8 цифр"></label>' +
    '<label class="field"><span>Подтверждение PIN</span>' +
      '<input id="pin-confirm" type="password" inputmode="numeric" autocomplete="off"></label>' +
    '<p class="small muted">Пустые поля — снять PIN.</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-pin style="flex:1">Сохранить</button>' +
    '</div>'
  );
}

// renderScheduleModal(): правка графика; чекбокс «off» глушит time-поля.
function renderScheduleModal() {
  const s = schedule();
  const rows = WEEK_DAYS.map(function (d) {
    const day = s[d[0]];
    return '<div class="est-row" style="align-items:center">' +
        '<span style="min-width:34px">' + d[1] + '</span>' +
        '<span class="row" style="gap:6px;flex:1">' +
          '<input id="sch-' + d[0] + '-from" type="time" value="' + escapeHtml(day.from) + '"' +
            (day.off ? ' disabled' : '') + ' style="flex:1">' +
          '<input id="sch-' + d[0] + '-to" type="time" value="' + escapeHtml(day.to) + '"' +
            (day.off ? ' disabled' : '') + ' style="flex:1">' +
        '</span>' +
        '<label class="small"><input type="checkbox" id="sch-' + d[0] + '-off"' +
          (day.off ? ' checked' : '') + '> вых</label>' +
      '</div>';
  }).join('');

  showModal(
    '<h3>🗓 График работы</h3>' +
    rows +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-schedule style="flex:1">Сохранить</button>' +
    '</div>'
  );
}

// --- Делегирование событий этого модуля ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  const changePinBtn = sel('[data-change-pin]');
  if (changePinBtn) { renderPinModal(); return; }

  const savePinBtn = sel('[data-save-pin]');
  if (savePinBtn) {
    const el1 = document.getElementById('pin-new');
    const el2 = document.getElementById('pin-confirm');
    const p1 = el1 ? String(el1.value || '').trim() : '';
    const p2 = el2 ? String(el2.value || '').trim() : '';
    if (!p1 && !p2) {
      savePinLocal('');
      closeModal();
      toast('PIN снят');
      render();
      return;
    }
    if (p1 !== p2) { toast('PIN-ы не совпадают', true); return; }
    if (savePinLocal(p1) === false) { toast('PIN: только 4–8 цифр', true); return; }
    closeModal();
    toast('PIN сохранён');
    render();
    return;
  }

  const editSchBtn = sel('[data-edit-schedule]');
  if (editSchBtn) { renderScheduleModal(); return; }

  const saveSchBtn = sel('[data-save-schedule]');
  if (saveSchBtn) {
    const next = {};
    let bad = false;
    WEEK_DAYS.forEach(function (d) {
      const offEl = document.getElementById('sch-' + d[0] + '-off');
      const fromEl = document.getElementById('sch-' + d[0] + '-from');
      const toEl = document.getElementById('sch-' + d[0] + '-to');
      const off = !!(offEl && offEl.checked);
      const from = fromEl ? String(fromEl.value || '') : '';
      const to = toEl ? String(toEl.value || '') : '';
      if (!off && (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || from >= to)) {
        bad = true;
      }
      next[d[0]] = { from: from || '09:00', to: to || '18:00', off: off };
    });
    if (bad) { toast('Проверьте время рабочих дней', true); return; }
    saveSchedule(next);
    closeModal();
    toast('График сохранён');
    render();
    return;
  }

  // «🔔 Разрешить уведомления» в профиле: свой обработчик, потому что
  // обработчик notify.js перерисовывает только экран orders.
  const enableBtn = sel('[data-profile-notify]');
  if (enableBtn && state.screen === 'profile') {
    if (typeof requestNotifyPermission !== 'function') {
      toast('Модуль уведомлений не загружен', true);
      return;
    }
    const res = requestNotifyPermission();
    if (res === 'granted') toast('Уведомления включены');
    else if (res === 'unsupported') toast('Браузер не поддерживает уведомления', true);
    else if (res === 'denied') toast('Уведомления запрещены браузером', true);
    else toast('Разрешите уведомления в диалоге браузера');
    render();
    return;
  }
});

// Чекбокс «вых» в модалке графика — time-поля становятся неактивными (change).
document.addEventListener('change', function (ev) {
  const cb = ev.target.closest && ev.target.closest('[id^="sch-"][id$="-off"]');
  if (!cb) return;
  const key = String(cb.id).slice(4, -4);
  const from = document.getElementById('sch-' + key + '-from');
  const to = document.getElementById('sch-' + key + '-to');
  if (from) from.disabled = !!cb.checked;
  if (to) to.disabled = !!cb.checked;
});

// --- Экспорт для core.js ---

window.WEEK_DAYS = WEEK_DAYS;
window.PROFILE_ROLE_LABELS = PROFILE_ROLE_LABELS;
window.defaultSchedule = defaultSchedule;
window.schedule = schedule;
window.saveSchedule = saveSchedule;
window.currentUserRecord = currentUserRecord;
window.pinStatusText = pinStatusText;
window.notifyStatusText = notifyStatusText;
window.renderProfile = renderProfile;
window.renderProfileDataBlock = renderProfileDataBlock;
window.renderPinBlock = renderPinBlock;
window.renderScheduleBlock = renderScheduleBlock;
window.renderNotifyBlock = renderNotifyBlock;
window.renderPinModal = renderPinModal;
window.renderScheduleModal = renderScheduleModal;
