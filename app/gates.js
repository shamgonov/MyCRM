/* CRM2 :: app/gates.js — единый центр контроля доступа к заявкам.
   Все проверки прав — только здесь. Зависит от auth.js (can, state). */
'use strict';

// Я назначен на заявку: основной исполнитель ИЛИ соисполнитель (правило SPEC 8).
function isAssignedToMe(o) {
  if (!o) return false;
  if (o.worker === state.user) return true;
  return Array.isArray(o.helpers) && o.helpers.indexOf(state.user) >= 0;
}

// Просмотр: все заявки по праву либо только «мои».
function canViewOrder(o) {
  if (!o) return false;
  return can('orders_view_all') || isAssignedToMe(o);
}

// Редактирование: по праву, либо исполнитель, пока заявка не закрыта деньгами.
function canEditOrder(o) {
  if (!o) return false;
  if (can('orders_edit')) return true;
  if (!isAssignedToMe(o)) return false;
  return o.status !== 'completed' && o.status !== 'paid';
}

// Взять в работу можно новую, осмотр или согласованную (исполнитель ещё не назначен).
function canTakeOrder(o) {
  if (!o) return false;
  if (o.worker) return false;
  return o.status === 'new' || o.status === 'inspection' || o.status === 'approved';
}

// Кнопка «Взять» видна, если можно взять и я ещё не приписан к заявке.
function showTakeBtn(o) {
  if (!o) return false;
  return canTakeOrder(o) && !isAssignedToMe(o) && !o.worker;
}

// Скрыть заявку из «пула свободных», если я уже в ней участвую (правило SPEC 7).
function hiddenTakeFromMe(o) {
  if (!o) return false;
  return isAssignedToMe(o);
}
