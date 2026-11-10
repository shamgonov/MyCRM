/* CRM2 :: app/ui-money.js — вкладка «Деньги» (Этап 12) и доля исполнителя (Этап 13).
   База суммы — calculateOrderTotal (orders.js, единая для сметы/документов/отчётов).
   Видимость денег: money_view (Q6 — исполнитель и менеджер).
   Зависит от db.js, auth.js, gates.js, orders.js, core.js (showModal/toast/render). */
'use strict';

const PAY_METHODS = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод'
};

// Деньги видно по праву money_view либо назначенному исполнителю (Q6).
function canSeeMoney(o) {
  if (!o) return false;
  if (can('money_view')) return true;
  return o.worker === state.user;
}

// Право вводить оплаты: money_edit (владелец/оператор) либо исполнитель своей заявки.
function canEditMoney(o) {
  if (!o) return false;
  if (can('money_edit')) return true;
  return o.worker === state.user;
}

const MGRID = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;';
function mrow(cells, head) {
  return '<div style="' + MGRID + (head ? 'font-weight:700;color:var(--muted);' : '') + '">' +
    cells.map(function (c) { return '<div>' + c + '</div>'; }).join('') + '</div>';
}

function payMethodLabel(m) {
  return PAY_METHODS[m] || (m || '—');
}

// --- 1. Вкладка «Деньги» ---

function renderMoneyTab(o) {
  if (!o) return '<p class="muted">Нет данных заявки.</p>';
  if (!canSeeMoney(o)) {
    return '<div class="card"><p class="muted">Нет доступа к деньгам заявки.</p></div>';
  }

  const revenue = orderRevenue(o);
  const paid = orderPaid(o);
  const balance = orderBalance(o);
  const editable = canEditMoney(o);

  const sumRow = function (label, value, cls) {
    return '<div class="est-row"><span>' + label + '</span>' +
      '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + money(value) + '</span></div>';
  };

  const rows = (o.payments || []).map(function (p) {
    return mrow([
      escapeHtml(p.date || '') + ' · ' + payMethodLabel(p.method),
      money(p.sum) + (p.note ? ' <span class="muted small">' + escapeHtml(p.note) + '</span>' : ''),
      editable
        ? '<button class="btn btn-danger" data-del-payment="' + p.id + '">✕</button>'
        : ''
    ]);
  });

  const table = (o.payments && o.payments.length)
    ? mrow(['Дата / способ', 'Сумма', ''], true) + rows.join('')
    : '<p class="muted">Оплат пока нет.</p>';

  // Доля исполнителя (Этап 13): видно исполнителю и тому, кто видит деньги.
  const rewardBlock = renderRewardBlock(o, editable);

  return '<div class="card info-block">' +
      '<h4>Расчёты по заявке</h4>' +
      sumRow('К оплате', revenue) +
      sumRow('Оплачено', paid) +
      '<div class="est-total"><span>' + (balance > 0 ? 'Остаток к оплате' : 'Итог') + '</span>' +
        '<span class="' + (balance > 0 ? 'badge badge-warn' : 'badge badge-ok') + '">' +
        money(balance) + '</span></div>' +
      (balance > 0 && o.status === 'completed'
        ? '<p class="small" style="color:var(--warn)">Заявка завершена, остаток не внесён.</p>' : '') +
    '</div>' +
    '<div class="card info-block">' +
      '<h4>Оплаты</h4>' + table +
      (editable
        ? '<button class="btn btn-primary" data-add-payment style="margin-top:10px">＋ Платёж</button>'
        : '') +
    '</div>' +
    rewardBlock;
}

// --- 2. Доля исполнителя (Этап 13) ---

function renderRewardBlock(o, editable) {
  const pct = orderRewardPct(o);
  const reward = orderReward(o);
  const pctInput = editable
    ? '<label class="field"><span>Доля исполнителя, %</span>' +
        '<input id="mw-reward-pct" type="number" min="0" max="100" step="0.5" value="' + pct + '"></label>' +
      '<button class="btn" data-save-reward-pct="' + o.id + '">Сохранить %</button>'
    : '';
  return '<div class="card info-block">' +
      '<h4>Доля исполнителя</h4>' +
      '<div class="est-row"><span>Ставка</span><span>' + pct + ' %</span></div>' +
      '<div class="est-total"><span>На карточку</span><span>' + money(reward) + '</span></div>' +
      '<p class="small muted">Вычитается из прибыли в отчётах (расход на оплату труда).</p>' +
      pctInput +
    '</div>';
}

// --- 3. Модалка платежа ---

function renderPaymentModal(o) {
  const methods = Object.keys(PAY_METHODS).map(function (k) {
    return '<option value="' + k + '">' + PAY_METHODS[k] + '</option>';
  }).join('');
  showModal(
    '<h3>Платёж по заявке №' + o.id + '</h3>' +
    '<p class="muted small">Остаток к оплате: ' + money(orderBalance(o)) + '</p>' +
    '<label class="field"><span>Сумма *</span>' +
      '<input id="pay-sum" type="number" min="1" step="1" value="' + Math.max(orderBalance(o), 0) + '"></label>' +
    '<label class="field"><span>Дата</span><input id="pay-date" type="date" value="' + localToday() + '"></label>' +
    '<label class="field"><span>Способ</span><select id="pay-method">' + methods + '</select></label>' +
    '<label class="field"><span>Комментарий</span><input id="pay-note" type="text"></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-payment="' + o.id + '" style="flex:1">Добавить</button>' +
    '</div>'
  );
}

// --- 4. Модалка «остаток при завершении» (напоминалка об оплате) ---

function showBalanceReminderModal(o) {
  window.__moneyReminder = { orderId: o.id };
  showModal(
    '<h3>Завершение заявки №' + o.id + '</h3>' +
    '<p>Остаток к оплате: <b>' + money(orderBalance(o)) + '</b></p>' +
    '<label class="row"><input type="checkbox" id="pay-remind" checked> ' +
      '<span>Напомнить об оплате</span></label>' +
    '<div class="row" style="margin-top:10px">' +
      '<button class="btn" data-remind-skip style="flex:1">Без напоминания</button>' +
      '<button class="btn btn-primary" data-remind-on style="flex:1">Напомнить</button>' +
    '</div>'
  );
}

// --- 5. Делегирование ---

document.addEventListener('click', function (ev) {
  if (!ev.target.closest) return;
  const sel = function (s) { return ev.target.closest(s); };

  const addBtn = sel('[data-add-payment]');
  if (addBtn) {
    const o = findMoneyOrderFromScreen();
    if (o && canEditMoney(o)) renderPaymentModal(o);
    else toast('Нет права вводить оплаты', true);
    return;
  }

  const saveBtn = sel('[data-save-payment]');
  if (saveBtn) {
    const o = (DB.orders || []).find(function (x) {
      return x.id === Number(saveBtn.getAttribute('data-save-payment'));
    });
    if (!o || !canEditMoney(o)) { toast('Нет права вводить оплаты', true); return; }
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const pay = addPayment(o, {
      sum: Number(val('pay-sum')),
      date: val('pay-date') || localToday(),
      method: val('pay-method') || 'cash',
      note: val('pay-note')
    });
    if (!pay) { toast('Укажите корректную сумму', true); return; }
    closeModal();
    toast('Платёж добавлен: ' + money(pay.sum));
    render();
    return;
  }

  const delBtn = sel('[data-del-payment]');
  if (delBtn) {
    const o = findMoneyOrderFromScreen();
    if (!o || !canEditMoney(o)) { toast('Нет права удалять оплаты', true); return; }
    if (!confirm('Удалить этот платёж?')) return;
    removePayment(o, Number(delBtn.getAttribute('data-del-payment')));
    toast('Платёж удалён');
    render();
    return;
  }

  const pctBtn = sel('[data-save-reward-pct]');
  if (pctBtn) {
    const o = (DB.orders || []).find(function (x) {
      return x.id === Number(pctBtn.getAttribute('data-save-reward-pct'));
    });
    if (!o || !canEditMoney(o)) { toast('Нет права менять долю', true); return; }
    const el = document.getElementById('mw-reward-pct');
    const pct = el ? Number(el.value) : NaN;
    if (!isFinite(pct) || pct < 0 || pct > 100) { toast('Процент от 0 до 100', true); return; }
    o.rewardPct = pct;
    saveOrderLocal(o);
    toast('Доля: ' + pct + ' %');
    render();
    return;
  }

  const remindOn = sel('[data-remind-on]');
  if (remindOn) { finishCompletionWithReminder(true); return; }

  const remindSkip = sel('[data-remind-skip]');
  if (remindSkip) { finishCompletionWithReminder(false); return; }
});

// Заявка текущего экрана «Деньги» (для кнопок без data-id).
function findMoneyOrderFromScreen() {
  if (state.screen !== 'order') return null;
  return (DB.orders || []).find(function (x) { return x.id === state.orderId; }) || null;
}

// Завершение модалки напоминания: ставим/снимаем o.moneyReminderAt и закрываем.
function finishCompletionWithReminder(withReminder) {
  const ctx = window.__moneyReminder;
  if (!ctx) { closeModal(); return; }
  const o = (DB.orders || []).find(function (x) { return x.id === ctx.orderId; });
  if (o) {
    o.moneyReminderAt = withReminder ? Date.now() : null;
    normalizeOrder(o);
    o.history.push({
      ts: Date.now(), by: state.user, action: 'money',
      details: withReminder ? 'Напоминание об оплате установлено' : 'Напоминание об оплате снято'
    });
    saveOrderLocal(o);
  }
  window.__moneyReminder = null;
  closeModal();
  render();
}

window.canSeeMoney = canSeeMoney;
window.canEditMoney = canEditMoney;
window.renderMoneyTab = renderMoneyTab;
window.renderPaymentModal = renderPaymentModal;
window.showBalanceReminderModal = showBalanceReminderModal;
