/* CRM2 :: app/ui-admin.js — администрирование: сотрудники, реквизиты, прайс (Этап 11).
   Только data-* + делегирование; инлайн-скриптов и внешних библиотек нет.
   Зависит от db.js (DB, save, money, escapeHtml), auth.js (state, can),
   core.js (render, showModal, closeModal, toast). */
'use strict';

// Активный таб админки (переживает перерисовки, как ORD_TAB в ui-orders.js).
var ADMIN_TAB = 'employees';

const ADMIN_ROLES = ['admin', 'manager', 'operator', 'worker'];
const ROLE_LABELS = { admin: 'Админ', manager: 'Менеджер', operator: 'Оператор', worker: 'Мастер' };
const PRICE_UNITS = ['шт', 'пог.м', 'компл', 'м²', 'м³', 'л', 'кг'];

function roleOptions(current) {
  return ADMIN_ROLES.map(function (r) {
    return '<option value="' + r + '"' + (r === current ? ' selected' : '') + '>' +
      (ROLE_LABELS[r] || r) + '</option>';
  }).join('');
}

// Строка таблицы админки. <td> вне <table> браузер при innerHTML отбрасывает,
// поэтому сетка задаётся grid'ом на div, как в отчётах (rrow).
function arow(cells, head, cols) {
  return '<div style="display:grid;grid-template-columns:' + cols + ';gap:8px;align-items:center;' +
      (head ? 'font-weight:700;color:var(--muted);font-size:12px;' : 'padding:4px 0;') + '">' +
    cells.map(function (c) { return '<span>' + c + '</span>'; }).join('') +
    '</div>';
}

const COLS_EMP = '1.2fr 1.3fr 1fr .9fr .5fr';
const COLS_PRICE = '1.6fr 1fr .8fr .6fr 1fr';

// --- 2. Сотрудники ---

function renderAdminEmployees() {
  const users = DB.users || [];
  const rows = users.map(function (u) {
    const fired = u.status === 'fired';
    const badge = fired
      ? '<span class="badge badge-danger">Уволен</span>'
      : '<span class="badge badge-ok">Активен</span>';
    const fireBtn = fired
      ? ''
      : '<button class="btn" data-fire="' + u.id + '" title="Уволить">🚫</button>';
    return arow([
      escapeHtml(u.name || '—'),
      '<span class="small">' + escapeHtml(u.phone || '—') + '</span>',
      '<select data-role-change="' + u.id + '">' + roleOptions(u.role || 'worker') + '</select>',
      badge,
      fireBtn
    ], false, COLS_EMP);
  }).join('') || '<p class="muted">Сотрудников нет.</p>';

  return '<div class="card">' +
      '<div class="spread"><h4>Сотрудники</h4>' +
        '<button class="btn btn-primary" data-add-employee>➕ Добавить сотрудника</button>' +
      '</div>' +
      arow(['Имя', 'Телефон', 'Роль', 'Статус', ''], true, COLS_EMP) +
      rows +
    '</div>';
}

// Модалка добавления сотрудника.
function renderAddEmployeeModal() {
  showModal(
    '<h3>➕ Новый сотрудник</h3>' +
    '<label class="field"><span>Имя *</span><input id="ae-name" type="text"></label>' +
    '<label class="field"><span>Телефон</span>' +
      '<input id="ae-phone" type="tel" placeholder="+7 900 000-00-00"></label>' +
    '<label class="field"><span>Роль</span>' +
      '<select id="ae-role">' + roleOptions('worker') + '</select></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-employee style="flex:1">Создать</button>' +
    '</div>'
  );
}

// --- 3. Реквизиты исполнителя ---

function renderAdminRequisites() {
  const s = DB.settings || {};
  const mode = s.executorMode || 'phys';

  const modeButtons = [['phys', 'Физ. лицо'], ['self_employed', 'Самозанятый'], ['legal', 'Юр. лицо']]
    .map(function (m) {
      return '<button class="chip' + (mode === m[0] ? ' active' : '') +
        '" data-mode="' + m[0] + '">' + m[1] + '</button>';
    }).join('');

  const field = function (label, id, value, type) {
    return '<label class="field"><span>' + label + '</span>' +
      '<input id="' + id + '" type="' + (type || 'text') + '" value="' + escapeHtml(value || '') + '"></label>';
  };

  let fields;
  if (mode === 'legal') {
    const l = s.executorLegal || {};
    fields = field('Название', 'req-name', l.name) + field('ИНН', 'req-inn', l.inn) +
      field('КПП', 'req-kpp', l.kpp) + field('Юр. адрес', 'req-address', l.address) +
      field('Банк', 'req-bank', l.bank) + field('БИК', 'req-bik', l.bik) +
      field('Р/с', 'req-account', l.account) + field('Директор', 'req-director', l.director) +
      field('Телефон', 'req-phone', l.phone, 'tel');
  } else if (mode === 'self_employed') {
    const e = s.executorSelfEmployed || {};
    fields = field('Имя', 'req-name', e.name) + field('ИНН', 'req-inn', e.inn) +
      field('Телефон', 'req-phone', e.phone, 'tel');
  } else {
    const p = s.executorPhys || {};
    fields = field('Имя', 'req-name', p.name) + field('Телефон', 'req-phone', p.phone, 'tel');
  }

  return '<div class="card">' +
      '<h4>Реквизиты исполнителя</h4>' +
      '<div class="chips" style="margin:8px 0">' + modeButtons + '</div>' +
      fields +
      '<button class="btn btn-block btn-primary" data-save-requisites style="margin-top:10px">' +
        '💾 Сохранить реквизиты</button>' +
    '</div>';
}

// --- 4. Прайс-лист ---

function renderAdminPrice() {
  const items = DB.priceList || [];
  const rows = items.map(function (p) {
    return arow([
      escapeHtml(p.name || '—'),
      '<span class="small">' + escapeHtml(p.category || '—') + '</span>',
      money(p.basePrice),
      escapeHtml(p.unit || 'шт'),
      '<span class="row">' +
        '<button class="btn" data-edit-price="' + p.id + '" title="Редактировать">✎</button>' +
        '<button class="btn btn-danger" data-delete-price="' + p.id + '" title="Удалить">🗑</button>' +
      '</span>'
    ], false, COLS_PRICE);
  }).join('') || '<p class="muted">Прайс-лист пуст.</p>';

  return '<div class="card">' +
      '<div class="spread"><h4>Прайс-лист</h4>' +
        '<button class="btn btn-primary" data-add-price>➕ Добавить позицию</button>' +
      '</div>' +
      arow(['Название', 'Категория', 'Цена', 'Ед.', 'Действия'], true, COLS_PRICE) +
      rows +
    '</div>';
}

// Модалка добавления/редактирования позиции прайса (id === null → новая).
function renderPriceModal(item) {
  const p = item || { id: null, name: '', category: '', basePrice: '', unit: 'шт', defaultQty: 1 };
  const unitOpts = PRICE_UNITS.map(function (u) {
    return '<option value="' + u + '"' + (p.unit === u ? ' selected' : '') + '>' + u + '</option>';
  }).join('');

  window.__priceEdit = { id: (item && item.id) || null };

  const field = function (label, id, value, type) {
    return '<label class="field"><span>' + label + '</span>' +
      '<input id="' + id + '" type="' + (type || 'text') + '" value="' + escapeHtml(value == null ? '' : value) + '"></label>';
  };

  showModal(
    '<h3>' + (p.id ? '✎ Позиция прайса' : '➕ Новая позиция прайса') + '</h3>' +
    field('Название *', 'pr-name', p.name) +
    field('Категория', 'pr-category', p.category) +
    field('Цена *', 'pr-price', p.basePrice, 'number') +
    '<label class="field"><span>Ед. изм.</span><select id="pr-unit">' + unitOpts + '</select></label>' +
    field('Кол-во по умолчанию', 'pr-qty', p.defaultQty, 'number') +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-price style="flex:1">Сохранить</button>' +
    '</div>'
  );
}

// --- 1. Главный экран админки ---

function renderAdmin() {
  const tabs = [['employees', '👥 Сотрудники'], ['requisites', '🏢 Реквизиты'], ['price', '📋 Прайс']];
  const tabHtml = tabs.map(function (t) {
    return '<button class="tab-btn' + (ADMIN_TAB === t[0] ? ' active' : '') +
      '" data-admin-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');

  let body;
  if (ADMIN_TAB === 'requisites') body = renderAdminRequisites();
  else if (ADMIN_TAB === 'price') body = renderAdminPrice();
  else body = renderAdminEmployees();

  return '<h2>⚙️ Администрирование</h2>' +
    '<div class="tabs">' + tabHtml + '</div>' +
    body;
}

// --- Действия (вызываются из делегирования) ---

function valOf(id) {
  const el = document.getElementById(id);
  return el ? String(el.value).trim() : '';
}

// Собирает форму по активному режиму и сохраняет в DB.settings.
function saveRequisitesFromForm() {
  if (!DB.settings) DB.settings = {};
  const mode = DB.settings.executorMode || 'phys';
  if (mode === 'legal') {
    DB.settings.executorLegal = {
      name: valOf('req-name'), inn: valOf('req-inn'), kpp: valOf('req-kpp'),
      address: valOf('req-address'), bank: valOf('req-bank'), bik: valOf('req-bik'),
      account: valOf('req-account'), director: valOf('req-director'), phone: valOf('req-phone')
    };
  } else if (mode === 'self_employed') {
    DB.settings.executorSelfEmployed = {
      name: valOf('req-name'), inn: valOf('req-inn'), phone: valOf('req-phone')
    };
  } else {
    DB.settings.executorPhys = { name: valOf('req-name'), phone: valOf('req-phone') };
  }
  save();
  return true;
}

function changeUserRole(userId, newRole) {
  if (ADMIN_ROLES.indexOf(newRole) < 0) return false;
  const user = (DB.users || []).find(function (u) { return String(u.id) === String(userId); });
  if (!user) return false;
  user.role = newRole;
  save();
  return true;
}

// «Уволить» = статус fired: запись остаётся в истории заявок.
function fireEmployee(userId) {
  const user = (DB.users || []).find(function (u) { return String(u.id) === String(userId); });
  if (!user) return false;
  user.status = 'fired';
  save();
  return true;
}

function deletePriceItem(id) {
  const pid = Number(id);
  const idx = (DB.priceList || []).findIndex(function (p) { return Number(p.id) === pid; });
  if (idx < 0) return false;
  DB.priceList.splice(idx, 1);
  save();
  return true;
}

// --- Делегирование событий ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  const tab = sel('[data-admin-tab]');
  if (tab) { ADMIN_TAB = tab.getAttribute('data-admin-tab'); render(); return; }

  const modeBtn = sel('[data-mode]');
  if (modeBtn) {
    if (!DB.settings) DB.settings = {};
    DB.settings.executorMode = modeBtn.getAttribute('data-mode');
    render();
    return;
  }

  const addEmp = sel('[data-add-employee]');
  if (addEmp) { renderAddEmployeeModal(); return; }

  const saveEmp = sel('[data-save-employee]');
  if (saveEmp) {
    const name = valOf('ae-name');
    if (!name) { toast('Укажите имя', true); return; }
    if (!DB.users) DB.users = [];
    DB.users.push({ id: 'u' + Date.now(), name: name, phone: valOf('ae-phone'), role: valOf('ae-role') || 'worker' });
    save();
    closeModal();
    toast('Сотрудник добавлен');
    render();
    return;
  }

  const fireBtn = sel('[data-fire]');
  if (fireBtn) {
    const fid = fireBtn.getAttribute('data-fire');
    const emp = (DB.users || []).find(function (u) { return String(u.id) === String(fid); });
    if (confirm('Уволить ' + ((emp && emp.name) || 'сотрудника') + '?')) {
      if (fireEmployee(fid)) { toast('Сотрудник уволен'); render(); }
      else toast('Сотрудник не найден', true);
    }
    return;
  }

  const saveReq = sel('[data-save-requisites]');
  if (saveReq) {
    if (saveRequisitesFromForm()) toast('Реквизиты сохранены');
    return;
  }

  const addPrice = sel('[data-add-price]');
  if (addPrice) { renderPriceModal(null); return; }

  const editPrice = sel('[data-edit-price]');
  if (editPrice) {
    const item = (DB.priceList || []).find(function (p) {
      return Number(p.id) === Number(editPrice.getAttribute('data-edit-price'));
    });
    if (item) renderPriceModal(item);
    return;
  }

  const delPrice = sel('[data-delete-price]');
  if (delPrice) {
    if (confirm('Удалить позицию прайса?')) {
      if (deletePriceItem(delPrice.getAttribute('data-delete-price'))) {
        toast('Позиция удалена');
        render();
      }
    }
    return;
  }

  const savePrice = sel('[data-save-price]');
  if (savePrice) {
    const name = valOf('pr-name');
    if (!name) { toast('Укажите название', true); return; }
    if (!Array.isArray(DB.priceList)) DB.priceList = [];
    const data = {
      name: name,
      category: valOf('pr-category'),
      basePrice: Number(valOf('pr-price')) || 0,
      unit: valOf('pr-unit') || 'шт',
      defaultQty: Number(valOf('pr-qty')) || 1
    };
    const eid = window.__priceEdit && window.__priceEdit.id;
    if (eid) {
      const existing = DB.priceList.find(function (p) { return Number(p.id) === Number(eid); });
      if (existing) Object.assign(existing, data);
    } else {
      data.id = Math.max(0, ...DB.priceList.map(function (p) { return Number(p.id) || 0; })) + 1;
      DB.priceList.push(data);
    }
    save();
    closeModal();
    toast('Прайс сохранён');
    render();
    return;
  }
});

// Смену роли читаем на change: click не отражает выбор option.
document.addEventListener('change', function (ev) {
  const select = ev.target.closest && ev.target.closest('[data-role-change]');
  if (!select) return;
  const uid = select.getAttribute('data-role-change');
  if (changeUserRole(uid, select.value)) {
    toast('Роль обновлена');
    render();
  } else {
    toast('Не удалось сменить роль', true);
  }
});

// Явный экспорт в window: экран вызывается из карты S (core.js).
window.renderAdmin = renderAdmin;
