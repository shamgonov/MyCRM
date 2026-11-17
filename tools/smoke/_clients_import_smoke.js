/* Смоук Этапа 32: импорт контактов — парсер форматов (телефон/адрес/имя),
   модалка-превью (pv-*) с редактированием, делегат data-save-preview,
   переименованная кнопка «📥 Добавить из контактов», регрессия дедупа. */
'use strict';

globalThis.localStorage = (function () {
  var m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();

var appStub = { innerHTML: '' };
var navStub = { innerHTML: '' };
var modalStub = { innerHTML: '' };
var FIELDS = {};
var clickHandlers = [];

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.addEventListener = function () {};
globalThis.navigator = {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-clients.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// Эмуляция клика: closest совпадает только с запрашиваемым атрибутом.
function clickOn(attr, value) {
  var target = {
    value: value === undefined || value === null ? '' : String(value),
    getAttribute: function (n) { return n === attr ? String(value) : null; },
    closest: function (selector) {
      return selector === '[' + attr + ']' ? target : null;
    }
  };
  clickHandlers.forEach(function (fn) { fn({ target: target }); });
}

// --- 1. parseContactText: форматы телефонов ---

// Пробелы и дефисы: +7 900 123-45-67
var f1 = parseContactText('Иван\n+7 900 123-45-67');
assert.eq(f1.phone, '+79001234567', '1: +7 900 123-45-67 → нормализован');
assert.eq(f1.name, 'Иван', '1: имя рядом с телефоном');

// Восьмерка: 8-900-123-45-67 → +7
var f2 = parseContactText('Петр\n8-900-123-45-67');
assert.eq(f2.phone, '+79001234567', '1: 8-900-123-45-67 → +7...');

// Слитный: +79001234567
var f3 = parseContactText('Сидор\n+79001234567');
assert.eq(f3.phone, '+79001234567', '1: +79001234567 без разделителей');

// Со скобкой: +7 (900) 123-45-67
var f4 = parseContactText('Анна\n+7 (900) 123-45-67');
assert.eq(f4.phone, '+79001234567', '1: +7 (900) 123-45-67 → нормализован');

// Телефон в середине текста.
var f5 = parseContactText('звонить: +7 912 555-11-22');
assert.eq(f5.phone, '+79125551122', '1: телефон из середины строки');

// --- 2. parseContactText: адрес по ключевым словам ---

var a1 = parseContactText('Иван\n+79001234567\nул. Мира, дом 10, кв. 5');
assert.eq(a1.address, 'ул. Мира, дом 10, кв. 5', '2: адрес «ул./дом/кв.»');

var a2 = parseContactText('Офис 305');
assert.eq(a2.address, 'Офис 305', '2: адрес по слову «офис»');
assert.eq(a2.name, '', '2: строка-адрес не стала именем');

var a3 = parseContactText('Иван\nпроспект Ленина 1');
assert.eq(a3.address, 'проспект Ленина 1', '2: адрес по слову «проспект»');
assert.eq(a3.name, 'Иван', '2: имя вне адресной строки');

// --- 3. parseContactText: имя ---

var n1 = parseContactText('Имя: Петров Василий');
assert.eq(n1.name, 'Петров Василий', '3: имя после «Имя:»');

var n2 = parseContactText('Кузнецова Мария');
assert.eq(n2.name, 'Кузнецова Мария', '3: имя = первая строка без телефона');

// Имя не должно «съедать» телефонную строку.
var n3 = parseContactText('+79001234567\nФёдор');
assert.eq(n3.name, 'Фёдор', '3: имя после телефонной строки');

// --- 4. parseContactText: пустой ввод ---

var e1 = parseContactText('');
assert.eq(e1.name, '', '4: пусто → имя пусто');
assert.eq(e1.phone, '', '4: пусто → телефон пуст');
assert.eq(e1.address, '', '4: пусто → адрес пуст');

var e2 = parseContactText(null);
assert.eq(e2.name, '', '4: null → имя пусто');
assert.eq(e2.phone, '', '4: null → телефон пуст');

// raw сохраняет исходный текст.
var e3 = parseContactText('Иван\n+79001234567');
assert.eq(e3.raw, 'Иван\n+79001234567', '4: raw = исходный текст');

// --- 5. renderContactPreviewModal: поля pv-* ---

modalStub.innerHTML = '';
renderContactPreviewModal({ name: 'Иван', phone: '+79001234567', address: 'ул. Мира 10' });
assert(modalStub.innerHTML.indexOf('id="pv-name"') >= 0, '5: превью содержит pv-name');
assert(modalStub.innerHTML.indexOf('id="pv-phone"') >= 0, '5: превью содержит pv-phone');
assert(modalStub.innerHTML.indexOf('id="pv-address"') >= 0, '5: превью содержит pv-address');
assert(modalStub.innerHTML.indexOf('value="Иван"') >= 0, '5: pv-name предзаполнен');
assert(modalStub.innerHTML.indexOf('value="+79001234567"') >= 0, '5: pv-phone предзаполнен');
assert(modalStub.innerHTML.indexOf('data-save-preview') >= 0, '5: кнопка data-save-preview');
assert(modalStub.innerHTML.indexOf('onclick') < 0, '5: инлайн-обработчиков нет');

// Пустой parsed → пустые поля, без исключения.
var noThrowPv = true;
try { renderContactPreviewModal({}); } catch (e) { noThrowPv = false; }
assert(noThrowPv, '5: пустой parsed → без исключения');

// --- 6. Делегат data-save-preview: создаёт клиента из pv-* ---

DB.clients = [];
CL_TAB = 'list';
state.clientId = null;
FIELDS['pv-name'] = { value: 'Импорт Тестовый' };
FIELDS['pv-phone'] = { value: '+79001112233' };
FIELDS['pv-address'] = { value: 'ул. Теста, 1' };
clickOn('data-save-preview');
assert.eq(DB.clients.length, 1, '6: клиент создан из превью');
var saved = DB.clients[0];
assert.eq(saved.name, 'Импорт Тестовый', '6: имя сохранено');
assert.eq(saved.phone, '+79001112233', '6: телефон сохранён');
assert.eq(saved.address, 'ул. Теста, 1', '6: адрес сохранён');
assert.eq(saved.kind, 'person', '6: kind=person');
assert.eq(CL_TAB, 'card', '6: переход в карточку');
assert.eq(state.clientId, saved.id, '6: state.clientId = id клиента');
assert.eq(modalStub.innerHTML, '', '6: модалка закрыта после сохранения');

// Ни имени, ни телефона → предупреждение, клиент не создан.
DB.clients = [];
modalStub.innerHTML = 'X';
FIELDS['pv-name'] = { value: '' };
FIELDS['pv-phone'] = { value: '' };
FIELDS['pv-address'] = { value: '' };
clickOn('data-save-preview');
assert.eq(DB.clients.length, 0, '6: пусто → клиент не создан');

// Только телефон (имя пустое) → телефоном становится имя карточки.
DB.clients = [];
FIELDS['pv-name'] = { value: '' };
FIELDS['pv-phone'] = { value: '+79005556677' };
FIELDS['pv-address'] = { value: '' };
clickOn('data-save-preview');
assert.eq(DB.clients.length, 1, '6: телефон без имени → карточка создана');
assert.eq(DB.clients[0].name, '+79005556677', '6: имя = телефон');

// Worker без clients_edit → не создаёт.
login('worker', 'Мастер');
DB.clients = [];
FIELDS['pv-name'] = { value: 'Нет Права' };
FIELDS['pv-phone'] = { value: '+79000000000' };
clickOn('data-save-preview');
assert.eq(DB.clients.length, 0, '6: worker — клиент не создан');
login('admin', 'Владелец');

// --- 7. Кнопка «📥 Добавить из контактов» в карточке ---

var card = renderClientCard({
  id: 5, name: 'КнопкаТест', kind: 'person', inn: '', kpp: '', ogrn: '',
  phone: '', email: '', city: '', address: '', notes: '', orderIds: []
});
assert(card.indexOf('📥 Добавить из контактов') >= 0, '7: подпись кнопки обновлена');
assert(card.indexOf('data-import-contact') >= 0, '7: data-import-contact есть');
assert(card.indexOf('Импорт / Вставить') < 0, '7: старой подписи нет');

// --- 8. Регрессия: addClient с дедупликацией ---

DB.clients = [];
var id8 = addClient({ name: 'Дедуп Тест', phone: '+79001230000' }, true);
assert(typeof id8 === 'number' && id8 > 0, '8: addClient вернул id');
assert.eq(DB.clients.length, 1, '8: первый клиент создан');
// Дедуп: confirm=true (мок) → дубль создаётся с новым id.
var id8b = addClient({ name: 'Дедуп Тест', phone: '+79001230000' }, true);
assert(id8b !== id8, '8: дубль получил новый id (confirm=true)');
assert.eq(DB.clients.length, 2, '8: дубль создан после подтверждения');
