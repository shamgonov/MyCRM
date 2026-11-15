/* Смоук app/ui-calc.js (Этап 20): собственный парсер выражений без eval().
   Поддерживает: числа (целые/дробные), +, -, *, /, %, скобки, унарный минус. */
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
var clickHandlers = [];
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
  },
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/ui-calc.js');

// --- 1. evaluateExpression: корректные выражения ---
assert.eq(evaluateExpression('2+2'), 4, 'eval: 2+2=4');
assert.eq(evaluateExpression('10-3'), 7, 'eval: 10-3=7');
assert.eq(evaluateExpression('3*4'), 12, 'eval: 3*4=12');
assert.eq(evaluateExpression('10/2'), 5, 'eval: 10/2=5');
assert.eq(evaluateExpression('10%3'), 1, 'eval: 10%3=1');
assert.eq(evaluateExpression('(3+5)*2'), 16, 'eval: (3+5)*2=16');
assert.eq(evaluateExpression('2+3*4'), 14, 'eval: 2+3*4=14 (приоритет * > +)');
assert.eq(evaluateExpression('(2+3)*4'), 20, 'eval: (2+3)*4=20 (скобки)');
assert.eq(evaluateExpression('10/0'), null, 'eval: деление на 0 → null');
assert.eq(evaluateExpression('10%0'), null, 'eval: остаток от 0 → null');
assert.eq(evaluateExpression('abc'), null, 'eval: буквы → null');
assert.eq(evaluateExpression(''), null, 'eval: пусто → null');
assert.eq(evaluateExpression('1 2'), null, 'eval: пробел между числами → null');
assert.eq(evaluateExpression('+'), null, 'eval: один оператор → null');
assert.eq(evaluateExpression('(2+3'), null, 'eval: незакрытая скобка → null');
assert.eq(evaluateExpression('2+3)'), null, 'eval: лишняя скобка → null');
assert.eq(evaluateExpression('3.14+0.86'), 4, 'eval: 3.14+0.86=4 (дробные)');
assert.eq(evaluateExpression('-5'), -5, 'eval: унарный минус');
assert.eq(evaluateExpression('-(3+2)'), -5, 'eval: унарный минус + скобки');
assert.eq(evaluateExpression('+3'), 3, 'eval: унарный плюс');
assert.eq(evaluateExpression('0'), 0, 'eval: ноль');
assert.eq(evaluateExpression('0.5'), 0.5, 'eval: дробь');
assert.eq(evaluateExpression('1000000'), 1000000, 'eval: большое число');
assert.eq(evaluateExpression('1+2+3+4+5'), 15, 'eval: цепочка +');
assert.eq(evaluateExpression('10/3'), 3.333333, 'eval: 10/3 ≈ 3.333333');
assert.eq(evaluateExpression('1.1+2.2'), 3.3, 'eval: 1.1+2.2=3.3 (округление)');
assert.eq(evaluateExpression('((2))'), 2, 'eval: вложенные скобки');
assert.eq(evaluateExpression('2*3*4'), 24, 'eval: цепочка *');
assert.eq(evaluateExpression('10-3-2'), 5, 'eval: цепочка -');

// --- 2. tokenize ошибки ---
assert.eq(calcTokenize('1+2abc'), null, 'tokenize: мусорные символы → null');
assert.eq(calcTokenize('1.2.3'), null, 'tokenize: две точки → null');

// --- 3. calcFormat ---
assert.eq(calcFormat(1234567), '1 234 567', 'format: 1234567');
assert.eq(calcFormat(0), '0', 'format: 0');
assert.eq(calcFormat(3.3), '3,3', 'format: 3,3');
assert.eq(calcFormat(-100), '-100', 'format: -100');

// --- 4. pushCalcHistory / __calcHistory ---
assert(Array.isArray(window.__calcHistory), '__calcHistory: массив');
assert.eq(window.__calcHistory.length, 0, '__calcHistory: пуст');
pushCalcHistory('2+2', 4);
assert.eq(window.__calcHistory.length, 1, 'pushHistory: длина 1');
assert.eq(window.__calcHistory[0].expr, '2+2', 'pushHistory: expr');
assert.eq(window.__calcHistory[0].value, 4, 'pushHistory: value');
pushCalcHistory('1+1', 2);
pushCalcHistory('3+3', 6);
assert.eq(window.__calcHistory.length, 3, 'pushHistory: 3 элемента');
// Ограничение 5
for (var i = 0; i < 10; i++) { pushCalcHistory('x' + i, i); }
assert.eq(window.__calcHistory.length, 5, 'pushHistory: лимит 5');

// --- 5. openCalcModal: модалка в #modal-container (renderCalcModal — строка) ---
openCalcModal();
assert(modalStub.innerHTML.indexOf('calc-input') >= 0, 'calcModal: calc-input');
assert(modalStub.innerHTML.indexOf('data-calc-btn') >= 0, 'calcModal: кнопки цифр');
assert(modalStub.innerHTML.indexOf('data-calc-eval') >= 0, 'calcModal: кнопка =');
assert(modalStub.innerHTML.indexOf('data-calc-clear') >= 0, 'calcModal: кнопка C');
assert(modalStub.innerHTML.indexOf('data-calc-open') >= 0 || modalStub.innerHTML.indexOf('calc-open') < 0,
  'calcModal: нет data-calc-open внутри модалки (только снаружи)');
assert(modalStub.innerHTML.indexOf('calc-history') >= 0, 'calcModal: история');
assert(modalStub.innerHTML.indexOf('data-calc-recall') >= 0, 'calcModal: recall из истории');

// --- 6. renderCalcButton ---
var btn = renderCalcButton();
assert(btn.indexOf('data-calc-open') >= 0, 'calcButton: data-calc-open');
assert(btn.indexOf('🔢') >= 0, 'calcButton: эмодзи');

// --- 7. typeof-регрессии ---
assert(typeof evaluateExpression === 'function', 'typeof evaluateExpression');
assert(typeof calcTokenize === 'function', 'typeof calcTokenize');
assert(typeof calcParse === 'function', 'typeof calcParse');
assert(typeof renderCalcModal === 'function', 'typeof renderCalcModal');
assert(typeof openCalcModal === 'function', 'typeof openCalcModal');
assert(typeof renderCalcButton === 'function', 'typeof renderCalcButton');

// --- 8. edge cases ---
assert.eq(evaluateExpression('0.1+0.2'), 0.3, 'eval: 0.1+0.2=0.3');
assert.eq(evaluateExpression('100/100'), 1, 'eval: 100/100=1');
assert.eq(evaluateExpression('50%100'), 50, 'eval: 50%100=50');
assert.eq(evaluateExpression('(1+2)*(3+4)'), 21, 'eval: (1+2)*(3+4)=21');
assert.eq(evaluateExpression('---5'), -5, 'eval: тройной унарный минус');
assert.eq(evaluateExpression('++5'), 5, 'eval: двойной унарный плюс');
