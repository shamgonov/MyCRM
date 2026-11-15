/* CRM2 :: app/ui-calc.js — калькулятор (Этап 20): модалка с собственным
   рекурсивным парсером арифметики. eval() НЕ используется намеренно.
   Зависит: db.js (escapeHtml), core.js (showModal, closeModal, toast).
   Поддерживает: числа (целые/дробные), + - * / %, скобки, унарный минус. */
'use strict';

// История последних вычислений живёт в памяти страницы (не в DB).
window.__calcHistory = window.__calcHistory || [];
const CALC_HISTORY_SIZE = 5;

// --- 1. Разбор выражения (без eval) ---

// calcTokenize(str): строка → [{t:'num',v}, {t:'+'}...] или null при мусорном символе.
function calcTokenize(str) {
  const s = String(str == null ? '' : str);
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      let num = '';
      let dots = 0;
      while (i < s.length) {
        const d = s.charAt(i);
        if (d < '0' || d > '9') {
          if (d !== '.') break;
          dots++;
          if (dots > 1) return null;      // «1.2.3» — не число
        }
        num += d;
        i++;
      }
      if (num === '.' || num === '') return null;
      const v = parseFloat(num);
      if (!isFinite(v)) return null;
      tokens.push({ t: 'num', v: v });
      continue;
    }
    if ('+-*/%()'.indexOf(c) >= 0) { tokens.push({ t: c }); i++; continue; }
    return null;                          // запятая, буквы, прочее — ошибка
  }
  return tokens;
}

// calcParse(tokens): рекурсивный спуск expr → term → factor; null при ошибке.
function calcParse(tokens) {
  let pos = 0;

  function peek() { return tokens[pos]; }
  function isOp(name) { return !!tokens[pos] && tokens[pos].t === name; }
  function eat(name) {
    if (isOp(name)) { pos++; return true; }
    return false;
  }

  // expr: сложение/вычитание (младший приоритет).
  function parseExpr() {
    let v = parseTerm();
    if (v === null) return null;
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = peek().t;
      pos++;
      const r = parseTerm();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  // term: умножение / деление / остаток.
  function parseTerm() {
    let v = parseFactor();
    if (v === null) return null;
    while (peek() && (peek().t === '*' || peek().t === '/' || peek().t === '%')) {
      const op = peek().t;
      pos++;
      const r = parseFactor();
      if (r === null) return null;
      if (r === 0) return null;           // деление/остаток на ноль — ошибка
      v = op === '*' ? v * r : (op === '/' ? v / r : v % r);
    }
    return v;
  }

  // factor: число, скобка, унарный +/- .
  function parseFactor() {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === '-') { pos++; const v = parseFactor(); return v === null ? null : -v; }
    if (tk.t === '+') { pos++; return parseFactor(); }
    if (tk.t === '(') {
      pos++;
      const v = parseExpr();
      if (v === null) return null;
      if (!eat(')')) return null;
      return v;
    }
    if (tk.t === 'num') { pos++; return tk.v; }
    return null;                          // оператор без операнда
  }

  const value = parseExpr();
  if (value === null) return null;
  if (pos !== tokens.length) return null; // «3 4», незакрытая скобка, хвост оператора
  return value;
}

// evaluateExpression(str): число или null (ошибка разбора, деление на 0, NaN/Inf).
// Результат округляется до 6 знаков: 0.1+0.2 даёт ровно 0.3, иначе тесты «плыли» бы.
function evaluateExpression(str) {
  const tokens = calcTokenize(str);
  if (!tokens || !tokens.length) return null;
  const v = calcParse(tokens);
  if (v === null || !isFinite(v) || isNaN(v)) return null;
  return Math.round(v * 1000000) / 1000000;
}

// Формат вывода: разделитель разрядов — пробел, дробная часть — запятая.
function calcFormat(v) {
  const parts = String(v).split('.');
  const int = parts[0].replace(/^-?(\d+)/, function (m) {
    return m.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  });
  return parts.length > 1 ? int + ',' + parts[1] : int;
}

// --- 2. Модалка калькулятора ---

const CALC_KEYS = [
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['0', '.', '%', '+']
];

function renderCalcHistory() {
  const h = window.__calcHistory || [];
  if (!h.length) return '<p class="small muted">История пуста.</p>';
  return h.map(function (r, i) {
    return '<div class="est-row">' +
        '<span data-calc-recall="' + i + '" style="color:var(--accent);cursor:pointer">' +
          escapeHtml(r.expr) + '</span>' +
        '<b>= ' + escapeHtml(calcFormat(r.value)) + '</b>' +
      '</div>';
  }).join('');
}

function renderCalcModal() {
  const rows = CALC_KEYS.map(function (row) {
    return '<div class="row" style="gap:6px;margin-top:6px">' + row.map(function (k) {
      return '<button class="btn" data-calc-btn="' + k + '" style="flex:1">' + k + '</button>';
    }).join('') + '</div>';
  }).join('');

  return '<h3>🔢 Калькулятор</h3>' +
    '<label class="field"><span>Выражение</span>' +
      '<input id="calc-input" type="text" inputmode="decimal" placeholder="например (120+180)*2" autocomplete="off"></label>' +
    '<div class="row" style="gap:6px;margin-top:6px">' +
      '<button class="btn" data-calc-btn="(" style="flex:1">(</button>' +
      '<button class="btn" data-calc-btn=")" style="flex:1">)</button>' +
      '<button class="btn" data-calc-back style="flex:1">⌫</button>' +
      '<button class="btn btn-danger" data-calc-clear style="flex:1">C</button>' +
    '</div>' +
    rows +
    '<div class="row" style="gap:6px;margin-top:6px">' +
      '<button class="btn btn-primary" data-calc-eval style="flex:2">= Вычислить</button>' +
      '<button class="btn" data-close style="flex:1">Закрыть</button>' +
    '</div>' +
    '<div id="calc-out" class="small muted" style="margin-top:10px">Поддерживаются + − × ÷ %, скобки.</div>' +
    '<div class="card info-block" style="margin-top:10px">' +
      '<h4>История (последние ' + CALC_HISTORY_SIZE + ')</h4>' +
      '<div id="calc-history">' + renderCalcHistory() + '</div>' +
    '</div>';
}

function openCalcModal() {
  showModal(renderCalcModal());
  const input = document.getElementById('calc-input');
  if (input && typeof input.focus === 'function') input.focus();
}

// Кнопка в шапку карточки заявки (вызывает ui-orders.js лениво).
function renderCalcButton() {
  return '<button class="btn" data-calc-open title="Калькулятор">🔢</button>';
}

// --- 3. Точечные обновления DOM внутри модалки (без перерисковки экрана) ---

function calcInputValue() {
  const el = document.getElementById('calc-input');
  return el ? String(el.value || '') : '';
}

function calcSetOut(html) {
  const el = document.getElementById('calc-out');
  if (el) el.innerHTML = html;
}

function calcRefreshHistory() {
  const el = document.getElementById('calc-history');
  if (el) el.innerHTML = renderCalcHistory();
}

function pushCalcHistory(expr, value) {
  if (!Array.isArray(window.__calcHistory)) window.__calcHistory = [];
  window.__calcHistory.unshift({ expr: expr, value: value });
  if (window.__calcHistory.length > CALC_HISTORY_SIZE) {
    window.__calcHistory = window.__calcHistory.slice(0, CALC_HISTORY_SIZE);
  }
}

// --- 4. Делегирование событий этого модуля ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };

  const openBtn = sel('[data-calc-open]');
  if (openBtn) { openCalcModal(); return; }

  const keyBtn = sel('[data-calc-btn]');
  if (keyBtn) {
    const el = document.getElementById('calc-input');
    if (!el) return;
    el.value = String(el.value || '') + keyBtn.getAttribute('data-calc-btn');
    calcSetOut('Поддерживаются + − × ÷ %, скобки.');
    el.focus();
    return;
  }

  const backBtn = sel('[data-calc-back]');
  if (backBtn) {
    const el = document.getElementById('calc-input');
    if (!el) return;
    el.value = String(el.value || '').slice(0, -1);
    return;
  }

  const clearBtn = sel('[data-calc-clear]');
  if (clearBtn) {
    const el = document.getElementById('calc-input');
    if (el) { el.value = ''; el.focus(); }
    calcSetOut('Поле очищено.');
    return;
  }

  const evalBtn = sel('[data-calc-eval]');
  if (evalBtn) {
    const expr = calcInputValue();
    const v = evaluateExpression(expr);
    if (v === null) {
      calcSetOut('<span class="badge badge-danger">Ошибка в выражении</span>');
      toast('Нельзя вычислить: ' + (expr || 'пусто'), true);
      return;
    }
    pushCalcHistory(expr, v);
    calcSetOut('<b>' + escapeHtml(expr) + ' = ' + escapeHtml(calcFormat(v)) + '</b>');
    calcRefreshHistory();
    return;
  }

  const recallBtn = sel('[data-calc-recall]');
  if (recallBtn) {
    const i = Number(recallBtn.getAttribute('data-calc-recall'));
    const rec = (window.__calcHistory || [])[i];
    const el = document.getElementById('calc-input');
    if (!rec || !el) return;
    el.value = rec.expr;
    calcSetOut('Взято из истории: = ' + escapeHtml(calcFormat(rec.value)));
    return;
  }
});

// Enter в поле выражения — то же, что кнопка «=».
document.addEventListener('keydown', function (ev) {
  const el = ev.target && ev.target.closest ? ev.target.closest('#calc-input') : null;
  if (!el || ev.key !== 'Enter') return;
  const expr = calcInputValue();
  const v = evaluateExpression(expr);
  if (v === null) {
    calcSetOut('<span class="badge badge-danger">Ошибка в выражении</span>');
    toast('Нельзя вычислить: ' + (expr || 'пусто'), true);
    return;
  }
  pushCalcHistory(expr, v);
  calcSetOut('<b>' + escapeHtml(expr) + ' = ' + escapeHtml(calcFormat(v)) + '</b>');
  calcRefreshHistory();
});

// --- Экспорт для core.js / ui-orders.js ---

window.CALC_KEYS = CALC_KEYS;
window.calcTokenize = calcTokenize;
window.calcParse = calcParse;
window.evaluateExpression = evaluateExpression;
window.calcFormat = calcFormat;
window.renderCalcHistory = renderCalcHistory;
window.renderCalcModal = renderCalcModal;
window.openCalcModal = openCalcModal;
window.renderCalcButton = renderCalcButton;
window.pushCalcHistory = pushCalcHistory;
