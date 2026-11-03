/* Смоук app/db.js (Этап 1): load/save, defaultData.regions, localToday локальная. */
'use strict';

// Мини-стаб localStorage перед загрузкой модуля.
globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();

loadModule('app/db.js');

assert(typeof DB === 'object' && DB !== null, 'DB инициализирован в load()');

// Состав defaultData() (с Этапа 4 load() сеет мок-данные, проверяем структуру напрямую).
const dd = defaultData();
assert.eq(dd.seq, 0, 'defaultData: seq=0');
assert(Array.isArray(dd.orders) && dd.orders.length === 0, 'defaultData: orders=[]');

// Сид мок-данных в load(): 4 заявки, «своя» у Мастера, просрочка и «сегодня».
assert.eq(DB.orders.length, 4, 'seedMockData: 4 демо-заявки');
assert.eq(DB.seq, 4, 'seedMockData: seq = 4');
assert(DB.orders.some(function (o) { return o.worker === 'Мастер' && o.date === localToday(); }),
  'seedMockData: есть «моя» заявка на сегодня');
assert(DB.orders.some(function (o) {
  return o.status === 'new' && o.date < localToday();
}), 'seedMockData: есть просрочка');
assert(DB.orders.every(function (o) { return typeof o.id === 'number' && o.history.length >= 1; }),
  'seedMockData: у всех есть id и история');

assert(Array.isArray(DB.users) && DB.users.length === 0, 'defaultData: users=[]');
assert(Array.isArray(DB.clients) && DB.clients.length === 0, 'defaultData: clients=[]');
assert(Array.isArray(DB.templates), 'defaultData: templates=[]');
assert(typeof DB.settings === 'object' && DB.settings !== null, 'defaultData: settings={}');
assert(Array.isArray(DB.regions) && DB.regions.length === 1,
  'defaultData: regions с Свердловской областью');
assert.eq(DB.regions[0].region, 'Свердловская область', 'defaultData: имя региона');
assert(DB.regions[0].cities.indexOf('Екатеринбург') >= 0, 'defaultData: Екатеринбург в городах');

// localToday(): локальные компоненты, не UTC (правило SPEC 2).
const d = new Date();
const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
const expected = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
assert.eq(localToday(), expected, 'localToday() = локальная YYYY-MM-DD');
assert(!localToday().includes('T') && !localToday().includes('Z'),
  'localToday() без ISO-артефактов');
assert.eq(fmt(d), expected, 'fmt(Date) — алиас локальной даты');
assert.eq(fmt(), expected, 'fmt() без аргумента — сегодня');

// money()
assert.eq(money(1500), '1 500 ₽', 'money(1500) с пробелом-разделителем');
assert.eq(money(0), '0 ₽', 'money(0)');
assert.eq(money(null), '0 ₽', 'money(null) безопасен');
assert.eq(money(-250.5), '-250,50 ₽', 'money(-250.5) с запятой');

// escapeHtml(): строки собираются из кодов, чтобы в тесте не было HTML-сущностей
const A = String.fromCharCode(38);   // амперсанд
const LT = String.fromCharCode(60);  // <
const GT = String.fromCharCode(62);  // >
const QT = String.fromCharCode(34);  // "
const rawIn = LT + 'b' + A + QT + 'x' + GT;
const escapedOut = A + 'lt;' + 'b' + A + 'amp;' + A + 'quot;' + 'x' + A + 'gt;';
assert.eq(escapeHtml(rawIn), escapedOut, 'escapeHtml экранирует спецсимволы');
assert.eq(escapeHtml(null), '', 'escapeHtml(null) = ""');

// lsGet/lsSet
lsSet('k1', 'v1');
assert.eq(lsGet('k1', 'def'), 'v1', 'lsSet/lsGet round-trip');
assert.eq(lsGet('missing', 'def'), 'def', 'lsGet возвращает default для отсутствующего');

// save() + повторный load() — персистентность; и хук window.__onSave
let hookCalls = 0;
window.__onSave = function () { hookCalls++; };
DB.seq = 42;
save();
assert.eq(hookCalls, 1, 'save() вызывает window.__onSave');
assert.eq(JSON.parse(localStorage.getItem('crm2_db')).seq, 42, 'save() пишет crm2_db');
DB = null;
load();
assert.eq(DB.seq, 42, 'load() читает сохранённое из localStorage');

// Битый JSON в localStorage — fallback на defaultData + сид мок-данных (Этап 4).
localStorage.setItem('crm2_db', '{oops');
load();
assert.eq(DB.seq, 4, 'load() с битым JSON → defaultData + seedMockData');
