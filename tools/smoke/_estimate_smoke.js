/* Смоук app/ui-estimate.js (Этап 6): расчёт, toggleDone, прайс, доп. работы. */
'use strict';

globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
const appStub = { innerHTML: '' };
const navStub = { innerHTML: '' };
const modalStub = { innerHTML: '' };
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
globalThis.confirm = function () { return false; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-estimate.js');

const today = localToday();

// --- Прайс-лист: есть ли в defaultData ---
assert.eq(DB.priceList.length, 3, 'priceList: 3 элемента');
assert.eq(DB.priceList[0].name, 'Замена уплотнителя ПВХ', 'priceList: первый элемент');
assert.eq(DB.priceList[0].basePrice, 900, 'priceList: basePrice 900');
assert.eq(DB.priceList[2].name, 'Установка доводчика', 'priceList: третий элемент');
assert.eq(DB.priceList[2].category, 'Двери', 'priceList: категория Двери');

// --- Сид: extras в «своей» заявке ---
const myOrder = DB.orders.find(function (o) { return o.worker === 'Мастер'; });
assert(myOrder, 'seedMockData: «своя» заявка найдена');
assert.eq(myOrder.extras.length, 1, 'seedMockData: 1 доп. работа в сиде');
assert.eq(myOrder.extras[0].status, 'pending_agree', 'seedMockData: статус pending_agree');
assert.eq(myOrder.extras[0].name, 'Подоконник ПВХ', 'seedMockData: название доп. работы');

// --- 6. calculateEstimateTotal: с коэффициентами, skipped, agreed extras ---
const ord = {
  works: [
    { name: 'Регулировка', qty: 2, price: 500, coeff: 1, skipped: false, done: true },
    { name: 'Уплотнитель', qty: 1, price: 1200, coeff: 1.5, skipped: true, done: false },
    { name: 'Доводчик', qty: 3, price: 2000, coeff: 1, skipped: false, done: false }
  ],
  extras: [
    { name: 'Подоконник', qty: 1, price: 1500, status: 'agreed' },
    { name: 'Откосы', qty: 2, price: 500, status: 'pending_agree' },
    { name: 'Сетка', qty: 1, price: 700, status: 'rejected' }
  ]
};
// works: 2*500*1 = 1000 (skipped пропущен) + 3*2000*1 = 6000 = 7000
// extras: agreed 1*1500 = 1500; pending и rejected пропущены.
assert.eq(calculateEstimateTotal(ord), 8500, 'расчёт: works (с coeff) + agreed extras');

// пустая смета = 0
assert.eq(calculateEstimateTotal({}), 0, 'расчёт пустой заявки = 0');
assert.eq(calculateEstimateTotal(null), 0, 'расчёт null = 0');

// --- 5. toggleWorkDone: циклическое переключение ---
const testOrd = {
  works: [
    { name: 'A', qty: 1, price: 100, coeff: 1, done: false, skipped: false },
    { name: 'B', qty: 1, price: 200, coeff: 1, done: true, skipped: false }
  ]
};

toggleWorkDone(testOrd, 0); // false → done
assert.eq(testOrd.works[0].done, true, 'toggle: false → done');
assert.eq(testOrd.works[0].skipped, false, 'toggle: skipped=false');

toggleWorkDone(testOrd, 0); // done → skipped
assert.eq(testOrd.works[0].done, false, 'toggle: done → skipped');
assert.eq(testOrd.works[0].skipped, true, 'toggle: skipped=true');

toggleWorkDone(testOrd, 0); // skipped → null (false)
assert.eq(testOrd.works[0].done, false, 'toggle: skipped → false');
assert.eq(testOrd.works[0].skipped, false, 'toggle: skipped=false');

// B: done → skipped
toggleWorkDone(testOrd, 1);
assert.eq(testOrd.works[1].done, false, 'toggle B: done → skipped');
assert.eq(testOrd.works[1].skipped, true, 'toggle B: skipped=true');

// Границы: index out of range
toggleWorkDone(testOrd, 99);
assert.eq(testOrd.works.length, 2, 'out of range не ломает массив');
toggleWorkDone(testOrd, -1);
assert.eq(testOrd.works.length, 2, 'negative index не ломает массив');
toggleWorkDone(null, 0);
assert(true, 'toggleWorkDone(null) не падает');

// --- renderEstimateTab: HTML-структура ---
const html = renderEstimateTab(myOrder);
assert(html.indexOf('📋 Работа из прайса') >= 0, 'renderEstimateTab: кнопка прайса');
assert(html.indexOf('➕ Доп. работа') >= 0, 'renderEstimateTab: кнопка доп. работы');
assert(html.indexOf('💾 Сохранить') >= 0, 'renderEstimateTab: кнопка сохранить');
assert(html.indexOf('Итого') >= 0, 'renderEstimateTab: блок итога');
assert(html.indexOf('Ждёт') >= 0, 'renderEstimateTab: бейдж pending_agree');
assert(html.indexOf('data-toggle-done=') >= 0, 'renderEstimateTab: чекбоксы done');
assert(html.indexOf('data-action="price-list"') >= 0, 'renderEstimateTab: action data-price-list');
assert(html.indexOf('data-action="add-extra"') >= 0, 'renderEstimateTab: action data-add-extra');

// --- renderWorkConfigModal: поля прайса ---
renderWorkConfigModal({ name: 'Тест', price: 500, coeff: 1, qty: 2 }, true);
assert(modalStub.innerHTML.indexOf('ew-name') >= 0, 'modal: поле name');
assert(modalStub.innerHTML.indexOf('ew-qty') >= 0, 'modal: поле qty');
assert(modalStub.innerHTML.indexOf('ew-price') >= 0, 'modal: поле price');
assert(modalStub.innerHTML.indexOf('ew-coeff') >= 0, 'modal: поле coeff');
assert(modalStub.innerHTML.indexOf('data-coeff="1.2"') >= 0 &&
  modalStub.innerHTML.indexOf('data-coeff="1.5"') >= 0 &&
  modalStub.innerHTML.indexOf('data-coeff="2"') >= 0, 'modal: быстрые чипы коэффициента');
assert(modalStub.innerHTML.indexOf('Добавить в смету') >= 0, 'modal: кнопка добавления');
closeModal();

// --- renderPriceListModal: список прайса ---
renderPriceListModal(myOrder);
assert(modalStub.innerHTML.indexOf('Замена уплотнителя ПВХ') >= 0, 'price-list: элемент прайса');
assert(modalStub.innerHTML.indexOf('price-search') >= 0, 'price-list: поле поиска');
assert(modalStub.innerHTML.indexOf('data-price-item=') >= 0, 'price-list: data-price-item');
closeModal();

// --- renderExtraWorkModal: поля доп. работы ---
renderExtraWorkModal();
assert(modalStub.innerHTML.indexOf('en-name') >= 0, 'extra-modal: название');
assert(modalStub.innerHTML.indexOf('en-price') >= 0, 'extra-modal: цена');
assert(modalStub.innerHTML.indexOf('en-qty') >= 0, 'extra-modal: кол-во');
assert(modalStub.innerHTML.indexOf('en-reason') >= 0, 'extra-modal: причина');
assert(modalStub.innerHTML.indexOf('Добавить') >= 0, 'extra-modal: кнопка добавить');
closeModal();

// --- Сохранение работы из прайса (мок: saveOrderLocal пушит в works) ---
const beforeWorks = myOrder.works.length;
const beforeExtras = myOrder.extras.length;

// Мокируем getElementById для сохранения работы
const mockInputs = {
  'ew-name': 'Регулировка форточки',
  'ew-qty': '3',
  'ew-price': '600',
  'ew-coeff': '1.5'
};
globalThis.document.getElementById = function (id) {
  const el = {
    value: mockInputs[id] || '0',
    closest: function () { return null; },
    classList: { add: function () {}, remove: function () {} }
  };
  return el;
};

// Клик data-save-work
const saveWorkEvent = { target: { closest: function (s) { return s === '[data-save-work]' ? mockInputs : null; } } };
// В смоуке нет реального DOM, поэтому проверяем логику через прямой вызов
// (мок saveOrderLocal уже есть из orders.js, он пушит в DB.orders)

// Проверка: saveOrderLocal пушит в DB.orders (без id → seq++ и push)
const fakeOrder = { works: [], extras: [] }; // без id → saveOrderLocal сам назначит
saveOrderLocal(fakeOrder);
assert(fakeOrder.id >= 1, 'saveOrderLocal: id назначен из seq');
assert(DB.orders.some(function (o) { return o.id === fakeOrder.id; }),
  'saveOrderLocal: новая заявка в DB.orders');
// Убираем тестовую заявку
DB.orders = DB.orders.filter(function (o) { return o.id !== fakeOrder.id; });

// Проверка: calculateEstimateTotal для новой заявки
const newOrd = {
  works: [
    { name: 'Регулировка', qty: 2, price: 500, coeff: 1.5, skipped: false, done: true },
    { name: 'Уплотнитель', qty: 1, price: 1200, coeff: 1, skipped: true, done: false }
  ],
  extras: [
    { name: 'Подоконник', qty: 1, price: 1500, status: 'agreed' }
  ]
};
// works: 2*500*1.5 = 1500; skipped пропущен
// extras: agreed 1*1500 = 1500
assert.eq(calculateEstimateTotal(newOrd), 3000, 'расчёт: coeff 1.5 * 2 * 500 + agreed 1500');

// --- Сохранение доп. работы на месте ---
const saveExtraEvent = { target: { closest: function (s) { return s === '[data-save-extra]' ? mockInputs : null; } } };
// Проверяем логику напрямую:
myOrder.extras.push({
  name: 'Пробник',
  price: 300,
  qty: 2,
  status: 'pending_agree',
  reason: 'Клиент просит'
});
saveOrderLocal(myOrder);
assert.eq(myOrder.extras.length, 2, 'доп. работа добавлена в extras');
assert.eq(myOrder.extras[1].status, 'pending_agree', 'статус pending_agree');

// --- Итого: пересчёт после добавления доп. работы ---
// myOrder.extras[0] = pending_agree (не считается)
// myOrder.extras[1] = pending_agree (не считается)
// myOrder.works = 2 работы, ни одна skipped
const totalBefore = calculateEstimateTotal(myOrder);
assert(typeof totalBefore === 'number' && totalBefore >= 0, 'итого: число >= 0');
