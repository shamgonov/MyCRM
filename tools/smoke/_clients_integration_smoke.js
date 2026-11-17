/* Смоук Этапа 30: глубокая интеграция контрагентов — авто-создание карточки
   из заявки (getOrCreateClient + saveOrderWithClient), журнал заявок в
   карточке, быстрая заявка из карточки (data-new-order-from-client), импорт
   из телефонной книги (navigator.contacts + фолбэк-модалка вставки). */
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
// navigator без contacts → Contact Picker API недоступен (десктоп-сценарий).
globalThis.navigator = {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
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

function mkClient(over) {
  return Object.assign({
    id: 1, name: 'Клиент', kind: 'person', inn: '', kpp: '', ogrn: '',
    phone: '', email: '', city: '', address: '', notes: '',
    orderIds: [], createdAt: Date.now(), createdBy: ''
  }, over || {});
}

function mkOrder(over) {
  return Object.assign({
    id: 1, client: 'Клиент', status: 'new', worker: '', date: '2026-01-01',
    t1: '09:00', t2: '', helpers: [], confirm: {}, tags: [], works: [],
    extras: [], materials: [], payments: [], history: [], createdAt: Date.now()
  }, over || {});
}

// --- 1. getOrCreateClient: новое имя → создаёт карточку, возвращает id ---

DB.clients = [];
var newId = getOrCreateClient('Смирнова А.П.', '+79990001122', 'Уралмаш 10');
assert(typeof newId === 'number' && newId > 0, '1: возвращён числовой id');
var created = (DB.clients || []).find(function (x) { return x.id === newId; });
assert(!!created, '1: карточка появилась в DB.clients');
assert.eq(created.name, 'Смирнова А.П.', '1: имя записано');
assert.eq(created.phone, '+79990001122', '1: телефон записан');
assert.eq(created.address, 'Уралмаш 10', '1: адрес записан');
assert.eq(created.kind, 'person', '1: kind по умолчанию person');

// Пустое имя → null, ничего не создаём.
assert.eq(getOrCreateClient('', '+79000000000', ''), null, '1: пустое имя → null');

// --- 2. getOrCreateClient: совпадение → без дубля, тот же id ---

var again = getOrCreateClient('смирнова а.п.', '+79990001122', '');
assert.eq(again, newId, '2: по телефону/имени найден существующий id');
assert.eq(DB.clients.length, 1, '2: дубль не создан');

var byName = getOrCreateClient('Смирнова А.П.', '', '');
assert.eq(byName, newId, '2: поиск по имени без телефона');
assert.eq(DB.clients.length, 1, '2: снова без дубля');

// --- 2.1 Нет права clients_edit → только поиск, без создания ---

login('worker', 'Мастер');
assert.eq(getOrCreateClient('Новый Без Права', '+79995554433', ''), null,
  '2.1: worker → null (нет clients_edit)');
assert.eq(DB.clients.length, 1, '2.1: карточка не создана');
// Поиск при этом работает: существующий находится даже без права на создание.
assert.eq(getOrCreateClient('Смирнова А.П.', '', ''), newId, '2.1: поиск доступен всем');
login('admin', 'Владелец');

// --- 3. saveOrderWithClient: авто-привязка + orderIds клиента ---

DB.orders = [];
DB.clients = [];
FIELDS['co-client-id'] = { value: '' }; // контрагент в модалке НЕ выбран
var o3 = saveOrderWithClient({
  client: 'Петров В.С.', phone: '+79111234567', address: 'Мира 10',
  date: '2026-06-01', t1: '10:00', t2: ''
});
assert(!!o3, '3: заявка создана');
assert(o3.clientId !== undefined, '3: clientId проставлен автоматически');
var c3 = (DB.clients || []).find(function (x) { return x.id === o3.clientId; });
assert(!!c3 && c3.name === 'Петров В.С.', '3: карточка создана по имени заявки');
assert(c3.orderIds.indexOf(o3.id) >= 0, '3: заявка в orderIds клиента');

// Повторная заявка тому же клиенту — без дубля карточки, orderIds растёт.
FIELDS['co-client-id'] = { value: '' };
var o3b = saveOrderWithClient({
  client: 'Петров В.С.', phone: '+79111234567', date: '2026-07-01', t1: '', t2: ''
});
assert.eq(o3b.clientId, o3.clientId, '3: вторая заявка привязана к тому же клиенту');
assert.eq(DB.clients.length, 1, '3: дубль карточки не создан');
assert.eq(c3.orderIds.length, 2, '3: orderIds содержит обе заявки');

// --- 4. renderClientCard: кнопки + журнал с data-order ---

c3.kind = 'person';
DB.orders.push(mkOrder({
  id: 901, client: c3.name, date: '2026-01-05', t1: '09:00',
  works: [{ name: 'Ремонт', qty: 1, price: 5000, coeff: 1 }]
}));
c3.orderIds.push(901);
var cardHtml = renderClientCard(c3);
assert(cardHtml.indexOf('data-new-order-from-client="' + c3.id + '"') >= 0,
  '4: кнопка «➕ Новая заявка»');
assert(cardHtml.indexOf('data-import-contact') >= 0, '4: кнопка «📥 Из телефонной книги»');
assert(cardHtml.indexOf('Журнал заявок') >= 0, '4: блок «Журнал заявок»');
assert(cardHtml.indexOf('data-order="901"') >= 0, '4: элемент журнала с data-order');
assert(cardHtml.indexOf('5 000') >= 0 || cardHtml.indexOf('5000') >= 0,
  '4: сумма заявки в журнале (money(calculateOrderTotal))');
// Сортировка новые→старые: более свежая дата выше.
var idxNew = cardHtml.indexOf('data-order="' + o3b.id + '"');
var idxOld = cardHtml.indexOf('data-order="901"');
assert(idxNew >= 0 && idxOld >= 0 && idxNew < idxOld,
  '4: журнал отсортирован новые сверху');

// Worker без clients_edit кнопок не видит.
login('worker', 'Мастер');
var cardWorker = renderClientCard(c3);
assert(cardWorker.indexOf('data-new-order-from-client') < 0,
  '4: worker без права — нет кнопки «Новая заявка»');
assert(cardWorker.indexOf('data-import-contact') < 0, '4: worker — нет кнопки импорта');
login('admin', 'Владелец');

// --- 5. Клик data-new-order-from-client → модалка предзаполнена ---

FIELDS['co-client-id'] = { value: '' };
FIELDS['nc-client'] = { value: '' };
FIELDS['nc-phone'] = { value: '' };
FIELDS['nc-address'] = { value: '' };
c3.city = 'Екатеринбург';
c3.address = 'Мира, 10';
modalStub.innerHTML = '';
clickOn('data-new-order-from-client', c3.id);
assert(modalStub.innerHTML.indexOf('Новая заявка') >= 0, '5: открыта модалка создания заявки');
assert.eq(FIELDS['nc-client'].value, c3.name, '5: поле клиента предзаполнено');
assert.eq(FIELDS['nc-phone'].value, c3.phone, '5: телефон предзаполнен');
assert(FIELDS['nc-address'].value.indexOf('Мира') >= 0, '5: адрес предзаполнен');
assert.eq(FIELDS['co-client-id'].value, String(c3.id), '5: контрагент выбран в select');

// --- 6. Импорт: парсер текста ---

var parsed = parseContactText('Иван\n+79001234567\nМосква');
assert.eq(parsed.name, 'Иван', '6: имя из первой не-телефонной строки');
assert.eq(parsed.phone, '+79001234567', '6: телефон из строки с цифрами');
assert.eq(parsed.address, 'Москва', '6: адрес из третьей строки');
// Порядок строк не важен: телефон ищётся по цифрам.
var p2 = parseContactText('+79001234567\nПетр');
assert.eq(p2.phone, '+79001234567', '6: телефон первой строкой');
assert.eq(p2.name, 'Петр', '6: имя второй строкой');
// Пустой ввод.
var p3 = parseContactText('');
assert.eq(p3.name, '', '6: пусто → имя пусто');

// --- 6.1 Фолбэк-модалка: navigator.contacts нет → importFromPhone не падает ---

modalStub.innerHTML = '';
var noThrow = true;
try { importFromPhone(); } catch (e) { noThrow = false; }
assert(noThrow, '6.1: без navigator.contacts — без исключения');
assert(modalStub.innerHTML.indexOf('pc-text') >= 0, '6.1: открыта фолбэк-модалка (pc-text)');
assert(modalStub.innerHTML.indexOf('data-paste-contact') >= 0,
  '6.1: кнопка «Распознать» (data-paste-contact)');
assert(modalStub.innerHTML.indexOf('onclick') < 0, '6.1: инлайн-обработчиков нет');

// Клик «Распознать» → addClient + переход в карточку.
DB.clients = [];
FIELDS['pc-text'] = { value: 'Иван\n+79001234567\nМосква' };
CL_TAB = 'list';
state.clientId = null;
clickOn('data-paste-contact');
assert.eq(DB.clients.length, 1, '6.1: карточка создана из вставленного текста');
var imported = DB.clients[0];
assert.eq(imported.name, 'Иван', '6.1: имя из текста');
assert.eq(imported.phone, '+79001234567', '6.1: телефон из текста');
assert.eq(imported.address, 'Москва', '6.1: адрес из текста');
assert.eq(CL_TAB, 'card', '6.1: открыта карточка импортированного');
assert.eq(state.clientId, imported.id, '6.1: state.clientId установлен');

// --- 6.2 Contact Picker API доступен → берётся имя/телефон контакта ---

globalThis.navigator = {
  contacts: {
    select: function () {
      return Promise.resolve([{ name: ['Сидоров И.И.'], tel: ['+79007654321'] }]);
    }
  }
};
DB.clients = [];
CL_TAB = 'list';
importFromPhone();
// then-колбэк асинхронный: прокручиваем микрозадачи синхронным then-циклом
// невозможно (раннер не ждёт промисы) — проверяем сам факт отсутствия модалки
// фолбэка (API есть → модалка вставки НЕ открывается).
assert(modalStub.innerHTML.indexOf('pc-text') < 0,
  '6.2: с доступным API фолбэк-модалка не открывается');
globalThis.navigator = {};

// --- 7. Регрессия: absence navigator вообще (старые окружения) ---

delete globalThis.navigator;
var noThrow2 = true;
modalStub.innerHTML = '';
try { importFromPhone(); } catch (e) { noThrow2 = false; }
assert(noThrow2, '7: без navigator — importFromPhone не падает');
assert(modalStub.innerHTML.indexOf('pc-text') >= 0, '7: открыт фолбэк');
globalThis.navigator = {};

// --- 9. Этап 31: вкладки экрана + вкладка «🚚 Поставщики» ---

loadModule('app/ui-admin.js'); // модалка поставщика и её делегаты

// 9.1 Вкладки экрана рендерятся в списке контрагентов.
CL_TAB = 'list';
var listHtml9 = renderClients();
assert(listHtml9.indexOf('data-cl-tab="list"') >= 0, '9.1: вкладка «Контрагенты»');
assert(listHtml9.indexOf('data-cl-tab="suppliers"') >= 0, '9.1: вкладка «Поставщики»');

// 9.2 Клик по вкладке переключает CL_TAB и рисует поставщиков.
clickOn('data-cl-tab', 'suppliers');
assert.eq(CL_TAB, 'suppliers', '9.2: клик по вкладке переключил CL_TAB');
var supHtml = renderClients();
assert(supHtml.indexOf('Поставщики') >= 0, '9.2: экран поставщиков отрисован');
assert(supHtml.indexOf('data-add-supplier') >= 0, '9.2: кнопка «➕ Поставщик»');

// 9.3 Кнопка импорта переименована (Этап 31).
var cardImp = renderClientCard(mkClient({ id: 777, name: 'ИмпортТест' }));
assert(cardImp.indexOf('📥 Импорт / Вставить') >= 0, '9.3: подпись «📥 Импорт / Вставить»');
assert(cardImp.indexOf('data-import-contact') >= 0, '9.3: data-import-contact на месте');

// 9.4 Полный цикл создания поставщика через модалку ui-admin.js.
DB.suppliers = [];
modalStub.innerHTML = '';
clickOn('data-add-supplier');
assert(modalStub.innerHTML.indexOf('sp-name') >= 0, '9.4: открыта модалка поставщика');
FIELDS['sp-name'] = { value: 'МеталлБаза' };
FIELDS['sp-phone'] = { value: '+73430001122' };
FIELDS['sp-address'] = { value: 'Черметов, 1' };
FIELDS['sp-hours'] = { value: 'пн-пт 8-17' };
FIELDS['sp-note'] = { value: 'заказ за сутки' };
clickOn('data-save-supplier');
assert.eq((DB.suppliers || []).length, 1, '9.4: поставщик создан');
var sup1 = DB.suppliers[0];
assert.eq(sup1.name, 'МеталлБаза', '9.4: название сохранено');
assert.eq(sup1.hours, 'пн-пт 8-17', '9.4: часы работы сохранены');
assert.eq(modalStub.innerHTML, '', '9.4: модалка закрыта');

// 9.5 Вкладка показывает карточку поставщика с кнопками.
var supHtml2 = renderSuppliersTab();
assert(supHtml2.indexOf('МеталлБаза') >= 0, '9.5: поставщик в списке');
assert(supHtml2.indexOf('data-edit-supplier="' + sup1.id + '"') >= 0, '9.5: кнопка ✎');
assert(supHtml2.indexOf('data-delete-supplier="' + sup1.id + '"') >= 0, '9.5: кнопка 🗑');
assert(supHtml2.indexOf('пн-пт 8-17') >= 0, '9.5: часы работы показаны');

// 9.6 Редактирование через ✎ → модалка предзаполнена → сохранение.
modalStub.innerHTML = '';
clickOn('data-edit-supplier', sup1.id);
assert(modalStub.innerHTML.indexOf('value="МеталлБаза"') >= 0, '9.6: модалка предзаполнена');
FIELDS['sp-name'] = { value: 'МеталлБаза ООО' };
clickOn('data-save-supplier');
assert.eq(DB.suppliers.length, 1, '9.6: дубль не создан');
assert.eq(DB.suppliers[0].name, 'МеталлБаза ООО', '9.6: название обновлено');

// 9.7 Удаление.
clickOn('data-delete-supplier', sup1.id);
assert.eq(DB.suppliers.length, 0, '9.7: поставщик удалён');

// 9.8 Worker без clients_edit — вкладка есть, кнопок нет.
login('worker', 'Мастер');
var supWorker = renderSuppliersTab();
assert(supWorker.indexOf('data-add-supplier') < 0, '9.8: worker — нет кнопки добавления');
var listWorker9 = renderClientList();
assert(listWorker9.indexOf('data-new-client') < 0, '9.8: worker — нет «＋ Контрагент»');
assert(listWorker9.indexOf('data-cl-tab="suppliers"') >= 0, '9.8: вкладка поставщика видна');
login('admin', 'Владелец');
CL_TAB = 'list';

// --- 10. Журнал карточки: клик data-order → go('order', id) ---

DB.orders.push(mkOrder({ id: 950, client: c3.name, date: '2026-08-01' }));
c3.orderIds.push(950);
go('clients');
clickOn('data-order', 950);
assert.eq(state.screen, 'order', '8: клик по журналу → экран заявки');
assert.eq(state.orderId, 950, '8: открыта нужная заявка');
