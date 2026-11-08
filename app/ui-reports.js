/* CRM2 :: app/ui-reports.js — отчёты и аналитика (Этап 10).
   Выручка берётся из calculateOrderTotal (orders.js) для completed/paid,
   расходы — из o.materials (закупка компании и компенсации работнику).
   Только таблицы: внешних библиотек и инлайн-скриптов нет.
   Зависит от db.js (DB, localToday, dateShift, money, escapeHtml) и orders.js. */
'use strict';

// Состояние экрана отчётов (переживает перерисовки, как ORD_TAB в ui-orders.js).
var REPORT_TAB = 'profit';
var REPORT_PERIOD = 'all';

// Закрытые статусы: выручка считается только по ним.
var REPORT_DONE = ['completed', 'paid'];

// --- 1. Прибыль за период ---

// Стоимость материала к списанию: факт. цена важнее плановой.
function materialCost(m) {
  return (Number(m.factPrice) || Number(m.price) || 0) * (Number(m.qty) || 0);
}

// Расходы заявки: закупка компании + компенсации работнику за свои материалы.
function orderExpenses(o) {
  var materials = 0;
  var compensations = 0;
  (o.materials || []).forEach(function (m) {
    if (m.buyer === 'company') materials += materialCost(m);
    // Компенсация положена, только когда работник действительно купил.
    if (m.buyer === 'worker' && m.status === 'bought') compensations += materialCost(m);
  });
  return { materials: materials, compensations: compensations };
}

// calculateProfit(orders, dateFrom, dateTo) → {revenue, materials, compensations, profit}.
function calculateProfit(orders, dateFrom, dateTo) {
  var list = filterByDate(orders, dateFrom, dateTo);
  var revenue = 0;
  var materials = 0;
  var compensations = 0;
  list.forEach(function (o) {
    if (REPORT_DONE.indexOf(o.status) >= 0) revenue += calculateOrderTotal(o) || 0;
    var e = orderExpenses(o);
    materials += e.materials;
    compensations += e.compensations;
  });
  return {
    revenue: revenue,
    materials: materials,
    compensations: compensations,
    profit: revenue - materials - compensations
  };
}

// Фильтр по датам в формате YYYY-MM-DD; null — граница не ограничивает.
function filterByDate(orders, dateFrom, dateTo) {
  return (orders || []).filter(function (o) {
    var d = o.date || '';
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  });
}

// --- 2. Выручка и прибыль по мастерам ---

function calculateByWorker(orders, dateFrom, dateTo) {
  var list = filterByDate(orders, dateFrom, dateTo);
  var map = {};
  list.forEach(function (o) {
    const name = o.worker || '— не назначен —';
    if (!map[name]) {
      map[name] = { worker: name, revenue: 0, materials: 0, compensations: 0, profit: 0, count: 0 };
    }
    if (REPORT_DONE.indexOf(o.status) >= 0) {
      map[name].revenue += calculateOrderTotal(o) || 0;
      map[name].count++;
    }
    var e = orderExpenses(o);
    map[name].materials += e.materials;
    map[name].compensations += e.compensations;
  });
  return Object.keys(map).map(function (k) {
    const r = map[k];
    return {
      worker: r.worker,
      revenue: r.revenue,
      profit: r.revenue - r.materials - r.compensations,
      count: r.count
    };
  }).sort(function (a, b) { return b.revenue - a.revenue; });
}

// --- 3. Эффективность диагностов ---

// Конверсия = осмотр привёл к закрытой (completed/paid) заявке.
function calculateByDiagnostician(orders, dateFrom, dateTo) {
  var list = filterByDate(orders, dateFrom, dateTo);
  var map = {};
  list.forEach(function (o) {
    if (!o.examiner) return;
    if (!map[o.examiner]) map[o.examiner] = { name: o.examiner, inspections: 0, converted: 0, revenue: 0 };
    map[o.examiner].inspections++;
    if (REPORT_DONE.indexOf(o.status) >= 0) {
      map[o.examiner].converted++;
      map[o.examiner].revenue += calculateOrderTotal(o) || 0;
    }
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.revenue - a.revenue; });
}

// --- 4. Экспорт CSV (разделитель ';', BOM для Excel) ---

function toCSV(data) {
  if (!data || !data.length) return '';
  const keys = Object.keys(data[0]);
  const esc = function (v) {
    if (typeof v === 'number') return String(v);
    return String(v == null ? '' : v).replace(/["\n\r;]/g, ' ');
  };
  var lines = [keys.map(esc).join(';')];
  data.forEach(function (row) { lines.push(keys.map(function (k) { return esc(row[k]); }).join(';')); });
  return '\ufeff' + lines.join('\r\n');
}

function exportToCSV(data, filename) {
  if (!data || !data.length) { toast('Нет данных для экспорта', true); return false; }
  try {
    const blob = new Blob([toCSV(data)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (filename || 'report') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (e) {
    toast('Экспорт недоступен в этом браузере', true);
    return false;
  }
}

// --- 5. Экран «Отчёты» ---

function periodDates() {
  const today = localToday();
  if (REPORT_PERIOD === 'today') return { from: today, to: today };
  if (REPORT_PERIOD === 'week') return { from: dateShift(today, -6), to: today };
  if (REPORT_PERIOD === 'month') return { from: today.slice(0, 7) + '-01', to: today };
  return { from: null, to: null };
}

function periodButtons() {
  return [['all', 'Все время'], ['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц']]
    .map(function (p) {
      return '<button class="chip' + (REPORT_PERIOD === p[0] ? ' active' : '') +
        '" data-report-period="' + p[0] + '">' + p[1] + '</button>';
    }).join('');
}

// Строка таблицы отчёта: сетка колонок + выравнивание сумм вправо.
const RGRID = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;';
function rrow(cells, head) {
  return '<div style="' + RGRID + (head ? 'font-weight:700;color:var(--muted);' : '') + '">' +
    cells.map(function (c, i) {
      return '<span' + (i ? ' style="text-align:right"' : '') + '>' + c + '</span>';
    }).join('') + '</div>';
}

function profitReport() {
  const p = calculateProfit(DB.orders || [], periodDates().from, periodDates().to);
  const big = function (label, value, accent) {
    return '<div class="card" style="text-align:center">' +
      '<div class="small muted">' + label + '</div>' +
      '<div style="font-size:20px;font-weight:700' +
        (accent ? ';color:var(--accent)' : '') + '">' + money(value) + '</div>' +
    '</div>';
  };
  var cards = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      big('Выручка', p.revenue) +
      big('Материалы', p.materials) +
      big('Компенсации', p.compensations) +
      big('Прибыль', p.profit, true) +
    '</div>';
  return cards +
    '<button class="btn btn-block" data-export-profit style="margin-top:10px">📥 Экспорт CSV</button>';
}

function workerReport() {
  const rows = calculateByWorker(DB.orders || [], periodDates().from, periodDates().to);
  if (!rows.length) return '<p class="muted">Нет данных за этот период.</p>';
  const body = rows.map(function (r) {
    return rrow([escapeHtml(r.worker), money(r.revenue), money(r.profit), r.count]);
  }).join('');
  return '<div class="card">' +
      rrow(['Мастер', 'Выручка', 'Прибыль', 'Заявок'], true) + body +
    '</div>' +
    '<button class="btn btn-block" data-export-workers style="margin-top:10px">📥 Экспорт CSV</button>';
}

function diagnosticianReport() {
  const rows = calculateByDiagnostician(DB.orders || [], periodDates().from, periodDates().to);
  if (!rows.length) return '<p class="muted">Осмотров за этот период не было.</p>';
  const body = rows.map(function (r) {
    const conv = r.inspections ? Math.round(r.converted / r.inspections * 100) + '%' : '—';
    return rrow([escapeHtml(r.name), r.inspections, r.converted + ' (' + conv + ')', money(r.revenue)]);
  }).join('');
  return '<div class="card">' +
      rrow(['Диагност', 'Осмотров', 'Конверсия', 'Выручка'], true) + body +
    '</div>' +
    '<button class="btn btn-block" data-export-diagnosticians style="margin-top:10px">📥 Экспорт CSV</button>';
}

function renderReportsTab() {
  const tabs = [['profit', '💰 Прибыль'], ['worker', '👷 По мастерам'], ['diagnostician', '🔍 По диагностам']];
  const tabHtml = tabs.map(function (t) {
    return '<button class="tab-btn' + (REPORT_TAB === t[0] ? ' active' : '') +
      '" data-report-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');

  let body;
  if (REPORT_TAB === 'worker') body = workerReport();
  else if (REPORT_TAB === 'diagnostician') body = diagnosticianReport();
  else body = profitReport();

  const p = periodDates();
  const periodLabel = p.from ? p.from + ' — ' + p.to : 'весь период';

  return '<h2>📊 Отчёты</h2>' +
    '<div class="tabs">' + tabHtml + '</div>' +
    '<div class="chips">' + periodButtons() + '</div>' +
    '<p class="small muted">Период: ' + periodLabel + '</p>' +
    body;
}

// Точка входа из карты экранов S.
function renderReports() {
  return renderReportsTab();
}

// --- Делегирование событий ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };
  const d = function () { return periodDates(); };

  const tab = sel('[data-report-tab]');
  if (tab) { REPORT_TAB = tab.getAttribute('data-report-tab'); render(); return; }

  const period = sel('[data-report-period]');
  if (period) { REPORT_PERIOD = period.getAttribute('data-report-period'); render(); return; }

  const exp = function (attr, build, name) {
    const btn = sel('[' + attr + ']');
    if (!btn) return false;
    const r = d();
    exportToCSV(build(DB.orders || [], r.from, r.to), name + '-' + (r.from || 'all') + '_' + (r.to || 'all'));
    return true;
  };
  if (exp('data-export-workers', calculateByWorker, 'workers')) return;
  if (exp('data-export-diagnosticians', calculateByDiagnostician, 'diagnosticians')) return;

  const expProfit = sel('[data-export-profit]');
  if (expProfit) {
    const r = d();
    exportToCSV([calculateProfit(DB.orders || [], r.from, r.to)], 'profit-' + (r.from || 'all') + '_' + (r.to || 'all'));
  }
});

// Явный экспорт в window: экран вызывается из карты S (core.js).
window.renderReports = renderReports;
window.renderReportsTab = renderReportsTab;
window.exportToCSV = exportToCSV;
