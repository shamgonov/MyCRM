/* CRM2 :: app/ui-tasks.js — органайзер (Этап 20): личные задачи и заметки с
   привязкой к заявке, чек-лист (done), дата выполнения (dueDate).
   Зависит: db.js (DB, save, escapeHtml, localToday), auth.js (state),
   core.js (render, showModal, closeModal, toast, go).
   Все функции возвращают HTML-строки; обработчики — только делегирование data-*. */
'use strict';

// Активный фильтр органайзера; живёт отдельно от state (как ORD_TAB в ui-orders.js).
var TASK_FILTER = 'all';

const TASK_FILTERS = [
  ['all', 'Все'],
  ['today', '📅 Сегодня'],
  ['order', '🔗 К заявке'],
  ['done', '✅ Выполненные']
];

// --- Модель данных ---

// normalizeTask(t): гарантирует поля модели (title/note/orderId/done/createdAt/dueDate).
function normalizeTask(t) {
  if (!t || typeof t !== 'object') return t;
  if (typeof t.title !== 'string') t.title = String(t.title == null ? '' : t.title);
  if (typeof t.note !== 'string') t.note = String(t.note == null ? '' : t.note);
  if (t.orderId === '' || t.orderId === undefined) t.orderId = null;
  if (t.orderId !== null) t.orderId = Number(t.orderId) || null;
  t.done = !!t.done;
  if (typeof t.createdAt !== 'number') t.createdAt = Number(t.createdAt) || Date.now();
  if (!t.dueDate) t.dueDate = null;
  else t.dueDate = String(t.dueDate);
  if (!t.id) t.id = 'tsk' + Date.now() + '_' + ((DB.tasks || []).length + 1);
  if (typeof t.by !== 'string') t.by = String(t.by || (state && state.user) || '');
  return t;
}

// findTask(id): задача по строковому id (в data-* атрибутах id всегда строка).
function findTask(id) {
  return (DB.tasks || []).find(function (t) { return String(t.id) === String(id); }) || null;
}

// addTask(data): создаёт задачу, кладёт в DB.tasks, сохраняет.
function addTask(data) {
  const d = data || {};
  const t = normalizeTask({
    id: 'tsk' + Date.now() + '_' + ((DB.tasks || []).length + 1),
    title: String(d.title || '').trim(),
    note: String(d.note || '').trim(),
    orderId: d.orderId ? Number(d.orderId) : null,
    done: false,
    createdAt: Date.now(),
    dueDate: d.dueDate ? String(d.dueDate) : null,
    by: (state && state.user) || ''
  });
  if (!Array.isArray(DB.tasks)) DB.tasks = [];
  DB.tasks.push(t);
  save();
  if (typeof collectionSave === 'function') collectionSave('tasks', t);
  return t;
}

// updateTask(id, data): правит существующую задачу (модалка редактирования).
function updateTask(id, data) {
  const t = findTask(id);
  if (!t) return null;
  const d = data || {};
  t.title = String(d.title || '').trim() || t.title;
  t.note = String(d.note == null ? t.note : d.note).trim();
  t.dueDate = d.dueDate ? String(d.dueDate) : null;
  t.orderId = d.orderId ? Number(d.orderId) : null;
  normalizeTask(t);
  save();
  if (typeof collectionSave === 'function') collectionSave('tasks', t);
  return t;
}

// toggleTask(id): инвертирует done (чек-лист).
function toggleTask(id) {
  const t = findTask(id);
  if (!t) return null;
  t.done = !t.done;
  save();
  if (typeof collectionSave === 'function') collectionSave('tasks', t);
  return t;
}

// deleteTask(id): удаляет задачу; true — если что-то удалилось.
function deleteTask(id) {
  const before = (DB.tasks || []).length;
  DB.tasks = (DB.tasks || []).filter(function (t) { return String(t.id) !== String(id); });
  if (DB.tasks.length === before) return false;
  save();
  if (typeof collectionDelete === 'function') collectionDelete('tasks', id);
  return true;
}

// tasksForOrder(orderId): задачи, привязанные к заявке.
function tasksForOrder(orderId) {
  const id = Number(orderId);
  return (DB.tasks || []).filter(function (t) { return Number(t.orderId) === id; });
}

// tasksByFilter(f): список для экранной фильтрации + сортировка.
// Активные — выше выполненных; внутри — по дате (без даты — в конце), затем свежие сверху.
function tasksByFilter(f) {
  const list = (DB.tasks || []).filter(function (t) {
    if (f === 'today') return t.dueDate === localToday();
    if (f === 'order') return t.orderId !== null && t.orderId !== '';
    if (f === 'done') return !!t.done;
    return true;
  });
  return list.sort(function (a, b) {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const ad = a.dueDate || '9999-99-99';
    const bd = b.dueDate || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// --- Рендер ---

function renderTaskFilters() {
  return '<div class="chips">' + TASK_FILTERS.map(function (c) {
    return '<button class="chip' + (TASK_FILTER === c[0] ? ' active' : '') +
      '" data-task-filter="' + c[0] + '">' + c[1] + '</button>';
  }).join('') + '</div>';
}

// Строка задачи: чекбокс done, заголовок, заметка, дата, привязка, кнопки ✎ и 🗑.
function renderTaskRow(t) {
  const overdue = t.dueDate && !t.done && t.dueDate < localToday();
  const order = t.orderId
    ? (DB.orders || []).find(function (o) { return Number(o.id) === Number(t.orderId); })
    : null;
  const link = t.orderId
    ? '<div class="small">🔗 <b data-task-order="' + t.orderId + '" style="color:var(--accent);cursor:pointer">№' +
        (order ? escapeHtml(order.client) : t.orderId) + '</b></div>'
    : '';
  return '<div class="list-item">' +
      '<div class="spread">' +
        '<span><input type="checkbox" data-toggle-task="' + escapeHtml(t.id) + '"' +
          (t.done ? ' checked' : '') + '> <b' +
          (t.done ? ' style="text-decoration:line-through;color:var(--muted)"' : '') + '>' +
          escapeHtml(t.title || '—') + '</b></span>' +
        '<span class="row" style="gap:4px">' +
          '<button class="btn" data-edit-task="' + escapeHtml(t.id) + '" title="Изменить">✎</button>' +
          '<button class="btn" data-del-task="' + escapeHtml(t.id) + '" title="Удалить">🗑</button>' +
        '</span>' +
      '</div>' +
      (t.note ? '<div class="small muted">' + escapeHtml(t.note) + '</div>' : '') +
      '<div class="small' + (overdue ? ' badge-warn' : ' muted') + '">' +
        (t.dueDate ? (overdue ? '⚠️ просрочено: ' : '📅 ') + escapeHtml(t.dueDate) : '📅 без даты') +
        (t.by ? ' · ' + escapeHtml(t.by) : '') +
      '</div>' +
      link +
    '</div>';
}

// renderTasks(): главный экран органайзера (S.tasks).
function renderTasks() {
  const all = DB.tasks || [];
  const open = all.filter(function (t) { return !t.done; }).length;
  const done = all.length - open;
  const rows = tasksByFilter(TASK_FILTER).map(renderTaskRow).join('');

  return '<div class="spread">' +
      '<h2>📝 Органайзер</h2>' +
      '<button class="btn btn-primary" data-new-task>＋ Новая задача</button>' +
    '</div>' +
    '<div class="card info-block">' +
      '<div class="row" style="gap:12px">' +
        '<span class="badge">Активных: ' + open + '</span>' +
        '<span class="badge badge-ok">Выполнено: ' + done + '</span>' +
      '</div>' +
      '<p class="small muted">Задачи видны всем, кто работает в этом приложении; ' +
      'привязка к заявке показывает их в карточке заявки.</p>' +
    '</div>' +
    renderTaskFilters() +
    '<div class="list">' + (rows || '<p class="muted">Задач нет — нажмите «＋ Новая задача».</p>') + '</div>';
}

// renderTaskModal(task): модалка создания (null) или редактирования (задача).
// Передача { orderId: N } — новая задача с предзаполненной привязкой из карточки.
function renderTaskModal(task) {
  const t = task && typeof task === 'object' ? normalizeTask(Object.assign({}, task)) : null;
  const editing = !!(task && task.id);
  window.__taskEditing = editing ? String(task.id) : null;

  const orderOptions = (DB.orders || []).map(function (o) {
    const sel = t && Number(t.orderId) === Number(o.id);
    return '<option value="' + o.id + '"' + (sel ? ' selected' : '') + '>№' +
      escapeHtml(String(o.id)) + ' · ' + escapeHtml(o.client || '') + '</option>';
  }).join('');

  showModal(
    '<h3>' + (editing ? '✎ Задача' : '＋ Новая задача') + '</h3>' +
    '<label class="field"><span>Заголовок *</span>' +
      '<input id="tk-title" type="text" value="' + escapeHtml(t ? t.title : '') + '" placeholder="Что сделать"></label>' +
    '<label class="field"><span>Заметка</span>' +
      '<textarea id="tk-note" rows="3" placeholder="Детали, материалы, адрес">' +
      escapeHtml(t ? t.note : '') + '</textarea></label>' +
    '<label class="field"><span>Дата выполнения</span>' +
      '<input id="tk-due" type="date" value="' + escapeHtml(t && t.dueDate ? t.dueDate : '') + '"></label>' +
    '<label class="field"><span>Привязка к заявке</span>' +
      '<select id="tk-order"><option value="">— личная задача —</option>' + orderOptions + '</select></label>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-save-task style="flex:1">Сохранить</button>' +
    '</div>'
  );
}

// renderOrderTasksBlock(o): блок задач в карточке заявки (вызывает ui-orders.js).
function renderOrderTasksBlock(o) {
  const list = tasksForOrder(o.id);
  const rows = list.map(function (t) {
    return '<div class="est-row' + (t.done ? ' done' : '') + '">' +
        '<span><input type="checkbox" data-toggle-task="' + escapeHtml(t.id) + '"' +
          (t.done ? ' checked' : '') + '> ' + escapeHtml(t.title || '—') + '</span>' +
        '<span class="small muted">' + escapeHtml(t.dueDate || '') + '</span>' +
      '</div>';
  }).join('');

  return '<div class="card info-block">' +
      '<div class="spread"><h4>📝 Задачи заявки</h4>' +
        '<button class="btn" data-task-add-order="' + o.id + '">＋ Задача</button></div>' +
      (rows || '<p class="small muted">Задач по этой заявке нет.</p>') +
      '<p class="small muted">Отметка выполнена здесь же; полный список — «📝 Органайзер».</p>' +
    '</div>';
}

// --- Делегирование событий этого модуля ---

document.addEventListener('click', function (ev) {
  const sel = function (s) { return ev.target.closest(s); };
  const val = function (id) {
    const el = document.getElementById(id);
    return el ? String(el.value == null ? '' : el.value).trim() : '';
  };

  const filterChip = sel('[data-task-filter]');
  if (filterChip) { TASK_FILTER = filterChip.getAttribute('data-task-filter'); render(); return; }

  const newTaskBtn = sel('[data-new-task]');
  if (newTaskBtn) { renderTaskModal(null); return; }

  const addForOrderBtn = sel('[data-task-add-order]');
  if (addForOrderBtn) {
    renderTaskModal({ orderId: Number(addForOrderBtn.getAttribute('data-task-add-order')) });
    return;
  }

  const editTaskBtn = sel('[data-edit-task]');
  if (editTaskBtn) {
    const t = findTask(editTaskBtn.getAttribute('data-edit-task'));
    if (t) renderTaskModal(t);
    return;
  }

  const saveTaskBtn = sel('[data-save-task]');
  if (saveTaskBtn) {
    const title = val('tk-title');
    if (!title) { toast('Укажите заголовок', true); return; }
    const data = {
      title: title,
      note: val('tk-note'),
      dueDate: val('tk-due'),
      orderId: val('tk-order') ? Number(val('tk-order')) : null
    };
    const id = window.__taskEditing;
    const saved = id ? updateTask(id, data) : addTask(data);
    window.__taskEditing = null;
    if (!saved) { toast('Не удалось сохранить задачу', true); return; }
    closeModal();
    toast(id ? 'Задача обновлена' : 'Задача добавлена');
    render();
    return;
  }

  const toggleBtn = sel('[data-toggle-task]');
  if (toggleBtn) {
    const t = toggleTask(toggleBtn.getAttribute('data-toggle-task'));
    if (!t) { toast('Задача не найдена', true); return; }
    render();
    return;
  }

  const delBtn = sel('[data-del-task]');
  if (delBtn) {
    const id = delBtn.getAttribute('data-del-task');
    if (!window.confirm('Удалить задачу?')) return;
    if (deleteTask(id)) { toast('Задача удалена'); render(); }
    else { toast('Задача не найдена', true); }
    return;
  }

  const orderLink = sel('[data-task-order]');
  if (orderLink) {
    go('order', Number(orderLink.getAttribute('data-task-order')));
    return;
  }
});

// --- Экспорт для core.js / ui-orders.js (const не попадает в window сам) ---

window.TASK_FILTERS = TASK_FILTERS;
window.normalizeTask = normalizeTask;
window.findTask = findTask;
window.addTask = addTask;
window.updateTask = updateTask;
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.tasksForOrder = tasksForOrder;
window.tasksByFilter = tasksByFilter;
window.renderTasks = renderTasks;
window.renderTaskModal = renderTaskModal;
window.renderOrderTasksBlock = renderOrderTasksBlock;
