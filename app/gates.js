/* CRM2 :: app/gates.js — единый центр контроля доступа к заявкам.
   Все проверки прав — только здесь. Зависит от auth.js (can, state). */
'use strict';

// Я назначен на заявку: основной исполнитель ИЛИ соисполнитель (правило SPEC 8).
// Соисполнитель считается назначенным, пока он не отказался: 'pending' тоже даёт
// доступ — иначе человек не увидит заявку и не сможет нажать «Принять».
function isAssignedToMe(o) {
  if (!o) return false;
  if (o.worker === state.user) return true;
  if (!Array.isArray(o.helpers) || o.helpers.indexOf(state.user) < 0) return false;
  const c = (o.confirm && o.confirm[state.user]) || 'pending';
  return c !== 'no';
}

// Просмотр: право на все заявки, либо «мои», либо свободные из пула.
// Пул открыт всем сотрудникам без исключений — иначе кнопка «Взять» была бы
// недостижима для исполнителя (он ещё не назначен, но заявку видеть обязан).
function canViewOrder(o) {
  if (!o) return false;
  return can('orders_view_all') || isAssignedToMe(o) || isPoolOrder(o);
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

// Видимость заявки в пуле: нет worker, подходящий статус, не моя.
// canViewOrder вызывает это автоматически — но функция нужна и для фильтра.
function isPoolOrder(o) {
  if (!o) return false;
  if (o.worker) return false;
  return o.status === 'new' || o.status === 'inspection' || o.status === 'approved';
}

// Список свободных заявок для пула: нет worker, статус new/inspection/approved,
// не скрыт из-за участия пользователя. Видит все такие заявки (участники пула не
// обязаны иметь orders_view_all — пул это публичный ресурс).
function getPoolOrders() {
  return (DB.orders || []).filter(function (o) {
    if (!isPoolOrder(o)) return false;
    return !hiddenTakeFromMe(o);
  });
}
