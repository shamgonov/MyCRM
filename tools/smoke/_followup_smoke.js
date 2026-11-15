/* Смоук Этапа 15: перенос остатка — дочерняя заявка, связь parent/followUpIds, частичный акт. */
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
globalThis.document = {
  readyState: 'loading',
  getElementById: function () { return null; },
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

setOwnerFlag(false);
DB.users = [];
login('worker', 'Мастер');

// --- 1. orderDisplayNumber: обычная и дочерняя ---
var o1 = { id: 279, works: [] };
assert.eq(orderDisplayNumber(o1), '279', 'displayNumber: обычная');

var o2 = { id: 280, parentId: 279, childNo: 1, works: [] };
assert.eq(orderDisplayNumber(o2), '279/1', 'displayNumber: дочерняя');
assert.eq(orderDisplayNumber(null), '', 'displayNumber: null');

// --- 2. createFollowUpOrder: создаёт дочернюю с переносом ---
var parent = {
  id: 279,
  client: 'Смирнов А.П.',
  phone: '+7 912 345-67-89',
  city: 'Екатеринбург',
  address: 'ул. Ленина, 15, кв. 3',
  date: localToday(),
  t1: '09:00',
  t2: '12:00',
  worker: 'Мастер',
  status: 'inwork',
  works: [
    { title: 'Регулировка', qty: 2, price: 500, coeff: 1, done: true, skipped: false },
    { title: 'Уплотнитель', qty: 1, price: 1200, coeff: 1, done: false, skipped: false },
    { title: 'Фурнитура', qty: 1, price: 800, coeff: 1, done: false, skipped: true }
  ],
  materials: [
    { name: 'Уплотнитель', qty: 5, price: 250, buyer: 'company', status: 'bought' },
    { name: 'Стеклопакет', qty: 1, price: 5000, buyer: 'company', status: 'needed' }
  ],
  extras: [],
  history: [],
  followUpIds: []
};

var child = createFollowUpOrder(parent);
assert(!!child, 'createFollowUpOrder: дочерняя создана');
assert.eq(child.parentId, 279, 'createFollowUpOrder: parentId установлен');
assert.eq(child.childNo, 1, 'createFollowUpOrder: childNo = 1');
assert.eq(child.status, 'new', 'createFollowUpOrder: статус новой = new');

// Копируются только работы без done/skipped.
assert.eq(child.works.length, 1, 'followUp: скопирована только 1 работа (уплотнитель)');
assert.eq(child.works[0].title, 'Уплотнитель', 'followUp: скопирована нужная работа');

// Копируются материалы со статусом needed.
assert.eq(child.materials.length, 1, 'followUp: скопирован 1 материал (needed)');
assert.eq(child.materials[0].name, 'Стеклопакет', 'followUp: скопирован needed материал');

// Связь в обе стороны.
assert(parent.followUpIds.length === 1, 'followUp: parent.followUpIds = [child.id]');
assert.eq(parent.followUpIds[0], child.id, 'followUp: parent.id ребёнка совпадает');

// История.
assert(parent.history.some(function (h) { return h.action === 'followup'; }),
  'followUp: запись в историю родителя');
assert(child.history.some(function (h) { return h.action === 'inherit'; }),
  'followUp: запись в историю ребёнка');

// --- 3. Нумерация: вторая дочерняя — 279/2 ---
var parent2 = {
  id: 300, client: 'Петров', city: '', address: '',
  phone: '', date: localToday(), t1: '10:00', t2: '14:00',
  worker: '', status: 'new',
  works: [], materials: [], extras: [], history: [], followUpIds: []
};
var child2a = createFollowUpOrder(parent2);
var child2b = createFollowUpOrder(parent2);
assert.eq(child2a.childNo, 1, 'followUp: первая = 1');
assert.eq(child2b.childNo, 2, 'followUp: вторая = 2');
assert.eq(parent2.followUpIds.length, 2, 'followUp: 2 связи');
assert.eq(orderDisplayNumber(child2a), '300/1', 'followUp: display = 300/1');
assert.eq(orderDisplayNumber(child2b), '300/2', 'followUp: display = 300/2');

// --- 4. Частичный акт: renderAct(o, {partial:true}) ---
// Загружаем ui-docs.js для проверки.
loadModule('app/ui-docs.js');

var actParent = {
  id: 279,
  client: 'Смирнов',
  city: 'Екатеринбург',
  address: 'ул. Ленина, 15',
  docInvoiceNumber: '2026-01-001',
  docActNumber: '2026-001',
  works: [
    { title: 'Регулировка', qty: 2, price: 500, coeff: 1, done: true, skipped: false },
    { title: 'Уплотнитель', qty: 1, price: 1200, coeff: 1, done: false, skipped: false }
  ],
  extras: [],
  materials: [{ name: 'Уплотнитель', qty: 5, price: 250, buyer: 'company', status: 'bought' }],
  followUpIds: [child.id],
  payments: []
};

var actHtml = renderAct(actParent, { partial: true });
assert(actHtml.indexOf('ПРОМЕЖУТОЧНЫЙ АКТ') >= 0, 'partial: заголовок "Промежуточный"');
assert(actHtml.indexOf('частично выполненные') >= 0, 'partial: текст о частичном выполнении');
assert(actHtml.indexOf('279/1') >= 0, 'partial: номер дочерней в акте');
assert(actHtml.indexOf('Остаток перенесён') >= 0, 'partial: пометка переноса');

// Обычный акт (без partial).
var fullHtml = renderAct(actParent);
assert(fullHtml.indexOf('ПРОМЕЖУТОЧНЫЙ АКТ') < 0, 'full: нет "Промежуточный"');
assert(fullHtml.indexOf('АКТ ВЫПОЛНЕННЫХ РАБОТ') >= 0, 'full: обычный заголовок');

// --- 5. Пустой перенос: нет работ без done ---
var emptyParent = {
  id: 400, client: 'Тест', city: '', address: '', phone: '',
  date: localToday(), t1: '', t2: '', worker: '', status: 'new',
  works: [
    { title: 'Готово', qty: 1, price: 100, coeff: 1, done: true, skipped: false },
    { title: 'Пропущено', qty: 1, price: 100, coeff: 1, done: false, skipped: true }
  ],
  materials: [{ name: 'Куплено', qty: 1, price: 100, buyer: 'company', status: 'bought' }],
  extras: [], history: [], followUpIds: []
};
var emptyChild = createFollowUpOrder(emptyParent);
assert(!!emptyChild, 'followUp: пустая создана');
assert.eq(emptyChild.works.length, 0, 'followUp: нет работ для переноса');
assert.eq(emptyChild.materials.length, 0, 'followUp: нет материалов needed');
assert.eq(emptyParent.followUpIds.length, 1, 'followUp: связь всё равно создана');

// --- 6. Null-безопасность ---
assert.eq(createFollowUpOrder(null), null, 'followUp: null parent → null');
assert.eq(orderDisplayNumber(null), '', 'followUp: null display → ""');
