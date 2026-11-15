/* CRM2 :: app/ui-orders.js — список заявок, карточка с табами, создание заявки.
   Зависит: db.js, auth.js, gates.js, orders.js, core.js (go/render/showModal/toast). */
'use strict';

// Русские названия статусов + цвет бейджа.
const STATUS_LABELS = {
  new: 'Новая', inspection: 'Осмотр', estimate: 'Смета', approved: 'Согласована',
  inwork: 'В работе', paused: 'Пауза', waiting: 'Ожидание', postponed: 'Отложена',
  completed: 'Завершена', paid: 'Оплачена', canceled: 'Отменена'
};

function statusBadgeClass(st) {
  if (st === 'inwork') return 'badge-accent';       // жёлтый
  if (st === 'completed' || st === 'paid') return 'badge-ok';   // зелёный
  if (st === 'canceled') return 'badge-danger';
  if (st === 'new') return 'badge';                  // серый (базовый)
  return 'badge-warn';
}

// Открытая вкладка карточки (переживает перерисовки).
var ORD_TAB = 'main';

// --- Фильтры списка: [Все][🤝 Пул][Сегодня][👷 Мои][⚠️ Просрочка] + 🏷️ тег ---

function orderPassesFilter(o, f) {
  if (f === 'today') return o.date === localToday();
  if (f === 'mine') return isAssignedToMe(o);
  if (f === 'pool') return isPoolOrder(o) && !hiddenTakeFromMe(o);
  if (f === 'overdue') {
    return o.date < localToday() &&
      o.status !== 'completed' && o.status !== 'paid' && o.status !== 'canceled';
  }
  if (f && f.indexOf('tag:') === 0) {
    const tag = f.slice(4);
    return Array.isArray(o.tags) && o.tags.indexOf(tag) >= 0;
  }
  return true; // 'all'
}

// Все теги для фильтра: пресеты настроек + уникальные теги заявок (Этап 17).
function allOrderTags() {
  const seen = {};
  const out = [];
  const add = function (t) {
    t = String(t || '').trim();
    if (!t || seen[t]) return;
    seen[t] = true;
    out.push(t);
  };
  ((DB.settings && DB.settings.tagPresets) || []).forEach(add);
  (DB.orders || []).forEach(function (o) { (o.tags || []).forEach(add); });
  return out;
}

// --- 1. Список заявок ---

function renderOrdersList() {
  const all = DB.orders || [];
  const f = state.filter || 'all';

  // Видимость: право на все заявки либо «мои» (гейты не обходятся).
  const rows = all
    .filter(function (o) { return canViewOrder(o); })
    .filter(function (o) { return orderPassesFilter(o, f); });

  const chips = [
    ['all', 'Все'], ['pool', '🤝 Пул'], ['today', 'Сегодня'],
    ['mine', '👷 Мои'], ['overdue', '⚠️ Просрочка']
  ].map(function (c) {
    return '<button class="chip' + (f === c[0] ? ' active' : '') +
      '" data-filter="' + c[0] + '">' + c[1] + '</button>';
  }).join('');

  // Фильтр по тегу (Этап 17): пресеты + теги заявок; значение — 'tag:Тег'.
  const tagVal = (f && f.indexOf('tag:') === 0) ? f.slice(4) : '';
  const tagOptions = allOrderTags().map(function (t) {
    return '<option value="' + escapeHtml(t) + '"' + (t === tagVal ? ' selected' : '') +
      '>' + escapeHtml(t) + '</option>';
  }).join('');
  const tagFilter = '<label class="field" style="margin:6px 0 0"><span>🏷️ По тегу</span>' +
    '<select data-tag-filter><option value="">— все теги —</option>' + tagOptions + '</select></label>';

  const cards = rows.length
    ? rows.map(renderOrderListItem).join('')
    : '<p class="muted">Заявок нет по этому фильтру.</p>';

  // Баннер напоминаний (Этап 9) живёт в notify.js — он грузится позже этого
  // модуля, поэтому ленивый вызов: без notify.js список работает как раньше.
  const bar = (typeof renderNotificationsBar === 'function') ? renderNotificationsBar() : '';

  return '<div class="spread">' +
      '<h2>📋 Заявки</h2>' +
      '<button class="btn btn-primary" data-create-modal title="Новая заявка">➕</button>' +
    '</div>' +
    bar +
    '<div class="chips">' + chips + '</div>' +
    tagFilter +
    '<div class="list">' + cards + '</div>';
}

// Карточка заявки в списке.
function renderOrderListItem(o) {
  const mine = isAssignedToMe(o);
  const pending = isMyPendingConfirm(o);
  return '<div class="list-item' + (mine ? ' mine' : '') + '" data-order="' + o.id + '">' +
    '<div class="spread">' +
      '<b>№' + o.id + ' ' + escapeHtml(o.client) + '</b>' +
      '<span>' +
        (pending ? '<span class="badge badge-warn">❓ Подтвердить</span> ' : '') +
        (mine ? '<span class="badge badge-accent">👷 МОЯ</span> ' : '') +
        '<span class="' + statusBadgeClass(o.status) + '">' +
          (STATUS_LABELS[o.status] || o.status) + '</span>' +
      '</span>' +
    '</div>' +
    '<div class="small muted">' + o.date + ' ' + (o.t1 || '') + '-' + (o.t2 || '') +
      ' · ' + escapeHtml(o.city || '') + '</div>' +
    (showTakeBtn(o)
      ? '<div style="margin-top:8px">' + takeButton(o) + '</div>'
      : '') +
  '</div>';
}

// Ожидаю ли я подтвердить участие в этой заявке (Этап 14).
function isMyPendingConfirm(o) {
  if (!o || !o.confirm) return false;
  return o.confirm[state.user] === 'pending';
}

function takeButton(o) {
  return '<button class="btn btn-primary" data-take-order="' + o.id + '">✋ Взять в работу</button>';
}

// --- 2. Карточка заявки (табы) ---

function renderOrderCard(id) {
  const o = (DB.orders || []).find(function (x) { return x.id === id; });
  if (!o) {
    return '<button class="btn" data-back>← Назад</button>' +
      '<div class="card"><p>Заявка не найдена.</p></div>';
  }
  if (!canViewOrder(o)) {
    return '<button class="btn" data-back>← Назад</button>' +
      '<div class="card"><p>Нет доступа к этой заявке.</p></div>';
  }

  const tabs = [
    ['main', 'Основное'], ['estimate', 'Смета'], ['materials', 'Материалы'],
    ['docs', 'Документы'], ['money', 'Деньги'], ['journal', 'Журнал']
  ].map(function (t) {
    return '<button class="tab-btn' + (ORD_TAB === t[0] ? ' active' : '') +
      '" data-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');

  let body;
  if (ORD_TAB === 'estimate') body = renderEstimateTab(o);
  else if (ORD_TAB === 'materials') body = renderShoppingTab(o);
  else if (ORD_TAB === 'docs') body = (typeof renderDocsTab === 'function') ? renderDocsTab(o) : '<p class="muted">Модуль документов не загружен.</p>';
  else if (ORD_TAB === 'money') body = (typeof renderMoneyTab === 'function') ? renderMoneyTab(o) : '<p class="muted">Модуль денег не загружен.</p>';
  else if (ORD_TAB === 'journal') body = renderOrderTabJournal(o);
  else body = renderOrderTabMain(o);

  return '<div class="head-row">' +
      '<button class="btn" data-back>←</button>' +
      '<h2>Заявка №' + o.id + '</h2>' +
      (canEditOrder(o) ? '<button class="btn" data-edit-order="' + o.id + '" title="Редактировать">✎</button>' : '') +
    '</div>' +
    '<div class="tabs">' + tabs + '</div>' +
    body;
}

// Журнал (история) — читаем сразу, она простая.
function renderOrderTabJournal(o) {
  const rows = (o.history || []).slice().reverse().map(function (h) {
    const d = new Date(h.ts);
    const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    const when = p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    let text = h.action === 'status'
      ? 'Статус: ' + (STATUS_LABELS[h.from] || h.from) + ' → ' + (STATUS_LABELS[h.to] || h.to)
      : (h.details || h.action);
    if (h.reason) text += ' (' + escapeHtml(h.reason) + ')';
    return '<div class="est-row"><span>' + escapeHtml(text) +
      '</span><span class="small muted">' + when + ' · ' + escapeHtml(h.by || '') + '</span></div>';
  });
  return '<div class="card">' + (rows.join('') || '<p class="muted">Пусто.</p>') + '</div>';
}

// --- 3. Вкладка «Основное» ---

function renderOrderTabMain(o) {
  const editable = canEditOrder(o);
  const transitions = (editable ? (STATUS_TRANSITIONS[o.status] || []) : []);

  const statusBlock = '<div class="card info-block">' +
    '<h4>Статус</h4>' +
    '<div class="row">' +
      '<span class="' + statusBadgeClass(o.status) + '">' + (STATUS_LABELS[o.status] || o.status) + '</span>' +
      (transitions.length
        ? '<select data-status-select="' + o.id + '">' +
            '<option value="">Сменить статус…</option>' +
            transitions.map(function (s) {
              return '<option value="' + s + '">' + (STATUS_LABELS[s] || s) + '</option>';
            }).join('') +
          '</select>'
        : '<span class="small muted">Переходов нет</span>') +
    '</div>' +
  '</div>';

  return '<div class="card info-block">' +
      '<h4>Клиент</h4>' +
      '<div><b>' + escapeHtml(o.client) + '</b></div>' +
      '<div><a href="tel:' + escapeHtml(o.phone || '') + '">' + escapeHtml(o.phone || '—') + '</a></div>' +
      '<div class="muted">' + escapeHtml([o.city, o.address].filter(Boolean).join(', ')) + '</div>' +
    '</div>' +
    renderOrderTagsBlock(o, editable) +
    renderOrderTeamBlock(o, editable) +
    statusBlock +
    renderFollowUpBlock(o, editable);
}

// Блок тегов проблемы (Этап 17): чипы с крестиком + пресет + произвольный тег.
function renderOrderTagsBlock(o, editable) {
  normalizeOrder(o);
  const chips = o.tags.length
    ? o.tags.map(function (t) {
        return '<span class="badge">' + escapeHtml(t) +
          (editable ? ' <b data-remove-tag="' + escapeHtml(t) + '" style="cursor:pointer">✕</b>' : '') +
          '</span>';
      }).join(' ')
    : '<span class="muted small">Тегов нет</span>';

  const presets = ((DB.settings && DB.settings.tagPresets) || []).map(function (t) {
    return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>';
  }).join('');

  const actions = editable
    ? '<div class="row" style="margin-top:8px;gap:6px">' +
        '<select data-add-tag-preset style="flex:1">' +
          '<option value="">🏷️ Пресет…</option>' + presets +
        '</select>' +
        '<input id="tag-custom" type="text" placeholder="свой тег" style="flex:1">' +
        '<button class="btn" data-add-tag-custom>＋</button>' +
      '</div>'
    : '';

  return '<div class="card info-block">' +
      '<h4>Теги</h4>' +
      '<div class="chips">' + chips + '</div>' +
      actions +
    '</div>';
}

// Блок переноса остатка (Этап 15): связи родитель/дети + кнопка новой заявки.
function renderFollowUpBlock(o, editable) {
  const kids = (o.followUpIds || []).length;
  const parent = o.parentId;
  if (!editable && !kids && !parent) return '';

  let links = '';
  if (parent) {
    links += '<div>Родитель: <b><span data-order="' + parent + '" style="color:var(--accent);cursor:pointer">№' +
      parent + '</span></b></div>';
  }
  if (kids) {
    links += '<div class="muted">Дочерние: ' + (o.followUpIds || []).map(function (id) {
      const child = (DB.orders || []).find(function (x) { return x.id === id; });
      const num = (typeof orderDisplayNumber === 'function' && child) ? orderDisplayNumber(child) : id;
      return '<span data-order="' + id + '" style="color:var(--accent);cursor:pointer">№' + num + '</span>';
    }).join(', ') + '</div>';
  }

  const btn = editable
    ? '<button class="btn" data-followup="' + o.id + '" style="margin-top:8px">🔄 Перенести остаток</button>'
    : '';

  return '<div class="card info-block">' +
      '<h4>Перенос остатка</h4>' +
      (links || '<p class="small muted">Связанных заявок нет.</p>') +
      '<p class="small muted">Работы «в работе» и материалы «нужно купить» уйдут в новую заявку.</p>' +
      btn +
    '</div>';
}

// Подпись статуса подтверждения соисполнителя.
const CONFIRM_LABELS = {
  pending: ['⏳ ждёт подтверждения', 'badge-warn'],
  ok: ['✅ подтвердил', 'badge-ok'],
  no: ['✖ отказался', 'badge-danger']
};

// Блок «Исполнители»: взятие из пула, подтверждение соисполнителя, приглашение.
function renderOrderTeamBlock(o, editable) {
  const rows = (o.helpers || []).map(function (h) {
    const st = (o.confirm && o.confirm[h]) || 'ok';
    const label = CONFIRM_LABELS[st] || CONFIRM_LABELS.ok;
    return '<div class="est-row"><span>' + escapeHtml(h) + '</span>' +
      '<span class="badge ' + label[1] + '">' + label[0] + '</span></div>';
  });

  let actions = '';
  if (showTakeBtn(o)) actions += takeButton(o);
  if (isMyPendingConfirm(o)) {
    actions += '<div class="row" style="margin-top:8px">' +
      '<button class="btn btn-primary" data-confirm-helper="' + o.id + '|ok" style="flex:1">✅ Принять</button>' +
      '<button class="btn btn-danger" data-confirm-helper="' + o.id + '|no" style="flex:1">Отказаться</button>' +
    '</div>';
  }
  if (editable && can('order_assign')) {
    actions += '<button class="btn" data-add-helper="' + o.id + '" style="margin-top:8px">＋ Соисполнитель</button>';
  }

  return '<div class="card info-block">' +
      '<h4>Исполнители</h4>' +
      '<div>Основной: <b>' + escapeHtml(o.worker || '— не назначен —') + '</b></div>' +
      (rows.length
        ? '<div class="muted">Соисполнители:</div>' + rows.join('')
        : '<div class="muted">Соисполнители: —</div>') +
      actions +
    '</div>';
}

// Заявка по id (общий поиск для обработчиков карточки).
function findOrderById(id) {
  return (DB.orders || []).find(function (x) { return x.id === id; }) || null;
}

// Взять заявку: спереди проверка слота, иначе мягкая модалка конфликта (как в календаре).
function doTakeOrder(id) {
  const o = findOrderById(id);
  if (!o) return;
  if (!canTakeOrder(o)) { toast('Заявку нельзя взять', true); return; }
  const probe = { date: o.date, t1: o.t1, t2: o.t2, worker: state.user };
  const conflicts = (typeof checkTimeConflict === 'function') ? checkTimeConflict(probe) : [];
  if (conflicts.length) {
    window.__takePending = id;
    showTakeConflictModal(conflicts);
    return;
  }
  applyTakeOrder(id);
}

function applyTakeOrder(id) {
  const o = findOrderById(id);
  if (!o) return false;
  const res = takeOrder(o);
  if (!res.ok) { toast(res.reason, true); return false; }
  toast('Заявка №' + id + ' взята в работу');
  render();
  return true;
}

// Пересечение при взятии — своя модалка: кнопка «Всё равно взять» относится
// к назначению, а не к созданию заявки (data-force-order занят календарём).
function showTakeConflictModal(conflicts) {
  const nums = conflicts.map(function (o) { return '№' + o.id; }).join(', ');
  showModal(
    '<h3>⚠️ Пересечение по времени</h3>' +
    '<p>У вас уже есть заявки в это время: <b>' + nums + '</b>.</p>' +
    '<p class="small muted">Если это один подъезд или адреса рядом, брать можно.</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-force-take style="flex:1">✅ Всё равно взять</button>' +
    '</div>'
  );
}

// Приглашение соисполнителя: выбор из сотрудников, кроме занятых на этой заявке.
function renderHelperModal(o) {
  const taken = (o.helpers || []).concat(o.worker ? [o.worker] : []).concat([state.user]);
  const names = (DB.users || [])
    .map(function (u) { return u.name; })
    .filter(function (n) { return n && taken.indexOf(n) < 0; });
  if (!names.length) { toast('Все сотрудники уже на заявке', true); return; }
  showModal(
    '<h3>Соисполнитель к заявке №' + o.id + '</h3>' +
    '<label class="field"><span>Сотрудник</span><select id="helper-name">' +
      names.map(function (n) { return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; }).join('') +
    '</select></label>' +
    '<p class="small muted">Сотрудник получит приглашение и должен подтвердить участие.</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-helper="' + o.id + '" style="flex:1">Пригласить</button>' +
    '</div>'
  );
}

// --- Перенос остатка: модалка (Этап 15) ---

function renderFollowUpModal(o) {
  showModal(
    '<h3>Перенос остатка заявки №' + o.id + '</h3>' +
    '<p class="small muted">Работы «в работе» и материалы «нужно купить» уйдут в новую заявку. ' +
    'Выполненные строки войдут в промежуточный акт.</p>' +
    '<label class="field"><span>Дата новой заявки</span>' +
      '<input id="fu-date" type="date" value="' + (o.date || localToday()) + '"></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-create-followup="' + o.id + '" style="flex:1">Создать дочернюю</button>' +
    '</div>'
  );
}

// Перенос остатка: открываем модалку, либо сразу создаём (без даты).
function doFollowUp(id) {
  var o = findOrderById(id);
  if (!o) return;
  if (!canEditOrder(o)) { toast('Нельзя переносить', true); return; }
  renderFollowUpModal(o);
}

// --- 4. Вкладка «Смета» (заглушка, перенесена в ui-estimate.js) ---

// renderEstimateTab подключён из ui-estimate.js (Этап 6)

// --- 5. Модалка создания заявки ---

function renderCreateOrderModal() {
  var clients = (DB.clients || []).map(function (c) {
    return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
  }).join('');
  showModal(
    '<h3>Новая заявка</h3>' +
    '<label class="field"><span>Контрагент</span><select id="co-client-id"><option value="">— вручную —</option>' + clients + '</select></label>' +
    '<label class="field"><span>Клиент *</span><input id="nc-client" type="text"></label>' +
    '<label class="field"><span>Телефон</span><input id="nc-phone" type="tel"></label>' +
    '<label class="field"><span>Адрес</span><input id="nc-address" type="text"></label>' +
    '<label class="field"><span>Дата</span><input id="nc-date" type="date" value="' + localToday() + '"></label>' +
    '<div class="row">' +
      '<label class="field" style="flex:1"><span>Время с</span><input id="nc-t1" type="time" value="09:00"></label>' +
      '<label class="field" style="flex:1"><span>Время до</span><input id="nc-t2" type="time" value="12:00"></label>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-order style="flex:1">Создать</button>' +
    '</div>'
  );
}

// --- Делегирование событий этого модуля ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  const createBtn = sel('[data-create-modal]');
  if (createBtn) { renderCreateOrderModal(); return; }

  const closeBtn = sel('[data-close]');
  if (closeBtn) { closeModal(); return; }

  const overlay = sel('[data-modal-overlay]');
  if (overlay && ev.target === overlay) { closeModal(); return; }

  // Кнопки пула и подтверждения стоят ВНУТРИ карточки [data-order], поэтому их
  // проверяем раньше перехода по карточке — иначе клик откроет заявку.
  const takeBtn = sel('[data-take-order]');
  if (takeBtn) { doTakeOrder(Number(takeBtn.getAttribute('data-take-order'))); return; }

  // Подтверждение «Всё равно взять» в модалке пересечения при взятии.
  const forceTakeBtn = sel('[data-force-take]');
  if (forceTakeBtn) {
    if (window.__takePending === null || window.__takePending === undefined) {
      closeModal();
      return;
    }
    applyTakeOrder(window.__takePending);
    window.__takePending = null;
    closeModal();
    return;
  }

  const confirmBtn = sel('[data-confirm-helper]');
  if (confirmBtn) {
    const parts = String(confirmBtn.getAttribute('data-confirm-helper')).split('|');
    const o = findOrderById(Number(parts[0]));
    if (o && confirmHelper(o, state.user, parts[1])) {
      closeModal();
      toast(parts[1] === 'ok' ? 'Участие подтверждено' : 'Вы отказались от заявки');
      render();
    } else {
      toast('Подтверждение уже обработано', true);
    }
    return;
  }

  const addHelperBtn = sel('[data-add-helper]');
  if (addHelperBtn) {
    const o = findOrderById(Number(addHelperBtn.getAttribute('data-add-helper')));
    if (o) renderHelperModal(o);
    return;
  }

  const saveHelperBtn = sel('[data-save-helper]');
  if (saveHelperBtn) {
    const o = findOrderById(Number(saveHelperBtn.getAttribute('data-save-helper')));
    const sel2 = document.getElementById('helper-name');
    const name = sel2 ? sel2.value : '';
    if (!o) return;
    if (!assignHelper(o, name)) { toast('Не удалось пригласить сотрудника', true); return; }
    closeModal();
    toast(name + ' приглашён (ждёт подтверждения)');
    render();
    return;
  }

  const followupBtn = sel('[data-followup]');
  if (followupBtn) { doFollowUp(Number(followupBtn.getAttribute('data-followup'))); return; }

  const createFollowupBtn = sel('[data-create-followup]');
  if (createFollowupBtn) {
    var o = findOrderById(Number(createFollowupBtn.getAttribute('data-create-followup')));
    if (!o) return;
    var val = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    var child = createFollowUpOrder(o, { date: val('fu-date') || localToday() });
    if (!child) { toast('Не удалось создать дочернюю заявку', true); return; }
    closeModal();
    toast('Создана дочерняя заявка №' + orderDisplayNumber(child));
    render();
    return;
  }

  // Теги заявки (Этап 17): крестик на чипе и кнопка «свой тег».
  const removeTagBtn = sel('[data-remove-tag]');
  if (removeTagBtn) {
    const o = findOrderById(state.orderId);
    if (o && canEditOrder(o)) {
      removeTag(o, removeTagBtn.getAttribute('data-remove-tag'));
      render();
    }
    return;
  }

  const addCustomTagBtn = sel('[data-add-tag-custom]');
  if (addCustomTagBtn) {
    const o = findOrderById(state.orderId);
    const input = document.getElementById('tag-custom');
    const tag = input ? String(input.value).trim() : '';
    if (!o || !canEditOrder(o)) return;
    if (!tag) { toast('Введите тег', true); return; }
    if (!addTag(o, tag)) { toast('Такой тег уже есть', true); return; }
    render();
    return;
  }

  const card = sel('[data-order]');
  if (card) { ORD_TAB = 'main'; go('order', Number(card.getAttribute('data-order'))); return; }

  const chip = sel('[data-filter]');
  if (chip) { state.filter = chip.getAttribute('data-filter'); render(); return; }

  const tab = sel('[data-tab]');
  if (tab) { ORD_TAB = tab.getAttribute('data-tab'); render(); return; }

  const addWork = sel('[data-add-work]');
  if (addWork) { alert('Добавление работ — этап 5'); return; }

  const editBtn = sel('[data-edit-order]');
  if (editBtn) { toast('Редактирование заявки — этап 5'); return; }

  const saveBtn = sel('[data-save-order]');
  if (saveBtn) {
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const client = val('nc-client');
    if (!client) { toast('Укажите клиента', true); return; }
    const data = {
      client: client,
      phone: val('nc-phone'),
      address: val('nc-address'),
      date: val('nc-date') || localToday(),
      t1: val('nc-t1'),
      t2: val('nc-t2')
    };
    // Конфликт проверяем по текущему пользователю (он станет worker после назначения).
    data.worker = state.user;
    const conflicts = (typeof checkTimeConflict === 'function') ? checkTimeConflict(data) : [];
    if (conflicts.length) {
      window.__calPending = data; // «Всё равно взять» доукомплектует через finishCreateOrder
      showConflictModal(conflicts, data);
      return;
    }
    saveOrderWithClient(data);
    closeModal();
    state.filter = 'all';
    go('orders');
    return;
  }
});

// Создание заявки с привязкой к контрагенту (Этап 16): o.clientId + orderIds
// контрагента + clientLegal для юрлиц (документы берут отсюда реквизиты).
function saveOrderWithClient(data) {
  const selEl = document.getElementById('co-client-id');
  const cid = selEl ? Number(selEl.value) : 0;
  const c = cid ? (DB.clients || []).find(function (x) { return x.id === cid; }) : null;
  if (c) {
    data.clientId = c.id;
    if (c.kind === 'company' || c.kind === 'ip') {
      data.clientLegal = {
        name: c.name, inn: c.inn || '', kpp: c.kpp || '',
        ogrn: c.ogrn || '', phone: c.phone || ''
      };
    }
  }
  const o = createOrder(data);
  if (c && o) {
    if (!Array.isArray(c.orderIds)) c.orderIds = [];
    c.orderIds.push(o.id);
    save();
  }
  return o;
}

// Смена статуса — событие change (не click).
document.addEventListener('change', function (ev) {
  const select = ev.target.closest && ev.target.closest('[data-status-select]');
  if (select) {
    const id = Number(select.getAttribute('data-status-select'));
    const ns = select.value;
    if (!ns) return;
    if (transitionOrder(id, ns)) {
      toast('Статус: ' + (STATUS_LABELS[ns] || ns));
      render();
      // Завершение с долгом: предлагаем напоминание об остатке (Этап 12).
      if (ns === 'completed' && typeof orderBalance === 'function' &&
          typeof showBalanceReminderModal === 'function') {
        const done = (DB.orders || []).find(function (x) { return x.id === id; });
        if (done && orderBalance(done) > 0) showBalanceReminderModal(done);
      }
    } else {
      toast('Переход не разрешён', true);
    }
    return;
  }

  // Выбор контрагента из справочника — подставляем реквизиты в форму (Этап 16).
  const clientSel = ev.target.closest && ev.target.closest('#co-client-id');
  if (clientSel) {
    const cid = Number(clientSel.value);
    const c = (DB.clients || []).find(function (x) { return x.id === cid; });
    const set = function (id, v) {
      const el = document.getElementById(id);
      if (el) el.value = v || '';
    };
    if (!c) { set('nc-client', ''); set('nc-phone', ''); set('nc-address', ''); return; }
    set('nc-client', c.name);
    set('nc-phone', c.phone);
    set('nc-address', [c.city, c.address].filter(Boolean).join(', '));
    return;
  }

  // Фильтр списка по тегу (Этап 17): значение 'tag:Тег', пусто — все.
  const tagFilter = ev.target.closest && ev.target.closest('[data-tag-filter]');
  if (tagFilter) {
    const t = String(tagFilter.value || '').trim();
    state.filter = t ? 'tag:' + t : 'all';
    render();
    return;
  }

  // Добавление тега-пресета к открытой заявке (Этап 17).
  const tagPreset = ev.target.closest && ev.target.closest('[data-add-tag-preset]');
  if (tagPreset) {
    const o = findOrderById(state.orderId);
    const tag = String(tagPreset.value || '').trim();
    if (!o || !tag) return;
    if (!canEditOrder(o)) { toast('Нельзя редактировать заявку', true); return; }
    if (!addTag(o, tag)) { toast('Такой тег уже есть', true); return; }
    render();
    return;
  }
});
