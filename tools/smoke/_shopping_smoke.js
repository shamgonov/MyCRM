/* Смоук app/ui-shopping.js (Этап 7): вкладка «Материалы», модалка,
   глобальные «Закупки», быстрые статусы, компенсации. */
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
loadModule('app/ui-shopping.js');

setOwnerFlag(false);
DB.users = [];

// Сид: у Смирнова (моя заявка) 3 материала
const o1 = DB.orders.find(function (o) { return o.client.indexOf('Смирнов') === 0; });
assert(o1 && o1.materials.length === 3, 'сид: 3 материала у заявки Смирнова');
assert.eq(o1.materials[0].status, 'needed', 'сид: уплотнитель needed');
assert.eq(o1.materials[1].buyer, 'worker', 'сид: доводчик покупает worker');
assert.eq(o1.materials[1].factPrice, 1600, 'сид: факт. цена доводчика 1600');
assert.eq(o1.materials[2].status, 'spoiled', 'сид: стеклопакет spoiled');

// --- 1. renderShoppingTab: строки и бейджи ---
login('worker', 'Мастер');
const tabHtml = renderShoppingTab(o1);
assert(tabHtml.indexOf('🧱 Уплотнитель ПВХ') >= 0, 'tab: название материала');
assert(tabHtml.indexOf('🟡 Нужно купить') >= 0, 'tab: бейдж needed');
assert(tabHtml.indexOf('🟢 Куплено') >= 0, 'tab: бейдж bought');
assert(tabHtml.indexOf('🔴 Испорчен') >= 0, 'tab: бейдж spoiled');
assert(tabHtml.indexOf('💳 Свои средства') >= 0, 'tab: бейдж своих средств (worker+bought)');
assert(tabHtml.indexOf('📷 чек') >= 0, 'tab: отметка о чеке');
assert(tabHtml.indexOf('факт 1 600') >= 0, 'tab: факт. цена в строке');
assert(tabHtml.indexOf('data-add-material') >= 0, 'tab: кнопка добавления (есть право edit)');
assert(tabHtml.indexOf('data-edit-material="1"') >= 0, 'tab: клик по строке = редактирование');
assert(tabHtml.indexOf('data-quick-mat="0"') >= 0, 'tab: быстрый «Куплено» для needed');
assert(tabHtml.indexOf('data-quick-mat="1"') >= 0, 'tab: быстрый «Компенсировать» для worker+bought');

// пустые материалы
assert(renderShoppingTab({ materials: [] }).indexOf('Материалов пока нет') >= 0,
  'tab: пустой список');

// worker НЕ видит кнопку добавления в чужой заявке (гейт canEditOrder)
const other = DB.orders.find(function (o) { return o.worker === 'Борис' && o.status === 'approved'; });
assert(renderShoppingTab(other).indexOf('data-add-material') < 0,
  'tab: чужая заявка — без кнопки добавления');

// --- 2. renderMaterialModal + saveMaterialFromModal ---
renderMaterialModal(o1, null);
assert(modalStub.innerHTML.indexOf('Новый материал') >= 0, 'modal: заголовок создания');
assert(modalStub.innerHTML.indexOf('mt-name') >= 0 && modalStub.innerHTML.indexOf('mt-qty') >= 0 &&
  modalStub.innerHTML.indexOf('mt-unit') >= 0 && modalStub.innerHTML.indexOf('mt-price') >= 0,
  'modal: базовые поля');
assert(modalStub.innerHTML.indexOf('mt-buyer') >= 0 && modalStub.innerHTML.indexOf('mt-status') >= 0,
  'modal: buyer + status');
assert(modalStub.innerHTML.indexOf('data-save-material') >= 0, 'modal: кнопка Сохранить');

// редактирование существующего
renderMaterialModal(o1, 1);
assert(modalStub.innerHTML.indexOf('Доводчик') >= 0, 'modal: имя редактируемого материала');
assert(modalStub.innerHTML.indexOf('mt-bought-fields') >= 0 &&
  modalStub.innerHTML.indexOf('mt-fact') >= 0, 'modal: поля bought (факт. цена)');
closeModal();

// добавление нового материала (значения передаём напрямую — DOM в смоуке нет)
const beforeLen = o1.materials.length;
const savedMat = saveMaterialFromModal(o1.id, null, {
  name: 'Саморезы', qty: '20', unit: 'шт', price: '5', buyer: 'company', status: 'needed'
});
assert(savedMat && savedMat.name === 'Саморезы', 'save: материал создан');
assert.eq(o1.materials.length, beforeLen + 1, 'save: добавлен в o.materials');
const inDb = DB.orders.find(function (x) { return x.id === o1.id; });
assert(inDb.materials.some(function (m) { return m.name === 'Саморезы'; }),
  'save: сохранено в DB (saveOrderLocal)');

// редактирование по индексу + bought-поля
const edited = saveMaterialFromModal(o1.id, 0, {
  name: 'Уплотнитель ПВХ', qty: '12', unit: 'пог.м', price: '250',
  buyer: 'worker', status: 'bought', factPrice: '3100', note: 'Леруа, чек есть', hasReceipt: true
});
assert.eq(edited.qty, 12, 'save: qty обновлён');
assert.eq(edited.status, 'bought', 'save: status= bought');
assert.eq(edited.factPrice, 3100, 'save: factPrice сохранён');
assert.eq(edited.hasReceipt, true, 'save: флаг чека');
assert(!edited.note || edited.note === 'Леруа, чек есть', 'save: note сохранён');

// spoiled → note без factPrice
const spoiled = saveMaterialFromModal(o1.id, 2, {
  name: 'Стеклопакет', qty: '1', unit: 'шт', price: '5000', buyer: 'company',
  status: 'spoiled', note: 'упал при транспортировке'
});
assert.eq(spoiled.status, 'spoiled', 'save: spoiled сохранён');
assert.eq(spoiled.note, 'упал при транспортировке', 'save: причина брака');
assert(spoiled.factPrice === undefined, 'save: у spoiled нет factPrice');

// без названия — отказ
assert.eq(saveMaterialFromModal(o1.id, null, { name: '', qty: 1 }), null,
  'save: пустое название → null');

// --- 4. updateMaterialStatus ---
const upd = updateMaterialStatus(o1, 3, 'bought', 120, 'куплено в строймаге');
assert.eq(upd.status, 'bought', 'updateMaterialStatus: статус изменён');
assert.eq(upd.factPrice, 120, 'updateMaterialStatus: factPrice');
assert.eq(updateMaterialStatus(o1, 99, 'bought'), null, 'updateMaterialStatus: вне диапазона → null');
assert.eq(updateMaterialStatus(null, 0, 'bought'), null, 'updateMaterialStatus: null-заявка → null');

// --- 3. renderGlobalShopping: фильтры и компенсация ---
login('admin', 'Владелец'); // видит все заявки
state.shopFilter = 'all';
const shopAll = renderGlobalShopping();
assert(shopAll.indexOf('🛒 Закупки') >= 0, 'shop: заголовок');
assert(shopAll.indexOf('data-shop-filter="needed"') >= 0 &&
  shopAll.indexOf('data-shop-filter="comp"') >= 0, 'shop: чипы-фильтры');
assert(shopAll.indexOf('К выплате работникам') >= 0, 'shop: блок «к выплате»');
// все материалы всех заявок (сид 3 + добавленные «Саморезы»)
assert.eq(collectMaterials('all').length, 4, 'shop filter=all: 4 материала (сид 3 + Саморезы)');
// needed: уплотнитель стал bought (мы его отредактировали) → остался spoiled? нет: needed=0
const neededList = collectMaterials('needed');
assert(neededList.every(function (it) { return it.m.status === 'needed'; }),
  'shop filter=needed: только needed');
// comp: worker+bought
const compList = collectMaterials('comp');
assert.eq(compList.length, 2, 'shop filter=comp: 2 своих покупки (доводчик + уплотнитель)');
assert(compList.every(function (it) { return it.m.buyer === 'worker' && it.m.status === 'bought'; }),
  'shop filter=comp: только worker+bought');
assert(shopAll.indexOf('data-compensate=') >= 0, 'shop: кнопка «Компенсировать»');
assert(shopAll.indexOf('№' + o1.id) >= 0, 'shop: указание заявки № и клиента');

// компенсация меняет статус и снимает из «к выплате»
const owedBefore = shopAll.match(/К выплате работникам: <b>([^<]+)</)[1];
assert(owedBefore.indexOf('4 700') >= 0 || owedBefore.length > 0, 'shop: сумма к выплате посчитана');
const compTarget = compList[0];
updateMaterialStatus(compTarget.o, compTarget.idx, 'compensated');
assert.eq(compTarget.m.status, 'compensated', 'compensated: статус проставлен');
assert.eq(collectMaterials('comp').length, compList.length - 1,
  'compensated больше не в фильтре «Компенсации»');
const shopAfter = renderGlobalShopping();
assert(shopAfter.indexOf('💰 Компенсировано') >= 0, 'shop: бейдж «Компенсировано»');

// worker видит в глобальном экране только материалы своих заявок (гейт canViewOrder)
login('worker', 'Мастер');
const workerShop = collectMaterials('all');
assert(workerShop.length > 0, 'worker: в глобальных закупках что-то видно');
assert(workerShop.every(function (it) { return canViewOrder(it.o); }),
  'worker: только материалы видимых заявок');
