#!/usr/bin/env node
/**
 * CRM2 :: tools/smoke/run.js — раннер смоук-тестов по модулям.
 * Каждый smoke-файл получает СВОЙ изолированный vm-контекст (как отдельная
 * страница браузера), внутри файла модули делят глобальные объекты через
 * loadModule('app/xxx.js').
 *
 * Запуск: node tools/smoke/run.js [файл1.js файл2.js ...]
 * Без аргументов — все smoke-*.js и _*_smoke.js из tools/smoke.
 * Код возврата: 0 — успех, 1 — есть падения.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(HERE)
      .filter((f) => /^smoke-.+\.js$/.test(f) || /^_.+_smoke\.js$/.test(f))
      .sort();

let pass = 0;
let fail = 0;

// Новый изолированный контекст для одного smoke-файла.
function makeSandbox() {
  function assert(cond, msg) {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.error('  FAIL: ' + msg);
    }
  }
  assert.eq = function (a, b, msg) {
    assert(a === b, (msg || 'eq') +
      ' (получено: ' + JSON.stringify(a) + ', ожидалось: ' + JSON.stringify(b) + ')');
  };

  // window === контекст (как в браузере window === globalThis).
  const sandbox = {
    console: console,
    assert: assert,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    fs: fs,
    path: path
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.loadModule = function (rel) {
    const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: rel });
  };
  vm.createContext(sandbox);
  return sandbox;
}

if (files.length === 0) {
  console.log('SMOKE: тестов пока нет — OK');
  process.exit(0);
}

for (const f of files) {
  let p = path.isAbsolute(f) ? f : path.join(HERE, f);
  if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js';
  console.log('smoke: ' + path.basename(p));
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), makeSandbox(), { filename: path.basename(p) });
  } catch (e) {
    fail++;
    console.error('  ERROR: ' + e.message);
  }
}

console.log('SMOKE: pass=' + pass + ' fail=' + fail);
if (fail) process.exit(1);
