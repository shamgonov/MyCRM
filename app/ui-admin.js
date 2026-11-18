/* CRM2 :: app/ui-admin.js — администрирование: сотрудники, реквизиты, прайс (Этап 11).
   Только data-* + делегирование; инлайн-скриптов и внешних библиотек нет.
   Зависит от db.js (DB, save, money, escapeHtml), auth.js (state, can),
   core.js (render, showModal, closeModal, toast). */
'use strict';

// Активный таб админки (переживает перерисовки, как ORD_TAB в ui-orders.js).
var ADMIN_TAB = 'employees';
var ADMIN_SUP_SEARCH = '';   // live-поиск в админке: поставщики (Этап 38)
var PRICE_SEARCH = ''; // live-поиск в админке: прайс (Этап 38)

// Поле live-поиска для админки (Этап 38): id, значение, плейсхолдер,
// data-атрибут кнопки очистки.
function adminSearchRow(id, value, placeholder, clearAttr) {
  return '<div class="search-row">' +
      '<input type="search" id="' + id + '" class="search-input" ' +
        'placeholder="' + placeholder + '" value="' + escapeHtml(value) + '">' +
      (value ? '<button class="btn" ' + clearAttr + ' title="Очистить">✕</button>' : '') +
    '</div>';
}

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

const COLS_EMP = 'minmax(80px, 1.2fr) minmax(80px, 1.3fr) minmax(60px, 1fr) minmax(60px, .9fr) minmax(40px, .5fr)';
const COLS_PRICE = 'minmax(100px, 1.6fr) minmax(60px, 1fr) minmax(50px, .8fr) minmax(40px, .6fr) minmax(60px, 1fr)';
const COLS_SUPP = 'minmax(90px, 1.4fr) minmax(70px, 1fr) minmax(80px, 1.3fr) minmax(60px, .9fr) minmax(50px, .8fr)';

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
  const all = DB.priceList || [];
  // Live-поиск (Этап 38): название / категория / ед. изм.
  const pq = String(PRICE_SEARCH || '').toLowerCase();
  const items = pq
    ? all.filter(function (p) {
        return (p.name || '').toLowerCase().indexOf(pq) >= 0 ||
               (p.category || '').toLowerCase().indexOf(pq) >= 0 ||
               (p.unit || '').toLowerCase().indexOf(pq) >= 0;
      })
    : all;
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
  }).join('') || (pq
    ? '<p class="muted">Ничего не найдено по запросу «' + escapeHtml(PRICE_SEARCH) + '»</p>'
    : '<p class="muted">Прайс-лист пуст.</p>');

  return '<div class="card">' +
      '<div class="spread"><h4>Прайс-лист</h4>' +
        '<button class="btn btn-primary" data-add-price>➕ Добавить позицию</button>' +
      '</div>' +
      // id отличается от #price-search модалки ui-estimate.js (Этап 17):
      // иначе ввод в модалке «Работа из прайса» засорял бы PRICE_SEARCH.
      adminSearchRow('admin-price-search', PRICE_SEARCH,
        '🔍 Поиск по названию, категории, ед. изм...', 'data-clear-price-search') +
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

// --- 5. Поставщики (Этап 18) ---

function renderAdminSuppliers() {
  const all = DB.suppliers || [];
  // Live-поиск (Этап 38): название / телефон / адрес / часы.
  const sq = String(ADMIN_SUP_SEARCH || '').toLowerCase();
  const sups = sq
    ? all.filter(function (s) {
        return (s.name || '').toLowerCase().indexOf(sq) >= 0 ||
               (s.phone || '').toLowerCase().indexOf(sq) >= 0 ||
               (s.address || '').toLowerCase().indexOf(sq) >= 0 ||
               (s.hours || '').toLowerCase().indexOf(sq) >= 0;
      })
    : all;
  const rows = sups.map(function (s) {
    return arow([
      escapeHtml(s.name || '—'),
      '<span class="small">' + escapeHtml(s.phone || '—') + '</span>',
      '<span class="small">' + escapeHtml(s.address || '—') + '</span>',
      '<span class="small">' + escapeHtml(s.hours || '—') + '</span>',
      '<span class="row">' +
        '<button class="btn" data-edit-supplier="' + s.id + '" title="Редактировать">✎</button>' +
        '<button class="btn btn-danger" data-delete-supplier="' + s.id + '" title="Удалить">🗑</button>' +
      '</span>'
    ], false, COLS_SUPP);
  }).join('') || (sq
    ? '<p class="muted">Ничего не найдено по запросу «' + escapeHtml(ADMIN_SUP_SEARCH) + '»</p>'
    : '<p class="muted">Поставщиков нет.</p>');

  return '<div class="card">' +
      '<div class="spread"><h4>Поставщики</h4>' +
        '<button class="btn btn-primary" data-add-supplier>➕ Добавить поставщика</button>' +
      '</div>' +
      adminSearchRow('sup-search', ADMIN_SUP_SEARCH,
        '🔍 Поиск по названию, телефону, адресу...', 'data-clear-sup-search') +
      arow(['Название', 'Телефон', 'Адрес', 'Часы работы', 'Действия'], true, COLS_SUPP) +
      rows +
    '</div>' +
    '<div class="card">' +
      '<h4>Склад</h4>' +
      '<label class="field"><span>Адрес склада (для маршрута закупки)</span>' +
        '<input id="wh-address" type="text" value="' +
        escapeHtml((DB.settings && DB.settings.warehouseAddress) || '') + '"></label>' +
      '<button class="btn btn-block" data-save-warehouse>💾 Сохранить адрес склада</button>' +
    '</div>';
}

// Модалка добавления/редактирования поставщика (без id — новый).
function renderSupplierModal(supplier) {
  const s = supplier || { id: null, name: '', phone: '', address: '', hours: '', note: '' };
  window.__supplierEdit = { id: (supplier && supplier.id) || null };

  const field = function (label, id, value, type) {
    return '<label class="field"><span>' + label + '</span>' +
      '<input id="' + id + '" type="' + (type || 'text') + '" value="' + escapeHtml(value || '') + '"></label>';
  };

  showModal(
    '<h3>' + (s.id ? '✎ Поставщик' : '➕ Новый поставщик') + '</h3>' +
    field('Название *', 'sp-name', s.name) +
    field('Телефон', 'sp-phone', s.phone, 'tel') +
    field('Адрес', 'sp-address', s.address) +
    field('Часы работы', 'sp-hours', s.hours) +
    '<label class="field"><span>Примечание (ассортимент)</span>' +
      '<textarea id="sp-note" rows="2">' + escapeHtml(s.note || '') + '</textarea></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-supplier style="flex:1">Сохранить</button>' +
    '</div>'
  );
}

// --- 1. Главный экран админки ---

// --- Вкладка «Доступ» (Этап 14-B): облачные пользователи users/{uid} ---

function accessRoleOptions(cur) {
  return ['owner','admin','manager','operator','worker'].map(function (r) {
    return '<option value="' + r + '"' + (r === cur ? ' selected' : '') + '>' + r + '</option>';
  }).join('');
}
function renderAdminAccess() {
  var list = (DB.users || []).filter(function (u) { return u.uid && String(u.id) === String(u.uid); });
  if (!list.length) {
    return '<div class="card"><p class="muted">Облачных пользователей пока нет. ' +
      'Попросите коллегу открыть ссылку и войти.</p></div>';
  }
  var rows = list.map(function (u) {
    var pending = u.status !== 'approved';
    return arow([
      escapeHtml(u.name || '—'),
      '<span class="small">' + escapeHtml(String(u.uid).slice(0, 8)) + '…</span>',
      '<select data-access-role="' + u.id + '">' + accessRoleOptions(u.role || 'worker') + '</select>',
      pending ? '<span class="badge badge-warn">ожидает</span>' : '<span class="badge badge-ok">доступен</span>',
      '<span class="row">' +
        (pending ? '<button class="btn btn-primary" data-access-approve="' + u.id + '">✅</button>' : '') +
        '<button class="btn btn-danger" data-access-block="' + u.id + '">🚫</button>' +
      '</span>'
    ], false, COLS_EMP);
  }).join('');
  return '<div class="card">' +
    '<h4>Доступ к общей базе</h4>' +
    arow(['Имя','UID','Роль','Статус',''], true, COLS_EMP) + rows +
    '<p class="small muted">Роль и статус пишутся в users/{uid} — их читают правила Firestore.</p>' +
    '</div>';
}
// setAccess(id, patch): правка users/{uid} + отправка в облако.
function setAccess(id, patch) {
  var u = (DB.users || []).find(function (x) { return String(x.id) === String(id); });
  if (!u) return false;
  Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
  save();
  if (typeof collectionSave === 'function') collectionSave('users', u);
  return true;
}

function renderAdmin() {
  const tabs = [
    ['employees', '👥 Сотрудники'], ['access', '🔑 Доступ'],
    ['requisites', '🏢 Реквизиты'],
    ['price', '📋 Прайс'], ['suppliers', '🚚 Поставщики']
  ];
  const tabHtml = tabs.map(function (t) {
    return '<button class="tab-btn' + (ADMIN_TAB === t[0] ? ' active' : '') +
      '" data-admin-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');

  let body;
  if (ADMIN_TAB === 'requisites') body = renderAdminRequisites();
  else if (ADMIN_TAB === 'price') body = renderAdminPrice();
  else if (ADMIN_TAB === 'suppliers') body = renderAdminSuppliers();
  else if (ADMIN_TAB === 'access') body = renderAdminAccess();
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
  if (typeof settingsSave === 'function') settingsSave();
  return true;
}

function changeUserRole(userId, newRole) {
  if (ADMIN_ROLES.indexOf(newRole) < 0) return false;
  const user = (DB.users || []).find(function (u) { return String(u.id) === String(userId); });
  if (!user) return false;
  user.role = newRole;
  save();
  if (typeof collectionSave === 'function') collectionSave('users', user);
  return true;
}

// «Уволить» = статус fired: запись остаётся в истории заявок.
function fireEmployee(userId) {
  const user = (DB.users || []).find(function (u) { return String(u.id) === String(userId); });
  if (!user) return false;
  user.status = 'fired';
  save();
  if (typeof collectionSave === 'function') collectionSave('users', user);
  return true;
}

function deletePriceItem(id) {
  const pid = Number(id);
  const idx = (DB.priceList || []).findIndex(function (p) { return Number(p.id) === pid; });
  if (idx < 0) return false;
  DB.priceList.splice(idx, 1);
  save();
  if (typeof collectionDelete === 'function') collectionDelete('priceList', id);
  return true;
}

// --- Делегирование событий ---

// Live-поиск в админке (Этап 38): прайс и поставщики, debounce 300ms.
// Фокус возвращаем после render() — поле пересоздаётся.
function restoreSearchFocus(id) {
  const again = document.getElementById(id);
  if (!again) return;
  try {
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  } catch (e) { /* без позиции каретки */ }
}

document.addEventListener('input', debounce(function (ev) {
  const el = ev.target;
  if (!el) return;
  if (el.id === 'sup-search') {
    ADMIN_SUP_SEARCH = String(el.value || '').trim();
    render();
    restoreSearchFocus('sup-search');
    return;
  }
  if (el.id === 'admin-price-search') {
    PRICE_SEARCH = String(el.value || '').trim();
    render();
    restoreSearchFocus('admin-price-search');
  }
}, 300));

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  // Очистка поиска (Этап 38).
  if (sel('[data-clear-sup-search]')) { ADMIN_SUP_SEARCH = ''; render(); return; }
  if (sel('[data-clear-price-search]')) { PRICE_SEARCH = ''; render(); return; }

  const tab = sel('[data-admin-tab]');
  if (tab) { ADMIN_TAB = tab.getAttribute('data-admin-tab'); render(); return; }

  // Доступ к общей базе (Этап 14-B): подтвердить/заблокировать/сменить роль.
  const approveBtn = sel('[data-access-approve]');
  if (approveBtn) {
    const aid = approveBtn.getAttribute('data-access-approve');
    if (setAccess(aid, { status: 'approved', active: true })) {
      toast('Доступ подтверждён');
    } else {
      toast('Пользователь не найден', true);
    }
    render();
    return;
  }

  const blockBtn = sel('[data-access-block]');
  if (blockBtn) {
    const bid = blockBtn.getAttribute('data-access-block');
    if (confirm('Закрыть доступ к общей базе?')) {
      if (setAccess(bid, { status: 'fired', active: false })) {
        toast('Доступ закрыт');
      } else {
        toast('Пользователь не найден', true);
      }
      render();
    }
    return;
  }

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
    const newEmp = { id: 'u' + Date.now(), name: name, phone: valOf('ae-phone'), role: valOf('ae-role') || 'worker' };
    DB.users.push(newEmp);
    save();
    if (typeof collectionSave === 'function') collectionSave('users', newEmp);
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
    let saved = data; // для хука: обновлённая позиция либо новая
    if (eid) {
      const existing = DB.priceList.find(function (p) { return Number(p.id) === Number(eid); });
      if (existing) { Object.assign(existing, data); saved = existing; }
    } else {
      data.id = Math.max(0, ...DB.priceList.map(function (p) { return Number(p.id) || 0; })) + 1;
      DB.priceList.push(data);
    }
    save();
    if (typeof collectionSave === 'function') collectionSave('priceList', saved);
    closeModal();
    toast('Прайс сохранён');
    render();
    return;
  }

  // --- Поставщики (Этап 18) ---

  const addSupp = sel('[data-add-supplier]');
  if (addSupp) { renderSupplierModal(null); return; }

  const editSupp = sel('[data-edit-supplier]');
  if (editSupp) {
    const s = findSupplier(editSupp.getAttribute('data-edit-supplier'));
    if (s) renderSupplierModal(s);
    return;
  }

  const delSupp = sel('[data-delete-supplier]');
  if (delSupp) {
    if (confirm('Удалить поставщика?')) {
      if (deleteSupplier(delSupp.getAttribute('data-delete-supplier'))) {
        toast('Поставщик удалён');
        render();
      }
    }
    return;
  }

  const saveSupp = sel('[data-save-supplier]');
  if (saveSupp) {
    const name = valOf('sp-name');
    if (!name) { toast('Укажите название', true); return; }
    const data = {
      id: window.__supplierEdit ? window.__supplierEdit.id : null,
      name: name,
      phone: valOf('sp-phone'),
      address: valOf('sp-address'),
      hours: valOf('sp-hours'),
      note: valOf('sp-note')
    };
    const saved = saveSupplier(data);
    if (!saved) { toast('Не удалось сохранить', true); return; }
    window.__supplierEdit = null;
    closeModal();
    toast('Поставщик сохранён');
    render();
    return;
  }

  const saveWh = sel('[data-save-warehouse]');
  if (saveWh) {
    if (!DB.settings) DB.settings = {};
    DB.settings.warehouseAddress = valOf('wh-address');
    save();
    toast('Адрес склада сохранён');
    return;
  }
});

// Смену роли читаем на change: click не отражает выбор option.
document.addEventListener('change', function (ev) {
  // Смена роли облачного пользователя на вкладке «Доступ» (Этап 14-B).
  const accessSel = ev.target.closest && ev.target.closest('[data-access-role]');
  if (accessSel) {
    const aid = accessSel.getAttribute('data-access-role');
    if (setAccess(aid, { role: accessSel.value })) {
      toast('Роль доступа обновлена');
    } else {
      toast('Пользователь не найден', true);
    }
    render();
    return;
  }

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
window.renderAdminAccess = renderAdminAccess;
window.setAccess = setAccess;
window.accessRoleOptions = accessRoleOptions;
