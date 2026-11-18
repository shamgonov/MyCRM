/* Смоук Этапа 34: десктопная навигация.
   1) theme.css содержит @media (min-width: 768px) с отменой скролла
      (.nav-scroll overflow-x: visible, snap none, центрирование).
   2) Внутри медиа-запроса: кнопки #nav .nav-btn крупнее (min-width: 96px),
      подписи без обрезки, фейды #nav::before/::after скрыты, скроллбар убран.
   3) Регрессия Этапа 26: мобильные правила (< 768px) не тронуты —
      overflow-x: auto, scroll-snap-type, flex-start, min-width: 72px. */
'use strict';

// --- theme.css читается с диска (как в _mobile_smoke.js) ---

function readCss() {
  var tries = ['styles/theme.css', path.join('..', '..', 'styles/theme.css')];
  for (var i = 0; i < tries.length; i++) {
    try { return fs.readFileSync(tries[i], 'utf8'); } catch (e) { /* дальше */ }
  }
  return '';
}
var css = readCss();
assert(css.length > 0, 'theme.css найден и прочитан');

// Блок правила по regex-селектору: { ... } до закрывающей скобки
// (первое совпадение — мобильное базовое правило).
function ruleBody(selRe, source) {
  var src = source === undefined ? css : source;
  var m = src.match(new RegExp(selRe + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
}

// --- 1. Медиа-запрос присутствует и вырезается целиком ---

assert(css.indexOf('@media (min-width: 768px)') >= 0,
  '1: theme.css содержит @media (min-width: 768px)');

// Вырезаем блок медиа-запроса балансировкой фигурных скобок.
function mediaBlock(marker) {
  var start = css.indexOf(marker);
  if (start < 0) return '';
  var open = css.indexOf('{', start);
  if (open < 0) return '';
  var depth = 0;
  for (var i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}
var mq = mediaBlock('@media (min-width: 768px)');
assert(mq.length > 0, '1: блок медиа-запроса найден и сбалансирован');

// --- 2. Внутри медиа-запроса: скролл отменён, лента центрируется ---

var mqNavScroll = ruleBody('\\.nav-scroll(?![\\w-])', mq);
assert(mqNavScroll.indexOf('overflow-x: visible') >= 0,
  '2: в @media .nav-scroll → overflow-x: visible');
assert(mqNavScroll.indexOf('overflow-y: visible') >= 0,
  '2: в @media .nav-scroll → overflow-y: visible');
assert(mqNavScroll.indexOf('scroll-snap-type: none') >= 0,
  '2: в @media .nav-scroll → scroll-snap-type: none');
assert(mqNavScroll.indexOf('justify-content: center') >= 0,
  '2: в @media .nav-scroll → justify-content: center');
assert(mqNavScroll.indexOf('flex-wrap: wrap') >= 0,
  '2: в @media .nav-scroll → flex-wrap: wrap (многорядно при нехватке мест)');

var mqNav = ruleBody('#nav', mq);
assert(mqNav.indexOf('padding') >= 0, '2: в @media #nav → padding с отступами');

// --- 3. Внутри медиа-запроса: кнопки крупнее, подписи полные ---

var mqBtn = ruleBody('#nav \\.nav-btn(?![\\w.-])', mq);
assert(mqBtn.indexOf('min-width: 96px') >= 0,
  '3: в @media #nav .nav-btn → min-width: 96px');
assert(mqBtn.indexOf('font-size: 12px') >= 0, '3: в @media кнопки → font-size: 12px');

var mqLabel = ruleBody('#nav \\.nav-btn \\.nav-label', mq);
assert(mqLabel.indexOf('max-width: none') >= 0, '3: в @media подписи без max-width');
assert(mqLabel.indexOf('overflow: visible') >= 0, '3: в @media подписи не обрезаются');
assert(mqLabel.indexOf('text-overflow: clip') >= 0, '3: в @media нет многоточий');

// Фейды краёв и скроллбар на десктопе скрыты.
assert(/#nav::before,\s*#nav::after\s*\{[^}]*display:\s*none/.test(mq),
  '3: в @media фейды #nav::before/::after отключены');
assert(/\.nav-scroll::-webkit-scrollbar\s*\{[^}]*display:\s*none/.test(mq),
  '3: в @media скроллбар .nav-scroll скрыт');

// --- 4. Регрессия Этапа 26: мобильные правила (< 768px) не тронуты ---

var mobNavScroll = ruleBody('\\.nav-scroll(?![\\w-])');
assert(mobNavScroll.indexOf('overflow-x: auto') >= 0,
  '4: базовый .nav-scroll → overflow-x: auto (мобильный скролл)');
assert(mobNavScroll.indexOf('scroll-snap-type: x proximity') >= 0,
  '4: базовый .nav-scroll → snap остался');
assert(mobNavScroll.indexOf('justify-content: flex-start') >= 0,
  '4: базовый .nav-scroll → flex-start остался');
assert(mobNavScroll.indexOf('overscroll-behavior-x: contain') >= 0,
  '4: базовый .nav-scroll → contain остался');

var mobBtn = ruleBody('#nav \\.nav-btn(?![\\w.-])');
assert(mobBtn.indexOf('min-width: 72px') >= 0,
  '4: базовый #nav .nav-btn → min-width: 72px (тач-цель)');
var mobLabel = ruleBody('#nav \\.nav-btn \\.nav-label');
assert(mobLabel.indexOf('text-overflow: ellipsis') >= 0,
  '4: базовые подписи → ellipsis (мобильная обрезка)');
var mobFades = ruleBody('#nav::before,\\s*#nav::after');
assert(mobFades.indexOf('position: absolute') >= 0, '4: базовые фейды на месте');

// --- 5. Регрессия: JS навигации не менялся — экраны рендерят nav без стиля ---

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

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');
render();
assert(navStub.innerHTML.indexOf('nav-scroll') >= 0,
  '5: лента навигации по-прежнему рендерится (nav-scroll)');
assert(navStub.innerHTML.indexOf('nav-btn') >= 0, '5: кнопки навигации на месте');
assert(navStub.innerHTML.indexOf('onclick') < 0, '5: инлайн-обработчиков нет');
