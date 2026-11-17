/* Смоук Этапа 15: перенос остатка — дочерняя заявка, связь parent/followUpIds,
   частичный акт, нумерация «279/1», защита ×9, normalizeOrder-поля связей. */
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

// Вспомогательное: заявка-родитель в DB.orders (createFollowUpOrder ищет по id).
function putOrder(o) {
  o.works = o.works || [];
  o.materials = o.materials || [];
  o.extras = o.extras || [];
  o.history = o.history || [];
  DB.orders.push(o);
  return o;
}

// --- 1. orderDisplayNumber: обычная и дочерняя ---
assert.eq(orderDisplayNumber({ id: 279, works: [] }), '279', 'displayNumber: обычная');
assert.eq(orderDisplayNumber({ id: 280, parentId: 279, childNo: 1, works: [] }), '279/1',
  'displayNumber: дочерняя');
assert.eq(orderDisplayNumber(null), '', 'displayNumber: null');

// --- 2. normalizeOrder: поля связей (Этап 15) ---
var bare = { id: 1, works: [], extras: [], materials: [], history: [], payments: [] };
normalizeOrder(bare);
assert('parentId' in bare && bare.parentId === null, 'normalizeOrder: parentId = null');
assert('childNo' in bare && bare.childNo === null, 'normalizeOrder: childNo = null');
assert(Array.isArray(bare.followUpIds), 'normalizeOrder: followUpIds = []');

// --- 3. createFollowUpOrder(parentId, data): перенос остатка ---
var parent = putOrder({
  id: 279,
  client: 'Смирнов А.П.',
  phone: '+7 912 345-67-89',
  city: 'Екатеринбург',
  address: 'ул. Ленина, 15, кв. 3',
  date: localToday(),
  t1: '09:00',
  t2: '12:00',
  worker: 'Мастер',
  status: 'postponed',
  works: [
    { title: 'Регулировка', qty: 2, price: 500, coeff: 1, done: true, skipped: false },
    { title: 'Уплотнитель', qty: 1, price: 1200, coeff: 1, done: false, skipped: false },
    { title: 'Фурнитура', qty: 1, price: 800, coeff: 1, done: false, skipped: true }
  ],
  materials: [
    { name: 'Уплотнитель', qty: 5, price: 250, buyer: 'company', status: 'bought' },
    { name: 'Стеклопакет', qty: 1, price: 5000, buyer: 'company', status: 'needed' }
  ],
  followUpIds: []
});

var child = createFollowUpOrder(279);
assert(!!child, 'createFollowUpOrder: дочерняя создана');
assert.eq(child.parentId, 279, 'createFollowUpOrder: parentId установлен');
assert.eq(child.childNo, 1, 'createFollowUpOrder: childNo = 1');
assert.eq(child.status, 'new', 'createFollowUpOrder: статус новой = new');
assert.eq(child.client, 'Смирнов А.П.', 'createFollowUpOrder: клиент унаследован');

// data.date/t1/t2/status применяются.
assert.eq(child.date, localToday(), 'createFollowUpOrder: дата из data/родителя');

// Копируются только работы без done/skipped.
assert.eq(child.works.length, 1, 'followUp: скопирована только 1 работа (уплотнитель)');
assert.eq(child.works[0].title, 'Уплотнитель', 'followUp: скопирована нужная работа');

// Копируются материалы со статусом needed.
assert.eq(child.materials.length, 1, 'followUp: скопирован 1 материал (needed)');
assert.eq(child.materials[0].name, 'Стеклопакет', 'followUp: скопирован needed материал');

// Связь в обе стороны.
assert.eq(parent.followUpIds.length, 1, 'followUp: parent.followUpIds = [child.id]');
assert.eq(parent.followUpIds[0], child.id, 'followUp: id ребёнка у родителя');

// История: followup у родителя, inherit у ребёнка.
assert(parent.history.some(function (h) { return h.action === 'followup'; }),
  'followUp: запись followup в историю родителя');
var fH = parent.history.find(function (h) { return h.action === 'followup'; });
assert(fH.details.indexOf('279/1') >= 0, 'followUp: details родителя с дробным номером');
assert(child.history.some(function (h) { return h.action === 'inherit'; }),
  'followUp: запись inherit в историю ребёнка');
assert(child.history.find(function (h) { return h.action === 'inherit'; })
  .details.indexOf('279') >= 0, 'followUp: details ребёнка с номером родителя');

// data с датой/временем/статусом.
var child2 = createFollowUpOrder(279, { date: '2030-01-15', t1: '10:00', t2: '11:00', status: 'inspection' });
assert.eq(child2.date, '2030-01-15', 'followUp data: дата из data');
assert.eq(child2.t1, '10:00', 'followUp data: t1 из data');
assert.eq(child2.t2, '11:00', 'followUp data: t2 из data');
assert.eq(child2.status, 'inspection', 'followUp data: статус из data');
assert.eq(child2.childNo, 2, 'followUp data: childNo продолжает нумерацию (2)');

// --- 4. Нумерация и защита ×9 ---
var parent2 = putOrder({
  id: 300, client: 'Петров', city: '', address: '', phone: '',
  date: localToday(), t1: '10:00', t2: '14:00', worker: '', status: 'postponed',
  works: [], materials: [], extras: [], history: [], followUpIds: []
});
var c1 = createFollowUpOrder(300);
var c2 = createFollowUpOrder(300);
assert.eq(c1.childNo, 1, 'followUp: первая = 1');
assert.eq(c2.childNo, 2, 'followUp: вторая = 2');
assert.eq(orderDisplayNumber(c1), '300/1', 'followUp: display = 300/1');
assert.eq(orderDisplayNumber(c2), '300/2', 'followUp: display = 300/2');

// Доводим до предела: всего детей у 300 уже 2, добавляем до 9 — десятый null.
for (var i = 3; i <= 9; i++) { assert(!!createFollowUpOrder(300), 'followUp: ребёнок ' + i + ' создан'); }
assert.eq(parent2.followUpIds.length, 9, 'followUp: 9 детей накоплено');
assert.eq(createFollowUpOrder(300), null, 'followUp: десятый → null (защита ×9)');
assert.eq(parent2.followUpIds.length, 9, 'followUp: после отказа связь не добавлена');

// --- 5. Null-безопасность ---
assert.eq(createFollowUpOrder(null), null, 'followUp: null parentId → null');
assert.eq(createFollowUpOrder(999999), null, 'followUp: несуществующий id → null');
assert.eq(createFollowUpOrder(undefined), null, 'followUp: undefined → null');

// --- 6. Пустой перенос: нечего копировать, связь всё равно создаётся ---
var emptyParent = putOrder({
  id: 400, client: 'Тест', city: '', address: '', phone: '',
  date: localToday(), t1: '', t2: '', worker: '', status: 'postponed',
  works: [
    { title: 'Готово', qty: 1, price: 100, coeff: 1, done: true, skipped: false },
    { title: 'Пропущено', qty: 1, price: 100, coeff: 1, done: false, skipped: true }
  ],
  materials: [{ name: 'Куплено', qty: 1, price: 100, buyer: 'company', status: 'bought' }],
  extras: [], history: [], followUpIds: []
});
var emptyChild = createFollowUpOrder(400);
assert(!!emptyChild, 'followUp: пустая создана');
assert.eq(emptyChild.works.length, 0, 'followUp: нет работ для переноса');
assert.eq(emptyChild.materials.length, 0, 'followUp: нет материалов needed');
assert.eq(emptyParent.followUpIds.length, 1, 'followUp: связь всё равно создана');

// --- 7. Частичный акт: renderAct(o, {partial:true}) ---
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
assert(actHtml.indexOf('выполнены частично') >= 0, 'partial: текст о частичном выполнении');
assert(actHtml.indexOf('претензий по объёму') >= 0, 'partial: формулировка про претензии');
assert(actHtml.indexOf('279/1') >= 0, 'partial: номер дочерней в акте');
assert(actHtml.indexOf('Остаток перенесён') >= 0, 'partial: пометка переноса');
// Только выполненные строки: «Уплотнитель» (done:false) в частичный акт не входит.
assert(actHtml.indexOf('Регулировка') >= 0, 'partial: выполненная работа в акте');
assert(actHtml.indexOf('Уплотнитель') < 0, 'partial: невыполненная работа НЕ в акте');

var fullHtml = renderAct(actParent);
assert(fullHtml.indexOf('ПРОМЕЖУТОЧНЫЙ') < 0, 'full: нет "Промежуточный"');
assert(fullHtml.indexOf('АКТ ВЫПОЛНЕННЫХ РАБОТ') >= 0, 'full: обычный заголовок');
assert(fullHtml.indexOf('Остаток перенесён') < 0, 'full: нет пометки переноса');

// --- 8. UI: блок связей и видимость кнопки ---
loadModule('app/ui-orders.js');

var postponedHtml = renderFollowUpBlock(parent, true);
assert(postponedHtml.indexOf('Перенос остатка') >= 0, 'block: заголовок');
assert(postponedHtml.indexOf('data-followup="279"') >= 0, 'block: кнопка у postponed (editable)');
assert(postponedHtml.indexOf('Дочерние') >= 0, 'block: список детей');
assert(postponedHtml.indexOf('279/1') >= 0, 'block: дробный номер ребёнка');

var childHtml = renderFollowUpBlock(child, true);
assert(childHtml.indexOf('Родитель') >= 0, 'block: ссылка на родителя');
assert(childHtml.indexOf('data-order="279"') >= 0, 'block: data-order родителя');

// Не-postponed: кнопки нет.
var newOrd = putOrder({ id: 500, client: 'Новая', status: 'new', date: localToday(),
  t1: '', t2: '', worker: '', works: [], materials: [], extras: [], history: [], followUpIds: [] });
assert(renderFollowUpBlock(newOrd, true).indexOf('data-followup') < 0,
  'block: кнопка скрыта для status=new');
// Read-only: кнопки нет даже у postponed.
assert(renderFollowUpBlock(parent, false).indexOf('data-followup') < 0,
  'block: кнопка скрыта без права редактирования');
