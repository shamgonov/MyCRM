/* CRM2 :: app/ui-sync.js — индикатор статуса синхронизации (Этап 25).
   Чип в шапке экрана + модалка деталей (режим, очередь, ошибки).
   Зависит от sync.js (syncStatus, flushQueue), auth.js (state),
   core.js (showModal/closeModal/toast), db.js (escapeHtml).
   Правил нет: только data-* + делегирование, инлайн-скриптов нет. */
'use strict';

// syncStatusMeta(mode): иконка, подпись и цвет чипа.
function syncStatusMeta(mode) {
  if (mode === 'local') return { ico: '🔌', label: 'Локально', color: 'var(--muted)' };
  if (mode === 'noaccess') return { ico: '⏳', label: 'Нет доступа', color: 'var(--warn)' };
  if (mode === 'offline') return { ico: '📴', label: 'Офлайн', color: 'var(--warn)' };
  if (mode === 'sending') return { ico: '🔄', label: 'Отправка…', color: 'var(--accent)' };
  if (mode === 'error') return { ico: '⚠️', label: 'Ошибка', color: 'var(--danger)' };
  return { ico: '☁️', label: 'В облаке', color: 'var(--ok)' };
}

// Время для модалки: детерминированный локальный формат (без Intl).
function syncFmtTime(ts) {
  var d = new Date(Number(ts) || 0);
  var p = function (n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// syncStatusData(): сводка из sync.js; без sync.js — безопасный «local».
function syncStatusData() {
  if (typeof syncStatus === 'function') return syncStatus();
  return { mode: 'local', pending: 0, online: true, approved: false,
           lastError: '', lastOk: 0 };
}

// Чип — внутреннее содержимое #sync-status (без обёртки: нужно для
// refreshSyncStatus, который меняет только innerHTML обёртки).
function renderSyncChip() {
  var s = syncStatusData();
  var meta = syncStatusMeta(s.mode);
  var cnt = s.pending > 0 ? ' · ' + s.pending + ' в очереди' : '';
  return '<button class="btn" data-sync-open ' +
    'style="font-size:11px;padding:2px 8px;line-height:1.4;background:transparent;' +
    'border-color:' + meta.color + ';color:' + meta.color + '">' +
    meta.ico + ' ' + meta.label + cnt + '</button>';
}

// renderSyncStatus(): обёртка с чипом; вставляется в render() над экраном.
function renderSyncStatus() {
  return '<div id="sync-status" style="display:flex;justify-content:flex-end;padding:0 12px">' +
    renderSyncChip() + '</div>';
}

// refreshSyncStatus(): точечное обновление чипа БЕЗ полного render()
// (хуки sync.js вызывают её после каждого изменения очереди/флагов).
function refreshSyncStatus() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  var host = document.getElementById('sync-status');
  if (!host || typeof host !== 'object') return;
  host.innerHTML = renderSyncChip();
}

// Подсказка, почему нет кнопки «Отправить сейчас».
function syncSendHint(mode) {
  if (mode === 'local') {
    return 'Синхронизация выключена: Firebase SDK недоступен — всё сохраняется локально.';
  }
  return 'Доступ к общей базе ещё не подтверждён владельцем — данные копятся локально.';
}

function renderSyncDetailsModal() {
  var s = syncStatusData();
  var meta = syncStatusMeta(s.mode);
  var rows = (DB && Array.isArray(DB.syncQueue)) ? DB.syncQueue : [];
  var shown = rows.slice(0, 10).map(function (op) {
    return '<div class="small">' + escapeHtml(String(op.type || '?')) + ' · ' +
      escapeHtml(String(op.collection || '?')) + '/' + escapeHtml(String(op.docId || '?')) +
      '</div>';
  }).join('');
  var more = rows.length > 10 ? '<div class="small muted">…и ещё ' + (rows.length - 10) + '</div>' : '';

  var accessTxt = '—';
  if (typeof state !== 'undefined' && state) {
    accessTxt = String(state.cloudStatus || 'нет данных') +
      (state.cloudRole ? ' · роль ' + state.cloudRole : '');
  }

  var actions = (s.mode === 'local' || s.mode === 'noaccess')
    ? '<p class="small muted">' + syncSendHint(s.mode) + '</p>'
    : '<button class="btn btn-primary" data-sync-flush>🔄 Отправить сейчас</button>';

  showModal(
    '<h3>Синхронизация</h3>' +
    '<p class="small" style="color:' + meta.color + ';margin:0">' + meta.ico + ' ' + meta.label + '</p>' +
    '<div class="small">Сеть: ' + (s.online ? 'онлайн' : 'офлайн') + '</div>' +
    '<div class="small">Доступ: ' + escapeHtml(accessTxt) + '</div>' +
    '<div class="small">В очереди: ' + s.pending + (s.pending ? ' опер.' : '') + '</div>' +
    (shown ? '<div style="margin-top:8px">' + shown + more + '</div>' :
             '<p class="small muted">Очередь пуста.</p>') +
    (s.lastError ? '<p class="small" style="color:var(--danger);margin:6px 0 0">' +
        'Последняя ошибка: ' + escapeHtml(s.lastError) + '</p>' : '') +
    '<div class="small muted">' +
      (s.lastOk ? 'Последняя отправка: ' + syncFmtTime(s.lastOk) : 'Отправок ещё не было') +
    '</div>' +
    '<div class="row" style="margin-top:10px">' + actions +
      '<button class="btn" data-close>Закрыть</button></div>'
  );
}

// --- Делегирование ---

document.addEventListener('click', function (ev) {
  var opener = ev.target.closest('[data-sync-open]');
  if (opener) { renderSyncDetailsModal(); return; }

  var flushBtn = ev.target.closest('[data-sync-flush]');
  if (flushBtn) {
    if (typeof flushQueue === 'function') flushQueue();
    toast('Отправка запрошена');
    closeModal();
    refreshSyncStatus();
    return;
  }
});

// Явный экспорт в window (const/let не создают свойств window).
window.syncStatusMeta = syncStatusMeta;
window.renderSyncChip = renderSyncChip;
window.renderSyncStatus = renderSyncStatus;
window.refreshSyncStatus = refreshSyncStatus;
window.renderSyncDetailsModal = renderSyncDetailsModal;
window.syncSendHint = syncSendHint;
window.syncFmtTime = syncFmtTime;
