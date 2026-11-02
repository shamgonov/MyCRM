#!/usr/bin/env node
/**
 * CRM2 :: tools/smoke/run.js — раннер смоук-тестов по модулям.
 * Запускает все tools/smoke/smoke-*.js в общем vm-контексте
 * (модули делят глобальные объекты, как в браузере через window).
 *
 * Запуск: node tools/smoke/run.js [файл1.js файл2.js ...]
 * Код возврата: 0 — успех, 1 — есть падения.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(HERE).filter((f) => /^smoke-.+\.js$/.test(f)).sort();

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(msg);
    console.error('  FAIL: ' + msg);
  }
}
assert.eq = function (a, b, msg) {
  assert(a === b, (msg || 'eq') +
    ' (получено: ' + JSON.stringify(a) + ', ожидалось: ' + JSON.stringify(b) + ')');
};

// Общий песочный контекст; наполнение (document, localStorage, firebase)
// добавляется смоук-файлами соответствующих этапов.
const sandbox = {
  console: console,
  assert: assert,
  window: {},
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

if (files.length === 0) {
  console.log('SMOKE: тестов пока нет (каркас, Этап 0) — OK');
  process.exit(0);
}

for (const f of files) {
  const p = path.isAbsolute(f) ? f : path.join(HERE, f);
  const code = fs.readFileSync(p, 'utf8');
  console.log('smoke: ' + path.basename(p));
  try {
    vm.runInContext(code, sandbox, { filename: path.basename(p) });
  } catch (e) {
    fail++;
    failures.push('ошибка выполнения: ' + e.message);
    console.error('  ERROR: ' + e.message);
  }
}

console.log('SMOKE: pass=' + pass + ' fail=' + fail);
if (fail) process.exit(1);
