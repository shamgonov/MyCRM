/* CRM2 :: app/ui-clients.js — справочник контрагентов (Этап 16).
   Зависит от db.js, auth.js, core.js (go/render/showModal/toast). */
'use strict';

var CL_TAB = 'list'; // 'list' | 'card'

// --- 1. Экран «Контрагенты» ---

function renderClients() {
  if (CL_TAB === 'card' && state.clientId) {
    var c = (DB.clients || []).find(function (x) { return x.id === state.clientId; });
    if (c) return renderClientCard(c);
    CL_TAB = 'list';
  }
  return renderClientList();
}

// --- 2. Список контрагентов ---

function renderClientList() {
  var list = DB.clients || [];
  var rows = list.map(function (c) {
    var count = (c.orderIds || []).length;
    return '<div class="list-item" data-client="' + c.id + '">' +
      '<div class="spread">' +
        '<b>' + escapeHtml(c.name) + '</b>' +
        '<span>' +
          '<span class="badge">' + clientKindLabel(c.kind) + '</span>' +
          ' · ' + count + ' заяв.' +
        '</span>' +
      '</div>' +
      '<div class="small muted">' + escapeHtml([c.phone, c.inn].filter(Boolean).join(' · ')) + '</div>' +
    '</div>';
  });

  return '<div class="spread">' +
      '<h2>📇 Контрагенты</h2>' +
      (can('clients_edit')
        ? '<button class="btn btn-primary" data-new-client>＋ Контрагент</button>'
        : '') +
    '</div>' +
    '<div class="card">' +
      (rows.length
        ? '<div class="list">' + rows.join('') + '</div>'
        : '<p class="muted">Контрагентов пока нет.</p>') +
    '</div>';
}

function clientKindLabel(k) {
  if (k === 'ip') return 'ИП';
  if (k === 'company') return 'ЮЛ';
  return 'Физ. лицо';
}

// --- 3. Карточка контрагента ---

function renderClientCard(c) {
  // Журнал заявок (Этап 30): сортировка новые→старые, номер, дата, статус, сумма.
  var clientOrders = (c.orderIds || [])
    .map(function (id) {
      return (DB.orders || []).find(function (x) { return x.id === id; });
    })
    .filter(Boolean)
    .sort(function (a, b) {
      var da = String(a.date || '') + String(a.t1 || '');
      var db = String(b.date || '') + String(b.t1 || '');
      if (da === db) return (b.id || 0) - (a.id || 0);
      return da < db ? 1 : -1;
    });
  var orders = clientOrders.map(function (o) {
    var label = STATUS_LABELS[o.status] || o.status;
    var sum = (typeof calculateOrderTotal === 'function') ? money(calculateOrderTotal(o)) : '';
    return '<div class="list-item" data-order="' + o.id + '" style="margin-top:6px">' +
      '<div class="spread">' +
        '<b>№' + escapeHtml(orderDisplayNumber(o)) + '</b>' +
        '<span class="' + statusBadgeClass(o.status) + '">' + escapeHtml(label) + '</span>' +
      '</div>' +
      '<div class="small muted">' + escapeHtml(o.date || '—') +
        (o.t1 ? ' ' + escapeHtml(o.t1) : '') +
        (sum ? ' · ' + escapeHtml(sum) : '') + '</div>' +
    '</div>';
  }).join('');

  var docLines = [
    'ИНН ' + (c.inn || '—'),
    'КПП ' + (c.kpp || '—'),
    'ОГРН ' + (c.ogrn || '—'),
    'Тел.: ' + (c.phone || '—'),
    'Email: ' + (c.email || '—'),
    'Адрес: ' + ([c.city, c.address].filter(Boolean).join(', '))
  ];

  var actions = '';
  if (can('clients_edit')) {
    actions = '<button class="btn" data-edit-client="' + c.id + '" style="margin-top:10px">✎ Редактировать</button>' +
      '<button class="btn btn-danger" data-del-client="' + c.id + '" style="margin-top:10px">🗑 Удалить</button>';
  }

  return '<div class="head-row">' +
      '<button class="btn" data-clients-back>←</button>' +
      '<h2>' + escapeHtml(c.name) + '</h2>' +
      '<span class="badge">' + clientKindLabel(c.kind) + '</span>' +
    '</div>' +
    (can('clients_edit')
      ? '<div class="row" style="margin-top:8px;gap:6px">' +
          '<button class="btn btn-primary" data-new-order-from-client="' + c.id + '" style="flex:1">➕ Новая заявка</button>' +
          '<button class="btn" data-import-contact style="flex:1">📥 Из телефонной книги</button>' +
        '</div>'
      : '') +
    '<div class="card info-block">' +
      '<h4>Реквизиты</h4>' +
      docLines.map(function (l) { return '<div class="est-row"><span>' + l + '</span></div>'; }).join('') +
    '</div>' +
    '<div class="card info-block">' +
      '<h4>Журнал заявок (' + clientOrders.length + ')</h4>' +
      (orders || '<p class="muted">Заявок нет.</p>') +
    '</div>' +
    (c.notes ? '<div class="card"><h4>Заметки</h4><p>' + escapeHtml(c.notes) + '</p></div>' : '') +
    actions;
}

// --- 4. Модалка создания/редактирования ---

function renderClientEditModal(client) {
  var isEdit = !!client;
  var k = client ? client.kind : 'person';
  var kinds = [
    '<option value="person"' + (k === 'person' ? ' selected' : '') + '>Физ. лицо</option>',
    '<option value="ip"' + (k === 'ip' ? ' selected' : '') + '>ИП</option>',
    '<option value="company"' + (k === 'company' ? ' selected' : '') + '>ЮЛ</option>'
  ].join('');

  showModal(
    '<h3>' + (isEdit ? 'Редактирование' : 'Новый') + ' контрагент</h3>' +
    '<label class="field"><span>Название / ФИО *</span><input id="cl-name" type="text" value="' + (client ? escapeHtml(client.name) : '') + '"></label>' +
    '<label class="field"><span>Тип</span><select id="cl-kind">' + kinds + '</select></label>' +
    '<label class="field"><span>ИНН</span><input id="cl-inn" type="text" value="' + (client ? escapeHtml(client.inn || '') : '') + '"></label>' +
    '<label class="field"><span>КПП</span><input id="cl-kpp" type="text" value="' + (client ? escapeHtml(client.kpp || '') : '') + '"></label>' +
    '<label class="field"><span>ОГРН</span><input id="cl-ogrn" type="text" value="' + (client ? escapeHtml(client.ogrn || '') : '') + '"></label>' +
    '<label class="field"><span>Телефон</span><input id="cl-phone" type="tel" value="' + (client ? escapeHtml(client.phone || '') : '') + '"></label>' +
    '<label class="field"><span>Email</span><input id="cl-email" type="email" value="' + (client ? escapeHtml(client.email || '') : '') + '"></label>' +
    '<label class="field"><span>Город</span><input id="cl-city" type="text" value="' + (client ? escapeHtml(client.city || '') : '') + '"></label>' +
    '<label class="field"><span>Адрес</span><input id="cl-address" type="text" value="' + (client ? escapeHtml(client.address || '') : '') + '"></label>' +
    '<label class="field"><span>Заметки</span><input id="cl-notes" type="text" value="' + (client ? escapeHtml(client.notes || '') : '') + '"></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-client="' + (isEdit ? client.id : '') + '" style="flex:1">' +
        (isEdit ? 'Сохранить' : 'Создать') + '</button>' +
    '</div>'
  );
}

// --- 5. Дедупликация: поиск похожих ---

function normalizeClientName(s) {
  if (!s) return '';
  var n = s.trim().toUpperCase();
  // Убираем лишние кавычки и пробелы.
  n = n.replace(/['""]/g, '').replace(/\s+/g, ' ');
  // Переводим суффиксы в начало.
  n = n.replace(/^(АО|ООО|ЗАО|ОАО|СПб|ИП)\s*/i, '');
  return n;
}

function findSimilarClients(name, phone) {
  var norm = normalizeClientName(name);
  if (!norm) return [];
  var list = DB.clients || [];
  return list.filter(function (c) {
    var cn = normalizeClientName(c.name);
    if (!cn) return false;
    if (cn === norm) return true;
    if (cn.indexOf(norm) >= 0 || norm.indexOf(cn) >= 0) return true;
    if (phone && c.phone && phone.replace(/\D/g, '') === c.phone.replace(/\D/g, '')) return true;
    return false;
  });
}

// --- 5.1 Создание контрагента (Этап 30): общая для формы и авто-привязки ---
// addClient(data) → id созданной карточки; null, если дубль и пользователь
// отказался создавать дубль. Проверка дублей — только при checkDuplicates.
function addClient(data, checkDuplicates) {
  if (!data || !data.name) return null;
  if (!Array.isArray(DB.clients)) DB.clients = [];
  if (checkDuplicates !== false) {
    var similar = findSimilarClients(data.name, data.phone || '');
    if (similar.length) {
      var names = similar.map(function (s) { return s.name; }).join(', ');
      if (!confirm('Найден похожий контрагент: ' + names + '. Создать дубль?')) return null;
    }
  }
  var maxId = 0;
  DB.clients.forEach(function (x) { if (x.id > maxId) maxId = x.id; });
  var newClient = Object.assign({
    id: maxId + 1,
    kind: 'person',
    createdAt: Date.now(),
    createdBy: state.user,
    orderIds: []
  }, data);
  if (!Array.isArray(newClient.orderIds)) newClient.orderIds = [];
  DB.clients.push(newClient);
  save();
  if (typeof collectionSave === 'function') collectionSave('clients', newClient);
  return newClient.id;
}

// --- 5.2 Импорт контрагента из телефонной книги (Этап 30) ---
// Contact Picker API есть не везде (нет на десктопе и в Firefox) — при
// недоступности открываем фолбэк-модалку ручного ввода.

// Парсинг вставленного текста: строка с цифрами (>=5) → телефон,
// первая не-телефонная строка → имя, остальные → адрес.
function parseContactText(txt) {
  var lines = String(txt || '').split('\n').map(function (l) {
    return l.trim();
  }).filter(Boolean);
  var res = { name: '', phone: '', address: '' };
  lines.forEach(function (l) {
    var digits = l.replace(/\D/g, '');
    if (!res.phone && digits.length >= 5 && /\d/.test(l)) { res.phone = l; return; }
    if (!res.name) { res.name = l; return; }
    res.address = res.address ? res.address + ', ' + l : l;
  });
  return res;
}

function renderPasteContactModal() {
  showModal(
    '<h3>📥 Контрагент из телефонной книги</h3>' +
    '<p class="small muted">Нативный выбор контактов недоступен в этом браузере. ' +
      'Вставьте данные вручную — по строке на значение.</p>' +
    '<label class="field"><span>Данные контакта</span>' +
      '<textarea id="pc-text" rows="4" ' +
        'placeholder="Иван\n+79001234567\nМосква"></textarea></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-paste-contact style="flex:1">Распознать</button>' +
    '</div>'
  );
}

// Открытие выбора контакта; при отказе/недоступности API — фолбэк-модалка.
function importFromPhone() {
  if (typeof navigator === 'undefined' || !navigator.contacts ||
      typeof navigator.contacts.select !== 'function') {
    renderPasteContactModal();
    return;
  }
  try {
    var p = navigator.contacts.select(['name', 'tel'], { multiple: false });
    if (!p || typeof p.then !== 'function') { renderPasteContactModal(); return; }
    p.then(function (list) {
      var ct = list && list.length ? list[0] : null;
      if (!ct) return; // пользователь отменил выбор
      var name = (ct.name && ct.name.length) ? ct.name[0] : '';
      var phone = (ct.tel && ct.tel.length) ? ct.tel[0] : '';
      if (!name && !phone) { renderPasteContactModal(); return; }
      finishImportContact({ name: name, phone: phone, address: '' });
    })['catch'](function () { renderPasteContactModal(); });
  } catch (e) {
    renderPasteContactModal();
  }
}

// Создание карточки по распознанным данным + переход в неё.
function finishImportContact(data) {
  if (!data || !data.name) { toast('Не удалось распознать имя', true); return false; }
  if (typeof can === 'function' && !can('clients_edit')) {
    toast('Нет права создавать контрагентов', true);
    return false;
  }
  var id = addClient({ name: data.name, phone: data.phone || '', address: data.address || '' }, true);
  if (id === null) { closeModal(); return false; }
  closeModal();
  CL_TAB = 'card';
  state.clientId = id;
  toast('Контрагент добавлен');
  render();
  return true;
}

// --- 6. Досье: собирает все телефоны/адреса из заявок ---

function buildClientDossier(client) {
  var phones = {}, addresses = {};
  (client.orderIds || []).forEach(function (id) {
    var o = (DB.orders || []).find(function (x) { return x.id === id; });
    if (!o) return;
    if (o.phone) phones[o.phone] = true;
    var addr = [o.city, o.address].filter(Boolean).join(', ');
    if (addr) addresses[addr] = true;
  });
  return { phones: Object.keys(phones), addresses: Object.keys(addresses) };
}

// --- Делегирование ---

document.addEventListener('click', function (ev) {
  var sel = function (s) { return ev.target.closest(s); };

  var backBtn = sel('[data-clients-back]');
  if (backBtn) { CL_TAB = 'list'; state.clientId = null; render(); return; }

  // ➕ Новая заявка из карточки контрагента (Этап 30): модалка заявки с
  // предзаполненными данными и выбранным контрагентом (привязку сделает
  // saveOrderWithClient через select #co-client-id).
  var newOrderBtn = sel('[data-new-order-from-client]');
  if (newOrderBtn) {
    var nid = Number(newOrderBtn.getAttribute('data-new-order-from-client'));
    var ncl = (DB.clients || []).find(function (x) { return x.id === nid; });
    if (!ncl) return;
    if (typeof renderCreateOrderModal !== 'function') {
      toast('Модуль заявок не загружен', true);
      return;
    }
    renderCreateOrderModal();
    var setVal = function (id, v) {
      var el = document.getElementById(id);
      if (el) el.value = v;
    };
    setVal('co-client-id', String(ncl.id));
    setVal('nc-client', ncl.name || '');
    setVal('nc-phone', ncl.phone || '');
    setVal('nc-address', [ncl.city, ncl.address].filter(Boolean).join(', '));
    state.clientId = ncl.id;
    return;
  }

  // 📥 Импорт из телефонной книги (Этап 30).
  var importBtn = sel('[data-import-contact]');
  if (importBtn) { importFromPhone(); return; }

  // «Распознать» в фолбэк-модалке ручного ввода контакта.
  var pasteBtn = sel('[data-paste-contact]');
  if (pasteBtn) {
    var ta = document.getElementById('pc-text');
    finishImportContact(parseContactText(ta ? ta.value : ''));
    return;
  }

  var newItem = sel('[data-new-client]');
  if (newItem) { renderClientEditModal(); return; }

  var client = sel('[data-client]');
  if (client) { CL_TAB = 'card'; state.clientId = Number(client.getAttribute('data-client')); render(); return; }

  var saveBtn = sel('[data-save-client]');
  if (saveBtn) {
    var val = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    var name = val('cl-name');
    if (!name) { toast('Укажите название/ФИО', true); return; }
    var clientData = {
      kind: val('cl-kind'),
      name: name,
      inn: val('cl-inn'),
      kpp: val('cl-kpp'),
      ogrn: val('cl-ogrn'),
      phone: val('cl-phone'),
      email: val('cl-email'),
      city: val('cl-city'),
      address: val('cl-address'),
      notes: val('cl-notes')
    };
    var editId = saveBtn.getAttribute('data-save-client');
    if (editId) {
      // Редактирование.
      var c = (DB.clients || []).find(function (x) { return x.id === Number(editId); });
      if (c) {
        Object.assign(c, clientData);
        save();
        if (typeof collectionSave === 'function') collectionSave('clients', c);
        toast('Контрагент обновлён');
      }
      closeModal();
      render();
      return;
    }
    // Создание (дедупликация и вставка — в addClient, Этап 30).
    var newId = addClient(clientData, true);
    if (newId === null) return;
    closeModal();
    state.clientId = newId;
    CL_TAB = 'card';
    toast('Контрагент создан');
    render();
    return;
  }

  var editBtn = sel('[data-edit-client]');
  if (editBtn) {
    var c = (DB.clients || []).find(function (x) { return x.id === Number(editBtn.getAttribute('data-edit-client')); });
    if (c) renderClientEditModal(c);
    return;
  }

  var delBtn = sel('[data-del-client]');
  if (delBtn) {
    var id = Number(delBtn.getAttribute('data-del-client'));
    if (!confirm('Удалить контрагента?')) return;
    var idx = (DB.clients || []).findIndex(function (x) { return x.id === id; });
    if (idx >= 0) DB.clients.splice(idx, 1);
    save();
    if (typeof collectionDelete === 'function') collectionDelete('clients', id);
    toast('Контрагент удалён');
    CL_TAB = 'list';
    render();
    return;
  }
});

window.renderClients = renderClients;
window.renderClientCard = renderClientCard;
window.renderClientList = renderClientList;
window.renderClientEditModal = renderClientEditModal;
window.findSimilarClients = findSimilarClients;
window.normalizeClientName = normalizeClientName;
window.buildClientDossier = buildClientDossier;
window.addClient = addClient;
window.importFromPhone = importFromPhone;
window.parseContactText = parseContactText;
window.renderPasteContactModal = renderPasteContactModal;
window.finishImportContact = finishImportContact;
