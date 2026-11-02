#!/usr/bin/env node
/**
 * CRM2 :: tools/make-icons.js — генератор PWA-иконок (192/512).
 * Рисует окно на тёмном фоне (тема: чёрный/жёлтый) и кодирует PNG
 * напрямую через zlib, без внешних зависимостей.
 * Запуск: node tools/make-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

// --- PNG (truecolor RGB, без сжатия строк) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(size, px) {
  const stride = size * 3 + 1; // +1 байт фильтра на строку
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    px.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Дизайн: жёлтая рама окна на чёрном фоне ---

const BG = [10, 10, 10];      // #0a0a0a — фон приложения
const YEL = [255, 212, 0];    // #ffd400 — акцент
const GLASS = [30, 30, 30];   // стекло

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 3);
  const set = (x, y, c) => {
    const i = (y * size + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) set(x, y, BG);
  }

  const wx0 = Math.round(0.16 * size);
  const wx1 = Math.round(0.84 * size) - 1;
  const wy0 = Math.round(0.12 * size);
  const wy1 = Math.round(0.88 * size) - 1;
  const frame = Math.max(2, Math.round(0.06 * size));
  const mull = Math.max(2, Math.round(0.045 * size));
  const mx = (wx0 + wx1) / 2;
  const my = (wy0 + wy1) / 2;

  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x <= wx1; x++) {
      const onFrame = x < wx0 + frame || x > wx1 - frame ||
        y < wy0 + frame || y > wy1 - frame;
      const onMull = (x >= mx - mull / 2 && x <= mx + mull / 2) ||
        (y >= my - mull / 2 && y <= my + mull / 2);
      set(x, y, onFrame || onMull ? YEL : GLASS);
    }
  }
  return px;
}

const iconsDir = path.join(ROOT, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(iconsDir, 'icon-' + size + '.png');
  fs.writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log('ICONS: ' + path.relative(ROOT, file) + ' (' + size + 'x' + size + ')');
}
