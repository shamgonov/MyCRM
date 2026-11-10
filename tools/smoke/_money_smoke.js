/* Смоук Этапа 12–13: деньги заявки (единая база суммы, платежи, остаток) и reward. */
'use strict';

globalThis.localStorage = (function () {
  const m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
const appStub = { innerHTML: '' };
const navStub = { innerHTML: '' };
const modalStub = { innerHTML: '' };
const fields = {};
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return fields[id] || null;
  },
  querySelectorAll: function () { return []; },
  addEventListener: function () {}
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-estimate.js');
loadModule('app/ui-money.js');
loadModule('app/ui-reports.js');
loadModule('app/notify.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// --- 1. Единая база суммы (Q3): коэффициент учтён в calculateOrderTotal ---
const ord = {
  id: 500, status: 'inwork', client: 'Тест', date: localToday(),
  works: [
    { title: 'Регулировка', qty: 2, price: 500, coeff: 1.5 },
    { title: 'Уплотнитель', qty: 1, price: 1000 },
    { title: 'Лишнее', qty: 5, price: 900, skipped: true }
  ],
  extras: [{ name: 'Подоконник', qty: 1, price: 700, status: 'agreed' }],
  materials: []
};
// 2*500*1.5 + 1*1000 + agreed 700 = 3200
assert.eq(calculateOrderTotal(ord), 3200, 'база: coeff учтён в calculateOrderTotal');
assert.eq(calculateEstimateTotal(ord), calculateOrderTotal(ord),
  'база: смета и отчёты считают одинаково');

// --- 2. orderRevenue / orderPaid / orderBalance ---
assert.eq(orderRevenue(ord), 3200, 'revenue = единая база');
assert.eq(orderPaid(ord), 0, 'paid = 0 без платежей');
assert.eq(orderBalance(ord), 3200, 'balance = revenue без оплат');

// --- 3. addPayment: сумма, история, id, отклонение некорректной суммы ---
const saved = saveOrderLocal(ord);
const pay1 = addPayment(saved, { sum: 1000, method: 'cash', note: 'аванс' });
assert(!!pay1, 'addPayment: платёж создан');
assert.eq(pay1.id, 1, 'addPayment: id = 1 для первого');
assert.eq(pay1.by, 'Владелец', 'addPayment: автор записан');
assert.eq(orderPaid(saved), 1000, 'paid после платежа = 1000');
assert.eq(orderBalance(saved), 2200, 'balance после платежа = 2200');
assert(saved.history.some(function (h) { return h.action === 'payment'; }),
  'addPayment: запись в истории');

const pay2 = addPayment(saved, { sum: 500 });
assert.eq(pay2.id, 2, 'addPayment: id инкрементальный');
assert.eq(pay2.method, 'cash', 'addPayment: способ по умолчанию — наличные');

assert.eq(addPayment(saved, { sum: 0 }), null, 'addPayment: нулевая сумма отклонена');
assert.eq(addPayment(saved, { sum: -50 }), null, 'addPayment: отрицательная сумма отклонена');
assert.eq(addPayment(saved, { sum: 'abc' }), null, 'addPayment: нечисловая сумма отклонена');
assert.eq(orderPaid(saved), 1500, 'paid не изменился после отклонённых платежей');

// --- 4. removePayment ---
assert(removePayment(saved, pay1.id) === true, 'removePayment: удалён существующий');
assert.eq(orderPaid(saved), 500, 'paid после удаления = 500');
assert.eq(removePayment(saved, 9999), false, 'removePayment: чужой id → false');

// --- 5. normalizeOrder доводит payments до массива ---
const bare = { id: 501, works: [], extras: [], materials: [], history: [] };
normalizeOrder(bare);
assert(Array.isArray(bare.payments), 'normalizeOrder: payments — массив');
assert.eq(createOrder({ client: 'Без платежей' }).payments.length, 0,
  'createOrder: payments=[] у новой заявки');

// --- 6. reward: процент по умолчанию, override, rounding (Этап 13) ---
DB.settings.rewardPctDefault = 10;
assert.eq(orderRewardPct(ord), 10, 'reward: общий процент из настроек');
assert.eq(orderReward(ord), 320, 'reward: 10% от 3200 = 320');

ord.rewardPct = 20;
assert.eq(orderRewardPct(ord), 20, 'reward: локальный override важнее общего');
assert.eq(orderReward(ord), 640, 'reward: 20% от 3200 = 640');

ord.rewardPct = 0;
assert.eq(orderRewardPct(ord), 0, 'reward: override 0 отключает долю явно');
assert.eq(orderReward(ord), 0, 'reward: 0% = 0 ₽');

DB.settings.rewardPctDefault = 0;
assert.eq(orderReward({ works: [{ qty: 1, price: 1000 }] }), 0,
  'reward: по умолчанию выключено');

// Округление: 15% от 999 = 149.85 → 150.
DB.settings.rewardPctDefault = 15;
assert.eq(orderReward({ works: [{ qty: 1, price: 999 }] }), 150, 'reward: округление до рубля');
DB.settings.rewardPctDefault = 0;
delete ord.rewardPct;

// --- 7. Видимость денег (Q6: исполнитель + менеджер/оператор/владелец) ---
state.user = 'Мастер';
login('worker', 'Мастер');
const mine = { id: 502, worker: 'Мастер', helpers: [], status: 'inwork', works: [], extras: [] };
const foreign = { id: 503, worker: 'Борис', helpers: [], status: 'inwork', works: [], extras: [] };
assert(canSeeMoney(mine) === true, 'worker видит деньги своей заявки');
assert(canSeeMoney(foreign) === false, 'worker НЕ видит деньги чужой заявки');
assert(canEditMoney(mine) === true, 'worker вводит оплаты по своей заявке');
assert(canEditMoney(foreign) === false, 'worker НЕ трогает чужие оплаты');

login('manager', 'Ирина');
assert(canSeeMoney(foreign) === true, 'менеджер видит деньги любой заявки (контроль выплат)');
login('admin', 'Владелец');
assert(canSeeMoney(foreign) === true, 'владелец видит деньги');
assert(canEditMoney(foreign) === true, 'владелец вводит оплаты');

// --- 8. Вкладка «Деньги» в карточке ---
const moneyOrder = createOrder({
  client: 'Оплатов', date: localToday(), t1: '10:00', t2: '12:00',
  status: 'inwork', worker: 'Владелец',
  works: [{ title: 'Датчик', qty: 1, price: 4000 }]
});
addPayment(moneyOrder, { sum: 1500 });

ORD_TAB = 'money';
const html = renderOrderCard(moneyOrder.id);
assert(html.indexOf('data-tab="money"') >= 0, 'карточка: таб «Деньги»');
assert(html.indexOf('Расчёты по заявке') >= 0, 'деньги: блок расчётов');
assert(html.indexOf('Остаток к оплате') >= 0, 'деньги: остаток');
assert(html.indexOf(money(2500)) >= 0, 'деньги: остаток 4000 - 1500 = 2500');
assert(html.indexOf('data-add-payment') >= 0, 'деньги: кнопка «＋ Платёж»');
assert(html.indexOf('data-del-payment') >= 0, 'деньги: удаление платежа');
assert(html.indexOf('Наличные') >= 0, 'деньги: способ оплаты подписан');
assert(html.indexOf('Доля исполнителя') >= 0, 'деньги: блок доли');
ORD_TAB = 'main';

// --- 9. Права: чужой worker не видит содержимое вкладки ---
login('worker', 'Посторонний');
const htmlDeny = renderMoneyTab(moneyOrder);
assert(htmlDeny.indexOf('Нет доступа') >= 0, 'деньги: отказ в доступе постороннему');
login('admin', 'Владелец');

// --- 10. Напоминалка об остатке (notify.js, kind 'balance') ---
const rem = buildReminders([]).filter(function (r) { return r.kind === 'balance'; });
assert.eq(rem.length, 0, 'напоминалка: без moneyReminderAt пусто');

moneyOrder.moneyReminderAt = Date.now();
saveOrderLocal(moneyOrder);
const rem2 = buildReminders([]).filter(function (r) { return r.kind === 'balance'; });
assert.eq(rem2.length, 1, 'напоминалка: moneyReminderAt даёт kind balance');
assert(rem2[0].when.indexOf('2500') >= 0, 'напоминалка: в подписи сумма остатка');
assert(REMINDER_LABELS.balance === '💰 Остаток', 'напоминалка: подпись kind есть');

// Погашенный остаток больше не напоминает.
addPayment(moneyOrder, { sum: 2500 });
const rem3 = buildReminders([]).filter(function (r) { return r.kind === 'balance'; });
assert.eq(rem3.length, 0, 'напоминалка: остаток погашен — молчим');

// --- 11. Прибыль: reward — расход (Q2) ---
DB.orders = [{
  id: 900, status: 'completed', worker: 'Владелец', date: localToday(), rewardPct: 25,
  works: [{ title: 'W', qty: 1, price: 1000 }],
  extras: [], materials: [{ name: 'M', qty: 1, price: 200, buyer: 'company', status: 'bought' }]
}];
const prof = calculateProfit(DB.orders);
assert.eq(prof.revenue, 1000, 'отчёт: revenue 1000');
assert.eq(prof.reward, 250, 'отчёт: reward 25% = 250');
assert.eq(prof.profit, 550, 'отчёт: прибыль = 1000 - 200 - 250');

const bw = calculateByWorker(DB.orders);
assert.eq(bw[0].reward, 250, 'отчёт по мастерам: колонка доли посчитана');
assert.eq(bw[0].profit, 550, 'отчёт по мастерам: прибыль минус доля');

REPORT_TAB = 'profit';
const repHtml = renderReportsTab();
assert(repHtml.indexOf('Доля исполнителей') >= 0, 'отчёт: карточка «Доля исполнителей»');
REPORT_TAB = 'worker';
assert(renderReportsTab().indexOf('Доля') >= 0, 'отчёт по мастерам: колонка «Доля»');
REPORT_TAB = 'profit';
