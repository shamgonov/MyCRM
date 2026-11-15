/* CRM2 :: app/orders.js — доменная логика заявок: статусы, переходы, расчёты.
   Работает с локальным DB.orders (sync.js подключим на Этапе 2+).
   Зависит от db.js (DB) и auth.js (state). */
'use strict';

const ORDER_STATUSES = [
  'new', 'inspection', 'estimate', 'approved', 'inwork', 'paused',
  'waiting', 'postponed', 'completed', 'paid', 'canceled'
];

// Локации материала (Этап 18): багажник / поставщик / склад / у заказчика.
const MAT_PLACES = ['trunk', 'supplier', 'warehouse', 'client'];
const MAT_PLACE_LABELS = {
  trunk: '🚗 Багажник', supplier: '🏪 Поставщик',
  warehouse: '🏭 Склад', client: '🏠 У заказчика'
};

// Матрица переходов (SPEC: статусы и переходы, включая ветку C без осмотра).
const STATUS_TRANSITIONS = {
  new: ['inspection', 'approved', 'postponed', 'canceled'],        // + Этап 19: postponed из new
  inspection: ['estimate', 'canceled'],               // осмотрщик составил смету
  estimate: ['approved', 'postponed', 'canceled'],    // клиент согласовал | отложил | отмена
  approved: ['inwork', 'canceled'],                   // назначен worker, тот принял
  inwork: ['paused', 'completed', 'canceled', 'postponed'],  // Q4: перенос остатка
  paused: ['inwork', 'canceled'],                     // возобновить
  waiting: ['inwork', 'canceled'],
  postponed: ['estimate', 'approved', 'canceled'],    // возврат после отложения
  completed: ['paid', 'canceled'],
  paid: [],
  canceled: []
};

// normalizeOrder(o): гарантия наличия обязательных коллекций (правило SPEC 3 — без undefined).
function normalizeOrder(o) {
  if (!o) return o;
  if (!Array.isArray(o.works)) o.works = [];
  if (!Array.isArray(o.extras)) o.extras = [];
  if (!Array.isArray(o.materials)) o.materials = [];
  if (!Array.isArray(o.history)) o.history = [];
  if (!Array.isArray(o.payments)) o.payments = [];
  // Подтверждение соисполнителя (Этап 14)
  if (!o.confirm || typeof o.confirm !== 'object' || Array.isArray(o.confirm)) o.confirm = {};
  // Теги проблемы (Этап 17)
  if (!Array.isArray(o.tags)) o.tags = [];
  // Время перезвона по итогам звонка (Этап 19): null = не назначен.
  if (!o.callbackAt) o.callbackAt = null;
  // Локация и поставщик материала (Этап 18).
  (o.materials || []).forEach(function (m) {
    if (!m) return;
    if (MAT_PLACES.indexOf(m.place) < 0) m.place = 'supplier';
    if (m.supplierId === undefined) m.supplierId = null;
  });
  return o;
}

// calculateOrderTotal(o): ЕДИНАЯ база суммы заявки для сметы, документов и отчётов
// (решение Q3): работы (не skipped, с коэффициентом) + доп.работы (agreed);
// материалы включаются в сумму клиента только при matsInTotal.
function calculateOrderTotal(o) {
  if (!o) return 0;
  let total = 0;
  (o.works || []).forEach(function (w) {
    if (w.skipped) return;
    total += (Number(w.qty) || 0) * (Number(w.price) || 0) * (Number(w.coeff) || 1);
  });
  (o.extras || []).forEach(function (x) {
    if (x.status !== 'agreed') return;
    total += (Number(x.qty) || 0) * (Number(x.price) || 0);
  });
  if (o.matsInTotal) {
    (o.materials || []).forEach(function (m) {
      total += (Number(m.qty) || 0) * (Number(m.price) || 0);
    });
  }
  return total;
}

// saveOrderLocal(o): вставка/замена в DB.orders + сохранение (глобальный save() из db.js).
// Новая заявка получает id из счётчика DB.seq.
function saveOrderLocal(o) {
  if (!o) return null;
  const idx = (DB.orders || []).findIndex(function (x) { return x.id === o.id; });
  if (idx >= 0) {
    DB.orders[idx] = o;
  } else {
    if (o.id === undefined || o.id === null) {
      DB.seq = (DB.seq || 0) + 1;
      o.id = DB.seq;
    }
    DB.orders.push(o);
  }
  save();
  return o;
}

// createOrder(data): дефолты + история создания + сохранение.
function createOrder(data) {
  const o = Object.assign({}, data || {});
  o.status = o.status || 'new';
  o.works = Array.isArray(o.works) ? o.works : [];
  o.extras = Array.isArray(o.extras) ? o.extras : [];
  o.materials = Array.isArray(o.materials) ? o.materials : [];
  o.history = Array.isArray(o.history) ? o.history : [];
  o.helpers = Array.isArray(o.helpers) ? o.helpers : [];
  o.payments = Array.isArray(o.payments) ? o.payments : [];
  o.createdAt = Date.now();
  o.createdBy = state.user;
  o.history.push({ ts: Date.now(), by: state.user, action: 'create', details: 'Заявка создана' });
  return saveOrderLocal(o);
}

// transitionOrder(id, newStatus, reason): переход по матрице STATUS_TRANSITIONS
// с записью в историю. Возвращает true при успехе.
function transitionOrder(id, newStatus, reason) {
  const o = (DB.orders || []).find(function (x) { return x.id === id; });
  if (!o) return false;
  if (ORDER_STATUSES.indexOf(newStatus) < 0) return false;
  const allowed = STATUS_TRANSITIONS[o.status] || [];
  if (allowed.indexOf(newStatus) < 0) return false;
  const old = o.status;
  o.status = newStatus;
  normalizeOrder(o);
  o.history.push({
    ts: Date.now(),
    by: state.user,
    action: 'status',
    from: old,
    to: newStatus,
    reason: reason || ''
  });
  saveOrderLocal(o);
  return true;
}

// --- Деньги заявки (Этап 12) ---
// Выручка = единая база calculateOrderTotal (Q3); оплачено = сумма o.payments.

function orderRevenue(o) {
  return calculateOrderTotal(o);
}

function orderPaid(o) {
  if (!o || !Array.isArray(o.payments)) return 0;
  return o.payments.reduce(function (s, p) { return s + (Number(p.sum) || 0); }, 0);
}

function orderBalance(o) {
  return orderRevenue(o) - orderPaid(o);
}

// addPayment(o, data): платёж с валидацией суммы; запись в историю.
function addPayment(o, data) {
  if (!o || !data) return null;
  const sum = Number(data.sum);
  if (!isFinite(sum) || sum <= 0) return null;
  normalizeOrder(o);
  const pay = {
    id: (o.payments.length ? Math.max.apply(null, o.payments.map(function (p) {
      return Number(p.id) || 0;
    })) : 0) + 1,
    sum: sum,
    date: data.date || localToday(),
    method: data.method || 'cash',
    by: state.user,
    note: data.note || ''
  };
  o.payments.push(pay);
  o.history.push({
    ts: Date.now(), by: state.user, action: 'payment',
    details: 'Платёж ' + sum + ' ₽ (' + pay.method + ')' + (pay.note ? ' — ' + pay.note : '')
  });
  saveOrderLocal(o);
  return pay;
}

function removePayment(o, paymentId) {
  if (!o || !Array.isArray(o.payments)) return false;
  const idx = o.payments.findIndex(function (p) { return p.id === paymentId; });
  if (idx < 0) return false;
  const removed = o.payments.splice(idx, 1)[0];
  normalizeOrder(o);
  o.history.push({
    ts: Date.now(), by: state.user, action: 'payment',
    details: 'Платёж удалён: ' + (Number(removed.sum) || 0) + ' ₽'
  });
  saveOrderLocal(o);
  return true;
}

// --- Доля исполнителя (Этап 13, решение Q2: reward — расход компании) ---

// Процент заявки: локальный override o.rewardPct, иначе общий DB.settings.rewardPctDefault.
// 0 означает «выключено» явно, поэтому переопределение проверяем на заданность, а не на truthy.
function orderRewardPct(o) {
  const local = o ? o.rewardPct : null;
  if (local !== null && local !== undefined && local !== '' && isFinite(Number(local))) {
    return Number(local);
  }
  const global = (DB && DB.settings) ? Number(DB.settings.rewardPctDefault) : 0;
  return isFinite(global) ? global : 0;
}

// Доля исполнителя в рублях от выручки заявки.
function orderReward(o) {
  const pct = orderRewardPct(o);
  if (!pct) return 0;
  return Math.round(orderRevenue(o) * pct / 100);
}

// --- Пул и подтверждение соисл. (Этап 14) ---

// Взять заявку в работу: назначить себя worker, записать факт, проверить доступ.
// Возвращает { ok: true } или { ok: false, reason: '...' }.
function takeOrder(o) {
  if (!o) return { ok: false, reason: 'Нет заявки' };
  if (o.worker) return { ok: false, reason: 'Исполнитель уже назначен' };
  if (o.status !== 'new' && o.status !== 'inspection' && o.status !== 'approved') {
    return { ok: false, reason: 'Статус не позволяет взять' };
  }
  if (o.helpers && o.helpers.indexOf(state.user) >= 0) {
    return { ok: false, reason: 'Уже прикреплён как соисполнитель' };
  }
  o.worker = state.user;
  o.takenAt = Date.now();
  o.takenBy = state.user;
  normalizeOrder(o);
  o.history.push({
    ts: Date.now(), by: state.user, action: 'take',
    details: 'Заявка взята в работу'
  });
  saveOrderLocal(o);
  return { ok: true };
}

// Назначить соисполнителя: добавить в helpers + pending-подтверждение.
function assignHelper(o, helperName) {
  if (!o || !helperName) return false;
  if (helperName === state.user) return false;
  if (!Array.isArray(o.helpers)) o.helpers = [];
  if (o.helpers.indexOf(helperName) >= 0) return false;
  normalizeOrder(o);
  o.helpers.push(helperName);
  o.confirm = o.confirm || {};
  o.confirm[helperName] = 'pending';
  o.history.push({
    ts: Date.now(), by: state.user, action: 'assign_helper',
    details: helperName + ' приглашён в соисполнители'
  });
  saveOrderLocal(o);
  return true;
}

// Подтвердить соисполнителя: 'ok' или 'no'.
function confirmHelper(o, helperName, decision) {
  if (!o || !helperName || !o.confirm || !o.confirm[helperName]) return false;
  if (o.confirm[helperName] !== 'pending') return false;
  if (decision !== 'ok' && decision !== 'no') return false;
  normalizeOrder(o);
  if (decision === 'no') {
    const idx = o.helpers.indexOf(helperName);
    if (idx >= 0) o.helpers.splice(idx, 1);
    delete o.confirm[helperName];
    o.history.push({
      ts: Date.now(), by: state.user, action: 'confirm_helper',
      details: helperName + ' отказался'
    });
  } else {
    o.confirm[helperName] = 'ok';
    o.history.push({
      ts: Date.now(), by: state.user, action: 'confirm_helper',
      details: helperName + ' подтвердил'
    });
  }
  saveOrderLocal(o);
  return true;
}

// --- Перенос остатка: дочерняя заявка (Этап 15) ---

// Отображаемый номер заявки: дочерняя — «279/1», обычная — «279».
// Числовой o.id остаётся ключом в DB.orders; дробный номер только для показа.
function orderDisplayNumber(o) {
  if (!o) return '';
  if (o.parentId && o.childNo) return o.parentId + '/' + o.childNo;
  return String(o.id);
}

// createFollowUpOrder(parent, data): перенос невыполненного остатка в новую
// дочернюю заявку. Копирует работы без done/skipped и материалы needed,
// наследует клиента/адрес, связывает родителя и ребёнка в обе стороны.
function createFollowUpOrder(parent, data) {
  if (!parent) return null;
  var d = data || {};
  normalizeOrder(parent);
  if (!Array.isArray(parent.followUpIds)) parent.followUpIds = [];
  var childNo = parent.followUpIds.length + 1;

  var clone = function (x) { return Object.assign({}, x); };
  var restWorks = (parent.works || [])
    .filter(function (w) { return !w.done && !w.skipped; })
    .map(clone);
  var restMats = (parent.materials || [])
    .filter(function (m) { return m.status === 'needed'; })
    .map(clone);

  var child = createOrder({
    client: parent.client,
    phone: parent.phone,
    city: parent.city,
    address: parent.address,
    date: d.date || parent.date,
    t1: d.t1 !== undefined ? d.t1 : (parent.t1 || ''),
    t2: d.t2 !== undefined ? d.t2 : (parent.t2 || ''),
    status: d.status || 'new',
    worker: parent.worker || '',
    kind: parent.kind,
    works: restWorks,
    materials: restMats,
    parentId: parent.id,
    childNo: childNo
  });
  if (!child) return null;

  parent.followUpIds.push(child.id);
  parent.history.push({
    ts: Date.now(), by: state.user, action: 'followup',
    details: 'Остаток перенесён в заявку №' + orderDisplayNumber(child)
  });
  saveOrderLocal(parent);

  child.history.push({
    ts: Date.now(), by: state.user, action: 'inherit',
    details: 'Создана из остатка заявки №' + parent.id
  });
  saveOrderLocal(child);
  return child;
}

// --- Теги (Этап 17) ---

// Добавить тег заявке.
function addTag(o, tag) {
  if (!o || !tag) return false;
  normalizeOrder(o);
  tag = tag.trim();
  if (!tag) return false;
  if (o.tags.indexOf(tag) >= 0) return false;
  o.tags.push(tag);
  saveOrderLocal(o);
  return true;
}

// Удалить тег у заявки.
function removeTag(o, tag) {
  if (!o || !tag) return false;
  const idx = o.tags.indexOf(tag);
  if (idx < 0) return false;
  o.tags.splice(idx, 1);
  saveOrderLocal(o);
  return true;
}

// --- Шаблоны смет (Этап 17) ---

// Сохранить текущую смету заявки как шаблон.
function saveTemplate(o, name) {
  if (!o || !name) return null;
  name = name.trim();
  if (!name) return null;
  if (!Array.isArray(DB.templates)) DB.templates = [];
  const tpl = {
    id: Date.now(),
    name: name,
    kind: 'estimate',
    works: (o.works || []).map(function (w) {
      return {
        name: w.name || w.title || '',
        qty: w.qty || 1,
        unit: w.unit || 'шт',
        price: w.price || 0,
        coeff: w.coeff || 1
      };
    }),
    tags: (o.tags || []).slice()
  };
  DB.templates.push(tpl);
  save();
  return tpl;
}

// Применить шаблон к заявке: очищает прежние работы и теги, заполняет из шаблона.
function applyTemplate(o, templateId) {
  if (!o || templateId === null || templateId === undefined) return false;
  if (!Array.isArray(DB.templates)) return false;
  const tpl = DB.templates.find(function (t) { return t.id === templateId; });
  if (!tpl) return false;
  o.works = (tpl.works || []).map(function (tw) {
    // Название из шаблона кладём и в name, и в title: сид и документы читают
    // title, смета и новые позиции — name (везде w.name || w.title).
    return {
      name: tw.name,
      title: tw.name,
      qty: tw.qty,
      unit: tw.unit || 'шт',
      price: tw.price,
      coeff: tw.coeff || 1,
      done: false,
      skipped: false
    };
  });
  o.tags = (tpl.tags || []).slice();
  saveOrderLocal(o);
  return true;
}

// --- Поставщики и маршрут закупки (Этап 18) ---

// Создать/обновить поставщика: без id — новая запись, с id — правка.
function saveSupplier(data) {
  if (!data || !data.name) return null;
  if (!Array.isArray(DB.suppliers)) DB.suppliers = [];
  let s = null;
  if (data.id !== undefined && data.id !== null && data.id !== '') {
    s = DB.suppliers.find(function (x) { return String(x.id) === String(data.id); });
  }
  if (s) {
    s.name = data.name;
    s.phone = data.phone || '';
    s.address = data.address || '';
    s.hours = data.hours || '';
    s.note = data.note || '';
  } else {
    s = {
      id: 'sup' + Date.now(),
      name: data.name,
      phone: data.phone || '',
      address: data.address || '',
      hours: data.hours || '',
      note: data.note || ''
    };
    DB.suppliers.push(s);
  }
  save();
  return s;
}

function deleteSupplier(id) {
  const idx = (DB.suppliers || []).findIndex(function (s) { return String(s.id) === String(id); });
  if (idx < 0) return false;
  DB.suppliers.splice(idx, 1);
  save();
  return true;
}

function findSupplier(id) {
  if (id === null || id === undefined || id === '') return null;
  return (DB.suppliers || []).find(function (s) { return String(s.id) === String(id); }) || null;
}

// Ключ группировки материала: поставщик, иначе — локация.
function materialGroupKey(m) {
  if (m && m.place === 'supplier' && m.supplierId) return 'supplier:' + m.supplierId;
  return 'place:' + ((m && m.place) || 'supplier');
}

function materialGroupLabel(key) {
  if (key.indexOf('supplier:') === 0) {
    const s = findSupplier(key.slice(9));
    return '🏪 ' + ((s && s.name) || 'Поставщик удалён') +
      (s && s.hours ? ' · ' + s.hours : '') +
      (s && s.phone ? ' · ' + s.phone : '');
  }
  const place = key.slice(6);
  return MAT_PLACE_LABELS[place] || place;
}

// Группировка плоского списка закупок [{o, m, idx}] по поставщикам/локациям.
// Порядок групп: сначала «купить у поставщика», затем остальные локации.
function groupMaterialsBySupplier(items) {
  const map = {};
  const order = [];
  (items || []).forEach(function (it) {
    const key = materialGroupKey(it.m);
    if (!map[key]) { map[key] = []; order.push(key); }
    map[key].push(it);
  });
  order.sort(function (a, b) {
    const rank = function (k) { return k.indexOf('supplier:') === 0 ? 0 : 1; };
    return rank(a) - rank(b) || materialGroupLabel(a).localeCompare(materialGroupLabel(b), 'ru');
  });
  return order.map(function (k) { return { key: k, label: materialGroupLabel(k), items: map[k] }; });
}

// Точки маршрута закупки заявки: поставщики материалов + склад (если есть).
// ignore — объект m.routeIgnored { ключ: true } «игнорировать точку».
function buildPurchaseRoute(o, ignore) {
  if (!o) return [];
  const ig = ignore || {};
  const points = [];
  const seen = {};
  (o.materials || []).forEach(function (m) {
    if (!m || m.place !== 'supplier' || m.status !== 'needed') return;
    const key = materialGroupKey(m);
    if (seen[key]) return;
    seen[key] = true;
    const s = findSupplier(m.supplierId);
    points.push({
      key: key,
      title: (s && s.name) || 'Поставщик не указан',
      address: (s && s.address) || '',
      phone: (s && s.phone) || '',
      ignored: !!ig[key]
    });
  });
  const hasWarehouse = (o.materials || []).some(function (m) {
    return m && m.place === 'warehouse' && m.status === 'needed';
  });
  if (hasWarehouse) {
    points.push({
      key: 'place:warehouse',
      title: 'Склад',
      address: (DB.settings && DB.settings.warehouseAddress) || '',
      phone: '',
      ignored: !!ig['place:warehouse']
    });
  }
  return points;
}

// URL навигатора (веб-версии, без библиотек): адрес → строка поиска карт.
function navigatorUrl(kind, address) {
  const q = encodeURIComponent(String(address || '').trim());
  if (!q) return '';
  if (kind === '2gis') return 'https://2gis.ru/search/' + q;
  if (kind === 'google') return 'https://www.google.com/maps/search/?api=1&query=' + q;
  return 'https://yandex.ru/maps/?text=' + q; // yandex по умолчанию
}
