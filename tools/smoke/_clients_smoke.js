/* Смоук Этапа 16: Контрагенты — справочник, дедуп, история, досье. */
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
var fields = {};
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return fields[id] || null;
  },
  addEventListener: function () {}
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-clients.js');
loadModule('app/ui-docs.js');

setOwnerFlag(false);
DB.users = [];
login('operator', 'Мария');

// --- 1. normalizeClientName ---
assert.eq(normalizeClientName('ООО "Ромашка"'), 'РОМАШКА', 'нормализация: кавычки убраны');
assert.eq(normalizeClientName('  ООО  Ромашка  '), 'РОМАШКА', 'нормализация: пробелы убраны');
assert.eq(normalizeClientName('АО "Логистик"'), 'ЛОГИСТИК', 'нормализация: АО → начало');
assert.eq(normalizeClientName('ИП Иванов'), 'ИВАНОВ', 'нормализация: ИП → начало');
assert.eq(normalizeClientName(''), '', 'нормализация: пустая → пустая');

// --- 2. findSimilarClients: поиск по имени ---
DB.clients = [];

// Создаём несколько контрагентов вручную.
DB.clients.push({
  id: 1, name: 'ООО "Ромашка"', kind: 'company', inn: '1234567890',
  phone: '+7 912 111-22-33', email: '', city: 'Екатеринбург', address: 'ул. Ленина, 1',
  notes: '', orderIds: [], createdAt: 0, createdBy: ''
});
DB.clients.push({
  id: 2, name: 'ИП Петров', kind: 'ip', inn: '987654321012',
  phone: '+7 903 222-33-44', email: '', city: '', address: '',
  notes: '', orderIds: [], createdAt: 0, createdBy: ''
});

var sim = findSimilarClients('Ромашка', '');
assert.eq(sim.length, 1, 'поиск: найдена Ромашка');
assert.eq(sim[0].name, 'ООО "Ромашка"', 'поиск: правильное совпадение');

// Частичное совпадение.
var sim2 = findSimilarClients('ООО Ром', '');
assert.eq(sim2.length, 1, 'поиск: частичное совпадение');

// Телефонное совпадение.
var sim3 = findSimilarClients('Новый клиент', '+79121112233');
assert.eq(sim3.length, 1, 'поиск: по телефону совпало');

// Нет совпадений.
var sim4 = findSimilarClients('Никто не найден', '99999999999');
assert.eq(sim4.length, 0, 'поиск: нет совпадений');

// --- 3. Список контрагентов: рендер ---
var listHtml = renderClientList();
assert(listHtml.indexOf('Контрагенты') >= 0, 'список: заголовок');
assert(listHtml.indexOf('Ромашка') >= 0, 'список: Ромашка в списке (escapeHtml)');
assert(listHtml.indexOf('Петров') >= 0, 'список: Петров в списке');
assert(listHtml.indexOf('data-client=') >= 0, 'список: data-client есть');
assert(listHtml.indexOf('＋ Контрагент') >= 0, 'список: кнопка создания');

// --- 4. Карточка контрагента ---
var c = DB.clients[0];
var cardHtml = renderClientCard(c);
assert(cardHtml.indexOf('Ромашка') >= 0, 'карточка: имя (escapeHtml)');
assert(cardHtml.indexOf('ЮЛ') >= 0, 'карточка: тип ЮЛ');
assert(cardHtml.indexOf('Реквизиты') >= 0, 'карточка: реквизиты');
assert(cardHtml.indexOf('1234567890') >= 0, 'карточка: ИНН');
assert(cardHtml.indexOf('Журнал заявок') >= 0, 'карточка: журнал заявок');
assert(cardHtml.indexOf('data-edit-client=') >= 0, 'карточка: кнопка редактирования');
assert(cardHtml.indexOf('data-del-client=') >= 0, 'карточка: кнопка удаления');

// --- 5. Досье ---
var dossier = buildClientDossier(c);
assert(Array.isArray(dossier.phones), 'досье: массив телефонов');
assert(Array.isArray(dossier.addresses), 'досье: массив адресов');

// --- 6. Клиент без orderIds ---
var noOrders = { id: 99, name: 'Тест', kind: 'person', orderIds: [] };
var cardNoOrders = renderClientCard(noOrders);
assert(cardNoOrders.indexOf('Заявок нет') >= 0, 'карточка: пустая история');

// --- 7. Сортировка по правам: worker не видит кнопки ---
login('worker', 'Мастер');
var listWorker = renderClientList();
assert(listWorker.indexOf('data-new-client') < 0, 'worker: нет кнопки создания');
login('operator', 'Мария');

// --- 8. renderClients: переключение list/card ---
var html = renderClients();
assert(html.indexOf('Контрагенты') >= 0, 'renderClients: заголовок');

// --- 9. Интеграция: заявка → контрагент → реквизиты в документе ---
DB.orders = [];
var company = {
  id: 10, name: 'ООО Вектор', kind: 'company', inn: '6600000000', kpp: '660001001',
  ogrn: '1026600000000', phone: '+73432000000', email: 'a@b.ru',
  city: 'Екатеринбург', address: 'ул. Мира, 5', notes: '',
  orderIds: [], createdAt: 0, createdBy: ''
};
DB.clients.push(company);

// saveOrderWithClient читает select #co-client-id — мок значения.
fields['co-client-id'] = { value: '10' };
fields['nc-client'] = { value: 'ООО Вектор' };
fields['nc-phone'] = { value: '+73432000000' };
fields['nc-address'] = { value: 'Екатеринбург, ул. Мира, 5' };

var order = saveOrderWithClient({
  client: 'ООО Вектор', phone: '+73432000000',
  address: 'Екатеринбург, ул. Мира, 5', date: localToday(), t1: '', t2: ''
});
assert(!!order, 'интеграция: заявка создана');
assert.eq(order.clientId, 10, 'интеграция: clientId проставлен');
assert(!!order.clientLegal, 'интеграция: clientLegal для юрлица');
assert.eq(order.clientLegal.inn, '6600000000', 'интеграция: ИНН из справочника');
assert.eq(company.orderIds.length, 1, 'интеграция: заявка в истории контрагента');
assert.eq(company.orderIds[0], order.id, 'интеграция: id заявки записан');

// Реквизиты заказчика в документе берутся из clientLegal.
var req = getClientRequisites(order);
assert.eq(req.mode, 'legal', 'документ: режим юрлица');
assert(req.lines.join(' ').indexOf('6600000000') >= 0, 'документ: ИНН в реквизитах');
assert(req.lines.join(' ').indexOf('660001001') >= 0, 'документ: КПП в реквизитах');

// Физлицо — clientLegal не создаётся.
var person = {
  id: 11, name: 'Иванов И.И.', kind: 'person', inn: '', kpp: '',
  ogrn: '', phone: '+79120000000', email: '', city: '', address: '', notes: '',
  orderIds: [], createdAt: 0, createdBy: ''
};
DB.clients.push(person);
fields['co-client-id'] = { value: '11' };
var order2 = saveOrderWithClient({
  client: 'Иванов И.И.', phone: '+79120000000', date: localToday(), t1: '', t2: ''
});
assert.eq(order2.clientId, 11, 'интеграция: физлицо привязано');
assert(!order2.clientLegal, 'интеграция: физлицу clientLegal не нужен');
assert.eq(buildClientDossier(person).phones.length, 1, 'досье: телефон из заявки');

// Этап 30: заявка без выбора контрагента из справочника теперь привязывается
// автоматически — по имени создаётся новая карточка (право clients_edit есть).
var clientsBefore = (DB.clients || []).length;
fields['co-client-id'] = { value: '' };
var order3 = saveOrderWithClient({ client: 'Случайный', date: localToday(), t1: '', t2: '' });
assert(order3.clientId !== undefined, 'Этап 30: авто-привязка проставила clientId');
assert.eq((DB.clients || []).length, clientsBefore + 1, 'Этап 30: карточка создана автоматически');
var autoClient = (DB.clients || []).find(function (x) { return x.id === order3.clientId; });
assert(!!autoClient && autoClient.name === 'Случайный', 'Этап 30: карточка с именем из заявки');
assert(autoClient.orderIds.indexOf(order3.id) >= 0, 'Этап 30: заявка записана в orderIds');

// Нет права clients_edit (worker) → авто-создание не срабатывает, clientId нет.
login('worker', 'Мастер');
var clientsNoEdit = (DB.clients || []).length;
fields['co-client-id'] = { value: '' };
var order4 = saveOrderWithClient({ client: 'Чужой Имя', date: localToday(), t1: '', t2: '' });
assert(order4.clientId === undefined, 'Этап 30: worker без clients_edit — без авто-создания');
assert.eq((DB.clients || []).length, clientsNoEdit, 'Этап 30: карточек не прибавилось');
login('operator', 'Мария');
