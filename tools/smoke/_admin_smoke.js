/* Смоук app/ui-admin.js (Этап 11): сотрудники, реквизиты, прайс-лист. */
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
// Поля форм: id → value. Тест наполняет их перед saveRequisitesFromForm().
const formFields = {};
const clickHandlers = [];
const changeHandlers = [];
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    if (Object.prototype.hasOwnProperty.call(formFields, id)) return { value: formFields[id] };
    return null;
  },
  addEventListener: function (type, fn) {
    if (type === 'click') clickHandlers.push(fn);
    if (type === 'change') changeHandlers.push(fn);
  }
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
loadModule('app/ui-admin.js');

setOwnerFlag(false);
login('admin', 'Владелец');

// Клик/изменение через зарегистрированные делегаты (как в браузере).
function fireClick(attr, value, extra) {
  const node = Object.assign({
    getAttribute: function (a) { return a === attr ? value : null; },
    value: (extra && extra.value) || ''
  }, extra || {});
  const ev = { target: { closest: function (s) { return s === '[' + attr + ']' ? node : null; } } };
  clickHandlers.forEach(function (fn) { fn(ev); });
}
function fireChange(attr, value, selectValue) {
  const node = {
    getAttribute: function (a) { return a === attr ? value : null; },
    value: selectValue
  };
  const ev = { target: { closest: function (s) { return s === '[' + attr + ']' ? node : null; } } };
  changeHandlers.forEach(function (fn) { fn(ev); });
}

// --- 1. renderAdminEmployees: список + элементы управления ---
const empHtml = renderAdminEmployees();
assert(empHtml.indexOf('Сотрудники') >= 0, 'employees: заголовок');
assert(empHtml.indexOf('data-add-employee') >= 0, 'employees: кнопка добавить');
(DB.users || []).forEach(function (u) {
  assert(empHtml.indexOf(escapeHtml(u.name)) >= 0, 'employees: имя ' + u.name + ' в списке');
  assert(empHtml.indexOf('data-role-change="' + u.id + '"') >= 0,
    'employees: select смены роли для ' + u.name);
  assert(empHtml.indexOf('data-fire="' + u.id + '"') >= 0,
    'employees: кнопка уволить для ' + u.name);
});
assert(/<option value="[a-z]+" selected>/.test(empHtml),
  'employees: текущая роль отмечена selected');
assert(empHtml.indexOf('admin') >= 0 && empHtml.indexOf('worker') >= 0,
  'employees: опции ролей присутствуют');

// --- 2. changeUserRole: обновляет DB.users + save() ---
const target = DB.users[DB.users.length - 1];
const oldRole = target.role;
assert.eq(changeUserRole(target.id, 'manager'), true, 'changeUserRole: вернул true');
assert.eq(DB.users[DB.users.length - 1].role, 'manager', 'changeUserRole: роль в DB обновлена');
assert(JSON.parse(localStorage.getItem('crm2_db')).users[DB.users.length - 1].role === 'manager',
  'changeUserRole: сохранено в localStorage (save())');
assert.eq(changeUserRole(target.id, 'hacker'), false, 'changeUserRole: чужая роль отклонена');
assert.eq(changeUserRole('no-such-id', 'admin'), false, 'changeUserRole: неизвестный id → false');
changeUserRole(target.id, oldRole); // вернуть как было

// Смена роли через делегат change (select).
fireChange('data-role-change', String(target.id), 'operator');
assert.eq(DB.users[DB.users.length - 1].role, 'operator', 'делегат change: роль обновлена');
changeUserRole(target.id, oldRole);

// Увольнение через делегат click.
fireClick('data-fire', String(target.id));
assert.eq(DB.users[DB.users.length - 1].status, 'fired', 'делегат click data-fire: статус fired');
DB.users[DB.users.length - 1].status = 'active';

// --- 3. renderAdminRequisites: поля зависят от executorMode ---
DB.settings.executorMode = 'phys';
const reqPhys = renderAdminRequisites();
assert(reqPhys.indexOf('id="req-name"') >= 0, 'requisites phys: поле Имя');
assert(reqPhys.indexOf('id="req-phone"') >= 0, 'requisites phys: поле Телефон');
assert(reqPhys.indexOf('id="req-inn"') < 0, 'requisites phys: ИНН отсутствует');
assert(reqPhys.indexOf('id="req-kpp"') < 0, 'requisites phys: КПП отсутствует');

DB.settings.executorMode = 'self_employed';
const reqSe = renderAdminRequisites();
assert(reqSe.indexOf('id="req-inn"') >= 0, 'requisites self_employed: ИНН есть');
assert(reqSe.indexOf('id="req-kpp"') < 0, 'requisites self_employed: КПП отсутствует');

DB.settings.executorMode = 'legal';
const reqLegal = renderAdminRequisites();
['req-name', 'req-inn', 'req-kpp', 'req-address', 'req-bank', 'req-bik',
 'req-account', 'req-director', 'req-phone'].forEach(function (id) {
  assert(reqLegal.indexOf('id="' + id + '"') >= 0, 'requisites legal: поле ' + id);
});
assert(reqLegal.indexOf('data-mode="phys"') >= 0 &&
  reqLegal.indexOf('data-mode="legal"') >= 0 &&
  reqLegal.indexOf('data-mode="self_employed"') >= 0,
  'requisites: переключатель data-mode для трёх режимов');
assert(reqLegal.indexOf('data-save-requisites') >= 0, 'requisites: кнопка сохранения');
assert(reqLegal.indexOf('active" data-mode="legal"') >= 0, 'requisites: активный режим подсвечен');

// --- 4. saveRequisitesFromForm: обновляет DB.settings и сохраняет ---
formFields['req-name'] = 'ООО Тест';
formFields['req-inn'] = '1234567890';
formFields['req-kpp'] = '123456789';
formFields['req-address'] = 'г. Тест, ул. Профсоюзная, 1';
formFields['req-bank'] = 'ПАО Тестбанк';
formFields['req-bik'] = '044525000';
formFields['req-account'] = '40702810000000000000';
formFields['req-director'] = 'Петров П.П.';
formFields['req-phone'] = '+7 343 000-11-22';
assert.eq(saveRequisitesFromForm(), true, 'saveRequisitesFromForm: вернул true');
assert.eq(DB.settings.executorLegal.name, 'ООО Тест', 'saveRequisites: name записан');
assert.eq(DB.settings.executorLegal.inn, '1234567890', 'saveRequisites: inn записан');
assert.eq(DB.settings.executorLegal.director, 'Петров П.П.', 'saveRequisites: director записан');
const persisted = JSON.parse(localStorage.getItem('crm2_db'));
assert.eq(persisted.settings.executorLegal.kpp, '123456789', 'saveRequisites: сохранено в localStorage');
delete formFields['req-name'];

// Смена режима через делегат click.
fireClick('data-mode', 'phys');
assert.eq(DB.settings.executorMode, 'phys', 'делегат data-mode: режим переключён');
DB.settings.executorMode = 'legal';

// --- 5. renderAdminPrice + deletePriceItem ---
const priceHtml = renderAdminPrice();
assert(priceHtml.indexOf('Прайс-лист') >= 0, 'price: заголовок');
assert(priceHtml.indexOf('data-add-price') >= 0, 'price: кнопка добавить');
(DB.priceList || []).forEach(function (p) {
  assert(priceHtml.indexOf(escapeHtml(p.name)) >= 0, 'price: позиция ' + p.name);
  assert(priceHtml.indexOf('data-edit-price="' + p.id + '"') >= 0, 'price: кнопка ✎ для ' + p.id);
  assert(priceHtml.indexOf('data-delete-price="' + p.id + '"') >= 0, 'price: кнопка 🗑 для ' + p.id);
});

const priceCount = DB.priceList.length;
const doomed = DB.priceList[0];
assert.eq(deletePriceItem(doomed.id), true, 'deletePriceItem: вернул true');
assert.eq(DB.priceList.length, priceCount - 1, 'deletePriceItem: позиция удалена');
assert(!DB.priceList.some(function (p) { return p.id === doomed.id; }),
  'deletePriceItem: id больше нет в прайсе');
assert(!JSON.parse(localStorage.getItem('crm2_db')).priceList.some(function (p) {
  return p.id === doomed.id;
}), 'deletePriceItem: сохранено в localStorage');
assert.eq(deletePriceItem(999999), false, 'deletePriceItem: неизвестный id → false');

// Добавление новой позиции через модалку (заполняем поля и кликаем «Сохранить»).
formFields['pr-name'] = 'Тестовая позиция';
formFields['pr-category'] = 'Тест';
formFields['pr-price'] = '1234';
formFields['pr-unit'] = 'шт';
formFields['pr-qty'] = '2';
window.__priceEdit = { id: null };
const priceBefore = DB.priceList.length;
fireClick('data-save-price', '');
assert.eq(DB.priceList.length, priceBefore + 1, 'делегат save-price: позиция добавлена');
const added = DB.priceList[DB.priceList.length - 1];
assert.eq(added.name, 'Тестовая позиция', 'save-price: имя сохранено');
assert.eq(added.basePrice, 1234, 'save-price: число распознано');
delete formFields['pr-name'];

// --- 6. renderAdmin: табы и контент ---
ADMIN_TAB = 'employees';
const adminHtml = renderAdmin();
assert(adminHtml.indexOf('Администрирование') >= 0, 'renderAdmin: заголовок');
assert(adminHtml.indexOf('data-admin-tab="employees"') >= 0, 'renderAdmin: таб Сотрудники');
assert(adminHtml.indexOf('data-admin-tab="requisites"') >= 0, 'renderAdmin: таб Реквизиты');
assert(adminHtml.indexOf('data-admin-tab="price"') >= 0, 'renderAdmin: таб Прайс');
ADMIN_TAB = 'requisites';
assert(renderAdmin().indexOf('Реквизиты исполнителя') >= 0, 'renderAdmin: контент реквизитов');
ADMIN_TAB = 'price';
assert(renderAdmin().indexOf('Прайс-лист') >= 0, 'renderAdmin: контент прайса');
ADMIN_TAB = 'employees';

// Переключение таба делегатом.
fireClick('data-admin-tab', 'price');
assert.eq(ADMIN_TAB, 'price', 'делегат data-admin-tab: таб переключён');
ADMIN_TAB = 'employees';

// --- 7. Инлайн-обработчиков нет (SPEC, правило 1) ---
const allHtml = renderAdmin() + renderAdminRequisites() + renderAdminPrice() + renderAdminEmployees();
assert(allHtml.indexOf('onclick') < 0, 'админка: onclick отсутствует');
assert(allHtml.indexOf('onchange') < 0, 'админка: onchange отсутствует');

// --- 8. Регрессия: отсутствие ui-admin.js не роняет приложение ---
assert(typeof S.admin === 'function', 'S.admin — функция');
const savedAdmin = globalThis.renderAdmin;
globalThis.renderAdmin = undefined;
const stub = S.admin();
assert(typeof stub === 'string' && stub.length > 0,
  'регрессия: без ui-admin.js S.admin отдаёт заглушку без ошибки');
assert(stub.indexOf('не загружен') >= 0, 'регрессия: заглушка с понятным текстом');
globalThis.renderAdmin = savedAdmin;
assert(S.admin().indexOf('Администрирование') >= 0, 'регрессия: с модулем — полноценный экран');

// --- 9. Экран доступен из роутера ---
go('admin');
assert.eq(state.screen, 'admin', 'go("admin"): экран переключён');
assert(appStub.innerHTML.indexOf('Администрирование') >= 0, 'render(): экран админки в #app');
