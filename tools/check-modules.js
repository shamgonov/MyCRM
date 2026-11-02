#!/usr/bin/env node
/**
 * CRM2 :: tools/check-modules.js — ГЕЙТ качества.
 * Проверяет: модули app/* парсятся (new Function / vm), sw.js парсится,
 * index.html не содержит инлайн-скриптов и подключает все модули.
 * Запуск: node tools/check-modules.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');

const errors = [];

function fail(msg) {
  errors.push(msg);
}

function parseScript(label, code) {
  try {
    // new Function — строгая проверка синтаксиса ES2017+ (без выполнения).
    // "use strict" в начале модулей дополнительно ловит legacy-синтаксис.
    // eslint-disable-next-line no-new-func
    new Function('"use strict";\n' + code);
  } catch (e) {
    fail(label + ': синтаксическая ошибка — ' + e.message);
  }
}

// 1. Модули app/*.js — существуют и парсятся
let modules = [];
let scaffoldOnly = false;
if (fs.existsSync(APP_DIR)) {
  modules = fs.readdirSync(APP_DIR).filter((f) => f.endsWith('.js')).sort();
  if (modules.length === 0) {
    fail('app/: не найдено ни одного модуля .js');
  }
} else {
  // Этап 0: каркас без модулей — допускается, но помечаем в выводе.
  scaffoldOnly = true;
}

for (const m of modules) {
  const code = fs.readFileSync(path.join(APP_DIR, m), 'utf8');
  parseScript('app/' + m, code);
}

// 2. sw.js
const swPath = path.join(ROOT, 'sw.js');
if (fs.existsSync(swPath)) {
  const code = fs.readFileSync(swPath, 'utf8');
  parseScript('sw.js', code);
  const m = code.match(/const VERSION = '([^']+)'/);
  if (!m) fail('sw.js: не найден VERSION для tools/deploy.js');
} else {
  fail('sw.js отсутствует');
}

// 3. version.json существует и валиден
const vPath = path.join(ROOT, 'version.json');
if (fs.existsSync(vPath)) {
  try {
    const v = JSON.parse(fs.readFileSync(vPath, 'utf8'));
    if (!v.version) fail('version.json: нет поля version');
  } catch (e) {
    fail('version.json: невалидный JSON — ' + e.message);
  }
} else {
  fail('version.json отсутствует');
}

// 4. index.html: без инлайн-скриптов, все модули подключены
const htmlPath = path.join(ROOT, 'index.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');

  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let tag;
  while ((tag = re.exec(html))) {
    const attrs = tag[1];
    const body = tag[2];
    if (!/\bsrc\s*=/.test(attrs)) {
      fail('index.html: инлайн-скрипт запрещён — ' + tag[0].slice(0, 60));
    } else if (body.trim()) {
      fail('index.html: код внутри <script src=...> запрещён');
    }
  }

  for (const m of modules) {
    if (!html.includes('app/' + m)) fail('index.html: не подключён модуль app/' + m);
  }
} else {
  fail('index.html отсутствует');
}

// 5. Обязательные файлы каркаса
for (const f of ['styles/theme.css', 'manifest.webmanifest', 'firestore.rules']) {
  if (!fs.existsSync(path.join(ROOT, f))) fail('Отсутствует ' + f);
}

if (errors.length) {
  console.error('GATE FAIL (' + errors.length + '):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const mode = scaffoldOnly ? ' (каркас: app/ появится на Этапе 1)' : '';
console.log('GATE OK' + mode + ': модулей app/=' + modules.length +
  ', инлайн-скриптов=0, каркас на месте.');
