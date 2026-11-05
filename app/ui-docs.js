/* CRM2 :: app/ui-docs.js — генерация документов: смета и акт выполненных работ.
   Реквизиты исполнителя (физ/самозанятый/юрлицо) и заказчика, нумерация,
   печать через браузер, шаринг текста. Локально, без Firebase (Этап 8). */
'use strict';

// --- 1. Нумерация документов: ГГГГ-Инициалы-Номер ---

// Инициалы из имени пользователя: первые буквы первых двух слов ('Владелец' → 'В').
function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'CRM';
  return words.slice(0, 2).map(function (w) {
    return w.charAt(0).toUpperCase();
  }).join('');
}

// Генерация номера: инкрементирует DB.settings.docCounter и сохраняет базу.
function generateDocNumber() {
  const year = new Date().getFullYear();
  const counter = (Number(DB.settings.docCounter) || 0) + 1;
  DB.settings.docCounter = counter;
  save();
  const num = String(counter).padStart(4, '0');
  return year + '-' + initialsOf(state.user) + '-' + num;
}

// --- 2. Реквизиты исполнителя ---

function getExecutorRequisites(mode) {
  const s = DB.settings || {};
  const m = mode || s.executorMode || 'phys';
  if (m === 'legal') {
    const l = s.executorLegal || {};
    return {
      mode: 'legal',
      title: l.name || '',
      lines: [
        'ИНН ' + (l.inn || '—') + (l.kpp ? ' / КПП ' + l.kpp : ''),
        'Адрес: ' + (l.address || '—'),
        'Банк: ' + (l.bank || '—') + ', БИК ' + (l.bik || '—'),
        'Р/с: ' + (l.account || '—'),
        'Директор: ' + (l.director || '—'),
        'Тел.: ' + (l.phone || '—')
      ],
      signName: l.director || l.name || ''
    };
  }
  if (m === 'self_employed') {
    const e = s.executorSelfEmployed || {};
    return {
      mode: 'self_employed',
      title: e.name || '',
      lines: [
        'ИНН ' + (e.inn || '—'),
        'Статус: плательщик НПД (самозанятый)',
        'Тел.: ' + (e.phone || '—')
      ],
      signName: e.name || ''
    };
  }
  const p = s.executorPhys || {};
  return {
    mode: 'phys',
    title: p.name || '',
    lines: ['Паспорт: гражданина РФ', 'Тел.: ' + (p.phone || '—')],
    signName: p.name || ''
  };
}

// --- 3. Реквизиты заказчика из заявки ---

function getClientRequisites(o) {
  if (!o) return { mode: 'phys', title: '', lines: [], signName: '' };
  if (o.clientLegal && o.clientLegal.name) {
    const c = o.clientLegal;
    return {
      mode: 'legal',
      title: o.client,
      lines: [
        'ИНН ' + (c.inn || '—') + (c.kpp ? ' / КПП ' + c.kpp : ''),
        'Тел.: ' + (c.phone || o.phone || '—')
      ],
      signName: c.director || o.client || c.name
    };
  }
  return {
    mode: 'phys',
    title: o.client || '',
    lines: [
      'Тел.: ' + (o.phone || '—'),
      'Адрес: ' + ([o.city, o.address].filter(Boolean).join(', ') || '—')
    ],
    signName: o.client || ''
  };
}

// --- Общие блоки документа ---

function todayRu() {
  const d = new Date();
  const p = function (n) { return n < 10 ? '0' + n : '' + n; };
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

// Строки таблицы работ/доп. работ. onlyDone (акт) — только done + agreed extras;
// skipped показываются зачёркнутыми и НЕ входят в итог (как в calculateEstimateTotal).
function docWorkRows(o, onlyDone) {
  const rows = [];
  let n = 0;
  (o.works || []).forEach(function (w) {
    if (w.skipped) {
      rows.push({ n: ++n, name: w.name || w.title, unit: w.unit || 'шт', qty: w.qty,
        price: w.price, sum: 0, dead: true, note: onlyDone ? 'не выполнено' : 'не входит в итог' });
      return;
    }
    if (onlyDone && !w.done) return;
    const coeff = Number(w.coeff) || 1;
    const sum = (Number(w.qty) || 0) * (Number(w.price) || 0) * coeff;
    rows.push({ n: ++n, name: (w.name || w.title) + (coeff !== 1 ? ' (коэфф. ' + coeff + ')' : ''),
      unit: w.unit || 'шт', qty: w.qty, price: w.price, sum: sum, dead: false, note: '' });
  });
  (o.extras || []).forEach(function (e) {
    if (e.status !== 'agreed') return;
    rows.push({ n: ++n, name: e.name + ' (доп. работа)', unit: e.unit || 'шт',
      qty: e.qty, price: e.price, sum: (Number(e.qty) || 0) * (Number(e.price) || 0),
      dead: false, note: '' });
  });
  return rows;
}

function docTable(rows) {
  const body = rows.map(function (r) {
    const cls = r.dead ? ' class="dead"' : '';
    return '<tr' + cls + '><td>' + r.n + '</td><td>' + escapeHtml(r.name) +
      (r.note ? ' <i>— ' + escapeHtml(r.note) + '</i>' : '') + '</td>' +
      '<td>' + escapeHtml(r.unit) + '</td><td>' + (r.qty || 0) + '</td>' +
      '<td>' + money(r.price) + '</td><td>' + money(r.sum) + '</td></tr>';
  }).join('');
  return '<table class="doc-table"><thead><tr>' +
    '<th>№</th><th>Наименование</th><th>Ед.</th><th>Кол.</th><th>Цена</th><th>Сумма</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>';
}

function docParty(title, req) {
  return '<div class="party"><b>' + title + ':</b> ' + escapeHtml(req.title) +
    (req.lines || []).map(function (l) {
      return '<div class="small">' + escapeHtml(l) + '</div>';
    }).join('') + '</div>';
}

function docSignatures(executor, client) {
  return '<div class="signs">' +
    '<div>Исполнитель: ' + escapeHtml(executor.signName) + ' ____________ /подпись/</div>' +
    '<div>Заказчик: ' + escapeHtml(client.signName) + ' ____________ /подпись/</div>' +
  '</div>';
}

// Платежи заявки: сумма всех payments (аванс и т.п.).
function paidSum(o) {
  return (o.payments || []).reduce(function (s, p) { return s + (Number(p.sum) || 0); }, 0);
}

// CSS для печати: светлая тема, таблицы, поля подписей.
const DOC_CSS =
  'body{font:14px/1.5 "Times New Roman",serif;color:#000;margin:24px}' +
  'h1{font-size:18px;text-align:center;margin:0 0 4px}' +
  '.doc-date{text-align:center;margin-bottom:16px}' +
  '.parties{display:flex;gap:24px;margin-bottom:16px}' +
  '.party{flex:1;border:1px solid #999;padding:8px;font-size:12px}' +
  '.small{font-size:12px}' +
  '.doc-table{width:100%;border-collapse:collapse;margin:8px 0}' +
  '.doc-table th,.doc-table td{border:1px solid #333;padding:4px 6px;font-size:12px;text-align:left}' +
  '.doc-table tr.dead td{color:#a00;text-decoration:line-through}' +
  '.doc-total{text-align:right;font-weight:700;margin:8px 0}' +
  '.pay-line{margin:4px 0}' +
  '.signs{display:flex;gap:24px;margin-top:32px;font-size:12px}' +
  '.signs div{flex:1}';

function docShell(title, number, inner) {
  return '<div class="doc-body"><h1>' + title + '</h1>' +
    '<div class="doc-date">№ ' + escapeHtml(number) + ' от ' + todayRu() + '</div>' +
    inner + '</div>';
}

// --- 4. Смета ---

function renderInvoice(o) {
  if (!o) return '<p class="muted">Нет данных заявки.</p>';
  const num = o.docInvoiceNumber || generateDocNumber();
  const exec = getExecutorRequisites();
  const client = getClientRequisites(o);
  const rows = docWorkRows(o, false);
  const total = rows.reduce(function (s, r) { return s + r.sum; }, 0);

  return docShell('СМЕТА', num,
    '<div class="parties">' +
      docParty('Исполнитель', exec) +
      docParty('Заказчик', client) +
    '</div>' +
    '<div class="small"><b>Адрес объекта:</b> ' +
      escapeHtml([o.city, o.address].filter(Boolean).join(', ') || '—') + '</div>' +
    docTable(rows) +
    '<div class="doc-total">Итого: ' + money(total) + '</div>' +
    docSignatures(exec, client));
}

// --- 5. Акт выполненных работ ---

function renderAct(o) {
  if (!o) return '<p class="muted">Нет данных заявки.</p>';
  const actNum = o.docActNumber || generateDocNumber();
  const invoiceNum = o.docInvoiceNumber || '—';
  const exec = getExecutorRequisites();
  const client = getClientRequisites(o);
  const rows = docWorkRows(o, true);
  const total = rows.reduce(function (s, r) { return s + r.sum; }, 0);
  const paid = paidSum(o);

  const payBlock = paid > 0
    ? '<div class="pay-line">Оплачено ранее: ' + money(paid) + '</div>' +
      '<div class="pay-line"><b>К оплате: ' + money(Math.max(0, total - paid)) + '</b></div>'
    : '';

  return docShell('АКТ ВЫПОЛНЕННЫХ РАБОТ', actNum,
    '<div class="doc-date">к Смете № ' + escapeHtml(invoiceNum) + '</div>' +
    '<div class="parties">' +
      docParty('Исполнитель', exec) +
      docParty('Заказчик', client) +
    '</div>' +
    '<div class="small"><b>Адрес объекта:</b> ' +
      escapeHtml([o.city, o.address].filter(Boolean).join(', ') || '—') + '</div>' +
    '<p class="small">Работы выполнены в соответствии со сметой. Заказчик претензий по объёму, ' +
      'качеству и срокам не имеет.</p>' +
    docTable(rows) +
    '<div class="doc-total">Итого выполнено: ' + money(total) + '</div>' +
    payBlock +
    docSignatures(exec, client));
}

// --- 6. Печать: новое окно + window.print() ---

function printDocument(html) {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { toast('Разрешите всплывающие окна для печати', true); return false; }
  w.document.write(
    '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    '<title>Документ</title><style>' + DOC_CSS + '</style></head><body>' +
    html + '</body></html>'
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}

// Текст документа для шаринга (плоский вид).
function docToPlainText(title, number, o, rows) {
  const exec = getExecutorRequisites();
  const client = getClientRequisites(o);
  const lines = [title + ' № ' + number + ' от ' + todayRu(),
    'Исполнитель: ' + exec.title,
    'Заказчик: ' + client.title,
    'Объект: ' + [o.city, o.address].filter(Boolean).join(', '), ''];
  rows.forEach(function (r) {
    lines.push(r.n + '. ' + r.name + ' — ' + (r.qty || 0) + ' ' + r.unit +
      ' x ' + money(r.price) + ' = ' + money(r.sum));
  });
  lines.push('', 'Итого: ' + money(rows.reduce(function (s, r) { return s + r.sum; }, 0)));
  return lines.join('\n');
}

// --- 7. Шаринг: navigator.share() → фолбэк в буфер обмена ---

function shareDocument(text) {
  if (navigator.share) {
    navigator.share({ title: 'CRM2: документ', text: text }).catch(function () {});
    return 'share';
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast('Скопировано в буфер'); });
    return 'clipboard';
  }
  toast('Шаринг недоступен', true);
  return 'none';
}

// --- 8. Вкладка «Документы» в карточке заявки ---

function renderDocsTab(o) {
  if (!o) return '<p class="muted">Нет данных заявки.</p>';
  const saved = [];
  if (o.docInvoiceNumber) saved.push('Смета № ' + escapeHtml(o.docInvoiceNumber));
  if (o.docActNumber) saved.push('Акт № ' + escapeHtml(o.docActNumber));

  return '<div class="card">' +
      '<h4>Документы</h4>' +
      (saved.length
        ? '<p class="small muted">Уже выпущены: ' + saved.join(' · ') + '</p>'
        : '<p class="small muted">Документы ещё не формировались.</p>') +
      '<div class="row">' +
        '<button class="btn" data-make-invoice="' + o.id + '" style="flex:1">📄 Смета</button>' +
        '<button class="btn" data-make-act="' + o.id + '" style="flex:1">📄 Акт</button>' +
      '</div>' +
    '</div>';
}

// Открытие превью в модалке с кнопками печати/шаринга.
function showDocPreview(kind, o) {
  const html = kind === 'act' ? renderAct(o) : renderInvoice(o);
  const number = kind === 'act' ? o.docActNumber : o.docInvoiceNumber;
  window.__docPreview = { kind: kind, orderId: o.id };
  showModal(
    '<div class="row spread"><h3>' + (kind === 'act' ? 'Акт' : 'Смета') +
      ' № ' + escapeHtml(number || '—') + '</h3>' +
      '<button class="btn" data-close>✕</button></div>' +
    '<div id="doc-preview">' + html + '</div>' +
    '<div class="row" style="margin-top:10px">' +
      '<button class="btn btn-primary" data-print-doc style="flex:1">🖨 Печать</button>' +
      '<button class="btn" data-share-doc style="flex:1">📤 Поделиться</button>' +
    '</div>'
  );
}

// --- Делегирование событий документов ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };
  const orderOf = function (attr, node) {
    const id = Number(node.getAttribute(attr));
    return (DB.orders || []).find(function (x) { return x.id === id; });
  };

  const invBtn = sel('[data-make-invoice]');
  if (invBtn) {
    const o = orderOf('data-make-invoice', invBtn);
    if (!o) return;
    if (!o.docInvoiceNumber) { o.docInvoiceNumber = generateDocNumber(); saveOrderLocal(o); }
    showDocPreview('invoice', o);
    return;
  }

  const actBtn = sel('[data-make-act]');
  if (actBtn) {
    const o = orderOf('data-make-act', actBtn);
    if (!o) return;
    if (!o.docActNumber) { o.docActNumber = generateDocNumber(); saveOrderLocal(o); }
    showDocPreview('act', o);
    return;
  }

  const printBtn = sel('[data-print-doc]');
  if (printBtn) {
    const ctx = window.__docPreview;
    if (!ctx) return;
    const o = (DB.orders || []).find(function (x) { return x.id === ctx.orderId; });
    if (!o) return;
    const host = document.getElementById('doc-preview');
    printDocument(host ? host.innerHTML : '');
    return;
  }

  const shareBtn = sel('[data-share-doc]');
  if (shareBtn) {
    const ctx = window.__docPreview;
    if (!ctx) return;
    const o = (DB.orders || []).find(function (x) { return x.id === ctx.orderId; });
    if (!o) return;
    const isAct = ctx.kind === 'act';
    const text = docToPlainText(isAct ? 'АКТ' : 'СМЕТА',
      isAct ? o.docActNumber : o.docInvoiceNumber, o, docWorkRows(o, isAct));
    shareDocument(text);
    return;
  }
});
