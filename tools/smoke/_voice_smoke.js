/* Смоук Этапа 41: голосовой ввод (диктовка + команды).
   1) voiceSupported / voiceNum / voiceNormalizePhone / voiceParseCommand.
   2) Движок: старт, переключатель, onerror, диктовка в поле, телефон.
   3) Команды: чтение/навигация сразу, изменяющие — через подтверждение.
   4) Кнопки 🎤: ровно 12 полей, селекты без микрофона, гард без ui-voice.
   5) Автоостановка: go(), closeModal, visibilitychange.
   6) Capture-делегирование, отсутствие инлайн-обработчиков, регрессия без firebase. */
'use strict';

globalThis.localStorage = (function () {
  var m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
})();

var appStub = { innerHTML: '', style: {} };
var navStub = { innerHTML: '' };
var modalStub = { innerHTML: '' };
var FIELDS = {};
var clickHandlers = [];
var docHandlers = {};

globalThis.document = {
  readyState: 'loading',
  visibilityState: 'visible',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return Object.prototype.hasOwnProperty.call(FIELDS, id) ? FIELDS[id] : null;
  },
  addEventListener: function (type, fn, capture) {
    if (type === 'click') clickHandlers.push({ fn: fn, capture: !!capture });
    else docHandlers[type] = fn;
  },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; },
  createElement: function (t) { return { tagName: t, className: '', textContent: '', style: {} }; }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function (fn) { if (typeof fn === 'function') fn(); return 0; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 0; };
globalThis.addEventListener = function () {};

loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-orders.js');
loadModule('app/ui-attention.js');
loadModule('app/ui-tasks.js');
loadModule('app/ui-digest.js');
loadModule('app/ui-voice.js');
loadModule('app/ui-clients.js');
loadModule('app/ui-admin.js');

setOwnerFlag(false);
DB.users = [];
login('admin', 'Владелец');

var today = localToday();

// --- 1. voiceSupported ---

// API нет — false (загружаем ui-voice.js после проверки отсутствия? Нет:
// модуль уже загружен, но проверка читает window в момент вызова).
assert.eq(voiceSupported(), false, '1: без SpeechRecognition → false');

globalThis.window.SpeechRecognition = function () {};
assert.eq(voiceSupported(), true, '1: с window.SpeechRecognition → true');
delete globalThis.window.SpeechRecognition;

globalThis.window.webkitSpeechRecognition = function () {};
assert.eq(voiceSupported(), true, '1: с webkitSpeechRecognition → true');
delete globalThis.window.webkitSpeechRecognition;

// --- 2. voiceNum ---

assert.eq(voiceNum('два'), 2, '2: «два» → 2');
assert.eq(voiceNum('двенадцать'), 12, '2: «двенадцать» → 12');
assert.eq(voiceNum('двадцать четыре'), 24, '2: «двадцать четыре» → 24');
assert.eq(voiceNum('4'), 4, '2: цифра «4» → 4');
assert.eq(voiceNum('  ДВА  '), 2, '2: регистр и пробелы игнорируются');
assert.eq(voiceNum('мусор'), null, '2: мусор → null');
assert.eq(voiceNum(''), null, '2: пустая строка → null');
assert.eq(voiceNum(null), null, '2: null → null');
assert.eq(voiceNum('двадцать четыре часа'), null, '2: лишние слова → null');

// --- 3. voiceNormalizePhone ---

assert.eq(voiceNormalizePhone('8 900 123-45-67'), '+79001234567', '3: 8XXXXXXXXXX → +7…');
assert.eq(voiceNormalizePhone('+79001234567'), '+79001234567', '3: уже нормализованный');
assert.eq(voiceNormalizePhone('9001234567'), '+79001234567', '3: 10 цифр с 9 → +7…');
assert.eq(voiceNormalizePhone('123'), '', '3: короткий номер → пусто');
assert.eq(voiceNormalizePhone(''), '', '3: пусто → пусто');
assert.eq(
  voiceNormalizePhone('восемь девятьсот сто двадцать три сорок пять шестьдесят семь'),
  '', '3: слова без единиц не дают 11 цифр → пусто');

var spelled = voiceNormalizePhone('восемь девять ноль ноль один два три четыре пять шесть семь');
assert.eq(spelled, '+79001234567', '3: слова по цифрам → +7…');

// --- 4. voiceParseCommand ---

assert.eq(voiceParseCommand('сводка').cmd, 'digest', '4: «сводка» → digest');
assert.eq(voiceParseCommand('покажи сводку').cmd, 'digest', '4: «покажи сводку» → digest');
assert.eq(voiceParseCommand('дайджест').cmd, 'digest', '4: «дайджест» → digest');
assert.eq(voiceParseCommand('озвучь сводку').cmd, 'digest_speak', '4: «озвучь сводку» → digest_speak');
assert.eq(voiceParseCommand('озвучь дайджест').cmd, 'digest_speak', '4: «озвучь дайджест» → digest_speak');
assert.eq(voiceParseCommand('читай сводку').cmd, 'digest_speak', '4: «читай сводку» → digest_speak');

assert.eq(voiceParseCommand('новая заявка').cmd, 'new_order', '4: «новая заявка» → new_order');
assert.eq(voiceParseCommand('создай заявку').cmd, 'new_order', '4: «создай заявку» → new_order');

var srch = voiceParseCommand('найди Смирнов');
assert.eq(srch.cmd, 'search', '4: «найди …» → search');
assert.eq(srch.arg, 'смирнов', '4: аргумент поиска в нижнем регистре');

assert.eq(voiceParseCommand('контрагенты').arg, 'clients', '4: контрагенты → clients');
assert.eq(voiceParseCommand('клиенты').arg, 'clients', '4: клиенты → clients');
assert.eq(voiceParseCommand('задачи').arg, 'tasks', '4: задачи → tasks');
assert.eq(voiceParseCommand('органайзер').arg, 'tasks', '4: органайзер → tasks');
assert.eq(voiceParseCommand('календарь').arg, 'calendar', '4: календарь → calendar');
assert.eq(voiceParseCommand('внимание').arg, 'overdue', '4: внимание → overdue');
assert.eq(voiceParseCommand('просроченные').arg, 'overdue', '4: просроченные → overdue');
assert.eq(voiceParseCommand('заявки').arg, 'orders', '4: заявки → orders');

assert.eq(voiceParseCommand('не дозвонился').arg, 'no_answer', '4: «не дозвонился» → no_answer');
assert.eq(voiceParseCommand('перезвонить завтра').arg, 'later_tomorrow', '4: завтра → later_tomorrow');
assert.eq(voiceParseCommand('перезвонить через 1 час').arg, 'later_1h', '4: 1 час → later_1h');
assert.eq(voiceParseCommand('перезвонить через 2 часа').arg, 'later_2h', '4: 2 часа → later_2h');
assert.eq(voiceParseCommand('перезвонить через 4 часа').arg, 'later_4h', '4: 4 часа → later_4h');
assert.eq(voiceParseCommand('перезвонить через 24 часа').arg, 'later_24h', '4: 24 часа → later_24h');
assert.eq(voiceParseCommand('перезвонить через 3 часа').cmd, 'call_custom', '4: 3 часа → call_custom');
assert.eq(voiceParseCommand('перезвонить через два часа').arg, 'later_2h', '4: «через два часа» → later_2h');

assert.eq(voiceParseCommand('стоп').cmd, 'stop', '4: стоп → stop');
assert.eq(voiceParseCommand('отмена').cmd, 'stop', '4: отмена → stop');
assert.eq(voiceParseCommand('хватит').cmd, 'stop', '4: хватит → stop');

function parseSig(t) {
  var p = voiceParseCommand(t);
  return p ? p.cmd + '|' + p.arg : 'null';
}

assert.eq(parseSig('свОдка'), parseSig('сводка'), '4: регистр не важен');
assert.eq(parseSig('СВОДКА'), parseSig('сводка'), '4: верхний регистр');
assert.eq(parseSig('  сводка  '), parseSig('сводка'), '4: пробелы по краям');
assert.eq(parseSig('перезвонить через 2 часа'), parseSig('перезвонить  через  2  часа'),
  '4: лишние пробелы схлопываются');
assert.eq(voiceParseCommand('абракадабра'), null, '4: мусор → null');
assert.eq(voiceParseCommand(''), null, '4: пусто → null');

// Приоритет: «озвучь сводку» не должно стать digest.
assert.eq(voiceParseCommand('озвучь сводку').cmd, 'digest_speak',
  '4: приоритет digest_speak над digest');

// --- 5. voiceStart без API → toast, не падает ---

var toasts = [];
globalThis.toast = function (msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); };

toasts = [];
var started = voiceStart('');
assert.eq(started, false, '5: без API voiceStart → false');
assert.eq(VC_ACTIVE, false, '5: без API VC_ACTIVE = false');
assert(toasts.length === 1 && toasts[0].msg.indexOf('Диктовка недоступна') >= 0,
  '5: подсказка про диктовку с клавиатуры');

// --- 6. Мок SpeechRecognition ---

var RecMock = function () {
  RecMock.instances.push(this);
  this.started = 0;
  this.aborted = 0;
  this.stopped = 0;
  this.lang = '';
  this.continuous = true;
  this.interimResults = false;
  this.maxAlternatives = 0;
  this.start = function () { this.started++; };
  this.abort = function () { this.aborted++; };
  this.stop = function () { this.stopped++; };
};
RecMock.instances = [];
globalThis.window.SpeechRecognition = RecMock;

toasts = [];
FIELDS['nc-client'] = { value: '', id: 'nc-client' };
var ok1 = voiceStart('nc-client');
assert.eq(ok1, true, '6: voiceStart с API → true');
assert.eq(RecMock.instances.length, 1, '6: создан один экземпляр');
var rec1 = RecMock.instances[0];
assert.eq(rec1.started, 1, '6: start() вызван один раз');
assert.eq(rec1.lang, 'ru-RU', '6: lang = ru-RU');
assert.eq(rec1.continuous, false, '6: continuous = false');
assert.eq(rec1.interimResults, true, '6: interimResults = true');
assert.eq(rec1.maxAlternatives, 1, '6: maxAlternatives = 1');
assert.eq(VC_TARGET, 'nc-client', '6: VC_TARGET = id поля');

// onstart → активен, слушаем.
rec1.onstart();
assert.eq(VC_ACTIVE, true, '6: onstart → VC_ACTIVE = true');
assert(toasts.some(function (t) { return t.msg.indexOf('Слушаю') >= 0; }), '6: toast «Слушаю…»');

// Повторный voiceStart — переключатель (остановка).
var ok2 = voiceStart('nc-client');
assert.eq(ok2, false, '6: повторный voiceStart → false (переключатель)');
assert.eq(VC_ACTIVE, false, '6: повторный voiceStart остановил запись');
assert(rec1.aborted >= 1 || rec1.stopped >= 1, '6: abort/stop вызван');

// --- 7. onerror: not-allowed и network ---

RecMock.instances = [];
voiceStart('');
var rec2 = RecMock.instances[0];
rec2.onstart();
toasts = [];
rec2.onerror({ error: 'not-allowed' });
assert(toasts.length === 1 && toasts[0].msg.indexOf('Нет доступа к микрофону') >= 0,
  '7: not-allowed → toast про разрешение');
assert.eq(VC_ACTIVE, false, '7: not-allowed → VC_ACTIVE = false');

RecMock.instances = [];
voiceStart('');
var rec3 = RecMock.instances[0];
rec3.onstart();
toasts = [];
rec3.onerror({ error: 'network' });
assert(toasts.length === 1 && toasts[0].msg.indexOf('интернета') >= 0,
  '7: network → toast про интернет');
assert.eq(VC_ACTIVE, false, '7: network → VC_ACTIVE = false');

RecMock.instances = [];
voiceStart('');
var rec3b = RecMock.instances[0];
rec3b.onstart();
toasts = [];
rec3b.onerror({ error: 'no-speech' });
assert(toasts[0].msg.indexOf('Не расслышал') >= 0, '7: no-speech → «Не расслышал»');
RecMock.instances = [];
voiceStart('');
var rec3c = RecMock.instances[0];
rec3c.onstart();
toasts = [];
rec3c.onerror({ error: 'audio-capture' });
assert(toasts[0].msg.indexOf('Микрофон не найден') >= 0, '7: audio-capture → «Микрофон не найден»');
voiceStop();

// --- 8. Диктовка в поле ---

DB.orders = [{
  id: 700, client: 'Клиент', status: 'new', worker: '', date: today, t1: '10:00', t2: '11:00',
  phone: '', address: '', helpers: [], confirm: {}, materials: [], works: [], extras: [],
  history: [], payments: [], tags: [], callbackAt: null
}];

FIELDS['nc-client'] = { value: 'Иван', id: 'nc-client' };
RecMock.instances = [];
voiceStart('nc-client');
var recD = RecMock.instances[0];
recD.onstart();

// interim: показываем в поле, в модель не пишем.
recD.onresult({ results: [{ 0: { transcript: 'Иванов' }, isFinal: false, length: 1 }] });
assert.eq(FIELDS['nc-client'].value, 'Иван Иванов', '8: interim показан как base + interim');
assert.eq(DB.orders[0].client, 'Клиент', '8: interim не пишет в DB');

// final: пишем в поле.
recD.onresult({ results: [{ 0: { transcript: 'Иванов Пётр' }, isFinal: true, length: 1 }] });
assert.eq(FIELDS['nc-client'].value, 'Иван Иванов Пётр', '8: final = base + final');
assert.eq(DB.orders[0].client, 'Клиент', '8: final не пишет в DB (сохранение за формой)');

// Телефон: успешная нормализация.
voiceStop();
FIELDS['nc-phone'] = { value: '', id: 'nc-phone' };
RecMock.instances = [];
voiceStart('nc-phone');
var recP = RecMock.instances[0];
recP.onstart();
recP.onresult({ results: [{ 0: { transcript: '8 900 123 45 67' }, isFinal: true, length: 1 }] });
assert.eq(FIELDS['nc-phone'].value, '+79001234567', '8: телефон нормализован');

// Телефон: неудачная нормализация → сырой текст + toast.
voiceStop();
FIELDS['nc-phone'] = { value: '', id: 'nc-phone' };
RecMock.instances = [];
toasts = [];
voiceStart('nc-phone');
var recP2 = RecMock.instances[0];
recP2.onstart();
recP2.onresult({ results: [{ 0: { transcript: '123' }, isFinal: true, length: 1 }] });
assert.eq(FIELDS['nc-phone'].value, '123', '8: неразборчивый номер записан сырым');
assert(toasts.some(function (t) { return t.msg.indexOf('Проверьте номер') >= 0; }),
  '8: toast «Проверьте номер вручную»');
voiceStop();

// --- 9. Команды: чтение/навигация выполняются сразу ---

var calls = { openDigest: 0, speakDigest: 0, go: [], create: 0, render: 0 };
globalThis.openDigest = function () { calls.openDigest++; };
globalThis.speakDigest = function () { calls.speakDigest++; };
var origGo = globalThis.go;
globalThis.go = function (s, id) { calls.go.push(s); };
var origCreate = globalThis.renderCreateOrderModal;
globalThis.renderCreateOrderModal = function () { calls.create++; };
var origRender = globalThis.render;
globalThis.render = function () { calls.render++; };

voiceHandleCommand('сводка');
assert.eq(calls.openDigest, 1, '9: «сводка» → openDigest 1 раз');

voiceHandleCommand('озвучь сводку');
assert.eq(calls.openDigest, 2, '9: «озвучь сводку» → openDigest');
assert.eq(calls.speakDigest, 1, '9: «озвучь сводку» → speakDigest');

voiceHandleCommand('календарь');
assert.eq(calls.go[calls.go.length - 1], 'calendar', '9: «календарь» → go(calendar)');

voiceHandleCommand('внимание');
assert.eq(calls.go[calls.go.length - 1], 'overdue', '9: «внимание» → go(overdue)');

voiceHandleCommand('новая заявка');
assert.eq(calls.create, 1, '9: «новая заявка» → renderCreateOrderModal');

ORD_SEARCH = '';
voiceHandleCommand('найди Смирнов');
assert.eq(ORD_SEARCH, 'смирнов', '9: «найди …» выставил ORD_SEARCH');
assert.eq(calls.go[calls.go.length - 1], 'orders', '9: поиск ушёл на экран заявок');
assert(calls.render >= 1, '9: после поиска вызван render()');

// --- 10. call без подтверждения не применяет ---

var applyCalls = [];
var origApply = globalThis.applyCallResult;
globalThis.applyCallResult = function (o, branch) {
  applyCalls.push({ id: o && o.id, branch: branch });
  return { ok: true, text: 'ok' };
};

state.orderId = 700;
modalStub.innerHTML = '';
voiceHandleCommand('перезвонить через 4 часа');
assert.eq(applyCalls.length, 0, '10: call без подтверждения не применяет');
assert(modalStub.innerHTML.indexOf('data-voice-confirm') >= 0, '10: открыта модалка подтверждения');
assert(modalStub.innerHTML.indexOf('🎤 Подтвердите команду') >= 0, '10: заголовок модалки');
assert(modalStub.innerHTML.indexOf('Перезвон через 4 часа') >= 0, '10: действие человеческим языком');
assert(modalStub.innerHTML.indexOf('Заявка №700') >= 0, '10: номер заявки в модалке');
assert(modalStub.innerHTML.indexOf('onclick') < 0, '16: нет onclick в модалке');

// --- 11. data-voice-confirm → applyCallResult с нужной заявкой ---

function fireClick(attrs) {
  var target = {
    getAttribute: function (a) {
      return Object.prototype.hasOwnProperty.call(attrs, a) ? String(attrs[a]) : null;
    },
    closest: function (sel) {
      var m = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
      if (!m) return null;
      var key = m[1];
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) return null;
      if (m[2] !== undefined && String(attrs[key]) !== m[2]) return null;
      return target;
    }
  };
  var ev = { target: target, stopPropagation: function () {}, preventDefault: function () {} };
  clickHandlers.slice().sort(function (a, b) {
    return (b.capture ? 1 : 0) - (a.capture ? 1 : 0);
  }).forEach(function (h) { h.fn(ev); });
  return ev;
}

calls.render = 0;
fireClick({ 'data-voice-confirm': 'call', 'data-voice-arg': 'later_4h' });
assert.eq(applyCalls.length, 1, '11: подтверждение вызвало applyCallResult');
assert.eq(applyCalls[0].branch, 'later_4h', '11: ветка later_4h');
assert.eq(applyCalls[0].id, 700, '11: та же заявка (state.orderId)');
assert.eq(modalStub.innerHTML, '', '11: модалка закрыта');
assert(calls.render >= 1, '11: вызван render()');

// call_custom → renderCustomCallbackModal, модалка не закрывается.
var customCalls = 0;
var origCustom = globalThis.renderCustomCallbackModal;
globalThis.renderCustomCallbackModal = function () { customCalls++; };
state.orderId = 700;
fireClick({ 'data-voice-confirm': 'call_custom', 'data-voice-arg': '' });
assert.eq(customCalls, 1, '11: call_custom → renderCustomCallbackModal');
globalThis.renderCustomCallbackModal = origCustom;

// --- 12. call при пустом state.orderId → toast, без модалки и apply ---

applyCalls = [];
state.orderId = null;
modalStub.innerHTML = '';
toasts = [];
var res12 = voiceHandleCommand('перезвонить через 2 часа');
assert.eq(res12, false, '12: без открытой заявки → false');
assert.eq(modalStub.innerHTML, '', '12: модалка не открыта');
assert.eq(applyCalls.length, 0, '12: applyCallResult не вызван');
assert(toasts.some(function (t) { return t.msg.indexOf('Откройте заявку') >= 0; }),
  '12: toast «Откройте заявку»');

// --- 13. Нераспознанная команда → toast ---

toasts = [];
calls.openDigest = 0;
var res13 = voiceHandleCommand('абракадабра');
assert.eq(res13, false, '13: мусор → false');
assert(toasts.some(function (t) { return t.msg.indexOf('Не понял команду') >= 0; }),
  '13: toast «Не понял команду»');
assert.eq(calls.openDigest, 0, '13: ничего не выполнено');

// --- 14. voiceStop снимает класс со всех кнопок ---

var listeningClasses = [];
var btnA = { classList: { add: function () {}, remove: function () { listeningClasses.push('a'); } } };
var btnB = { classList: { add: function () {}, remove: function () { listeningClasses.push('b'); } } };
var origQSA = globalThis.document.querySelectorAll;
globalThis.document.querySelectorAll = function (sel) {
  if (sel.indexOf('vc-listening') >= 0 || sel.indexOf('data-voice') >= 0) return [btnA, btnB];
  return [];
};
RecMock.instances = [];
voiceStart('');
RecMock.instances[0].onstart();
assert.eq(VC_ACTIVE, true, '14: запись активна');
voiceStop();
assert.eq(VC_ACTIVE, false, '14: voiceStop сбросил VC_ACTIVE');
assert(listeningClasses.length >= 2, '14: класс снят со всех кнопок');
globalThis.document.querySelectorAll = origQSA;

// go() гасит микрофон.
globalThis.go = origGo;
RecMock.instances = [];
voiceStart('');
RecMock.instances[0].onstart();
assert.eq(VC_ACTIVE, true, '14: микрофон активен перед go()');
go('orders');
assert.eq(VC_ACTIVE, false, '14: go() остановил микрофон');

// closeModal гасит микрофон.
RecMock.instances = [];
voiceStart('');
RecMock.instances[0].onstart();
assert.eq(VC_ACTIVE, true, '14: микрофон активен перед closeModal()');
closeModal();
assert.eq(VC_ACTIVE, false, '14: closeModal() остановил микрофон');

// visibilitychange → hidden гасит микрофон.
RecMock.instances = [];
voiceStart('');
RecMock.instances[0].onstart();
assert.eq(VC_ACTIVE, true, '14: микрофон активен перед уходом в фон');
globalThis.document.visibilityState = 'hidden';
docHandlers['visibilitychange']();
assert.eq(VC_ACTIVE, false, '14: hidden остановил микрофон');
globalThis.document.visibilityState = 'visible';

// --- 15. Все вызовы guarded ---

state.orderId = 700;
toasts = [];
globalThis.openDigest = undefined;
voiceHandleCommand('сводка');
assert(toasts.some(function (t) { return t.msg.indexOf('Сводка недоступна') >= 0; }),
  '15: без openDigest → toast, не падение');
globalThis.openDigest = function () { calls.openDigest++; };

globalThis.renderCreateOrderModal = undefined;
toasts = [];
voiceHandleCommand('новая заявка');
assert(toasts.some(function (t) { return t.msg.indexOf('Модуль заявок не загружен') >= 0; }),
  '15: без renderCreateOrderModal → toast');
globalThis.renderCreateOrderModal = origCreate;

globalThis.applyCallResult = undefined;
toasts = [];
modalStub.innerHTML = '';
fireClick({ 'data-voice-confirm': 'call', 'data-voice-arg': 'later_2h' });
assert(toasts.some(function (t) { return t.msg.indexOf('Модуль звонков не загружен') >= 0; }),
  '15: без applyCallResult → toast, не падение');
globalThis.applyCallResult = origApply;

// --- 4 (продолжение). Кнопки 🎤: ровно 12 полей ---

var EXPECTED = ['nc-client', 'nc-phone', 'nc-address', 'eo-client', 'eo-phone', 'eo-address',
  'tk-title', 'tk-note', 'ord-search', 'cl-search', 'sup-tab-search', 'admin-price-search'];

DB.orders = [{
  id: 700, client: 'К', status: 'new', worker: '', date: today, t1: '10:00', t2: '11:00',
  phone: '', address: '', city: '', helpers: [], confirm: {}, materials: [], works: [],
  extras: [], history: [], payments: [], tags: [], callbackAt: null
}];
DB.clients = [{ id: 1, name: 'К', kind: 'person', phone: '', address: '', city: '', orderIds: [] }];
DB.suppliers = [{ id: 's1', name: 'S', phone: '', address: '', hours: '', note: '' }];
DB.priceList = [{ id: 1, name: 'P', category: '', basePrice: 1, unit: 'шт', defaultQty: 1 }];
DB.tasks = [];

// Собираем HTML всех экранов с полями.
CL_TAB = 'list';
var htmlClients = renderClients();
CL_TAB = 'suppliers';
var htmlSup = renderClients();
CL_TAB = 'list';
ADMIN_TAB = 'price';
var htmlPrice = renderAdmin();
ORD_SEARCH = '';
var htmlOrders = renderOrdersList();

// Модалки: showModal пишет в modalStub.
renderCreateOrderModal();
var htmlCreate = modalStub.innerHTML;
renderEditOrderModal(DB.orders[0]);
var htmlEdit = modalStub.innerHTML;
globalThis.showModal && renderTaskModal ? null : null;
if (typeof renderTaskModal === 'function') { renderTaskModal(null); }
var htmlTask = modalStub.innerHTML;

var allHtml = htmlClients + htmlSup + htmlPrice + htmlOrders + htmlCreate + htmlEdit + htmlTask;
var found = [];
EXPECTED.forEach(function (id) {
  var has = allHtml.indexOf('data-voice-field="' + id + '"') >= 0;
  assert(has, '4: кнопка 🎤 у поля ' + id);
  if (has) found.push(id);
});
assert.eq(found.length, 12, '4: ровно 12 полей с микрофоном');

// Селекты — без микрофона.
assert(htmlCreate.indexOf('data-voice-field="co-client-id"') < 0,
  '4: у селекта co-client-id нет микрофона');
assert(htmlCreate.indexOf('data-voice-field="nc-worker"') < 0,
  '4: у селекта nc-worker нет микрофона');

// Нет инлайн-обработчиков ни в одном фрагменте.
['htmlClients', 'htmlSup', 'htmlPrice', 'htmlOrders', 'htmlCreate', 'htmlEdit', 'htmlTask']
  .forEach(function (name) {
    var h = eval(name);
    assert(h.indexOf('onclick') < 0 && h.indexOf('oninput') < 0 && h.indexOf('onchange') < 0,
      '16: ' + name + ' — нет инлайн-обработчиков');
  });

// Гард: без renderVoiceFieldBtn кнопок нет, разметка прежняя.
var savedMic = globalThis.renderVoiceFieldBtn;
globalThis.renderVoiceFieldBtn = undefined;
CL_TAB = 'list';
var noMicClients = renderClients();
CL_TAB = 'suppliers';
var noMicSup = renderClients();
CL_TAB = 'list';
ADMIN_TAB = 'price';
var noMicPrice = renderAdmin();
ORD_SEARCH = '';
var noMicOrders = renderOrdersList();
var allNoMic = noMicClients + noMicSup + noMicPrice + noMicOrders;
assert(allNoMic.indexOf('data-voice-field') < 0, '4: без ui-voice.js кнопок 🎤 нет');
assert.eq(noMicClients.length, 678, '4: HTML контрагентов без 🎤 = baseline');
assert.eq(noMicSup.length, 808, '4: HTML поставщиков без 🎤 = baseline');
assert.eq(noMicPrice.length, 1506, '4: HTML прайса без 🎤 = baseline');

// Теги <input> трёх полей — байт-в-байт прежние (патч: атрибуты не менялись).
function inputTag(html, id) {
  var start = html.indexOf('<input type="search" id="' + id + '"');
  if (start < 0) return null;
  var end = html.indexOf('>', start);
  return end < 0 ? null : html.slice(start, end + 1);
}
var tagCl = inputTag(noMicClients, 'cl-search');
assert.eq(tagCl,
  '<input type="search" id="cl-search" class="search-input" ' +
  'placeholder="🔍 Поиск по имени, телефону, адресу..." value="">',
  '4: <input id="cl-search"> IDENTICAL');
var tagSup = inputTag(noMicSup, 'sup-tab-search');
assert.eq(tagSup,
  '<input type="search" id="sup-tab-search" class="search-input" ' +
  'placeholder="🔍 Поиск по названию, телефону, адресу..." value="">',
  '4: <input id="sup-tab-search"> IDENTICAL');
var tagPrice = inputTag(noMicPrice, 'admin-price-search');
assert.eq(tagPrice,
  '<input type="search" id="admin-price-search" class="search-input" ' +
  'placeholder="🔍 Поиск по названию, категории, ед. изм..." value="">',
  '4: <input id="admin-price-search"> IDENTICAL');

// Админский sup-search — без микрофона (хелпер без micId).
ADMIN_TAB = 'suppliers';
var htmlAdminSup = renderAdmin();
ADMIN_TAB = 'price';
assert(htmlAdminSup.indexOf('data-voice-field="sup-search"') < 0,
  '4: admin sup-search без 🎤 (хелпер не тронут)');
assert(htmlAdminSup.indexOf('data-voice-field') < 0,
  '4: в админских поставщиках микрофонов нет');

globalThis.renderVoiceFieldBtn = savedMic;

// --- 6 (продолжение). Capture-слушатель ---

var captures = clickHandlers.filter(function (h) { return h.capture; });
assert(captures.length > 0, '6: есть capture-слушатель клика');

// --- 23. Кнопка «🎤 Команда» в render() ---

globalThis.render = origRender;
globalThis.go = origGo;
globalThis.applyCallResult = origApply;
DB.orders = [];
DB.tasks = [];
state.screen = 'orders';
render();
assert(appStub.innerHTML.indexOf('data-voice-command') >= 0,
  '23: кнопка «🎤 Команда» есть после входа');

logout();
state.screen = 'login';
render();
assert(appStub.innerHTML.indexOf('data-voice-command') < 0,
  '23: на экране входа кнопки нет');
login('admin', 'Владелец');

// --- 17. Регрессия: без firebase ---

globalThis.firebase = undefined;
DB.orders = [{
  id: 701, client: 'К2', status: 'new', worker: '', date: today, t1: '10:00', t2: '11:00',
  phone: '', address: '', helpers: [], confirm: {}, materials: [], works: [], extras: [],
  history: [], payments: [], tags: [], callbackAt: null
}];
state.orderId = 701;
toasts = [];
modalStub.innerHTML = '';
var noFbOk = voiceHandleCommand('перезвонить через 2 часа');
assert.eq(noFbOk, true, '17: без firebase команда работает');
assert(modalStub.innerHTML.indexOf('data-voice-confirm') >= 0,
  '17: без firebase модалка подтверждения открыта');
assert.eq(voiceNum('двадцать четыре'), 24, '17: без firebase парсеры работают');
assert.eq(voiceNormalizePhone('8 900 123 45 67'), '+79001234567',
  '17: без firebase нормализация работает');
