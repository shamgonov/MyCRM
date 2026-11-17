/* Смоук app/ui-tasks.js (Этап 20): CRUD задач, фильтрация, делегирование,
   привязка к заявке, блок в карточке. */
'use strict';

globalThis.localStorage = (function () {
  var m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();
var appStub = { innerHTML: '' };
var navStub = { innerHTML: '' };
var modalStub = { innerHTML: '' };
var FIELDS = {};
var clickHandlers = [];
globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn) { if (type === 'click') clickHandlers.push(fn); }
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
loadModule('app/ui-tasks.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

// --- 1. normalizeTask ---
var bare = {};
normalizeTask(bare);
assert('id' in bare, 'normalizeTask: id задан');
assert('title' in bare, 'normalizeTask: title задан');
assert('note' in bare, 'normalizeTask: note задан');
assert('done' in bare, 'normalizeTask: done задан');
assert('createdAt' in bare, 'normalizeTask: createdAt задан');
assert('dueDate' in bare, 'normalizeTask: dueDate задан');
assert('orderId' in bare, 'normalizeTask: orderId задан');
assert.eq(bare.orderId, null, 'normalizeTask: orderId = null');
assert.eq(bare.done, false, 'normalizeTask: done = false');

// --- 2. addTask ---
var t1 = addTask({ title: 'Задача 1', note: 'Заметка', dueDate: '2025-01-01', orderId: 1 });
assert(t1, 'addTask: возвращает задачу');
assert.eq(t1.title, 'Задача 1', 'addTask: title');
assert.eq(t1.note, 'Заметка', 'addTask: note');
assert.eq(t1.dueDate, '2025-01-01', 'addTask: dueDate');
assert.eq(t1.orderId, 1, 'addTask: orderId');
assert.eq(t1.done, false, 'addTask: done = false');
assert('id' in t1, 'addTask: id задан');
assert('createdAt' in t1, 'addTask: createdAt задан');

// Задача без привязки
var t2 = addTask({ title: 'Личная задача' });
assert.eq(t2.orderId, null, 'addTask: личная задача, orderId = null');
assert('id' in t2, 'addTask: id задан для личной задачи');

// Пустой заголовок — допускается (долг, но не null).
var t3 = addTask({ title: '' });
assert.eq(t3.title, '', 'addTask: пустой заголовок');

// --- 3. toggleTask ---
assert.eq(t1.done, false, 'toggleTask: до toggle done=false');
toggleTask(t1.id);
var t1t = findTask(t1.id);
assert.eq(t1t.done, true, 'toggleTask: после toggle done=true');
toggleTask(t1.id);
var t1t2 = findTask(t1.id);
assert.eq(t1t2.done, false, 'toggleTask: повторный toggle обратно=false');

// Toggle несуществующей
var res = toggleTask('nonexistent');
assert.eq(res, null, 'toggleTask: несуществующая → null');

// --- 4. deleteTask ---
assert.eq((DB.tasks || []).length, 3, 'deleteTask: до удаления 3 задачи');
var delRes = deleteTask(t3.id);
assert.eq(delRes, true, 'deleteTask: возврат true');
assert.eq(deleteTask(t3.id), false, 'deleteTask: повторный → false');
assert.eq((DB.tasks || []).length, 2, 'deleteTask: после удаления 2 задачи');
assert.eq(findTask(t3.id), null, 'deleteTask: удалённая не найдена');

// --- 5. tasksForOrder ---
var tasks1 = tasksForOrder(1);
assert.eq(tasks1.length, 1, 'tasksForOrder(1): 1 задача');
assert.eq(tasks1[0].id, t1.id, 'tasksForOrder: правильная задача');
var tasks0 = tasksForOrder(999);
assert.eq(tasks0.length, 0, 'tasksForOrder(999): пусто');

// --- 6. tasksByFilter ---
// Сброс: добавляем задачи для фильтрации
deleteTask(t1.id);
deleteTask(t2.id);
DB.tasks = [];
var d = localToday();
var yesterday = (function () {
  var p = d.split('-');
  var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) - 1);
  return p[0] + '-' + (dt.getMonth() + 1 < 10 ? '0' + (dt.getMonth() + 1) : (dt.getMonth() + 1)) + '-' + (dt.getDate() < 10 ? '0' + dt.getDate() : dt.getDate());
})();
var tomorrow = (function () {
  var p = d.split('-');
  var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + 1);
  return p[0] + '-' + (dt.getMonth() + 1 < 10 ? '0' + (dt.getMonth() + 1) : (dt.getMonth() + 1)) + '-' + (dt.getDate() < 10 ? '0' + dt.getDate() : dt.getDate());
})();

addTask({ title: 'Сегодня', dueDate: d });
addTask({ title: 'Завтра', dueDate: tomorrow });
addTask({ title: 'Вчера', dueDate: yesterday });
addTask({ title: 'Без даты' });
// addTask всегда создаёт активную задачу (done:false) — выполненную делаем toggle'ом.
var doneTask = addTask({ title: 'Выполненная' });
toggleTask(doneTask.id);
addTask({ title: 'К заявке', orderId: 1 });

var allFiltered = tasksByFilter('all');
assert(allFiltered.length >= 5, 'tasksByFilter(all): ≥5 задач');
var todayFiltered = tasksByFilter('today');
assert.eq(todayFiltered.length, 1, 'tasksByFilter(today): 1 задача на сегодня');
var doneFiltered = tasksByFilter('done');
assert.eq(doneFiltered.length, 1, 'tasksByFilter(done): 1 выполненная');
var orderFiltered = tasksByFilter('order');
assert.eq(orderFiltered.length, 1, 'tasksByFilter(order): 1 привязанная');

// --- 7. updateTask ---
var uTask = addTask({ title: 'Старое название', note: 'старое', dueDate: '2025-01-01', orderId: 5 });
var updated = updateTask(uTask.id, { title: 'Новое название', note: 'новое', dueDate: '2025-06-01', orderId: 10 });
assert.eq(updated.title, 'Новое название', 'updateTask: title обновлён');
assert.eq(updated.note, 'новое', 'updateTask: note обновлён');
assert.eq(updated.dueDate, '2025-06-01', 'updateTask: dueDate обновлён');
assert.eq(updated.orderId, 10, 'updateTask: orderId обновлён');

// --- 8. renderTasks ---
var html = renderTasks();
assert(html.indexOf('📝 Органайзер') >= 0, 'renderTasks: заголовок');
assert(html.indexOf('＋ Новая задача') >= 0, 'renderTasks: кнопка');
assert(html.indexOf('data-new-task') >= 0, 'renderTasks: data-new-task');
assert(html.indexOf('data-task-filter') >= 0, 'renderTasks: фильтры');
assert(html.indexOf('data-toggle-task') >= 0, 'renderTasks: чекбоксы');
assert(html.indexOf('data-del-task') >= 0, 'renderTasks: кнопки удаления');

// --- 9. renderTaskModal ---
renderTaskModal(null);
assert(modalStub.innerHTML.indexOf('＋ Новая задача') >= 0, 'renderTaskModal(null): заголовок');
assert(modalStub.innerHTML.indexOf('tk-title') >= 0, 'renderTaskModal: tk-title');
assert(modalStub.innerHTML.indexOf('tk-note') >= 0, 'renderTaskModal: tk-note');
assert(modalStub.innerHTML.indexOf('tk-due') >= 0, 'renderTaskModal: tk-due');
assert(modalStub.innerHTML.indexOf('tk-order') >= 0, 'renderTaskModal: tk-order');
modalStub.innerHTML = '';

// --- 10. renderOrderTasksBlock ---
var orderMock = { id: 1, client: 'Тест', status: 'new', worker: '', helpers: [],
  materials: [], works: [], extras: [], history: [], payments: [] };
var blockHtml = renderOrderTasksBlock(orderMock);
assert(blockHtml.indexOf('Задачи заявки') >= 0, 'renderOrderTasksBlock: заголовок');
assert(blockHtml.indexOf('data-task-add-order') >= 0, 'renderOrderTasksBlock: кнопка');
// После добавления задачи к заявке — строки в блоке
addTask({ title: 'Блок задача', orderId: 1 });
var blockHtml2 = renderOrderTasksBlock(orderMock);
assert(blockHtml2.indexOf('Блок задача') >= 0, 'renderOrderTasksBlock: задача в блоке');
assert(blockHtml2.indexOf('data-toggle-task') >= 0, 'renderOrderTasksBlock: чекбокс в блоке');

// --- 11. делегирование: filter, new, toggle, delete ---
// Переиспользуем clickHandlers (уже заполнены через addEventListener в модулях).
// Проверка: filter-чип
var filterFound = false;
clickHandlers.forEach(function (fn) {
  var node = {
    getAttribute: function (a) { return a === 'data-task-filter' ? 'today' : null; },
    value: ''
  };
  var ev = { target: { closest: function (s) { return s === '[data-task-filter]' ? node : null; } } };
  fn(ev);
});
assert.eq(TASK_FILTER, 'today', 'delegate: filter Today');

// --- 11.5 Этап 31: reminderTime + notify ---

// normalizeTask доводит новые поля до безопасных значений.
var nt = normalizeTask({ title: 'x' });
assert.eq(nt.reminderTime, '', 'Э31: normalizeTask → reminderTime = ""');
assert.eq(nt.notify, false, 'Э31: normalizeTask → notify = false');

// addTask сохраняет переданные поля напоминания.
var tRem = addTask({ title: 'Напомнить', dueDate: '2026-05-05',
  reminderTime: '14:30', notify: true });
assert.eq(tRem.reminderTime, '14:30', 'Э31: addTask → reminderTime');
assert.eq(tRem.notify, true, 'Э31: addTask → notify=true');

// renderTaskRow показывает 🔔 и время только при notify && reminderTime.
var rowHtml = renderTaskRow(tRem);
assert(rowHtml.indexOf('🔔') >= 0, 'Э31: строка — иконка 🔔');
assert(rowHtml.indexOf('14:30') >= 0, 'Э31: строка — время напоминания');
var rowPlain = renderTaskRow(addTask({ title: 'Без напоминания' }));
assert(rowPlain.indexOf('🔔') < 0, 'Э31: без notify — нет 🔔');
// notify есть, времени нет — иконку не показываем (нечего показывать).
var rowNoTime = renderTaskRow(addTask({ title: 'Время пусто', notify: true }));
assert(rowNoTime.indexOf('🔔') < 0, 'Э31: notify без времени — нет 🔔');

// Модалка содержит новые поля.
renderTaskModal(tRem);
assert(modalStub.innerHTML.indexOf('tk-time') >= 0, 'Э31: модалка — tk-time');
assert(modalStub.innerHTML.indexOf('tk-notify') >= 0, 'Э31: модалка — tk-notify');
assert(modalStub.innerHTML.indexOf('Оповестить меня') >= 0, 'Э31: модалка — подпись чекбокса');
assert(modalStub.innerHTML.indexOf('value="14:30"') >= 0, 'Э31: tk-time предзаполнен');
assert(modalStub.innerHTML.indexOf('checked') >= 0, 'Э31: чекбокс отмечен у notify-задачи');
modalStub.innerHTML = '';

// Делегат «Сохранить»: читает tk-time и tk-notify.checked.
function clickTaskSave() {
  var node = {
    getAttribute: function (a) { return a === 'data-save-task' ? '' : null; },
    closest: function (s) { return s === '[data-save-task]' ? node : null; }
  };
  clickHandlers.forEach(function (fn) { fn({ target: node }); });
}
DB.tasks = [];
window.__taskEditing = null;
FIELDS['tk-title'] = { value: 'Позвонить поставщику' };
FIELDS['tk-note'] = { value: '' };
FIELDS['tk-due'] = { value: '2026-05-06' };
FIELDS['tk-order'] = { value: '' };
FIELDS['tk-time'] = { value: '09:15' };
FIELDS['tk-notify'] = { checked: true };
clickTaskSave();
assert.eq(DB.tasks.length, 1, 'Э31: делегат создал задачу');
assert.eq(DB.tasks[0].reminderTime, '09:15', 'Э31: делегат сохранил reminderTime');
assert.eq(DB.tasks[0].notify, true, 'Э31: делегат сохранил notify');

// Редактирование: сброс notify через снятый чекбокс.
window.__taskEditing = String(DB.tasks[0].id);
FIELDS['tk-notify'] = { checked: false };
FIELDS['tk-time'] = { value: '' };
clickTaskSave();
assert.eq(DB.tasks[0].notify, false, 'Э31: редактирование — notify сброшен');
assert.eq(DB.tasks[0].reminderTime, '', 'Э31: редактирование — время очищено');
window.__taskEditing = null;

// updateTask без новых полей их НЕ трогает (обратная совместимость).
var keep = addTask({ title: 'Держи', reminderTime: '18:00', notify: true });
updateTask(keep.id, { title: 'Держи 2' });
assert.eq(keep.reminderTime, '18:00', 'Э31: updateTask без полей — время сохранено');
assert.eq(keep.notify, true, 'Э31: updateTask без полей — notify сохранён');

// --- 12. typeof-регрессии (модуль может не загрузиться) ---assert(typeof renderTasks === 'function', 'typeof renderTasks');
assert(typeof renderTaskModal === 'function', 'typeof renderTaskModal');
assert(typeof renderOrderTasksBlock === 'function', 'typeof renderOrderTasksBlock');
assert(typeof addTask === 'function', 'typeof addTask');
assert(typeof toggleTask === 'function', 'typeof toggleTask');
assert(typeof deleteTask === 'function', 'typeof deleteTask');
assert(typeof tasksForOrder === 'function', 'typeof tasksForOrder');
