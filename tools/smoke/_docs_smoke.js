/* Смоук app/ui-docs.js (Этап 8): нумерация, реквизиты, смета, акт, печать, шаринг. */
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
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
  },
  addEventListener: function () {}
};
globalThis.confirm = function () { return false; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };

// Мок window.open для печати.
let printed = 0;
let writtenHtml = '';
globalThis.window.open = function () {
  return {
    document: {
      write: function (h) { writtenHtml += h; },
      close: function () {}
    },
    focus: function () {},
    print: function () { printed++; }
  };
};
// Мок буфера обмена (navigator.share отсутствует → фолбэк clipboard).
let copiedText = '';
globalThis.navigator = { clipboard: { writeText: function (t) { copiedText = t; return Promise.resolve(); } } };

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-estimate.js');
loadModule('app/ui-shopping.js');
loadModule('app/ui-docs.js');

setOwnerFlag(false);
DB.users = [];
login('worker', 'Мастер');

// --- 1. generateDocNumber: формат, уникальность, инкремент, save ---
assert.eq(DB.settings.docCounter, 0, 'settings.docCounter стартует с 0');
const n1 = generateDocNumber();
const year = new Date().getFullYear();
assert(n1.indexOf(year + '-') === 0, 'номер начинается с года: ' + n1);
assert(/^\d{4}-[A-ZА-Я]{1,2}-\d{4}$/.test(n1), 'формат ГГГГ-Инициалы-0001: ' + n1);
assert(n1.indexOf('-М-') >= 0, 'инициалы из state.user (Мастер → М)');
assert(n1.indexOf('-0001') >= 0, 'первый номер = 0001');
assert.eq(DB.settings.docCounter, 1, 'счётчик инкрементирован');
assert.eq(JSON.parse(localStorage.getItem('crm2_db')).settings.docCounter, 1,
  'счётчик сохранён через save()');
const n2 = generateDocNumber();
assert(n2 !== n1 && n2.indexOf('-0002') >= 0, 'второй номер уникален: ' + n2);

// Инициалы из двух слов
login('admin', 'Пётр Сидоров');
const n3 = generateDocNumber();
assert(n3.indexOf('-ПС-') >= 0, 'инициалы из двух слов: ' + n3);
login('worker', 'Мастер');

// --- 2. getExecutorRequisites: три режима ---
const phys = getExecutorRequisites('phys');
assert.eq(phys.mode, 'phys', 'phys: режим');
assert(phys.title.indexOf('Иванов Иван Иванович') === 0, 'phys: ФИО из settings');
assert(phys.lines.join(' ').indexOf('+7 912 123-45-67') >= 0, 'phys: телефон');

const se = getExecutorRequisites('self_employed');
assert.eq(se.mode, 'self_employed', 'self_employed: режим');
assert(se.lines.join(' ').indexOf('123456789012') >= 0, 'self_employed: ИНН 12 знаков');
assert(se.lines.join(' ').indexOf('НПД') >= 0, 'self_employed: пометка о НПД');

const legal = getExecutorRequisites('legal');
assert.eq(legal.mode, 'legal', 'legal: режим');
assert(legal.title.indexOf('Окна-Сервис') >= 0, 'legal: наименование');
const legalAll = legal.lines.join(' ');
assert(legalAll.indexOf('1234567890') >= 0 && legalAll.indexOf('123456789') >= 0,
  'legal: ИНН и КПП');
assert(legalAll.indexOf('044525604') >= 0 && legalAll.indexOf('40702810') >= 0,
  'legal: БИК и р/с');
assert(legal.signName.indexOf('Иванов И.И.') === 0, 'legal: подписант — директор');

// режим по умолчанию из settings.executorMode
assert.eq(getExecutorRequisites().mode, 'phys', 'без аргумента — режим из settings');
DB.settings.executorMode = 'legal';
assert.eq(getExecutorRequisites().mode, 'legal', 'executorMode из settings учитывается');
DB.settings.executorMode = 'phys';

// --- 3. getClientRequisites: юрлицо vs физлицо ---
const oLegal = DB.orders.find(function (o) { return o.clientLegal; });
assert(oLegal, 'сид: заявка с clientLegal найдена');
const cReq = getClientRequisites(oLegal);
assert.eq(cReq.mode, 'legal', 'заказчик-юрлицо: режим legal');
assert(cReq.title.indexOf('ОкнаСервис') >= 0,
  'заказчик: наименование из заявки (согласовано с clientLegal)');
assert(cReq.lines.join(' ').indexOf('9876543210') >= 0, 'заказчик: ИНН/КПП из clientLegal');

const oPhys = DB.orders.find(function (o) { return o.worker === 'Мастер' && !o.clientLegal; });
const pReq = getClientRequisites(oPhys);
assert.eq(pReq.mode, 'phys', 'заказчик-физлицо: режим phys');
assert(pReq.lines.join(' ').indexOf('+7 912 345-67-89') >= 0, 'физлицо: телефон из заявки');

// --- 4. renderInvoice: все работы + только agreed доп. ---
const ord = {
  id: 500, client: 'Тестовый', phone: '+7 000', city: 'Екатеринбург', address: 'Мира, 1',
  works: [
    { title: 'Регулировка', qty: 2, price: 500, unit: 'шт', coeff: 1.5, done: true },
    { title: 'Откосы', qty: 1, price: 3000, unit: 'шт', skipped: true },
    { title: 'Уплотнитель', qty: 4, price: 200, unit: 'пог.м' }
  ],
  extras: [
    { name: 'Подоконник', qty: 1, price: 1500, status: 'agreed' },
    { name: 'Сетка', qty: 1, price: 700, status: 'pending_agree' },
    { name: 'Монтаж', qty: 1, price: 900, status: 'rejected' }
  ]
};
const inv = renderInvoice(ord);
assert(inv.indexOf('СМЕТА') >= 0, 'смета: заголовок');
assert(/№ \d{4}-[A-ZА-Я]{1,2}-\d{4} от \d{2}\.\d{2}\.\d{4}/.test(inv), 'смета: номер и дата');
assert(inv.indexOf('Регулировка') >= 0 && inv.indexOf('коэфф. 1.5') >= 0,
  'смета: работа с коэффициентом');
assert(inv.indexOf('Уплотнитель') >= 0, 'смета: обычная работа');
assert(inv.indexOf('Откосы') >= 0, 'смета: skipped показана');
assert(inv.indexOf('не входит в итог') >= 0, 'смета: skipped помечена и не в итоге');
assert(inv.indexOf('Подоконник') >= 0 && inv.indexOf('доп. работа') >= 0,
  'смета: agreed доп. работа включена');
assert(inv.indexOf('Сетка') < 0, 'смета: pending_agree НЕ включена');
assert(inv.indexOf('Монтаж') < 0, 'смета: rejected НЕ включена');
// Итого: 2*500*1.5 + 4*200 + 1500 = 1500 + 800 + 1500 = 3800
assert(inv.indexOf('Итого: 3 800') >= 0, 'смета: итог без skipped = 3 800');
assert(inv.indexOf('Исполнитель') >= 0 && inv.indexOf('Заказчик') >= 0, 'смета: подписи');
assert(inv.indexOf('Адрес объекта') >= 0 && inv.indexOf('Мира, 1') >= 0, 'смета: адрес объекта');
assert(inv.indexOf('<table') >= 0 && inv.indexOf('<th>Наименование</th>') >= 0,
  'смета: таблица работ');

// смета сохраняет номер в заявке и не генерирует новый при повторе
ord.docInvoiceNumber = generateDocNumber();
const invNumSaved = ord.docInvoiceNumber;
const inv2 = renderInvoice(ord);
assert(inv2.indexOf(invNumSaved) >= 0, 'смета: повторный рендер использует сохранённый номер');

// --- 5. renderAct: только done + agreed; skipped зачёркнута ---
const act = renderAct(ord);
assert(act.indexOf('АКТ ВЫПОЛНЕННЫХ РАБОТ') >= 0, 'акт: заголовок');
assert(act.indexOf('к Смете № ' + invNumSaved) >= 0, 'акт: ссылка на номер сметы');
assert(act.indexOf('Регулировка') >= 0, 'акт: done-работа включена');
assert(act.indexOf('Уплотнитель') < 0, 'акт: работа без done НЕ включена');
assert(act.indexOf('Откосы') >= 0 && act.indexOf('не выполнено') >= 0,
  'акт: skipped показана зачёркнутой с пометкой');
assert(act.indexOf('Подоконник') >= 0, 'акт: agreed доп. работа включена');
assert(act.indexOf('Сетка') < 0, 'акт: pending доп. НЕ включена');
assert(act.indexOf('Итого выполнено: 3 000') >= 0,
  'акт: итог = 1500 (done) + 1500 (agreed extra); skipped = 0');
assert(act.indexOf('class="dead"') >= 0, 'акт: строка skipped с классом dead');

// аванс/к оплате
ord.payments = [{ id: 1, sum: 1000, type: 'advance', method: 'cash', date: localToday() }];
const actPaid = renderAct(ord);
assert(actPaid.indexOf('Оплачено ранее: 1 000') >= 0, 'акт: блок аванса');
assert(actPaid.indexOf('К оплате: 2 000') >= 0, 'акт: к оплате = итог − аванс');
ord.payments = [];

// --- 6. printDocument: мок window.open + print() ---
printed = 0; writtenHtml = '';
assert(printDocument(inv) === true, 'printDocument: вернул true');
assert.eq(printed, 1, 'printDocument: window.print() вызван');
assert(writtenHtml.indexOf('СМЕТА') >= 0, 'printDocument: HTML записан в окно');
assert(writtenHtml.indexOf('<style>') >= 0, 'printDocument: стили для печати подключены');

// --- 7. shareDocument: clipboard-фолбэк (navigator.share нет) ---
copiedText = '';
assert.eq(shareDocument('Текст сметы'), 'clipboard', 'share: фолбэк в буфер обмена');
assert(copiedText === 'Текст сметы', 'share: текст передан в clipboard');

// --- 8. renderDocsTab + showDocPreview ---
const docsHtml = renderDocsTab(oLegal);
assert(docsHtml.indexOf('Документы') >= 0, 'docs tab: заголовок');
assert(docsHtml.indexOf('data-make-invoice="' + oLegal.id + '"') >= 0, 'docs tab: кнопка сметы');
assert(docsHtml.indexOf('data-make-act="' + oLegal.id + '"') >= 0, 'docs tab: кнопка акта');
assert(docsHtml.indexOf('ещё не формировались') >= 0, 'docs tab: пустое состояние');
oLegal.docInvoiceNumber = '2026-М-7777';
assert(renderDocsTab(oLegal).indexOf('2026-М-7777') >= 0,
  'docs tab: показывает выпущенные документы');

const counterBefore = DB.settings.docCounter;
showDocPreview('invoice', oLegal);
assert(modalStub.innerHTML.indexOf('Смета №') >= 0, 'preview: шапка модалки со сметой');
assert(modalStub.innerHTML.indexOf('data-print-doc') >= 0 &&
  modalStub.innerHTML.indexOf('data-share-doc') >= 0, 'preview: кнопки печати/шаринга');
assert(modalStub.innerHTML.indexOf('СМЕТА') >= 0, 'preview: превью документа внутри');
assert.eq(DB.settings.docCounter, counterBefore,
  'preview: повторный просмотр НЕ создаёт новый номер');

// генерация номера при первом выпуске (как в обработчике)
const fresh = { id: 501, client: 'Новый', works: [], extras: [] };
assert(!fresh.docInvoiceNumber, 'заявка без номера сметы');
fresh.docInvoiceNumber = generateDocNumber();
assert.eq(DB.settings.docCounter, counterBefore + 1, 'первый выпуск: счётчик +1');
closeModal();
