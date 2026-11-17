/* Смоук Этапа 14-B: облачная идентичность (uid → users/{uid}), клейм владельца
   через meta/bootstrap, applyCloudIdentity, cloudApproved, syncAccessChanged
   (пауза/разблокировка и однократный старт слушателей), flushQueue по доступу,
   renderAccessBanner, вкладка «Доступ» (renderAdminAccess/setAccess),
   локальный фолбэк без Firebase и содержимое firestore.rules.

   Мок- Firestore/Auth возвращает СИНХРОННЫЕ thenable-объекты (см. okP/errP):
   раннер smoke не дожидается нативных промисов, а логика 14-B целиком
   построена на цепочках .then/.catch, которые должны отработать до
   следующей assert-проверки. */
'use strict';

// --- DOM / окружение ---

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
var HANDLERS = { click: [], change: [] };

globalThis.document = {
  readyState: 'loading',
  getElementById: function (id) {
    if (id === 'app') return appStub;
    if (id === 'nav') return navStub;
    if (id === 'modal-container') return modalStub;
    return null;
  },
  addEventListener: function (type, fn) {
    if (HANDLERS[type]) HANDLERS[type].push(fn);
  }
};
globalThis.confirm = function () { return true; };
globalThis.alert = function () {};
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.addEventListener = function () {};

// Эмуляция клика/изменения по элементу с нужным data-атрибутом.
function fireClick(attr, value) { fire(HANDLERS.click, attr, value, value); }
// Для select-элемента: в data-атрибуте — id пользователя, в .value — новая роль.
function fireChange(attr, id, newValue) { fire(HANDLERS.change, attr, id, newValue); }
function fire(list, attr, attrValue, elementValue) {
  var target = {
    value: elementValue === undefined || elementValue === null ? '' : String(elementValue),
    getAttribute: function (n) { return n === attr ? String(attrValue) : null; },
    closest: function (selector) {
      return selector === '[' + attr + ']' ? target : null;
    }
  };
  list.forEach(function (fn) { fn({ target: target }); });
}

// --- Синхронные thenable-обёртки ---
// Нативный промис разворачивает thenable, возвращённый из onOk, — мок обязан
// делать то же самое, иначе цепочки ensureMyUserDoc вернут «обёртку обёртки».
function isP(r) { return !!r && typeof r.then === 'function'; }
function unwrap(r) {
  var guard = 0;
  while (isP(r) && r._err === undefined && guard++ < 25) r = r._val;
  return r;
}
function okP(val) {
  var v = unwrap(val);
  return {
    then: function (onOk, onErr) {
      try {
        return typeof onOk === 'function' ? okP(onOk(v)) : okP(v);
      } catch (e) { return errP(e); }
    },
    catch: function () { return okP(v); },
    _val: v
  };
}
function errP(err) {
  var e = unwrap(err);
  return {
    then: function (onOk, onErr) {
      try {
        return typeof onErr === 'function' ? okP(onErr(e)) : errP(e);
      } catch (x) { return errP(x); }
    },
    catch: function (onErr) {
      try { return okP(onErr(e)); } catch (x) { return errP(x); }
    },
    _err: e
  };
}

// --- Мок Firebase ---
// store: 'users/u1' → объект (или undefined = документа нет).
// MOCK.uid — текущий анонимный uid; MOCK.failBootstrapSet — гонка за владельца.
// MOCK.ops — set/update/delete; MOCK.subs — подписки (коллекция или документ).
var MOCK = {
  uid: 'u1',
  store: {},
  ops: [],
  subs: [],
  failBootstrapSet: false,
  user: function () { return { uid: MOCK.uid }; }
};

function snapOf(id) {
  var d = MOCK.store[id];
  var exists = d !== undefined && d !== null;
  return {
    exists: exists,
    data: function () { return exists ? d : undefined; }
  };
}

globalThis.firebase = {
  apps: [{}],
  initializeApp: function () {},
  auth: function () {
    return {
      currentUser: MOCK.user(),
      signInAnonymously: function () { return okP(MOCK.user()); },
      signOut: function () { return okP(null); },
      onAuthStateChanged: function (cb) {
        MOCK.authCb = cb;
        return function () {};
      }
    };
  },
  firestore: function () {
    return {
      enablePersistence: function () {},
      collection: function (name) {
        return {
          onSnapshot: function (cb) {
            MOCK.subs.push({ coll: name, docId: null, cb: cb });
            return function () {};
          },
          doc: function (id) {
            return {
              get: function () { return okP(snapOf(name + '/' + id)); },
              set: function (data, opts) {
                if (name === 'meta' && id === 'bootstrap' && MOCK.failBootstrapSet) {
                  MOCK.ops.push({ t: 'set', coll: name, id: id, data: data });
                  return errP({ code: 'permission-denied' });
                }
                MOCK.ops.push({ t: 'set', coll: name, id: id, data: data, opts: opts || {} });
                MOCK.store[name + '/' + id] = data;
                return okP(undefined);
              },
              update: function (data) {
                MOCK.ops.push({ t: 'update', coll: name, id: id, data: data });
                var cur = MOCK.store[name + '/' + id] || {};
                Object.keys(data).forEach(function (k) { cur[k] = data[k]; });
                MOCK.store[name + '/' + id] = cur;
                return okP(undefined);
              },
              delete: function () {
                MOCK.ops.push({ t: 'delete', coll: name, id: id });
                delete MOCK.store[name + '/' + id];
                return okP(undefined);
              },
              onSnapshot: function (cb) {
                MOCK.subs.push({ coll: name, docId: id, cb: cb });
                return function () {};
              }
            };
          }
        };
      }
    };
  }
};

// Разворачивает результат цепочки thenable в значение (смоук синхронный,
// нативные промисы раннером не «выжидаются»).
function val(p) {
  if (p && typeof p.then === 'function') return p._val;
  return p;
}

// Подписка на users/{uid}: применяет документ как watchMyAccess.
function fireMyAccess(data) {
  var sub = MOCK.subs.filter(function (s) {
    return s.coll === 'users' && s.docId === MOCK.uid;
  })[0];
  if (!sub) return false;
  sub.cb({ exists: data !== undefined, data: function () { return data; } });
  return true;
}
function countSubs(name) {
  return MOCK.subs.filter(function (s) { return s.coll === name; }).length;
}

// Порядок загрузки как в index.html (sync — после ui-admin, с гардом доступа).
loadModule('app/db.js');
loadModule('app/auth.js');
loadModule('app/core.js');
loadModule('app/gates.js');
loadModule('app/orders.js');
loadModule('app/ui-admin.js');

setOwnerFlag(false);
DB.users = [];
DB.syncQueue = [];
DB.orders = [];

// --- 1. Свободный bootstrap → первый вошедший становится владельцем ---

MOCK.uid = 'u1';
login('worker', 'Владелец'); // локально выбран «Мастер», облако должно поднять до admin
var rec1 = val(ensureMyUserDoc('Владелец'));
assert(rec1 && rec1.role === 'owner', '1: первый uid получил роль owner');
assert.eq(rec1.status, 'approved', '1: владелец сразу approved');
assert.eq(MOCK.store['users/u1'].role, 'owner', '1: users/u1 записан с role=owner');
assert.eq(MOCK.store['users/u1'].uid, 'u1', '1: поле uid совпадает с id документа');
assert.eq(MOCK.store['meta/bootstrap'].ownerUid, 'u1', '1: bootstrap.ownerUid = первый uid');
assert.eq(state.uid, 'u1', '1: state.uid из Firebase');
assert.eq(lsGet('crm2_uid', ''), 'u1', '1: uid сохранён в localStorage');
assert.eq(state.cloudRole, 'owner', '1: state.cloudRole=owner');
assert.eq(state.cloudStatus, 'approved', '1: state.cloudStatus=approved');
assert.eq(state.cloudActive, true, '1: state.cloudActive=true');
assert.eq(state.role, 'admin', '1: owner → локальная роль admin');
assert.eq(JSON.parse(lsGet('crm2_test_user', '{}')).role, 'admin',
  '1: сессия перезаписана ролью из облака');

// bootstrap пишется с merge (не затираем чужие поля) и до записи пользователя.
var bootOps = MOCK.ops.filter(function (o) { return o.coll === 'meta'; });
assert.eq(bootOps.length, 1, '1: bootstrap записан один раз');
assert.eq(bootOps[0].opts.merge, true, '1: bootstrap set с merge:true');
assert.eq(MOCK.ops[0].coll, 'meta', '1: bootstrap раньше документа пользователя');

// Существующий документ не пересоздаётся (идемпотентность входа).
MOCK.ops = [];
var rec1b = val(ensureMyUserDoc('Владелец'));
assert.eq(rec1b.role, 'owner', '1: существующий users/u1 → роль не изменилась');
assert.eq(MOCK.ops.length, 0, '1: существующий документ не перезаписывается');

// --- 2. Bootstrap занят → worker + pending, владелец не перезаписан ---

MOCK.uid = 'u2';
MOCK.ops = [];
login('worker', 'Мастер');
var rec2 = val(ensureMyUserDoc('Мастер'));
assert.eq(rec2.role, 'worker', '2: второй вошедший → worker');
assert.eq(rec2.status, 'pending', '2: второй вошедший → pending');
assert.eq(MOCK.store['users/u2'].status, 'pending', '2: users/u2 записан как pending');
assert.eq(MOCK.store['meta/bootstrap'].ownerUid, 'u1', '2: bootstrap владельца НЕ перезаписан');
assert.eq(MOCK.ops.filter(function (o) { return o.coll === 'meta'; }).length, 0,
  '2: к занятому bootstrap записи нет');
assert.eq(state.cloudStatus, 'pending', '2: state.cloudStatus=pending');
assert.eq(state.role, 'worker', '2: pending → локальная роль не повышена');

// --- 3. Гонка за владельца: set bootstrap отклонён → worker/pending ---
// bootstrap освобождён (его ещё нет) — оба браузера считают его свободным,
// но запись в meta/bootstrap у проигравшего отклоняется правилами.

MOCK.uid = 'u3';
MOCK.ops = [];
delete MOCK.store['meta/bootstrap'];
MOCK.failBootstrapSet = true;
login('worker', 'Антон');
var rec3 = val(ensureMyUserDoc('Антон'));
assert.eq(rec3.role, 'worker', '3: проигравший гонку → worker');
assert.eq(rec3.status, 'pending', '3: проигравший гонку → pending');
assert.eq(MOCK.store['users/u3'].status, 'pending', '3: users/u3 записан pending');
assert(MOCK.ops.some(function (o) { return o.coll === 'users' && o.id === 'u3'; }),
  '3: документ пользователя создан после отказа bootstrap');
MOCK.failBootstrapSet = false;

// --- 4. applyCloudIdentity: сопоставление ролей и сессии ---

state.role = 'manager';
applyCloudIdentity({ role: 'owner', status: 'approved', active: true });
assert.eq(state.cloudRole, 'owner', '4: owner → cloudRole=owner');
assert.eq(state.role, 'admin', '4: approved owner → admin');
assert.eq(JSON.parse(lsGet('crm2_test_user', '{}')).role, 'admin', '4: сессия обновлена');

state.role = 'manager';
applyCloudIdentity({ role: 'operator', status: 'approved', active: true });
assert.eq(state.role, 'operator', '4: approved operator → operator');

state.role = 'manager';
applyCloudIdentity({ role: 'worker', status: 'pending', active: true });
assert.eq(state.role, 'manager', '4: pending → локальная роль не меняется');
assert.eq(state.cloudStatus, 'pending', '4: pending записан в state');

state.role = 'operator';
applyCloudIdentity({ role: 'admin', status: 'approved', active: false });
assert.eq(state.role, 'operator', '4: active=false → роль не меняется');
assert.eq(state.cloudActive, false, '4: active=false записан');

// unknown-роль из облака не ломает локальную
state.role = 'manager';
applyCloudIdentity({ role: 'guest', status: 'approved', active: true });
assert.eq(state.role, 'manager', '4: неизвестная облачная роль → локальная сохранена');

// --- 5. cloudApproved: таблица статусов ---

state.cloudStatus = 'approved'; state.cloudActive = true;
assert.eq(cloudApproved(), true, '5: approved + active → true');
state.cloudStatus = 'pending'; state.cloudActive = true;
assert.eq(cloudApproved(), false, '5: pending → false');
state.cloudStatus = 'approved'; state.cloudActive = false;
assert.eq(cloudApproved(), false, '5: approved, но active=false → false');
state.cloudStatus = 'fired'; state.cloudActive = false;
assert.eq(cloudApproved(), false, '5: fired → false');
state.cloudStatus = null; state.cloudActive = true;
assert.eq(cloudApproved(), false, '5: null (ещё не прочитано) → false');

// Готовим «ожидание подтверждения» перед загрузкой sync.js.
state.cloudRole = 'worker'; state.cloudStatus = 'pending'; state.cloudActive = true;

// --- sync.js: при pending слушатели НЕ стартуют ---

loadModule('app/sync.js'); // initSync() видит cloudApproved()===false
assert.eq(MOCK.subs.length, 0, 'pending: initSync не подписывается на облако');
assert.eq(SYNC_LISTENERS_ON, false, 'pending: слушатели не запущены');

// --- 6/7. Очередь при pending копится, не отправляясь ---

MOCK.ops = [];
DB.syncQueue = [];
assert.eq(orderSave({ id: 42, client: 'Ожидание', status: 'new' }), true,
  '7: операция принята в очередь');
assert.eq(DB.syncQueue.length, 1, '7: pending → операция осталась в очереди');
assert.eq(MOCK.ops.length, 0, '7: pending → в облако ничего не ушло');
assert.eq(SYNC_PAUSED, true, '7: pending → очередь на паузе');

// syncAccessChanged: подтверждение → слушатели + снятие паузы + flush.
applyCloudIdentity({ role: 'worker', status: 'approved', active: true });
assert.eq(SYNC_PAUSED, false, '6: подтверждение сняло паузу очереди');
assert.eq(SYNC_LISTENERS_ON, true, '6: подтверждение запустило слушатели');
assert(countSubs('orders') >= 1, '6: подписка на orders после подтверждения');
assert(countSubs('clients') >= 1, '6: подписка на справочники после подтверждения');
// worker по правилам не читает чужие users/* → подписка на коллекцию пропущена.
assert.eq(countSubs('users'), 0, '6: worker не подписывается на коллекцию users');
assert.eq(countSubs('settings'), 1, '6: подписан settings/org');
assert.eq(DB.syncQueue.length, 0, '6: подтверждение слило накопленную очередь');
assert.eq(MOCK.ops.length, 1, '6: очередь ушла в облако');
assert.eq(MOCK.ops[0].coll, 'orders', '6: отправлена заявка');
assert.eq(MOCK.ops[0].opts.merge, true, '6: set с merge:true (SPEC 4)');

// Повторное подтверждение не плодит подписки (идемпотентность).
var subsAfter = MOCK.subs.length;
applyCloudIdentity({ role: 'owner', status: 'approved', active: true });
assert.eq(MOCK.subs.length, subsAfter, '6: слушатели стартуют ровно один раз');
assert.eq(state.role, 'admin', '6: подтверждённый owner → admin');

// Доступ закрыт → снова пауза, очередь копится.
applyCloudIdentity({ role: 'worker', status: 'fired', active: false });
MOCK.ops = [];
DB.syncQueue = [];
orderPatch(42, { status: 'inwork' });
assert.eq(SYNC_PAUSED, true, 'fired: очередь снова на паузе');
assert.eq(DB.syncQueue.length, 1, 'fired: операция осталась локально');
assert.eq(MOCK.ops.length, 0, 'fired: в облако ничего не ушло');

// Возврат доступа → очередь разбирается.
state.cloudRole = 'worker'; state.cloudStatus = 'approved'; state.cloudActive = true;
syncAccessChanged();
assert.eq(DB.syncQueue.length, 0, 'возврат доступа: очередь отправлена');
assert.eq(MOCK.ops.length, 1, 'возврат доступа: одна операция в облаке');

// --- 8. Баннер статуса доступа ---

state.role = 'worker';
state.cloudStatus = 'approved'; state.cloudActive = true;
assert.eq(renderAccessBanner(), '', '8: подтверждённый доступ → баннера нет');

state.cloudStatus = 'pending'; state.cloudActive = true;
var bPending = renderAccessBanner();
assert(bPending.indexOf('⏳') >= 0, '8: pending → ⏳');
assert(bPending.indexOf('ожидает подтверждения') >= 0, '8: pending → текст про владельца');

state.cloudStatus = 'fired'; state.cloudActive = false;
var bFired = renderAccessBanner();
assert(bFired.indexOf('🚫') >= 0, '8: fired → 🚫');
assert(bFired.indexOf('только локально') >= 0, '8: fired → текст про локальный режим');

state.cloudStatus = null; state.cloudActive = true;
assert(renderAccessBanner().indexOf('🔌') >= 0, '8: статус не прочитан → 🔌');

var savedRole = state.role;
state.role = null;
assert.eq(renderAccessBanner(), '', '8: до входа баннера нет');
state.role = savedRole;

// Баннер встраивается в render() над экраном.
state.cloudStatus = 'pending'; state.cloudActive = true;
state.screen = 'orders';
render();
assert(appStub.innerHTML.indexOf('⏳') >= 0, '8: render() показал баннер над экраном');
assert(appStub.innerHTML.indexOf('Заявки') >= 0, '8: экран под баннером на месте');
state.cloudStatus = 'approved';
render();
assert.eq(appStub.innerHTML.indexOf('⏳'), -1, '8: approved → в render баннера нет');

// --- 9. setAccess: правка users/{uid} + отправка в облако ---

state.role = 'admin';
DB.users = [
  { id: 'u2', uid: 'u2', name: 'Мастер', role: 'worker', status: 'pending', active: true },
  { id: 'dev-owner', uid: '', name: 'Владелец', role: 'admin' }
];
MOCK.ops = [];
assert.eq(setAccess('u2', { status: 'approved', active: true }), true, '9: setAccess → true');
assert.eq(DB.users[0].status, 'approved', '9: статус применён локально');
assert.eq(MOCK.ops.length, 1, '9: изменение отправлено в облако');
assert.eq(MOCK.ops[0].coll, 'users', '9: коллекция users');
assert.eq(MOCK.ops[0].id, 'u2', '9: docId = uid');
assert.eq(MOCK.ops[0].data.status, 'approved', '9: в облако ушёл новый статус');
assert.eq(JSON.parse(lsGet('crm2_db', '{}')).users[0].status, 'approved',
  '9: setAccess вызвал save() — правка в localStorage');
assert.eq(setAccess('no-such-id', { status: 'approved' }), false, '9: нет пользователя → false');

// --- 10. Вкладка «Доступ» ---

var tabsHtml = renderAdmin();
assert(tabsHtml.indexOf('data-admin-tab="access"') >= 0, '10: таб access есть');
assert(tabsHtml.indexOf('Доступ') >= 0, '10: подпись вкладки');

DB.users = [
  { id: 'u2', uid: 'u2', name: 'Мастер', role: 'worker', status: 'pending', active: true },
  { id: 'u5', uid: 'u5', name: 'Ольга', role: 'operator', status: 'approved', active: true },
  { id: 'dev-owner', uid: '', name: 'Владелец', role: 'admin' }
];
ADMIN_TAB = 'access';
var html10 = renderAdmin();
assert(html10.indexOf('data-access-approve="u2"') >= 0, '10: кнопка подтверждения у pending');
assert(html10.indexOf('data-access-block="u2"') >= 0, '10: кнопка блокировки');
assert(html10.indexOf('data-access-role="u2"') >= 0, '10: select роли');
assert(html10.indexOf('data-access-role="u5"') >= 0, '10: select роли для approved');
assert(html10.indexOf('data-access-approve="u5"') < 0, '10: approved → кнопки подтверждения нет');
assert(html10.indexOf('ожидает') >= 0, '10: бейдж «ожидает»');
assert(html10.indexOf('доступен') >= 0, '10: бейдж «доступен»');
assert(html10.indexOf('Мастер') >= 0 && html10.indexOf('Ольга') >= 0, '10: имена облачных');
// Локальный реестр (id !== uid) на вкладку не попадает.
assert(html10.indexOf('Владелец') < 0, '10: не-uid запись скрыта');
assert(accessRoleOptions('operator').indexOf('value="operator" selected') >= 0,
  '10: текущая роль выбрана в select');
assert(accessRoleOptions('worker').indexOf('owner') >= 0, '10: роль owner доступна');

// Пустая lista — понятная заглушка, не падение.
DB.users = [];
assert(renderAdminAccess().indexOf('Облачных пользователей пока нет') >= 0,
  '10: нет облачных пользователей → заглушка');

// Делегат подтверждения: approve → approved+active + отправка.
DB.users = [
  { id: 'u2', uid: 'u2', name: 'Мастер', role: 'worker', status: 'pending', active: true }
];
MOCK.ops = [];
fireClick('data-access-approve', 'u2');
assert.eq(DB.users[0].status, 'approved', 'делегат: подтверждение записало статус');
assert.eq(DB.users[0].active, true, 'делегат: active=true');
assert.eq(MOCK.ops.length, 1, 'делегат: подтверждение отправлено в облако');

// Делегат блокировки.
fireClick('data-access-block', 'u2');
assert.eq(DB.users[0].status, 'fired', 'делегат: блокировка → fired');
assert.eq(DB.users[0].active, false, 'делегат: active=false');

// Смена роли облачного пользователя через change-делегат.
fireChange('data-access-role', 'u2', 'manager');
assert.eq(DB.users[0].role, 'manager', 'делегат: select сменил роль');

// --- 11. Локальный фолбэк: без Firebase ничего не ломается ---

var savedFb = globalThis.firebase;
delete globalThis.firebase;
assert.eq(cloudAvailable(), false, '11: без firebase cloudAvailable → false');
var savedUid = state.uid;
var pNull = ensureMyUserDoc('БезОблака');
assert(pNull && typeof pNull.then === 'function',
  '11: ensureMyUserDoc без firebase → промис (резолвится в null), не исключение');
assert.eq(state.uid, savedUid, '11: без firebase state.uid не тронут');
assert.eq(typeof watchMyAccess(), 'undefined', '11: watchMyAccess без firebase → undefined');
resumeCloudSession();
assert(true, '11: resumeCloudSession без firebase не падает');
state.cloudStatus = 'pending'; state.cloudActive = true;
assert.eq(renderAccessBanner(), '', '11: без firebase баннер пустой (работаем локально)');
globalThis.firebase = savedFb;

// --- 12. firestore.rules: содержимое (деплой — следующий шаг) ---

// Правила читаются с диска (деплой — отдельный следующий шаг). Пути
// перебираются: запуск возможен и из корня, и из tools/smoke.
function readRules() {
  var tries = ['firestore.rules', path.join('..', '..', 'firestore.rules')];
  for (var i = 0; i < tries.length; i++) {
    try { return fs.readFileSync(tries[i], 'utf8'); } catch (e) { /* пробуем дальше */ }
  }
  return '';
}
var rulesText = readRules();
assert(rulesText.length > 0, '12: firestore.rules найден и прочитан');
assert(rulesText.indexOf('isActive()') >= 0, '12: rules использует isActive()');
assert(rulesText.indexOf('isOwnerOrAdmin()') >= 0, '12: rules использует isOwnerOrAdmin()');
assert(rulesText.indexOf('workerKeys()') >= 0, '12: rules ограничивает поля workerKeys()');
assert(rulesText.indexOf('meta/bootstrap') >= 0, '12: rules описывает meta/bootstrap');
assert(rulesText.indexOf('match /users/{userId}') >= 0, '12: rules описывает users');
assert(rulesText.indexOf('if true') < 0, '12: rules НЕ содержит «if true»');
assert(rulesText.indexOf('match /{document=**}') >= 0, '12: rules имеет deny по умолчанию');

// --- 13. Экспорты/typeof ---

['cloudAvailable', 'myUserRef', 'bootstrapRef', 'cloudApproved', 'ensureMyUserDoc',
 'applyCloudIdentity', 'watchMyAccess', 'resumeCloudSession', 'renderAccessBanner',
 'startOrdersListener', 'syncAccessChanged', 'renderAdminAccess', 'setAccess',
 'accessRoleOptions'].forEach(function (n) {
  assert(typeof globalThis[n] === 'function', 'typeof ' + n);
});
