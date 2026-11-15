/* Смоук Этапа 17: теги заявок, шаблоны смет, дедуп услуг. */
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
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
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
loadModule('app/ui-estimate.js');

setOwnerFlag(false);
DB.users = [];
login('worker', 'Мастер');

// --- 1. normalizeOrder: tags === [] ---
var bare = { id: 1, works: [], extras: [], materials: [], history: [], payments: [] };
normalizeOrder(bare);
assert(Array.isArray(bare.tags), 'normalizeOrder: tags = []');
assert.eq(bare.tags.length, 0, 'normalizeOrder: tags пуст');

// --- 2. Теги: addTag / removeTag ---
var order = {
  id: 10, client: 'Тест', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'new',
  works: [], extras: [], materials: [], history: [], payments: []
};
normalizeOrder(order);

assert(addTag(order, 'Стекло') === true, 'addTag: добавлен');
assert.eq(order.tags.length, 1, 'addTag: 1 тег');
assert.eq(order.tags[0], 'Стекло', 'addTag: значение верно');

assert(addTag(order, 'Стекло') === false, 'addTag: дубликат запрещён');
assert.eq(order.tags.length, 1, 'addTag: дубль не добавлен');

assert(addTag(order, 'Фурнитура') === true, 'addTag: второй тег');
assert.eq(order.tags.length, 2, 'addTag: 2 тега');

assert(removeTag(order, 'Стекло') === true, 'removeTag: удалён');
assert.eq(order.tags.length, 1, 'removeTag: 1 тег остался');
assert.eq(order.tags[0], 'Фурнитура', 'removeTag: остался фурнитура');

assert(removeTag(order, 'Нет такого') === false, 'removeTag: несуществующий → false');
assert(removeTag(null, 'Тег') === false, 'removeTag: null → false');

// addTag/removeTag сохраняют заявку через saveOrderLocal → тег виден в БД на диске.
var stored = JSON.parse(localStorage.getItem('crm2_db'));
var storedOrder = stored.orders.find(function (x) { return x.id === 10; });
assert(!!storedOrder, 'addTag: заявка сохранена в localStorage');
assert.eq(storedOrder.tags.join(','), 'Фурнитура', 'addTag: тег записан на диск');

// --- 3. Шаблоны: saveTemplate ---
var orderForTmpl = {
  id: 20, client: 'Шаблонный', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '10:00', t2: '14:00',
  worker: 'Мастер', status: 'estimate',
  works: [
    { title: 'Регулировка', qty: 2, price: 800, unit: 'шт', coeff: 1, done: false },
    { title: 'Замена уплотнителя', qty: 5, price: 200, unit: 'пог.м', coeff: 1.5, done: false }
  ],
  extras: [], materials: [], history: [], payments: [],
  tags: ['Стекло', 'Фурнитура']
};

var tpl = saveTemplate(orderForTmpl, 'Регулировка стандарт');
assert(!!tpl, 'saveTemplate: шаблон создан');
assert.eq(tpl.name, 'Регулировка стандарт', 'saveTemplate: имя верно');
assert.eq(tpl.kind, 'estimate', 'saveTemplate: kind = estimate');
assert.eq(tpl.works.length, 2, 'saveTemplate: 2 работы скопировано');
assert.eq(tpl.works[0].name, 'Регулировка', 'saveTemplate: имя работы');
assert.eq(tpl.works[0].qty, 2, 'saveTemplate: qty скопировано');
assert.eq(tpl.works[1].coeff, 1.5, 'saveTemplate: coeff скопировано');
assert.eq(tpl.tags.length, 2, 'saveTemplate: теги скопированы');
assert.eq(tpl.tags[0], 'Стекло', 'saveTemplate: первый тег');
assert(DB.templates.indexOf(tpl) >= 0, 'saveTemplate: шаблон в DB.templates');

// saveTemplate: пустое имя
var emptyTmpl = saveTemplate(orderForTmpl, '');
assert(emptyTmpl === null, 'saveTemplate: пустое имя → null');
assert(saveTemplate(null, 'X') === null, 'saveTemplate: null order → null');

// --- 4. applyTemplate: замена работ и тегов ---
var orderForApply = {
  id: 30, client: 'Применить', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'estimate',
  works: [
    { title: 'Старая работа', qty: 1, price: 100, unit: 'шт', coeff: 1, done: false }
  ],
  extras: [], materials: [], history: [], payments: [],
  tags: ['Старый тег']
};
normalizeOrder(orderForApply);

assert(applyTemplate(orderForApply, tpl.id) === true, 'applyTemplate: успех');
assert.eq(orderForApply.works.length, 2, 'applyTemplate: 2 работы из шаблона');
assert.eq(orderForApply.works[0].name, 'Регулировка', 'applyTemplate: имя из шаблона');
assert(orderForApply.works[0].title === 'Регулировка', 'applyTemplate: title = name');
assert(orderForApply.works[1].coeff === 1.5, 'applyTemplate: coeff из шаблона');
assert.eq(orderForApply.tags.length, 2, 'applyTemplate: теги из шаблона');
assert.eq(orderForApply.tags[0], 'Стекло', 'applyTemplate: первый тег шаблона');

// applyTemplate: несуществующий id
assert(applyTemplate(orderForApply, 99999) === false, 'applyTemplate: нет шаблона → false');
assert(applyTemplate(null, tpl.id) === false, 'applyTemplate: null order → false');

// --- 5. Дедуп: findSimilarPriceItems ---
// Прайс: замена уплотнителя ПВХ, Регулировка створки, Установка доводчика
var sim1 = findSimilarPriceItems('Регулировк');
assert(sim1.length >= 1, 'dedup: частичное совпадение найдено');
assert(sim1[0].name.indexOf('Регулировка') >= 0, 'dedup: найдена Регулировка');

var sim2 = findSimilarPriceItems('довод');
assert(sim2.length >= 1, 'dedup: поиск доводчика');
// В прайсе «Установка доводчика» — другая падежная форма и строчная буква:
// сравнение регистронезависимое, именно для этого в дедупе морфология слов.
assert(sim2.some(function (p) { return p.name.toLowerCase().indexOf('доводчик') >= 0; }),
  'dedup: «довод» → найден «Установка доводчика»');

var sim2b = findSimilarPriceItems('Регулирвка'); // опечатка: пропущена «о»
assert(sim2b.length >= 1, 'dedup: опечатка найдена');
assert(sim2b.some(function (p) { return p.name.indexOf('Регулировка') >= 0; }),
  'dedup: опечатка → Регулировка створки');

var sim3 = findSimilarPriceItems('xyz123nonexist');
assert(sim3.length === 0, 'dedup: несуществующее → пусто');

var sim4 = findSimilarPriceItems('');
assert(sim4.length === 0, 'dedup: пустая строка → пусто');

var sim5 = findSimilarPriceItems('АБ');
assert(sim5.length === 0, 'dedup: слишком короткое → пусто');

// --- 6. Фильтр по тегу в ui-orders ---
var taggedOrders = [
  { id: 100, client: 'Стекло', tags: ['Стекло'], status: 'new', worker: '', helpers: [] },
  { id: 101, client: 'Фурнитура', tags: ['Фурнитура'], status: 'new', worker: '', helpers: [] },
  { id: 102, client: 'Оба тега', tags: ['Стекло', 'Фурнитура'], status: 'new', worker: '', helpers: [] },
  { id: 103, client: 'Без тегов', tags: [], status: 'new', worker: '', helpers: [] }
];
DB.orders = taggedOrders;

// allOrderTags: собирает пресеты + теги заявок
var tags = allOrderTags();
assert(tags.indexOf('Стекло') >= 0, 'allOrderTags: есть Стекло');
assert(tags.indexOf('Фурнитура') >= 0, 'allOrderTags: есть Фурнитура');
assert(tags.indexOf('Гарантия') >= 0, 'allOrderTags: пресет Garantia');

// orderPassesFilter: tag:Стекло
assert(orderPassesFilter(taggedOrders[0], 'tag:Стекло') === true, 'filter tag:Стекло → найдена');
assert(orderPassesFilter(taggedOrders[1], 'tag:Стекло') === false, 'filter tag:Стекло → фурнитура нет');
assert(orderPassesFilter(taggedOrders[2], 'tag:Стекло') === true, 'filter tag:Стекло → оба найдена');
assert(orderPassesFilter(taggedOrders[3], 'tag:Стекло') === false, 'filter tag:Стекло → без тегов нет');

// filter 'all'
assert(orderPassesFilter(taggedOrders[0], 'all') === true, 'filter all → все');
assert(orderPassesFilter(taggedOrders[3], 'all') === true, 'filter all → без тегов тоже');

// --- 7. renderEstimateTab: кнопки шаблонов ---
var orderForEst = {
  id: 50, client: 'Смета', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'estimate',
  works: [
    { name: 'Регулировка', qty: 2, price: 500, coeff: 1, done: false, skipped: false }
  ],
  extras: [], materials: [], history: [], payments: [], tags: []
};
var estHtml = renderEstimateTab(orderForEst);
assert(estHtml.indexOf('data-save-template') >= 0, 'renderEstimateTab: кнопка сохранить шаблон');
assert(estHtml.indexOf('data-apply-template') >= 0, 'renderEstimateTab: кнопка применить шаблон');
assert(estHtml.indexOf('Сохранить как шаблон') >= 0, 'renderEstimateTab: текст кнопки');
assert(estHtml.indexOf('Применить шаблон') >= 0, 'renderEstimateTab: текст кнопки');

// --- 8. renderOrderTagsBlock: теги в карточке ---
var orderForTags = {
  id: 60, client: 'Теги', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'new',
  works: [], extras: [], materials: [], history: [], payments: [],
  tags: ['Стекло', 'Фурнитура']
};
var mainTab = renderOrderTabMain(orderForTags);
assert(mainTab.indexOf('data-remove-tag="Стекло"') >= 0, 'renderOrderTabMain: чип Стекло с крестиком');
assert(mainTab.indexOf('data-remove-tag="Фурнитура"') >= 0, 'renderOrderTabMain: чип Фурнитура с крестиком');
assert(mainTab.indexOf('data-add-tag-preset') >= 0, 'renderOrderTabMain: select пресетов');
assert(mainTab.indexOf('data-add-tag-custom') >= 0, 'renderOrderTabMain: кнопка своего тега');
assert(mainTab.indexOf('Стекло') >= 0, 'renderOrderTabMain: отображён тег');

// --- 9. renderSaveTemplateModal ---
renderSaveTemplateModal(orderForEst);
assert(modalStub.innerHTML.indexOf('tpl-name') >= 0, 'saveTemplateModal: поле имени');
assert(modalStub.innerHTML.indexOf('Сохранить') >= 0, 'saveTemplateModal: кнопка сохранения');
closeModal();

// --- 10. renderApplyTemplateModal ---
renderApplyTemplateModal(orderForEst);
assert(modalStub.innerHTML.indexOf('tpl-select') >= 0, 'applyTemplateModal: select шаблонов');
assert(modalStub.innerHTML.indexOf('Регулировка стандарт') >= 0, 'applyTemplateModal: имя шаблона');
closeModal();

// --- 11. levenshtein: базовые проверки ---
assert.eq(levenshtein('abc', 'abc'), 0, 'levenshtein: одинаковые');
assert.eq(levenshtein('abc', 'abd'), 1, 'levenshtein: 1 замена');
assert.eq(levenshtein('abc', 'abcd'), 1, 'levenshtein: 1 вставка');
assert.eq(levenshtein('', 'abc'), 3, 'levenshtein: 3 вставки');
assert.eq(levenshtein('Регулировк', 'Регулировка'), 1, 'levenshtein: 1 буква');
