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

// dateShift('YYYY-MM-DD', ±N) — локальная дата со сдвигом (для мок-данных).
function dateShift(iso, days) {
  const p = String(iso).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + days);
  const q = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + q(d.getMonth() + 1) + '-' + q(d.getDate());
}

// seedMockData(): демо-заявки для свежей установки (Этап 4).
// «Своя» заявка привязана к мок-юзеру «Мастер» (так зовёт doLogin в core.js).
function seedMockData() {
  const today = localToday();
  const mk = function (o) {
    DB.seq = (DB.seq || 0) + 1;
    o.id = DB.seq;
    o.status = o.status || 'new';
    o.works = o.works || [];
    o.extras = o.extras || [];
    o.materials = o.materials || [];
    o.helpers = o.helpers || [];
    o.history = o.history && o.history.length ? o.history :
      [{ ts: Date.now(), by: 'Владелец', action: 'create', details: 'Мок-заявка (демо)' }];
    o.createdAt = Date.now();
    o.createdBy = o.createdBy || 'Владелец';
    DB.orders.push(o);
  };

  // «Моя» заявка на сегодня (worker=Мастер)
  mk({ client: 'Смирнов А.П.', phone: '+7 912 345-67-89', address: 'ул. Ленина, 15, кв. 3',
    city: 'Екатеринбург', date: today, t1: '09:00', t2: '12:00', status: 'inwork',
    worker: 'Мастер', helpers: ['Вера'],
    works: [
      { title: 'Регулировка створки', qty: 2, price: 800, unit: 'шт' },
      { title: 'Замена уплотнителя', qty: 1, price: 1200, unit: 'компл' }
    ] });

  // Просрочка: новая, назначена на вчера
  mk({ client: 'Иванова М.С.', phone: '+7 922 111-22-33', address: 'ул. Мира, 8',
    city: 'Нижний Тагил', date: dateShift(today, -1), t1: '10:00', t2: '11:00', status: 'new' });

  // Сегодня, согласована, за Борисом
  mk({ client: 'ООО ОкнаСервис', phone: '+7 343 200-00-00', address: 'пр. Ленина, 50, офис 12',
    city: 'Екатеринбург', date: today, t1: '14:00', t2: '18:00', status: 'approved',
    worker: 'Борис', helpers: [],
    works: [{ title: 'Диагностика', qty: 1, price: 1000, unit: 'шт' }] });

  // Завершённая неделю назад (не попадает в просрочку, есть skipped-работа)
  mk({ client: 'Петрова Е.В.', phone: '+7 950 555-11-22', address: 'ул. Гагарина, 27, кв. 44',
    city: 'Первоуральск', date: dateShift(today, -7), t1: '09:00', t2: '10:00', status: 'completed',
    worker: 'Борис', helpers: ['Мастер'],
    works: [
      { title: 'Замена стекла', qty: 1, price: 4500, unit: 'шт' },
      { title: 'Фурнитура', qty: 1, price: 2800, unit: 'компл', skipped: true }
    ] });
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
  if ((DB.orders || []).length === 0) seedMockData();
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
