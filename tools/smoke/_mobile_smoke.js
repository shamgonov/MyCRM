/* Смоук Этапа 26: мобильная оптимизация.
   1) Адаптивные grid-колонки (COLS_EMP/COLS_PRICE/COLS_SUPP с minmax).
   2) theme.css: overflow-x hidden на html/body/#app, скролл .nav-scroll,
      flex-wrap у .row, nowrap-чипы, отсутствие конфликтующих margin auto.
   3) render() гарантирует padding-bottom для #app (гард на стабы без style). */
'use strict';

// --- theme.css читается с диска (как firestore.rules в _access_smoke.js) ---

function readCss() {
  var tries = ['styles/theme.css', path.join('..', '..', 'styles/theme.css')];
  for (var i = 0; i < tries.length; i++) {
    try { return fs.readFileSync(tries[i], 'utf8'); } catch (e) { /* дальше */ }
  }
  return '';
}
var css = readCss();
assert(css.length > 0, 'theme.css найден и прочитан');

// Блок правила по regex-селектору: { ... } до закрывающей скобки.
// Селектор передаётся уже как regex ('\\.row', 'html,\\s+body').
function ruleBody(selRe) {
  var m = css.match(new RegExp(selRe + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
}

// --- 1. html, body / #app: горизонтальный ноль-прорыв ---

var htmlBody = ruleBody('html,\\s+body');
assert(htmlBody.indexOf('overflow-x: hidden') >= 0, '1: html, body → overflow-x: hidden');
assert(htmlBody.indexOf('max-width: 100vw') >= 0, '1: html, body → max-width: 100vw');

var appRule = ruleBody('#app');
assert(appRule.indexOf('overflow-x: hidden') >= 0, '1: #app → overflow-x: hidden');
assert(appRule.indexOf('max-width: min(720px, 100%)') >= 0,
  '1: #app → max-width: min(720px, 100%) (десктоп-центрирование сохранено)');
assert(appRule.indexOf('box-sizing: border-box') >= 0, '1: #app → box-sizing: border-box');
assert(appRule.indexOf('--nav-h') >= 0, '1: #app → padding учитывает высоту навигации');

// Универсальный box-sizing (в исходной теме был `* { box-sizing }` — проверяем,
// что он остался и покрывает псевдоэлементы из ТЗ).
assert(css.indexOf('box-sizing: border-box') >= 0, '1: box-sizing: border-box присутствует');

// --- 2. Таблицы и карточки: локальный скролл вместо прорыва страницы ---

var gridRows = ruleBody('\\.arow,\\s*\\.rrow,\\s*\\.mrow');
assert(gridRows.indexOf('overflow-x: auto') >= 0, '2: .arow/.rrow/.mrow → overflow-x: auto');
assert(gridRows.indexOf('-webkit-overflow-scrolling: touch') >= 0,
  '2: grid-строки → инерционный скролл на touch');

var cardRule = ruleBody('\\.card,\\s*\\.list-item');
assert(cardRule.indexOf('max-width: 100%') >= 0, '2: .card/.list-item → max-width: 100%');
assert(cardRule.indexOf('word-wrap: break-word') >= 0, '2: .card/.list-item → перенос слов');

// --- 3. Ряды кнопок и чипы ---

var rowRule = ruleBody('\\.row');
assert(rowRule.indexOf('display: flex') >= 0, '3: .row → display: flex (регрессия)');
assert(rowRule.indexOf('flex-wrap: wrap') >= 0, '3: .row → flex-wrap: wrap');
var rowBtn = ruleBody('\\.row\\s*>\\s*\\.btn(?![\\w-])');
assert(rowBtn.indexOf('min-width: 0') >= 0, '3: .row > .btn → min-width: 0');
assert(rowBtn.indexOf('flex: 1 1 auto') >= 0, '3: .row > .btn → flex: 1 1 auto');

var chipsRule = ruleBody('\\.chips');
assert(chipsRule.indexOf('overflow-x: auto') >= 0, '3: .chips → overflow-x: auto');
assert(chipsRule.indexOf('flex-wrap: nowrap') >= 0, '3: .chips → flex-wrap: nowrap');
// В CSS селектор записан списком: '.chips > .chip, .chips > .btn { ... }' —
// между селектором и '{' может быть хвост списка ([^{]* не перепрыгнет '{').
var chipItem = ruleBody('\\.chips\\s*>\\s*\\.chip(?![\\w-])[^{]*');
assert(chipItem.indexOf('flex: 0 0 auto') >= 0, '3: чип не сжимается (flex: 0 0 auto)');

// --- 3.1 Табы карточки заявки: горизонтальный скролл (6 табов на телефоне) ---

var tabsRule = ruleBody('\\.tabs(?![\\w-])');
assert(tabsRule.indexOf('overflow-x: auto') >= 0, '3.1: .tabs → overflow-x: auto');
assert(tabsRule.indexOf('overflow-y: hidden') >= 0, '3.1: .tabs → overflow-y: hidden');
assert(tabsRule.indexOf('-webkit-overflow-scrolling: touch') >= 0,
  '3.1: .tabs → инерционный скролл на touch');
assert(tabsRule.indexOf('overscroll-behavior-x: contain') >= 0,
  '3.1: .tabs → overscroll-behavior-x: contain');
assert(tabsRule.indexOf('justify-content: flex-start') >= 0,
  '3.1: .tabs → justify-content: flex-start');
var tabBtnRule = ruleBody('\\.tab-btn(?![\\w-])');
assert(tabBtnRule.indexOf('flex: 0 0 auto') >= 0, '3.1: .tab-btn не сжимается');
assert(tabBtnRule.indexOf('white-space: nowrap') >= 0, '3.1: .tab-btn → nowrap');

// --- 3.2 Этап 29: .order-tabs-scroll — скрытый скроллбар + snap ---

var otsRule = ruleBody('\\.order-tabs-scroll(?![\\w-:])');
assert(otsRule.indexOf('scroll-snap-type: x proximity') >= 0,
  '3.2: .order-tabs-scroll → scroll-snap-type');
assert(otsRule.indexOf('scrollbar-width: none') >= 0,
  '3.2: .order-tabs-scroll → скроллбар скрыт (Firefox)');
assert(css.indexOf('.order-tabs-scroll::-webkit-scrollbar') >= 0,
  '3.2: .order-tabs-scroll::-webkit-scrollbar → display: none');
var otsBtn = ruleBody('\\.order-tabs-scroll \\.tab-btn(?![\\w-])');
assert(otsBtn.indexOf('flex: 0 0 auto') >= 0, '3.2: вкладки не сжимаются');
assert(otsBtn.indexOf('scroll-snap-align: start') >= 0, '3.2: snap к началу вкладки');

// --- 3.3 Этап 33: заголовки и панели действий переносятся, а не вылезают ---

// .spread: flex-wrap + отступ между перенесёнными элементами.
var spreadRule = ruleBody('\\.spread(?![\\w-])');
assert(spreadRule.indexOf('display: flex') >= 0, '3.3: .spread → display: flex (регрессия)');
assert(spreadRule.indexOf('flex-wrap: wrap') >= 0, '3.3: .spread → flex-wrap: wrap');
assert(spreadRule.indexOf('gap: 8px') >= 0, '3.3: .spread → gap: 8px');
// Заголовок тянется, но не сплющивается в ноль и переносит длинные слова.
var spreadH2 = ruleBody('\\.spread\\s+h2');
assert(spreadH2.indexOf('flex: 1 1 auto') >= 0, '3.3: .spread h2 → flex: 1 1 auto');
assert(spreadH2.indexOf('min-width: 200px') >= 0, '3.3: .spread h2 → min-width: 200px');
assert(spreadH2.indexOf('overflow-wrap: break-word') >= 0,
  '3.3: .spread h2 → перенос длинных названий');
// Кнопка действия не сжимается и не разрывается внутри себя.
var spreadBtn = ruleBody('\\.spread\\s*>\\s*\\.btn(?![\\w-])');
assert(spreadBtn.indexOf('flex-shrink: 0') >= 0, '3.3: .spread > .btn → flex-shrink: 0');
assert(spreadBtn.indexOf('white-space: nowrap') >= 0, '3.3: .spread > .btn → nowrap');

// .head-row: шапка карточки (кнопка «←», заголовок, бейдж).
var headRule = ruleBody('\\.head-row(?![\\w-])');
assert(headRule.indexOf('display: flex') >= 0, '3.3: .head-row → display: flex (регрессия)');
assert(headRule.indexOf('flex-wrap: wrap') >= 0, '3.3: .head-row → flex-wrap: wrap');
assert(headRule.indexOf('gap: 8px') >= 0, '3.3: .head-row → gap: 8px');
var headH2 = ruleBody('\\.head-row\\s+h2');
assert(headH2.indexOf('flex: 1 1 auto') >= 0, '3.3: .head-row h2 → flex: 1 1 auto');
assert(headH2.indexOf('min-width: 0') >= 0, '3.3: .head-row h2 → min-width: 0');
var headBtn = ruleBody('\\.head-row\\s*>\\s*\\.btn(?![\\w-])');
assert(headBtn.indexOf('flex-shrink: 0') >= 0, '3.3: .head-row > .btn → flex-shrink: 0');
assert(headBtn.indexOf('white-space: nowrap') >= 0, '3.3: .head-row > .btn → nowrap');

// Регрессия Этапа 26: вложенные кнопки рядов не получили nowrap (иначе
// flex-wrap: wrap в .row перестал бы работать).
assert(ruleBody('\\.row\\s*>\\s*\\.btn(?![\\w-])').indexOf('white-space: nowrap') < 0,
  '3.3: .row > .btn без nowrap (flex-wrap ряда сохранён)');

// --- 4. Нижняя навигация ---

var navScroll = ruleBody('\\.nav-scroll');
assert(navScroll.indexOf('overflow-x: auto') >= 0, '4: .nav-scroll → overflow-x: auto');
assert(navScroll.indexOf('justify-content: flex-start') >= 0,
  '4: .nav-scroll → justify-content: flex-start');
assert(navScroll.indexOf('overscroll-behavior-x: contain') >= 0,
  '4: .nav-scroll → overscroll-behavior-x: contain (нет «тяги» страницы)');
// Регрессия Этапа 26: margin-auto центрирование удалено (ломало скролл).
assert(css.indexOf('margin-left: auto') === -1, '4: .nav-scroll > :first-child margin удалён');
assert(css.indexOf('margin-right: auto') === -1, '4: .nav-scroll > :last-child margin удалён');

var navBtn = ruleBody('#nav \\.nav-btn');
assert(navBtn.indexOf('flex: 0 0 auto') >= 0, '4: nav-btn не сжимается');
assert(navBtn.indexOf('min-width: 72px') >= 0, '4: nav-btn min-width 72px (тач-цель)');
assert(navBtn.indexOf('scroll-snap-align: center') >= 0, '4: nav-btn привязка снапа');
var navLabel = ruleBody('#nav \\.nav-btn \\.nav-label');
assert(navLabel.indexOf('text-overflow: ellipsis') >= 0, '4: длинные подписи — многоточие');

// --- Мок-окружение для JS-проверок ---

globalThis.localStorage = (function () {
  var m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();

var appStub = { innerHTML: '', style: {} };
var navStub = { innerHTML: '' };
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return { innerHTML: '' };
    return null;
  },
  addEventListener: function () {}
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-admin.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// --- 5. Адаптивные grid-колонки (константы ui-admin.js) ---

assert(COLS_EMP.indexOf('minmax(') >= 0, '5: COLS_EMP → minmax');
assert(COLS_PRICE.indexOf('minmax(') >= 0, '5: COLS_PRICE → minmax');
assert(COLS_SUPP.indexOf('minmax(') >= 0, '5: COLS_SUPP → minmax');
// Сумма минимумов заведомо меньше ширины телефона (390px).
function minSum(cols) {
  var sum = 0;
  cols.split('minmax(').slice(1).forEach(function (part) {
    sum += parseInt(part, 10) || 0;
  });
  return sum;
}
assert(minSum(COLS_EMP) <= 390, '5: COLS_EMP минимумы влезают в 390px (' + minSum(COLS_EMP) + ')');
assert(minSum(COLS_PRICE) <= 390, '5: COLS_PRICE минимумы влезают в 390px');
assert(minSum(COLS_SUPP) <= 390, '5: COLS_SUPP минимумы влезают в 390px');
// Число колонок не изменилось (5/5/5) — семантика таблиц та же.
assert.eq(COLS_EMP.split('minmax(').length - 1, 5, '5: COLS_EMP — 5 колонок');
assert.eq(COLS_PRICE.split('minmax(').length - 1, 5, '5: COLS_PRICE — 5 колонок');
assert.eq(COLS_SUPP.split('minmax(').length - 1, 5, '5: COLS_SUPP — 5 колонок');

// Таблицы админки реально используют новые колонки.
DB.users = [{ id: 'u1', name: 'Владелец', role: 'admin' }];
DB.priceList = [{ id: 1, name: 'Услуга', category: 'Окна', basePrice: 100, unit: 'шт', defaultQty: 1 }];
DB.suppliers = [{ id: 1, name: 'Поставщик', phone: '', address: '', hours: '', note: '' }];
ADMIN_TAB = 'employees';
assert(renderAdmin().indexOf('minmax(80px, 1.2fr)') >= 0, '5: таблица сотрудников → minmax-колонки');
ADMIN_TAB = 'price';
assert(renderAdmin().indexOf('minmax(100px, 1.6fr)') >= 0, '5: таблица прайса → minmax-колонки');
ADMIN_TAB = 'suppliers';
assert(renderAdmin().indexOf('minmax(90px, 1.4fr)') >= 0, '5: таблица поставщиков → minmax-колонки');
ADMIN_TAB = 'employees';

// --- 6. render() гарантирует padding-bottom для #app ---

appStub.style = {};
appStub.innerHTML = '';
render();
assert(String(appStub.style.paddingBottom).indexOf('--nav-h') >= 0,
  '6: render() задал padding-bottom через var(--nav-h)');
assert(String(appStub.style.paddingBottom).indexOf('env(safe-area-inset-bottom)') >= 0,
  '6: padding-bottom учитывает safe-area iPhone');
assert(appStub.innerHTML.length > 0, '6: контент экрана отрендерился');

// Регрессия: стаб #app без style (как в других смоуках) — render не падает.
globalThis.document.getElementById = function (id) {
  if (id === 'app') return { innerHTML: '' };
  if (id === 'nav') return navStub;
  return null;
};
render();
assert(true, '6: render() безопасен на стабе #app без .style');

// На экране входа padding тоже ставится (навигация скрыта, но стиль единый).
logout();
globalThis.document.getElementById = function (id) {
  if (id === 'app') return appStub;
  if (id === 'nav') return navStub;
  return null;
};
appStub.style = {};
render();
assert(String(appStub.style.paddingBottom).indexOf('--nav-h') >= 0,
  '6: на входе padding-bottom тоже проставлен');

// --- 7. Этап 33: кнопки действий карточки контрагента в .row ---

loadModule('app/ui-clients.js');
login('admin', 'Владелец');
DB.clients = [{
  id: 1, name: 'АдаптивТест', kind: 'person', inn: '', kpp: '', ogrn: '',
  phone: '', email: '', city: '', address: '', notes: '', orderIds: []
}];
var clCard = renderClientCard(DB.clients[0]);
var rowPos = clCard.indexOf('<div class="row" style="margin-top:10px">');
var editPos = clCard.indexOf('data-edit-client');
var delPos = clCard.indexOf('data-del-client');
assert(rowPos >= 0 && editPos > rowPos && delPos > rowPos,
  '7: кнопки ✎/🗑 карточки обёрнуты в .row (перенос на телефоне)');
assert(clCard.indexOf('style="margin-top:10px">✎') < 0 &&
       clCard.indexOf('style="margin-top:10px">🗑') < 0,
  '7: инлайн-margin у самих кнопок убран (ряд даёт отступ)');
// Заголовок списка + кнопка — в .spread без жёстких ширины.
var clList = renderClientList();
assert(clList.indexOf('<div class="spread">') >= 0, '7: заголовок списка в .spread');
assert(clList.indexOf('style="width:') < 0 && clList.indexOf('style="min-width:') < 0,
  '7: в списке контрагентов нет инлайн-ширин');
