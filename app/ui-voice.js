/* CRM2 :: app/ui-voice.js — голосовой ввод (Этап 41).
   Диктовка в текстовые поля и фиксированный набор голосовых команд.
   Только нативный Web Speech API (SpeechRecognition): без LLM, ключей и бэкенда.
   Озвучка (TTS) живёт в ui-digest.js (Этап 39) — здесь её не дублируем.
   Все межмодульные вызовы — через typeof-гарды: локальный режим и рассинхрон
   порядка скриптов не должны ронять приложение. */
'use strict';

var VC_REC = null;        // текущий SpeechRecognition
var VC_ACTIVE = false;
var VC_TARGET = '';       // id поля для диктовки, '' = режим команд
var VC_LAST = '';         // последний распознанный текст
var VC_FINAL = '';        // накопленный final-текст (режим команд)
var VC_BASE = '';         // базовое значение поля на момент старта диктовки

// Поля, где распознанный текст нормализуется как телефон.
var VC_PHONE_FIELDS = { 'nc-phone': true, 'eo-phone': true };

// --- 1. Поддержка API ---

function voiceSupported() {
  if (typeof window === 'undefined' || !window) return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function vcCtor() {
  if (typeof window === 'undefined' || !window) return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function vcToast(msg, isError) {
  if (typeof toast === 'function') toast(msg, isError);
}

function vcDoc() {
  return (typeof document !== 'undefined' && document) ? document : null;
}

function vcEl(id) {
  var d = vcDoc();
  if (!d || typeof d.getElementById !== 'function' || !id) return null;
  return d.getElementById(id);
}

// --- 2. Чистые парсеры (без DOM) ---

// Русские числительные и цифры → число или null.
var VC_NUM_WORDS = {
  'ноль': 0, 'один': 1, 'одну': 1, 'одна': 1, 'два': 2, 'две': 2, 'три': 3,
  'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9,
  'десять': 10, 'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13,
  'четырнадцать': 14, 'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17,
  'восемнадцать': 18, 'девятнадцать': 19, 'двадцать': 20, 'тридцать': 30,
  'сорок': 40, 'пятьдесят': 50, 'шестьдесят': 60, 'семьдесят': 70,
  'восемьдесят': 80, 'девяносто': 90, 'сто': 100
};

// 'двадцать четыре' → 24, '4' → 4, 'мусор' → null.
function voiceNum(text) {
  var s = String(text == null ? '' : text).toLowerCase().replace(/ё/g, 'е').trim();
  if (!s) return null;
  s = s.replace(/\s+/g, ' ');
  if (/^-?\d+$/.test(s)) return Number(s);

  var words = s.split(' ');
  var sum = 0;
  var seen = false;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (!Object.prototype.hasOwnProperty.call(VC_NUM_WORDS, w)) {
      // «двадцать четыре» — составное; всё прочее считаем мусором.
      return null;
    }
    sum += VC_NUM_WORDS[w];
    seen = true;
  }
  return seen ? sum : null;
}

// Извлечь цифры из речи (слова 0-9 + цифры) и нормализовать до +7XXXXXXXXXX.
// Возвращает '' если итог не 11 цифр — поле молча не портим.
function voiceNormalizePhone(text) {
  var s = String(text == null ? '' : text).toLowerCase().replace(/ё/g, 'е');
  var DIGITS = {
    'ноль': '0', 'один': '1', 'одна': '1', 'два': '2', 'две': '2', 'три': '3',
    'четыре': '4', 'пять': '5', 'шесть': '6', 'семь': '7', 'восемь': '8', 'девять': '9'
  };
  var digits = '';
  var tokens = s.split(/[^а-я0-9]+/);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (!t) continue;
    if (/^\d+$/.test(t)) {
      digits += t;
    } else if (Object.prototype.hasOwnProperty.call(DIGITS, t)) {
      digits += DIGITS[t];
    }
  }
  if (!digits) return '';
  if (digits.length === 11 && digits.charAt(0) === '8') {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 11 && digits.charAt(0) === '7') {
    return '+' + digits;
  }
  if (digits.length === 10 && digits.charAt(0) === '9') {
    return '+7' + digits;
  }
  return '';
}

// Разбор голосовой команды: { cmd, arg } или null.
// Приоритет — более длинные фразы («озвучь сводку» раньше «сводка»).
function voiceParseCommand(text) {
  var s = String(text == null ? '' : text).toLowerCase().replace(/ё/g, 'е').trim();
  if (!s) return null;
  s = s.replace(/\s+/g, ' ');

  // Озвучка — раньше обычной сводки.
  if (s.indexOf('озвучь сводку') >= 0 || s.indexOf('читай сводку') >= 0 ||
      s.indexOf('озвучь дайджест') >= 0) {
    return { cmd: 'digest_speak', arg: '' };
  }
  if (s.indexOf('сводка') >= 0 || s.indexOf('покажи сводку') >= 0 ||
      s.indexOf('дайджест') >= 0) {
    return { cmd: 'digest', arg: '' };
  }
  if (s.indexOf('новая заявка') >= 0 || s.indexOf('создай заявку') >= 0) {
    return { cmd: 'new_order', arg: '' };
  }
  if (s.indexOf('стоп') >= 0 || s.indexOf('отмена') >= 0 || s.indexOf('хватит') >= 0) {
    return { cmd: 'stop', arg: '' };
  }

  // Перезвоны — до «найди/поиск», чтобы «перезвонить через 2 часа» не ушло в поиск.
  if (s.indexOf('не дозвонился') >= 0) {
    return { cmd: 'call', arg: 'no_answer' };
  }
  if (s.indexOf('перезвонить завтра') >= 0) {
    return { cmd: 'call', arg: 'later_tomorrow' };
  }
  var cb = s.match(/перезвонить через (\d+|[а-я ]+?)(?: час| ч|$)/);
  if (cb) {
    var n = voiceNum(cb[1]);
    if (n === 1) return { cmd: 'call', arg: 'later_1h' };
    if (n === 2) return { cmd: 'call', arg: 'later_2h' };
    if (n === 4) return { cmd: 'call', arg: 'later_4h' };
    if (n === 24) return { cmd: 'call', arg: 'later_24h' };
    return { cmd: 'call_custom', arg: '' };
  }

  // Поиск: остаток фразы после ключевого слова.
  var searchM = s.match(/^(?:найди|поиск)\s+(.+)$/);
  if (searchM) return { cmd: 'search', arg: searchM[1].trim() };

  // Навигация — фактические ключи карты S.
  if (s.indexOf('контрагенты') >= 0 || s.indexOf('клиенты') >= 0) {
    return { cmd: 'nav', arg: 'clients' };
  }
  if (s.indexOf('задачи') >= 0 || s.indexOf('органайзер') >= 0) {
    return { cmd: 'nav', arg: 'tasks' };
  }
  if (s.indexOf('календарь') >= 0) {
    return { cmd: 'nav', arg: 'calendar' };
  }
  if (s.indexOf('внимание') >= 0 || s.indexOf('просроченные') >= 0) {
    return { cmd: 'nav', arg: 'overdue' };
  }
  if (s.indexOf('заявки') >= 0) {
    return { cmd: 'nav', arg: 'orders' };
  }
  return null;
}

// --- 3. Движок распознавания ---

// Подсветка/снятие класса со ВСЕХ кнопок (микрофон один, кнопок может быть много).
function vcSetListeningClass(on) {
  var d = vcDoc();
  if (!d || typeof d.querySelectorAll !== 'function') return;
  var nodes = null;
  try { nodes = d.querySelectorAll('.vc-listening'); } catch (e) { return; }
  if (!nodes || !nodes.length) return;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (!el.classList) continue;
    if (on) { if (el.classList.add) el.classList.add('vc-listening'); }
    else if (el.classList.remove) el.classList.remove('vc-listening');
  }
}

function vcMarkButton(targetId) {
  var d = vcDoc();
  if (!d || typeof d.querySelector !== 'function') return;
  var sel = targetId
    ? '[data-voice-field="' + targetId + '"]'
    : '[data-voice-command]';
  var btn = null;
  try { btn = d.querySelector(sel); } catch (e) { return; }
  if (btn && btn.classList && btn.classList.add) btn.classList.add('vc-listening');
}

function vcClearAllListening() {
  var d = vcDoc();
  if (!d || typeof d.querySelectorAll !== 'function') return;
  var nodes = null;
  try { nodes = d.querySelectorAll('[data-voice-field], [data-voice-command]'); } catch (e) { return; }
  if (!nodes || !nodes.length) return;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.classList && el.classList.remove) el.classList.remove('vc-listening');
  }
}

var VC_ERROR_TEXT = {
  'not-allowed': 'Нет доступа к микрофону. Разрешите в настройках браузера',
  'service-not-allowed': 'Нет доступа к микрофону. Разрешите в настройках браузера',
  'no-speech': 'Не расслышал, повторите',
  'network': 'Распознавание требует интернета',
  'audio-capture': 'Микрофон не найден',
  'aborted': ''  // отмена пользователем — без шума
};

function voiceStop() {
  if (VC_REC) {
    try { if (typeof VC_REC.abort === 'function') VC_REC.abort(); } catch (e) { /* уже остановлен */ }
    try { if (typeof VC_REC.stop === 'function') VC_REC.stop(); } catch (e) { /* уже остановлен */ }
  }
  VC_REC = null;
  VC_ACTIVE = false;
  VC_TARGET = '';
  VC_FINAL = '';
  VC_BASE = '';
  vcClearAllListening();
}

// Записать распознанный final в поле: base + ' ' + final, с нормализацией телефона.
function vcWriteToField(targetId, finalText) {
  var el = vcEl(targetId);
  if (!el) return false;
  var base = VC_BASE ? String(VC_BASE) : '';
  var text = String(finalText == null ? '' : finalText).trim();
  if (!text) return false;

  var value;
  if (VC_PHONE_FIELDS[targetId]) {
    var phone = voiceNormalizePhone(text);
    if (phone) {
      value = phone;
    } else {
      value = base ? base + ' ' + text : text;
      vcToast('Проверьте номер вручную', true);
    }
  } else {
    value = base ? base + ' ' + text : text;
  }
  el.value = value.trim();
  return true;
}

function voiceStart(targetInputId) {
  var target = String(targetInputId || '');

  // Кнопка-переключатель: повторное нажатие останавливает.
  if (VC_ACTIVE) {
    voiceStop();
    return false;
  }

  if (!voiceSupported()) {
    vcToast('Диктовка недоступна в этом браузере. Нажмите 🎤 на клавиатуре.', true);
    return false;
  }

  var Ctor = vcCtor();
  if (!Ctor) {
    vcToast('Диктовка недоступна в этом браузере. Нажмите 🎤 на клавиатуре.', true);
    return false;
  }

  VC_TARGET = target;
  VC_FINAL = '';
  VC_LAST = '';
  var fieldEl = target ? vcEl(target) : null;
  VC_BASE = fieldEl && fieldEl.value != null ? String(fieldEl.value) : '';

  var rec;
  try {
    rec = new Ctor();
    rec.lang = 'ru-RU';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
  } catch (e) {
    vcToast('Не удалось запустить диктовку', true);
    voiceStop();
    return false;
  }

  rec.onstart = function () {
    VC_ACTIVE = true;
    vcMarkButton(VC_TARGET);
    vcToast('Слушаю…');
  };

  rec.onresult = function (ev) {
    var interim = '';
    var finalText = '';
    var results = ev && ev.results ? ev.results : null;
    if (!results) return;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r) continue;
      var alt = (r[0] && r[0].transcript) ? String(r[0].transcript) : '';
      if (r.isFinal) finalText += alt;
      else interim += alt;
    }
    VC_LAST = interim || finalText;

    if (VC_TARGET) {
      // interim показываем в поле, но в модель ничего не пишем.
      var el = vcEl(VC_TARGET);
      if (el) {
        if (finalText) {
          vcWriteToField(VC_TARGET, finalText);
          VC_FINAL = '';
        } else if (interim) {
          var base = VC_BASE ? String(VC_BASE) : '';
          el.value = (base ? base + ' ' + interim : interim).trim();
        }
      }
    } else if (finalText) {
      VC_FINAL += (VC_FINAL ? ' ' : '') + finalText;
    }
  };

  rec.onerror = function (ev) {
    var code = (ev && ev.error) ? String(ev.error) : '';
    var msg = Object.prototype.hasOwnProperty.call(VC_ERROR_TEXT, code)
      ? VC_ERROR_TEXT[code]
      : 'Ошибка распознавания';
    voiceStop();
    if (msg) vcToast(msg, true);
  };

  rec.onend = function () {
    var pending = VC_FINAL;
    var wasCommand = !VC_TARGET;
    voiceStop();
    if (wasCommand && pending) voiceHandleCommand(pending);
  };

  VC_REC = rec;
  try {
    rec.start();
  } catch (e) {
    vcToast('Не удалось запустить диктовку', true);
    voiceStop();
    return false;
  }
  return true;
}

// --- 4. Кнопки ---

function renderVoiceFieldBtn(inputId) {
  return '<button class="btn vc-mic" data-voice-field="' + escapeHtml(String(inputId)) +
    '" title="Продиктовать">🎤</button>';
}

function renderVoiceCommandBtn() {
  return '<div class="vc-cmd-wrap">' +
      '<button class="btn vc-cmd" data-voice-command>🎤 Команда</button>' +
    '</div>';
}

// Обёртка поля с микрофоном: <div class="row">…input…🎤</div>.
// Используется только там, где кнопка добавляется к существующему полю.
function voiceFieldRow(inputHtml, inputId) {
  return '<div class="row vc-field-row">' + inputHtml + renderVoiceFieldBtn(inputId) + '</div>';
}

// --- 5. Команды ---

function vcOrder() {
  var id = (typeof state !== 'undefined' && state) ? state.orderId : null;
  if (id === null || id === undefined || id === '') return null;
  var list = (typeof DB !== 'undefined' && DB && Array.isArray(DB.orders)) ? DB.orders : [];
  return list.find(function (x) { return String(x.id) === String(id); }) || null;
}

function vcActionLabel(parsed) {
  var arg = parsed.arg;
  if (parsed.cmd === 'call_custom') return 'Выбрать дату и время перезвона';
  if (arg === 'no_answer') return 'Не дозвонился';
  if (arg === 'later_tomorrow') return 'Перезвонить завтра в 09:00';
  if (arg === 'later_1h') return 'Перезвон через 1 час';
  if (arg === 'later_2h') return 'Перезвон через 2 часа';
  if (arg === 'later_4h') return 'Перезвон через 4 часа';
  if (arg === 'later_24h') return 'Перезвон через 24 часа';
  return String(arg || '');
}

function renderVoiceConfirmModal(parsed, rawText) {
  var o = vcOrder();
  if (!o) {
    vcToast('Откройте заявку, чтобы применить команду', true);
    return false;
  }
  if (typeof showModal !== 'function') {
    vcToast('Модалки недоступны', true);
    return false;
  }
  var num = (typeof orderDisplayNumber === 'function')
    ? orderDisplayNumber(o) : String(o.id != null ? o.id : '—');
  var arg = parsed.arg == null ? '' : String(parsed.arg);
  showModal(
    '<h3>🎤 Подтвердите команду</h3>' +
    '<p class="small muted">Распознано: «' + escapeHtml(String(rawText || '')) + '»</p>' +
    '<p>Заявка №' + escapeHtml(String(num)) + ' — ' + escapeHtml(o.client || '—') + '</p>' +
    '<p class="small muted">Действие: ' + escapeHtml(vcActionLabel(parsed)) + '</p>' +
    '<div class="row">' +
      '<button class="btn" data-close style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" data-voice-confirm="' + escapeHtml(String(parsed.cmd)) +
        '" data-voice-arg="' + escapeHtml(arg) + '" style="flex:1">Подтвердить</button>' +
    '</div>'
  );
  return true;
}

function voiceHandleCommand(text) {
  var raw = String(text == null ? '' : text).trim();
  var parsed = voiceParseCommand(raw);
  if (!parsed) {
    vcToast('Не понял команду: «' + raw + '»', true);
    return false;
  }

  if (parsed.cmd === 'stop') { voiceStop(); return true; }

  if (parsed.cmd === 'digest') {
    if (typeof openDigest !== 'function') { vcToast('Сводка недоступна', true); return false; }
    openDigest();
    return true;
  }

  if (parsed.cmd === 'digest_speak') {
    if (typeof openDigest !== 'function') { vcToast('Сводка недоступна', true); return false; }
    openDigest();
    if (typeof speakDigest === 'function') speakDigest();
    else vcToast('Озвучка недоступна', true);
    return true;
  }

  if (parsed.cmd === 'new_order') {
    if (typeof renderCreateOrderModal !== 'function') {
      vcToast('Модуль заявок не загружен', true);
      return false;
    }
    renderCreateOrderModal();
    return true;
  }

  if (parsed.cmd === 'nav') {
    if (typeof go !== 'function') { vcToast('Навигация недоступна', true); return false; }
    go(parsed.arg);
    return true;
  }

  if (parsed.cmd === 'search') {
    if (typeof ORD_SEARCH === 'undefined') { vcToast('Поиск недоступен', true); return false; }
    ORD_SEARCH = String(parsed.arg || '');
    if (typeof go === 'function') go('orders');
    if (typeof render === 'function') render();
    return true;
  }

  // Изменяющие данные — только через подтверждение.
  if (parsed.cmd === 'call' || parsed.cmd === 'call_custom') {
    return renderVoiceConfirmModal(parsed, raw);
  }

  vcToast('Не понял команду: «' + raw + '»', true);
  return false;
}

// --- 6. Делегирование (capture) ---

document.addEventListener('click', function (ev) {
  var t = ev.target;
  if (!t || typeof t.closest !== 'function') return;

  var fieldBtn = t.closest('[data-voice-field]');
  if (fieldBtn) {
    ev.stopPropagation();
    ev.preventDefault();
    voiceStart(fieldBtn.getAttribute('data-voice-field'));
    return;
  }

  if (t.closest('[data-voice-command]')) {
    ev.stopPropagation();
    ev.preventDefault();
    voiceStart('');
    return;
  }

  var confirmBtn = t.closest('[data-voice-confirm]');
  if (confirmBtn) {
    ev.stopPropagation();
    ev.preventDefault();
    var cmd = String(confirmBtn.getAttribute('data-voice-confirm') || '');
    var arg = String(confirmBtn.getAttribute('data-voice-arg') || '');
    var o = vcOrder();
    if (!o) {
      vcToast('Откройте заявку, чтобы применить команду', true);
      return;
    }
    if (cmd === 'call') {
      if (typeof applyCallResult !== 'function') {
        vcToast('Модуль звонков не загружен', true);
        return;
      }
      var res = applyCallResult(o, arg);
      if (res && res.text) vcToast(res.text, !res.ok);
    } else if (cmd === 'call_custom') {
      if (typeof renderCustomCallbackModal !== 'function') {
        vcToast('Модуль перезвона не загружен', true);
        return;
      }
      renderCustomCallbackModal(o);
      return; // модалку выбора даты не закрываем — её обработает ui-attention.js
    }
    if (typeof closeModal === 'function') closeModal();
    if (typeof render === 'function') render();
    if (typeof refreshDigestIfOpen === 'function') refreshDigestIfOpen();
    return;
  }
}, true);

// --- 7. Автоостановка: страница уходит в фон/закрывается ---

function vcOnHide() {
  if (VC_ACTIVE) voiceStop();
}

if (typeof document !== 'undefined' && document &&
    typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') vcOnHide();
  });
}
if (typeof window !== 'undefined' && window &&
    typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', vcOnHide);
}

// --- 8. Экспорт ---

window.voiceSupported = voiceSupported;
window.voiceStart = voiceStart;
window.voiceStop = voiceStop;
window.voiceNum = voiceNum;
window.voiceNormalizePhone = voiceNormalizePhone;
window.voiceParseCommand = voiceParseCommand;
window.voiceHandleCommand = voiceHandleCommand;
window.renderVoiceFieldBtn = renderVoiceFieldBtn;
window.renderVoiceCommandBtn = renderVoiceCommandBtn;
window.renderVoiceConfirmModal = renderVoiceConfirmModal;
window.voiceFieldRow = voiceFieldRow;
