/* CRM2 :: app/ui-clients.js — справочник контрагентов (Этап 16).
   Зависит от db.js, auth.js, core.js (go/render/showModal/toast). */
'use strict';

var CL_TAB = 'list'; // 'list' | 'card' | 'suppliers'
var CL_SEARCH = '';  // live-поиск по контрагентам (Этап 38)
var SUP_SEARCH = ''; // live-поиск по поставщикам на вкладке (Этап 38)

// --- 1. Экран «Контрагенты» ---

function renderClients() {
  if (CL_TAB === 'suppliers') return renderSuppliersTab();
  if (CL_TAB === 'card' && state.clientId) {
    var c = (DB.clients || []).find(function (x) { return x.id === state.clientId; });
    if (c) return renderClientCard(c);
    CL_TAB = 'list';
  }
  return renderClientList();
}

// Панель вкладок экрана (Этап 31): список контрагентов / поставщики.
function renderClientsTabs() {
  var tabs = [['list', '📇 Контрагенты'], ['suppliers', '🚚 Поставщики']];
  return '<div class="chips">' + tabs.map(function (t) {
    var active = (CL_TAB === t[0] || (t[0] === 'list' && CL_TAB === 'card')) ? ' active' : '';
    return '<button class="chip' + active + '" data-cl-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('') + '</div>';
}

// --- 2. Список контрагентов ---

function renderClientList() {
  var list = DB.clients || [];
  // Live-поиск (Этап 38): имя / телефон / адрес / город.
  var q = String(CL_SEARCH || '').toLowerCase();
  if (q) {
    list = list.filter(function (c) {
      return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
             (c.phone || '').toLowerCase().indexOf(q) >= 0 ||
             (c.address || '').toLowerCase().indexOf(q) >= 0 ||
             (c.city || '').toLowerCase().indexOf(q) >= 0 ||
             (c.email || '').toLowerCase().indexOf(q) >= 0;
    });
  }
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

  // Этап 36: кнопка добавления — в отдельной панели .head-actions, а не
  // соседом заголовка в .spread. Так она не конкурирует за ширину строки и
  // видна на телефоне независимо от каскада медиазапросов.
  return '<div class="spread">' +
      '<h2>📇 Контрагенты</h2>' +
    '</div>' +
    (can('clients_edit')
      ? '<div class="head-actions">' +
          '<button class="btn btn-primary" data-new-client>＋ Контрагент</button>' +
        '</div>'
      : '') +
    renderClientsTabs() +
    renderClientSearch() +
    '<div class="card">' +
      (rows.length
        ? '<div class="list">' + rows.join('') + '</div>'
        : (q
            ? '<p class="muted">Ничего не найдено по запросу «' + escapeHtml(CL_SEARCH) + '»</p>'
            : '<p class="muted">Контрагентов пока нет.</p>')) +
    '</div>';
}

// Поле live-поиска контрагентов (Этап 38). Значение хранится в CL_SEARCH,
// поэтому после render() ввод сохраняется; ✕ очищает запрос.
function renderClientSearch() {
  // Этап 41: 🎤 только при загруженном ui-voice.js — иначе разметка прежняя.
  var mic = (typeof renderVoiceFieldBtn === 'function') ? renderVoiceFieldBtn('cl-search') : '';
  return '<div class="search-row">' +
      '<input type="search" id="cl-search" class="search-input" ' +
        'placeholder="🔍 Поиск по имени, телефону, адресу..." ' +
        'value="' + escapeHtml(CL_SEARCH) + '">' +
      mic +
      (CL_SEARCH ? '<button class="btn" data-clear-search title="Очистить">✕</button>' : '') +
    '</div>';
}

function clientKindLabel(k) {
  if (k === 'ip') return 'ИП';
  if (k === 'company') return 'ЮЛ';
  return 'Физ. лицо';
}

// --- 2.1 Вкладка «🚚 Поставщики» (Этап 31) ---
// Данные и сохранение — общие с админкой (saveSupplier/deleteSupplier из
// orders.js, модалка и делегаты — из ui-admin.js: data-add-supplier,
// data-edit-supplier, data-delete-supplier). Здесь только карточки-список.

function renderSuppliersTab() {
  var sups = DB.suppliers || [];
  // Live-поиск (Этап 38): название / телефон / адрес / заметка.
  var sq = String(SUP_SEARCH || '').toLowerCase();
  if (sq) {
    sups = sups.filter(function (s) {
      return (s.name || '').toLowerCase().indexOf(sq) >= 0 ||
             (s.phone || '').toLowerCase().indexOf(sq) >= 0 ||
             (s.address || '').toLowerCase().indexOf(sq) >= 0 ||
             (s.note || '').toLowerCase().indexOf(sq) >= 0;
    });
  }
  // Единый критерий экрана: справочники ведёт роль с clients_edit
  // (admin/operator/manager); worker экраном контрагентов не управляет.
  var editable = can('clients_edit');
  var rows = sups.map(function (s) {
    var actions = '';
    if (editable) {
      actions = '<div class="row" style="margin-top:6px;gap:6px">' +
        '<button class="btn" data-edit-supplier="' + escapeHtml(String(s.id)) + '" style="flex:1">✎ Редактировать</button>' +
        '<button class="btn btn-danger" data-delete-supplier="' + escapeHtml(String(s.id)) + '" style="flex:1">🗑 Удалить</button>' +
        '</div>';
    }
    return '<div class="list-item">' +
      '<div class="spread"><b>' + escapeHtml(s.name || '—') + '</b>' +
        (s.hours ? '<span class="badge">' + escapeHtml(s.hours) + '</span>' : '') +
      '</div>' +
      (s.phone ? '<div class="small">📞 <a href="tel:' + escapeHtml(s.phone) + '">' +
        escapeHtml(s.phone) + '</a></div>' : '') +
      (s.address ? '<div class="small muted">📍 ' + escapeHtml(s.address) + '</div>' : '') +
      (s.note ? '<div class="small">' + escapeHtml(s.note) + '</div>' : '') +
      actions +
    '</div>';
  }).join('');

  // Этап 36: кнопка «➕ Поставщик» — в отдельной панели .head-actions
  // (см. renderClientList): не конкурирует с заголовком за ширину строки.
  return '<div class="spread">' +
      '<h2>🚚 Поставщики</h2>' +
    '</div>' +
    (editable
      ? '<div class="head-actions">' +
          '<button class="btn btn-primary" data-add-supplier>➕ Поставщик</button>' +
        '</div>'
      : '') +
    renderClientsTabs() +
    renderSupplierSearch() +
    '<div class="card">' +
      (rows ? '<div class="list">' + rows + '</div>'
            : (SUP_SEARCH
                ? '<p class="muted">Ничего не найдено по запросу «' + escapeHtml(SUP_SEARCH) + '»</p>'
                : '<p class="muted">Поставщиков пока нет.</p>')) +
    '</div>';
}

// Поле live-поиска поставщиков на вкладке «🚚 Поставщики» (Этап 38).
function renderSupplierSearch() {
  // Этап 41: 🎤 только при загруженном ui-voice.js — иначе разметка прежняя.
  var mic = (typeof renderVoiceFieldBtn === 'function') ? renderVoiceFieldBtn('sup-tab-search') : '';
  return '<div class="search-row">' +
      '<input type="search" id="sup-tab-search" class="search-input" ' +
        'placeholder="🔍 Поиск по названию, телефону, адресу..." ' +
        'value="' + escapeHtml(SUP_SEARCH) + '">' +
      mic +
      (SUP_SEARCH ? '<button class="btn" data-clear-sup-tab-search title="Очистить">✕</button>' : '') +
    '</div>';
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

  // Кнопки действий — в .row: на узких экранах переносятся целиком (Этап 33).
  var actions = '';
  if (can('clients_edit')) {
    actions = '<div class="row" style="margin-top:10px">' +
      '<button class="btn" data-edit-client="' + c.id + '">✎ Редактировать</button>' +
      '<button class="btn btn-danger" data-del-client="' + c.id + '">🗑 Удалить</button>' +
      '</div>';
  }

  return '<div class="head-row">' +
      '<button class="btn" data-clients-back>←</button>' +
      '<h2>' + escapeHtml(c.name) + '</h2>' +
      '<span class="badge">' + clientKindLabel(c.kind) + '</span>' +
    '</div>' +
    (can('clients_edit')
      ? '<div class="row" style="margin-top:8px;gap:6px">' +
          '<button class="btn btn-primary" data-new-order-from-client="' + c.id + '" style="flex:1">➕ Новая заявка</button>' +
          '<button class="btn" data-import-contact style="flex:1">📥 Добавить из контактов</button>' +
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

// --- 5.2 Импорт контрагента из телефонной книги (Этап 30, Этап 32) ---
// Contact Picker API есть не везде (нет на десктопе и в Firefox): при его
// доступности сразу открываем системный выбор контакта, иначе — модалку с
// выбором источника: вставка текста из буфера или ручной ввод формы.

// Российские форматы телефонов: +7 900 123-45-67, 8-900-123-45-67,
// +7(900)123-45-67, +79001234567.
var CONTACT_PHONE_RE = /(?:\+?7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
var ADDRESS_KEYWORDS = ['ул.', 'пр.', 'проспект', 'дом', 'офис', 'кв.', 'квартира'];

// Парсинг вставленного текста (Этап 32): телефон ищется по формату, адрес —
// по ключевым словам, имя — первая строка без телефона и не адрес.
// Возвращает {name, phone, address, raw} для превью.
function parseContactText(txt) {
  var raw = String(txt || '');
  var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); })
    .filter(Boolean);
  var res = { name: '', phone: '', address: '', raw: raw };
  var phoneLine = '';
  lines.forEach(function (l) {
    if (res.phone) return;
    var m = l.match(CONTACT_PHONE_RE);
    if (!m) return;
    phoneLine = l;
    var digits = m[0].replace(/[\s-()]/g, '');
    if (digits.charAt(0) === '8') digits = '+7' + digits.slice(1);
    else if (digits.charAt(0) === '7') digits = '+' + digits;
    res.phone = digits;
  });
  lines.forEach(function (l) {
    if (res.address || l === phoneLine) return;
    var low = l.toLowerCase();
    for (var i = 0; i < ADDRESS_KEYWORDS.length; i++) {
      if (low.indexOf(ADDRESS_KEYWORDS[i]) >= 0) { res.address = l; return; }
    }
  });
  lines.forEach(function (l) {
    if (res.name) return;
    var m = l.match(/^(?:имя|name)\s*[:\-]\s*(.+)$/i);
    if (m) { res.name = m[1].trim(); return; }
    if (l === phoneLine || l === res.address) return;
    if (CONTACT_PHONE_RE.test(l)) return;
    res.name = l;
  });
  return res;
}

// Модалка выбора источника при недоступном Contact Picker API (Этап 32).
function renderContactSourceModal() {
  showModal(
    '<h3>📥 Добавить из контактов</h3>' +
    '<p class="small muted">Нативный выбор контактов недоступен в этом ' +
      'браузере. Выберите, откуда взять данные контакта.</p>' +
    '<div class="row" style="gap:6px">' +
      '<button class="btn btn-primary" data-contact-paste style="flex:1">📋 Вставить из буфера</button>' +
      '<button class="btn" data-contact-manual style="flex:1">✏️ Ввести вручную</button>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
    '</div>'
  );
}

function renderPasteContactModal() {
  showModal(
    '<h3>📋 Вставить данные контакта</h3>' +
    '<p class="small muted">Вставьте скопированный контакт — формат ' +
      'распознается автоматически (телефон, адрес, имя).</p>' +
    '<label class="field"><span>Данные контакта</span>' +
      '<textarea id="pc-text" rows="4" ' +
        'placeholder="Иван&#10;+7 900 123-45-67&#10;ул. Мира, дом 10"></textarea></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-paste-contact style="flex:1">Распознать</button>' +
    '</div>'
  );
}

// Превью распознанных данных перед сохранением (Этап 32): поля редактируемы.
function renderContactPreviewModal(parsed) {
  var p = parsed || {};
  showModal(
    '<h3>📇 Проверьте данные</h3>' +
    '<label class="field"><span>Имя</span>' +
      '<input id="pv-name" type="text" value="' + escapeHtml(p.name || '') + '"></label>' +
    '<label class="field"><span>Телефон</span>' +
      '<input id="pv-phone" type="tel" value="' + escapeHtml(p.phone || '') + '"></label>' +
    '<label class="field"><span>Адрес</span>' +
      '<input id="pv-address" type="text" value="' + escapeHtml(p.address || '') + '"></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-preview style="flex:1">💾 Сохранить</button>' +
    '</div>'
  );
}

// Открытие выбора контакта; при отказе/недоступности API — модалка источника.
function importFromPhone() {
  if (typeof navigator === 'undefined' || !navigator.contacts ||
      typeof navigator.contacts.select !== 'function') {
    renderContactSourceModal();
    return;
  }
  try {
    var p = navigator.contacts.select(['name', 'tel'], { multiple: false });
    if (!p || typeof p.then !== 'function') { renderContactSourceModal(); return; }
    p.then(function (list) {
      var ct = list && list.length ? list[0] : null;
      if (!ct) return; // пользователь отменил выбор
      var name = (ct.name && ct.name.length) ? ct.name[0] : '';
      var phone = (ct.tel && ct.tel.length) ? ct.tel[0] : '';
      if (!name && !phone) { renderContactSourceModal(); return; }
      // Этап 32: системный контакт тоже проходит через превью.
      renderContactPreviewModal({ name: name, phone: phone, address: '' });
    })['catch'](function () { renderContactSourceModal(); });
  } catch (e) {
    renderContactSourceModal();
  }
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

// Live-поиск контрагентов (Этап 38): debounce 300ms — перерисовка не на
// каждую букву. render() пересоздаёт поле, поэтому фокус возвращаем сами.
document.addEventListener('input', debounce(function (ev) {
  var el = ev.target;
  if (!el) return;
  if (el.id === 'sup-tab-search') {
    SUP_SEARCH = String(el.value || '').trim();
    render();
    var again = document.getElementById('sup-tab-search');
    if (again) {
      try {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      } catch (e) { /* без позиции каретки */ }
    }
    return;
  }
  if (el.id !== 'cl-search') return;
  CL_SEARCH = String(el.value || '').trim();
  render();
  var again2 = document.getElementById('cl-search');
  if (again2) {
    try {
      again2.focus();
      again2.setSelectionRange(again2.value.length, again2.value.length);
    } catch (e) { /* старые браузеры — без позиции каретки */ }
  }
}, 300));

document.addEventListener('click', function (ev) {
  var sel = function (s) { return ev.target.closest(s); };

  var backBtn = sel('[data-clients-back]');
  if (backBtn) { CL_TAB = 'list'; state.clientId = null; render(); return; }

  // Переключение вкладок экрана (Этап 31): список / поставщики.
  var clTab = sel('[data-cl-tab]');
  if (clTab) {
    CL_TAB = clTab.getAttribute('data-cl-tab');
    if (CL_TAB !== 'card') state.clientId = null;
    render();
    return;
  }

  // Очистка live-поиска (Этап 38).
  var clearSearchBtn = sel('[data-clear-search]');
  if (clearSearchBtn) {
    CL_SEARCH = '';
    render();
    return;
  }

  var clearSupTabBtn = sel('[data-clear-sup-tab-search]');
  if (clearSupTabBtn) {
    SUP_SEARCH = '';
    render();
    return;
  }

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

  // Модалка выбора источника (Этап 32): вставка из буфера / ручной ввод.
  var srcPasteBtn = sel('[data-contact-paste]');
  if (srcPasteBtn) { renderPasteContactModal(); return; }

  var srcManualBtn = sel('[data-contact-manual]');
  if (srcManualBtn) { renderClientEditModal(); return; }

  // «Распознать» в модалке вставки: парсинг → превью (Этап 32),
  // сохранение — отдельным делегатом data-save-preview.
  var pasteBtn = sel('[data-paste-contact]');
  if (pasteBtn) {
    var ta = document.getElementById('pc-text');
    var parsed = parseContactText(ta ? ta.value : '');
    if (!parsed.name && !parsed.phone) {
      toast('Не удалось распознать данные', true);
      return;
    }
    renderContactPreviewModal(parsed);
    return;
  }

  // 💾 Сохранение из превью распознанного контакта (Этап 32).
  var savePreviewBtn = sel('[data-save-preview]');
  if (savePreviewBtn) {
    var pvVal = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    var pvName = pvVal('pv-name');
    var pvPhone = pvVal('pv-phone');
    var pvAddress = pvVal('pv-address');
    if (!pvName && !pvPhone) { toast('Укажите имя или телефон', true); return; }
    if (typeof can === 'function' && !can('clients_edit')) {
      toast('Нет права создавать контрагентов', true);
      return;
    }
    // Имя обязательно для карточки: если распознан только телефон — он и имя.
    var pvId = addClient({
      name: pvName || pvPhone, phone: pvPhone, address: pvAddress, kind: 'person'
    }, true);
    if (pvId === null) return; // дубль отклонён пользователем
    closeModal();
    state.clientId = pvId;
    CL_TAB = 'card';
    toast('Контакт добавлен');
    render();
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
window.renderClientsTabs = renderClientsTabs;
window.renderSuppliersTab = renderSuppliersTab;
window.renderClientCard = renderClientCard;
window.renderClientList = renderClientList;
window.renderClientSearch = renderClientSearch;
window.renderSupplierSearch = renderSupplierSearch;
window.renderClientEditModal = renderClientEditModal;
window.findSimilarClients = findSimilarClients;
window.normalizeClientName = normalizeClientName;
window.buildClientDossier = buildClientDossier;
window.addClient = addClient;
window.importFromPhone = importFromPhone;
window.parseContactText = parseContactText;
window.renderContactSourceModal = renderContactSourceModal;
window.renderPasteContactModal = renderPasteContactModal;
window.renderContactPreviewModal = renderContactPreviewModal;
