#!/usr/bin/env node
/**
 * CRM2 :: tools/deploy.js — единственный путь деплоя (SPEC, правило 12).
 * Перед публикацией: bump версии (patch | minor | major [--set X.Y.Z]),
 * обновляет VERSION в sw.js и version.json.
 * Запуск: node tools/deploy.js patch
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, data) { fs.writeFileSync(p, data, 'utf8'); }

function bump(version, kind) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) throw new Error('bad version: ' + version);
  if (kind === 'major') return [parts[0] + 1, 0, 0].join('.');
  if (kind === 'minor') return [parts[0], parts[1] + 1, 0].join('.');
  return [parts[0], parts[1], parts[2] + 1].join('.');
}

const args = process.argv.slice(2);
const setIdx = args.indexOf('--set');
let kind = args[0] || 'patch';

const vPath = path.join(ROOT, 'version.json');
const meta = JSON.parse(read(vPath));
let next;

if (setIdx !== -1 && args[setIdx + 1]) {
  next = args[setIdx + 1];
  kind = 'set';
} else if (['patch', 'minor', 'major'].includes(kind)) {
  next = bump(meta.version, kind);
} else {
  console.error('Использование: node tools/deploy.js [patch|minor|major] [--set X.Y.Z]');
  process.exit(1);
}

// 1. version.json
const now = new Date().toISOString();
write(vPath, JSON.stringify({ version: next, updated: now }, null, 2) + '\n');

// 2. sw.js — только строка VERSION (UTF-8, без sed)
const swPath = path.join(ROOT, 'sw.js');
const sw = read(swPath);
if (!/const VERSION = '/.test(sw)) {
  console.error('sw.js: не найден VERSION');
  process.exit(1);
}
write(swPath, sw.replace(/const VERSION = '[^']*'/, "const VERSION = '" + next + "'"));

console.log('DEPLOY: версия ' + meta.version + ' -> ' + next +
  ' (kind=' + kind + ', ' + now + ')');
console.log('Далее вручную: firebase deploy --only hosting,firestore:rules');
