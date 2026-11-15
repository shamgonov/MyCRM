/* Смоук Этапа 18: поставщики, локации материалов, маршруты, шаринг списка закупок. */
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
loadModule('app/ui-shopping.js');
loadModule('app/ui-admin.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// --- 1. Поставщики: saveSupplier / deleteSupplier / findSupplier ---
// Сначала очистим от сидов (пусто по умолчанию).
DB.suppliers = [];

var sup1 = saveSupplier({ name: 'ОкнаПро', phone: '+7 343 100-20-30', address: 'ул. Монтажников, 5', hours: '9-18', note: 'Уплотнители, фурнитура' });
assert(!!sup1, 'saveSupplier: новый создан');
assert.eq(sup1.name, 'ОкнаПро', 'saveSupplier: имя верно');
assert(sup1.id !== null && sup1.id !== '', 'saveSupplier: id присвоен');
assert(DB.suppliers.length === 1, 'saveSupplier: 1 в списке');

var sup2 = saveSupplier({ id: sup1.id, name: 'ОкнаПро обновлён', phone: '+7 343 999-99-99', address: '', hours: '', note: '' });
assert(!!sup2, 'saveSupplier: обновление');
assert.eq(sup2.name, 'ОкнаПро обновлён', 'saveSupplier: имя обновлено');
assert(DB.suppliers.length === 1, 'saveSupplier: дубль не добавлен');

var supFromId = findSupplier(sup1.id);
assert(!!supFromId, 'findSupplier: найден');
assert.eq(supFromId.name, 'ОкнаПро обновлён', 'findSupplier: актуальные данные');

var supNull = findSupplier(null);
assert(supNull === null, 'findSupplier: null → null');

var supMissing = findSupplier('nonexistent');
assert(supMissing === null, 'findSupplier: несуществующий → null');

assert(saveSupplier({ name: '' }) === null, 'saveSupplier: пустое имя → null');
assert(saveSupplier(null) === null, 'saveSupplier: null → null');

// --- 2. deleteSupplier ---
assert(deleteSupplier(sup1.id) === true, 'deleteSupplier: удалён');
assert(DB.suppliers.length === 0, 'deleteSupplier: пустой список');
assert(deleteSupplier('missing') === false, 'deleteSupplier: несуществующий → false');

// --- 3. Нормализация материалов: place и supplierId ---
var testOrder = {
  id: 99, client: 'Тест', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'new',
  works: [], extras: [], history: [], payments: [],
  materials: [
    { name: 'Уплотнитель', qty: 5, price: 250, buyer: 'company', status: 'needed' },
    { name: 'Стеклопакет', qty: 1, price: 5000, buyer: 'company', status: 'needed',
      place: 'warehouse', supplierId: 'sup123' },
    { name: 'Доводчик', qty: 1, price: 1500, buyer: 'worker', status: 'bought',
      place: 'trunk', supplierId: null, factPrice: 1600 }
  ]
};
normalizeOrder(testOrder);
assert.eq(testOrder.materials[0].place, 'supplier', 'normalizeOrder: дефолт place');
assert.eq(testOrder.materials[0].supplierId, null, 'normalizeOrder: дефолт supplierId');
assert.eq(testOrder.materials[1].place, 'warehouse', 'normalizeOrder: сохранён warehouse');
assert.eq(testOrder.materials[1].supplierId, 'sup123', 'normalizeOrder: сохранён supplierId');
assert.eq(testOrder.materials[2].place, 'trunk', 'normalizeOrder: сохранён trunk');
assert.eq(testOrder.materials[2].supplierId, null, 'normalizeOrder: null supplierId');

// --- 4. MAT_PLACES / MAT_PLACE_LABELS ---
assert(MAT_PLACES.indexOf('trunk') >= 0, 'MAT_PLACES: trunk');
assert(MAT_PLACES.indexOf('supplier') >= 0, 'MAT_PLACES: supplier');
assert(MAT_PLACES.indexOf('warehouse') >= 0, 'MAT_PLACES: warehouse');
assert(MAT_PLACES.indexOf('client') >= 0, 'MAT_PLACES: client');
assert.eq(MAT_PLACE_LABELS.trunk, '🚗 Багажник', 'MAT_PLACE_LABELS: trunk');
assert.eq(MAT_PLACE_LABELS.supplier, '🏪 Поставщик', 'MAT_PLACE_LABELS: supplier');

// --- 5. materialGroupKey ---
var m1 = { place: 'supplier', supplierId: 'supA' };
var m2 = { place: 'warehouse', supplierId: null };
var m3 = { place: 'trunk', supplierId: null };
assert.eq(materialGroupKey(m1), 'supplier:supA', 'materialGroupKey: поставщик');
assert.eq(materialGroupKey(m2), 'place:warehouse', 'materialGroupKey: склад');
assert.eq(materialGroupKey(m3), 'place:trunk', 'materialGroupKey: багажник');

var mNoPlace = {};
assert.eq(materialGroupKey(mNoPlace), 'place:supplier', 'materialGroupKey: дефолт');

// --- 6. materialGroupLabel ---
// Адрес у поставщика есть — он нужен для кнопок навигатора в маршруте;
// в метку группировки адрес не входит (только часы и телефон).
var supB = saveSupplier({ name: 'Склад-Юг', phone: '+7 343 555-55-55',
  address: 'ул. Монтажников, 7', hours: '8-17' });
assert(!!supB, 'helper supB создан');
assert.eq(materialGroupLabel('supplier:' + supB.id), '🏪 Склад-Юг · 8-17 · +7 343 555-55-55', 'materialGroupLabel: с поставщиком');
assert.eq(materialGroupLabel('place:warehouse'), '🏭 Склад', 'materialGroupLabel: склад');
assert.eq(materialGroupLabel('place:trunk'), '🚗 Багажник', 'materialGroupLabel: багажник');

// --- 7. groupMaterialsBySupplier ---
var items = [
  { o: { id: 1, client: 'А' }, m: { place: 'supplier', supplierId: supB.id, status: 'needed', name: 'Уплотнитель', qty: 1, price: 100, unit: 'шт' } },
  { o: { id: 2, client: 'Б' }, m: { place: 'supplier', supplierId: supB.id, status: 'needed', name: 'Фурнитура', qty: 2, price: 200, unit: 'шт' } },
  { o: { id: 1, client: 'А' }, m: { place: 'warehouse', status: 'needed', name: 'Стекло', qty: 1, price: 5000, unit: 'шт' } }
];
var groups = groupMaterialsBySupplier(items);
assert.eq(groups.length, 2, 'groupMaterialsBySupplier: 2 группы');
// Сначала поставщики, потом остальные.
assert(groups[0].label.indexOf('Склад-Юг') >= 0, 'groupMaterialsBySupplier: поставщик первый');
assert(groups[0].items.length === 2, 'groupMaterialsBySupplier: 2 материала у поставщика');
assert(groups[1].label.indexOf('Склад') >= 0, 'groupMaterialsBySupplier: склад второй');

// Пустой список → пустая группировка
assert.eq(groupMaterialsBySupplier([]).length, 0, 'groupMaterialsBySupplier: пусто');
assert(groupMaterialsBySupplier(null).length === 0, 'groupMaterialsBySupplier: null');

// --- 8. buildPurchaseRoute ---
var routeOrder = {
  id: 10, client: 'Маршрут', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'estimate',
  works: [], extras: [], materials: [], history: [], payments: []
};
// Поставщик needed.
routeOrder.materials.push({ name: 'Уплотнитель', qty: 5, price: 250, status: 'needed',
  place: 'supplier', supplierId: supB.id });
// Уже купленный — не попадает.
routeOrder.materials.push({ name: 'Стекло', qty: 1, price: 5000, status: 'bought',
  place: 'supplier', supplierId: supB.id, factPrice: 5000 });
// Склад needed — если есть warehouseAddress.
DB.settings.warehouseAddress = 'ул. Складская, 1';
routeOrder.materials.push({ name: 'Пена', qty: 3, price: 100, status: 'needed',
  place: 'warehouse', supplierId: null });

var route = buildPurchaseRoute(routeOrder);
assert.eq(route.length, 2, 'buildPurchaseRoute: 2 точки (поставщик + склад)');
assert(route[0].title.indexOf('Склад-Юг') >= 0, 'buildPurchaseRoute: поставщик');
assert(route[1].title === 'Склад', 'buildPurchaseRoute: склад');

// Игнорирование точки: она остаётся в списке (чтобы снять игнор чекбоксом),
// но помечается ignored.
var ig = {};
ig['supplier:' + supB.id] = true;
var routeIgnored = buildPurchaseRoute(routeOrder, ig);
assert.eq(routeIgnored.length, 2, 'buildPurchaseRoute: игнор не удаляет точку');
assert.eq(routeIgnored[0].ignored, true, 'buildPurchaseRoute: поставщик помечен ignored');
assert.eq(routeIgnored[1].ignored, false, 'buildPurchaseRoute: склад не игнорируется');

// --- 9. navigatorUrl ---
assert.eq(navigatorUrl('yandex', 'Екатеринбург, ул. Тестовая, 5'),
  'https://yandex.ru/maps/?text=' + encodeURIComponent('Екатеринбург, ул. Тестовая, 5'),
  'navigatorUrl: yandex');
assert.eq(navigatorUrl('2gis', 'Екатеринбург, ул. Тестовая, 5'),
  'https://2gis.ru/search/' + encodeURIComponent('Екатеринбург, ул. Тестовая, 5'),
  'navigatorUrl: 2gis');
assert.eq(navigatorUrl('google', 'Екатеринбург, ул. Тестовая, 5'),
  'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Екатеринбург, ул. Тестовая, 5'),
  'navigatorUrl: google');
assert.eq(navigatorUrl('yandex', ''), '', 'navigatorUrl: пустой адрес');

// --- 10. renderGlobalShopping: группировка и шаринг ---
// Убедимся, что группировка выводится.
state.shopFilter = 'all';
var shopHtml = renderGlobalShopping();
assert(shopHtml.indexOf('🛒 Закупки') >= 0, 'shop: заголовок');
assert(shopHtml.indexOf('data-shop-filter="needed"') >= 0, 'shop: чип needed');
assert(shopHtml.indexOf('data-shop-filter="comp"') >= 0, 'shop: чип comp');
assert(shopHtml.indexOf('К выплате работникам') >= 0, 'shop: сумма к выплате');
assert(shopHtml.indexOf('data-compensate=') >= 0, 'shop: кнопка компенсации');
// Группировка по поставщикам.
assert(shopHtml.indexOf('Группировка по поставщикам') >= 0, 'shop: заголовок группировки');
assert(shopHtml.indexOf('data-share-shop-list') >= 0, 'shop: кнопка шаринга');

// --- 11. renderOrderRouteBlock: маршрут в карточке ---
var routeCardOrder = {
  id: 20, client: 'Рут', city: 'Екб', address: 'ул. Рут, 1', phone: '',
  date: localToday(), t1: '10:00', t2: '14:00',
  worker: 'Мастер', status: 'estimate',
  works: [], extras: [], materials: [], history: [], payments: []
};
routeCardOrder.materials.push({ name: 'Уплотнитель', qty: 5, price: 250, status: 'needed',
  place: 'supplier', supplierId: supB.id });

// Загрузим ui-docs для shareDocument (смоук ui-orders её не тянет).
loadModule('app/ui-docs.js');

var mainTab = renderOrderTabMain(routeCardOrder);
assert(mainTab.indexOf('Маршрут закупки') >= 0, 'routeBlock: заголовок маршрута');
assert(mainTab.indexOf('Склад-Юг') >= 0, 'routeBlock: название поставщика');
assert(mainTab.indexOf('data-route-ignore=') >= 0, 'routeBlock: чекбокс игнор');
assert(mainTab.indexOf('2ГИС') >= 0, 'routeBlock: кнопка 2ГИС');
assert(mainTab.indexOf('Яндекс') >= 0, 'routeBlock: кнопка Яндекс');
assert(mainTab.indexOf('Google') >= 0, 'routeBlock: кнопка Google');
assert(mainTab.indexOf('target="_blank"') >= 0, 'routeBlock: открывает новую вкладку');

// Пустой маршрут (нет needed материалов).
var emptyRouteOrder = {
  id: 21, client: 'Пусто', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'new',
  works: [], extras: [], materials: [
    { name: 'Куплено', qty: 1, price: 100, status: 'bought', place: 'trunk', supplierId: null, factPrice: 100 }
  ], history: [], payments: []
};
var emptyMainTab = renderOrderTabMain(emptyRouteOrder);
assert(emptyMainTab.indexOf('Маршрут закупки') < 0, 'routeBlock: нет маршрута если пусто');

// --- 12. renderAdminSuppliers: вкладка в админке ---
ADMIN_TAB = 'suppliers';
var adminHtml = renderAdmin();
assert(adminHtml.indexOf('🚚 Поставщики') >= 0, 'admin: вкладка поставщиков');
assert(adminHtml.indexOf('data-add-supplier') >= 0, 'admin: кнопка добавить');
assert(adminHtml.indexOf('wh-address') >= 0, 'admin: поле адреса склада');
assert(adminHtml.indexOf('data-save-warehouse') >= 0, 'admin: кнопка сохранения склада');

// --- 13. renderSupplierModal ---
renderSupplierModal({ id: null, name: '', phone: '', address: '', hours: '', note: '' });
assert(modalStub.innerHTML.indexOf('sp-name') >= 0, 'supplierModal: поле name');
assert(modalStub.innerHTML.indexOf('sp-phone') >= 0, 'supplierModal: поле phone');
assert(modalStub.innerHTML.indexOf('sp-address') >= 0, 'supplierModal: поле address');
assert(modalStub.innerHTML.indexOf('sp-hours') >= 0, 'supplierModal: поле hours');
assert(modalStub.innerHTML.indexOf('sp-note') >= 0, 'supplierModal: поле note');
assert(modalStub.innerHTML.indexOf('data-save-supplier') >= 0, 'supplierModal: кнопка сохранения');
closeModal();

// --- 14. renderMaterialModal: поля place/supplier ---
var matOrder = {
  id: 30, client: 'Материал', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'estimate',
  works: [], extras: [], materials: [], history: [], payments: []
};
renderMaterialModal(matOrder, null);
assert(modalStub.innerHTML.indexOf('mt-place') >= 0, 'matModal: select места');
assert(modalStub.innerHTML.indexOf('mt-supplier') >= 0, 'matModal: select поставщика');
assert(modalStub.innerHTML.indexOf('Склад-Юг') >= 0, 'matModal: поставщик в списке');
closeModal();

// --- 15. saveMaterialFromModal: place/supplierId ---
var saveMatOrder = {
  id: 40, client: 'Save', city: 'Екб', address: '', phone: '',
  date: localToday(), t1: '09:00', t2: '12:00',
  worker: 'Мастер', status: 'new',
  works: [], extras: [], materials: [], history: [], payments: []
};
// Функция ищет заявку в DB.orders — регистрируем её там.
DB.orders.push(saveMatOrder);
var saved = saveMaterialFromModal(40, null, {
  name: 'Тест-материал', qty: '3', unit: 'шт', price: '500',
  buyer: 'company', status: 'needed',
  place: 'trunk', supplierId: supB.id
});
assert(!!saved, 'saveMaterialFromModal: создан');
assert.eq(saved.place, 'trunk', 'saveMaterialFromModal: place = trunk');
assert.eq(saved.supplierId, supB.id, 'saveMaterialFromModal: supplierId');
