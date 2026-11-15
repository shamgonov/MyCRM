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
  var orders = (c.orderIds || []).map(function (id) {
    var o = (DB.orders || []).find(function (x) { return x.id === id; });
    if (!o) return '';
    var label = STATUS_LABELS[o.status] || o.status;
    return '<div class="est-row">' +
      '<span>№' + o.id + ' · ' + escapeHtml(o.client) + '</span>' +
      '<span class="' + statusBadgeClass(o.status) + '">' + label + '</span>' +
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
    '<div class="card info-block">' +
      '<h4>Реквизиты</h4>' +
      docLines.map(function (l) { return '<div class="est-row"><span>' + l + '</span></div>'; }).join('') +
    '</div>' +
    '<div class="card info-block">' +
      '<h4>История заявок (' + (c.orderIds || []).length + ')</h4>' +
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
        toast('Контрагент обновлён');
      }
      closeModal();
      render();
      return;
    }
    // Создание с проверкой дублей.
    var similar = findSimilarClients(clientData.name, clientData.phone);
    if (similar.length) {
      var names = similar.map(function (s) { return s.name; }).join(', ');
      if (!confirm('Найден похожий контрагент: ' + names + '. Создать дубль?')) return;
    }
    var maxId = 0;
    (DB.clients || []).forEach(function (x) {
      if (x.id > maxId) maxId = x.id;
    });
    var newClient = Object.assign({
      id: maxId + 1,
      createdAt: Date.now(),
      createdBy: state.user,
      orderIds: []
    }, clientData);
    if (!Array.isArray(DB.clients)) DB.clients = [];
    DB.clients.push(newClient);
    save();
    closeModal();
    state.clientId = newClient.id;
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
