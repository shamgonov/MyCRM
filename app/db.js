/* CRM2 :: app/db.js — локальный кэш (localStorage), defaultData, утилиты дат/денег.
   Глобальный DB инициализируется в load(). Никаких toISOString для дат (SPEC, правило 2). */
'use strict';

function lsGet(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v;
  } catch (e) {
    return def;
  }
}

function lsSet(key, val) {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch (e) {
    return false;
  }
}

function localToday() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Алиас для совместимости со старой CRM: fmt(d) — локальная дата YYYY-MM-DD.
function fmt(d) {
  if (d instanceof Date) {
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return localToday();
}

// Детерминированный формат: обычные пробелы-разделители, запятая в дробной части
// (toLocaleString даёт неразрывные пробелы, зависящие от платформы).
function money(n) {
  const v = Number(n) || 0;
  const parts = Math.abs(v).toFixed(2).split('.');
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = parts[1] === '00' ? '' : ',' + parts[1];
  return (v < 0 ? '-' : '') + int + frac + ' ₽';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function defaultData() {
  return {
    seq: 0,
    orders: [],
    users: [],
    clients: [],
    templates: [],
    settings: {},
    regions: [{
      region: 'Свердловская область',
      cities: ['Екатеринбург', 'Нижний Тагил', 'Каменск-Уральский', 'Первоуральск']
    }]
  };
}

// DB — глобальный объект, наполняется в load().
var DB = null;

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem('crm2_db');
  } catch (e) {
    raw = null;
  }
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = null;
    }
  }
  DB = data || defaultData();
  return DB;
}

function save() {
  try {
    localStorage.setItem('crm2_db', JSON.stringify(DB));
  } catch (e) {
    // localStorage недоступен (private mode / переполнение) — работаем в памяти.
  }
  if (typeof window.__onSave === 'function') window.__onSave(); // хук для sync.js (Этап 2)
}

load();
