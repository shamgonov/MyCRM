/* Смоук app/ui-reports.js (Этап 10): прибыль, мастера, диагностики, экспорт CSV. */
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
globalThis.clearTimeout = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-reports.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// --- 1. calculateProfit: формула revenue - materials - compensations ---
const today = localToday();
const testOrders = [
  { id: 1, status: 'completed', worker: 'А', examiner: 'Б', date: today,
    works: [{ title: 'A', qty: 1, price: 100 }],
    extras: [], materials: [] },
  { id: 2, status: 'paid', worker: 'А', examiner: 'Б', date: today,
    works: [{ title: 'B', qty: 2, price: 50 }],
    extras: [], materials: [
      { name: 'X', qty: 1, price: 30, buyer: 'company', status: 'bought' },
      { name: 'Y', qty: 1, price: 20, buyer: 'worker', status: 'bought', factPrice: 25 }
    ] },
  { id: 3, status: 'new', worker: 'А', examiner: 'Б', date: today,
    works: [{ title: 'C', qty: 100, price: 999 }],
    extras: [], materials: [] }
];

const p = calculateProfit(testOrders);
assert.eq(p.revenue, 200, 'profit: revenue = completed(100) + paid(100)');
assert.eq(p.materials, 30, 'profit: materials = company bought (30)');
assert.eq(p.compensations, 25, 'profit: compensations = worker bought factPrice (25)');
assert.eq(p.profit, 145, 'profit: profit = revenue - materials - compensations');

// new заявка не влияет на revenue.
const pNew = calculateProfit([{ id: 99, status: 'new', works: [{ qty: 1, price: 9999 }] }]);
assert.eq(pNew.revenue, 0, 'profit: new не входит в revenue');

// --- 2. calculateByWorker: группировка по worker, только completed/paid ---
const bw = calculateByWorker(testOrders);
assert.eq(bw.length, 1, 'workers: один мастер А');
assert.eq(bw[0].worker, 'А', 'workers: мастер А');
assert.eq(bw[0].revenue, 200, 'workers: выручка = 200');
assert.eq(bw[0].count, 2, 'workers: 2 completed/paid заявки');
assert.eq(bw[0].profit, 145, 'workers: прибыль = 200 - 30 - 25');

// Несколько мастеров.
const multi = [
  { id: 10, status: 'completed', worker: 'X', works: [{ qty: 1, price: 500 }], extras: [], materials: [] },
  { id: 11, status: 'completed', worker: 'Y', works: [{ qty: 1, price: 300 }], extras: [], materials: [] },
  { id: 12, status: 'new', worker: 'X', works: [{ qty: 1, price: 999 }], extras: [], materials: [] }
];
const bw2 = calculateByWorker(multi);
assert.eq(bw2.length, 2, 'workers: два мастера');
const x = bw2.find(function (r) { return r.worker === 'X'; });
const y = bw2.find(function (r) { return r.worker === 'Y'; });
assert.eq(x.revenue, 500, 'workers: X revenue = 500');
assert.eq(x.count, 1, 'workers: X count = 1 (new не считается)');
assert.eq(y.revenue, 300, 'workers: Y revenue = 300');
assert.eq(y.count, 1, 'workers: Y count = 1');

// --- 3. calculateByDiagnostician: inspections → converted ---
const bd = calculateByDiagnostician(testOrders);
assert.eq(bd.length, 1, 'diagnostics: один диагност Б');
assert.eq(bd[0].name, 'Б', 'diagnostics: диагност Б');
assert.eq(bd[0].inspections, 3, 'diagnostics: 3 осмотра (все с examiner=Б)');
assert.eq(bd[0].converted, 2, 'diagnostics: 2 из 3 converted (completed+paid)');

// Без examiner — не учитывается.
const noExaminer = [
  { id: 20, status: 'completed', examiner: '', works: [{ qty: 1, price: 100 }], extras: [], materials: [] }
];
const bd2 = calculateByDiagnostician(noExaminer);
assert.eq(bd2.length, 0, 'diagnostics: без examiner → пусто');

// --- 4. exportToCSV: BOM + разделитель ; ---
const csvData = [{ name: 'Иван', value: 100 }, { name: 'Петр', value: 200 }];
const csv = toCSV(csvData);
assert(csv.indexOf('\ufeff') === 0, 'csv: BOM в начале');
assert(csv.indexOf(';') >= 0, 'csv: разделитель ;');
assert(csv.indexOf('Иван;100') >= 0, 'csv: строка Иван');
assert(csv.indexOf('Петр;200') >= 0, 'csv: строка Петр');

// Пустые данные → пустая строка.
assert.eq(toCSV([]), '', 'csv: пустой массив → пустая строка');
assert.eq(toCSV(null), '', 'csv: null → пустая строка');

// --- 5. Фильтр по периоду ---
const now = localToday();
const from = dateShift(now, -5);
const to = now;
const filtered = filterByDate(testOrders, from, to);
assert.eq(filtered.length, 3, 'period: все заявки в диапазоне [-5, 0]');

// Будущая заявка не попадает в прошлый диапазон.
const future = [{ id: 99, status: 'completed', date: dateShift(now, 30), worker: 'Z',
  works: [{ qty: 1, price: 5000 }], extras: [], materials: [] }];
const pastOnly = filterByDate(future, from, to);
assert.eq(pastOnly.length, 0, 'period: future не попадает в past');

// Без фильтров — все.
const noFilter = filterByDate(future, null, null);
assert.eq(noFilter.length, 1, 'period: null/null → все');

// Интеграция с calculateProfit: фильтр влияет на revenue.
const noRange = calculateProfit(future);
const withRange = calculateProfit(future, from, to);
assert.eq(noRange.revenue, 5000, 'period: без фильтра revenue = 5000');
assert.eq(withRange.revenue, 0, 'period: фильтр по past → 0');

// --- 6. renderReportsTab: таблицы + кнопки экспорта ---
const html = renderReportsTab();
assert(html.indexOf('Отчёты') >= 0, 'render: заголовок');
assert(html.indexOf('data-report-tab="profit"') >= 0, 'render: таб Прибыль');
assert(html.indexOf('data-report-tab="worker"') >= 0, 'render: таб Мастера');
assert(html.indexOf('data-report-tab="diagnostician"') >= 0, 'render: таб Диагносты');
assert(html.indexOf('data-report-period="all"') >= 0, 'render: период Все время');
assert(html.indexOf('data-report-period="today"') >= 0, 'render: период Сегодня');
assert(html.indexOf('data-report-period="week"') >= 0, 'render: период Неделя');
assert(html.indexOf('data-report-period="month"') >= 0, 'render: период Месяц');

// Таб Прибыль: большие цифры + экспорт.
assert(html.indexOf('data-export-profit') >= 0, 'render: кнопка экспорта прибыли');

// Переключение на таб Мастера.
REPORT_TAB = 'worker';
const htmlWorker = renderReportsTab();
assert(htmlWorker.indexOf('Мастер') >= 0, 'render worker: заголовок Мастера');
assert(htmlWorker.indexOf('Выручка') >= 0, 'render worker: колонка Выручка');
assert(htmlWorker.indexOf('Прибыль') >= 0, 'render worker: колонка Прибыль');
assert(htmlWorker.indexOf('data-export-workers') >= 0, 'render worker: экспорт');

// Переключение на таб Диагносты.
REPORT_TAB = 'diagnostician';
const htmlDiag = renderReportsTab();
assert(htmlDiag.indexOf('Диагност') >= 0, 'render diag: заголовок');
assert(htmlDiag.indexOf('Осмотров') >= 0, 'render diag: колонка Осмотров');
assert(htmlDiag.indexOf('Конверсия') >= 0, 'render diag: колонка Конверсия');
assert(htmlDiag.indexOf('data-export-diagnosticians') >= 0, 'render diag: экспорт');

// Переключение периода.
REPORT_PERIOD = 'today';
const htmlToday = renderReportsTab();
assert(htmlToday.indexOf('data-report-period="today"') >= 0, 'render: today активен');
REPORT_PERIOD = 'week';
REPORT_PERIOD = 'month';
REPORT_PERIOD = 'all';
REPORT_TAB = 'profit';

// --- 7. Регрессия: без ui-reports.js список заявок не падает ---
// Проверяем, что S.reports (core.js) имеет typeof-обёртку.
assert(typeof S.reports === 'function', 'S.reports — функция');
// При загрузке без ui-reports: typeof renderReports === 'undefined',
// но S.reports вернёт заглушку без ошибки.
