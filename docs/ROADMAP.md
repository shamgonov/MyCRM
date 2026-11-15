# CRM2 — сводный план (Этапы 0–21 выполнены)

Документ-ориентир. Актуален вместо `SPEC.md` (тот — застывший мастер-промпт, расходится с кодом).
Готовое: Этапы 0–21, 21 модуль `app/`, `SMOKE: pass=1368 fail=0`, `GATE OK`.
Firebase SDK подключён в `index.html` (compat-версия); `app/sync.js` — двусторонняя
синхронизация с Firestore, без SDK приложение молча работает локально.

## Решённые вопросы Q1–Q6 (приняты, реализованы)

| Вопрос | Ответ | Коммит |
|--------|-------|--------|
| Q1. Пушить f388ef4? | **Да**, запушен в origin/main | — |
| Q2. Reward из прибыли? | **Да**, вычитается как расход на оплату труда | d18709e |
| Q3. Единая база суммы? | **Да**, `calculateOrderTotal` = смета = документы = отчёты | d18709e |
| Q4. Переход inwork → postponed? | **Да**, разрешён | 49ee54e |
| Q5. Права контрагентов? | **Отдельные** clients_view / clients_edit | 49ee54e (каталог), Этап 16 |
| Q6. Кто видит деньги? | **Исполнитель + менеджер** (money_view / money_edit) | d18709e |

## Готовые этапы

| Этап | Что | Коммит |
|------|-----|--------|
| 0–11 | Каркас, auth, гейты, заявки, календарь, смета, материалы, документы, напоминания, отчёты, админка | до f388ef4 |
| 12–13 | Вкладка «Деньги», платежи, остаток + напоминалка, reward, единая база суммы | d18709e |
| 14 | Пул, «✋ Взять в работу», подтверждение соисполнителя (o.confirm), inwork→postponed | 49ee54e |
| 15 | «🔄 Перенести остаток», дочерняя заявка №279/1, промежуточный акт | 089909a |
| 16 | Контрагенты: справочник, дедуп, история, досье, выбор в заявке, реквизиты в документах | 8283572 |
| 17 | Теги проблем (чипы + фильтр), шаблоны смет (сохранить/применить), дедуп услуг в прайсе | 948c037 |
| 18 | Поставщики (CRUD в админке), локация материалов (place/supplierId), группировка, маршрут + навигатор, шаринг списка закупок | 8b2d5a0 |
| 19 | «⚠️ Требует внимания» (`app/ui-attention.js`), «Итог звонка» (6 веток, `o.callbackAt`), дайджест 08:30, new→postponed | 9e0db09 |
| 20 | Органайзер (`app/ui-tasks.js`), калькулятор без eval (`app/ui-calc.js`), профиль (`app/ui-profile.js`): PIN, график, уведомления, выход | 9ac89a4 |
| 21 | Синхронизация (`app/sync.js`): очередь офлайн-операций, flushQueue, sanitize, merge:true, onSnapshot; `app/firebase-config.js` + compat-SDK | (этот коммит) |

---

## 0. Правила для всех этапов

- Vanilla JS ES2017+, без сборщика, без `?.` и `??`, без внешних библиотек.
- Глобальные `function` / `var` / `const`; для `const` обязателен `window.*`-экспорт.
- Экраны — в `S` (`app/core.js`) через ленивые `typeof fn === 'function'` обёртки.
- События — делегирование `document.addEventListener` + `data-*`; смена `<select>` — на `change`.
- Кнопки внутри кликабельной карточки (`[data-order]`) обрабатывать ДО обработчика карточки.
- Модалки — `showModal()` / `closeModal()` + контекст в `window.__*`.
- Таблицы — на CSS-grid (`arow` / `rrow` / `mrow`), не `<td>` вне `<table>`.
- Инлайн-скриптов (`onclick`) — нет. `styles/theme.css` не трогать.
  ⚠️ Firebase SDK подключён на Этапе 20 (compat-версия, index.html);
  `app/firebase-config.js` — конфигурация, инициализируется при наличии SDK.
- Сохранение — глобальный `save()` из `db.js`; заявка — `saveOrderLocal(o)`.
- Каждый этап: модуль/правка + `<script>` в `index.html` + смоук + `node tools/check-modules.js`.
- Проверка: `node tools/check-modules.js && node tools/smoke/run.js && node --check app/<новый>.js`.
- Если якорь для правки не найден — СТОП, спросить, не выдумывать.

### Текущая модель данных (итог Этапов 12–21)
- `o.payments[]` — `{ id, sum, date, method:'cash'|'card'|'transfer', by, note }`.
- `o.confirm = { имя: 'pending'|'ok'|'no' }`, `o.takenAt`, `o.takenBy`.
- `o.moneyReminderAt`, `o.rewardPct` (переопределяет `DB.settings.rewardPctDefault`).
- `o.parentId`, `o.childNo`, `o.followUpIds[]` — связи переноса остатка.
- `o.clientId`, `o.clientLegal` — привязка к контрагенту (Этап 16).
- `o.tags[]` — теги проблемы; пресеты в `DB.settings.tagPresets` (Этап 17).
- `o.routeIgnored = { ключ: true }` — «игнорировать точку маршрута» (Этап 18).
- `o.callbackAt` — timestamp перезвона по «Итогу звонка»; null = не назначен (Этап 19).
- `DB.templates[{ id, name, kind:'estimate', works:[{ name, qty, unit, price, coeff }], tags[] }]` (Этап 17).
- `DB.suppliers[{ id, name, phone, address, hours, note }]` (Этап 18).
- `DB.clients[{ id, kind:'person'|'ip'|'company', name, inn, kpp, ogrn, phone, email, city, address, notes, orderIds[], createdAt, createdBy }]`.
- `DB.tasks[{ id, title, note, orderId|null, done, createdAt, dueDate|null, by }]` — органайзер (Этап 20).
- `DB.syncQueue[{ type:'save'|'patch', collection, docId, data, ts }]` — офлайн-очередь Firestore (Этап 21).
- `DB.settings.warehouseAddress` — адрес склада для маршрута закупки (Этап 18).
- `DB.settings.digestShownToday` — дата (YYYY-MM-DD) показанного утреннего дайджеста (Этап 19).
- `DB.settings.schedule = { Mon..Sun: { from:'HH:MM', to:'HH:MM', off:bool } }` — график работы (Этап 20).
- `DB.settings.notifyEnabled` — пользователь согласился на системные уведомления.
- База суммы одна: `calculateOrderTotal()` (работы × coeff + agreed доп. + материалы при `matsInTotal`).
- Функции: `orderRevenue/orderPaid/orderBalance`, `addPayment/removePayment`,
  `orderRewardPct/orderReward`, `takeOrder/assignHelper/confirmHelper`,
  `createFollowUpOrder/orderDisplayNumber`, `normalizeClientName/findSimilarClients/buildClientDossier`,
  `addTag/removeTag/allOrderTags`, `saveTemplate/applyTemplate`,
  `findSimilarPriceItems/wordLooksSimilar/levenshtein`,
  `saveSupplier/deleteSupplier/findSupplier`,
  `materialGroupKey/materialGroupLabel/groupMaterialsBySupplier`,
  `buildPurchaseRoute/navigatorUrl`, `MAT_PLACES`, `MAT_PLACE_LABELS`,
  `renderAttention/attentionGroups/isCallbackDue`,
  `renderCallResultModal/applyCallResult/CALL_BRANCHES`,
  `buildDigestText/maybeDigest` (notify.js),
  `normalizeTask/addTask/updateTask/toggleTask/deleteTask/findTask`,
  `tasksForOrder/tasksByFilter/renderTasks/renderTaskModal/renderOrderTasksBlock` (ui-tasks.js),
  `evaluateExpression/calcTokenize/calcParse/calcFormat/openCalcModal/renderCalcButton` (ui-calc.js),
  `renderProfile/renderPinModal/renderScheduleModal/schedule/defaultSchedule/saveSchedule`,
  `currentUserRecord/pinStatusText/notifyStatusText` (ui-profile.js),
  `initSync/sanitize/queueOperation/orderSave/orderPatch/flushQueue` (sync.js).

### Осталось пустовать
- Пустых коллекций в модели нет: `DB.suppliers` ведётся в админке (Этап 18),
  `DB.tasks` — в органайзере (Этап 20).

---

## Этап 21 — как реализовано

- `app/firebase-config.js` — конфигурация проекта (compat-SDK в `index.html` до `app/db.js`).
- `app/sync.js`:
  - `initSync()` — без `firebase` возвращает false (локальный режим без ошибок);
    иначе `initializeApp` (если ещё не создан), persistence, `onSnapshot('orders')`
    с merge-применением удалённых изменений в `DB.orders` (локальные операции из
    очереди не затираются).
  - `sanitize(obj)` — рекурсивная чистка `undefined` (SPEC 3).
  - `queueOperation` → `DB.syncQueue` + `save()` + `flushQueue()`.
  - `orderSave(o)` — `{type:'save'}` → `set(data, { merge: true })` (SPEC 4);
    `orderPatch(id, fields)` — `{type:'patch'}` → `update(data)` (SPEC 5).
  - `flushQueue()` — голова очереди снимается ДО отправки (SPEC 6); `unavailable` →
    операция возвращается в голову + пауза до новой операции/события `online`;
    `permission-denied` → пропуск с toast. Флаги SYNC_FLUSHING/SYNC_PAUSED гасят
    рекурсию save() → flushQueue() → save().
- Интеграция: `db.js save()` вызывает `window.flushQueue()`;
  `orders.js saveOrderLocal()` — `window.orderSave(o)` с фолбэком на `save()`.
- Очередь переживает перезагрузку (`DB.syncQueue` в localStorage, миграция в `load()`).

**Смоук:** `_sync_smoke.js` (65 проверок, вкл. мок Firestore).

---

## Порядок работ

Этапы 0–21 выполнены. Дальше — только по запросу пользователя
(варианты: права Firestore под роли в `firestore.rules`, UI-индикатор статуса
синхронизации, деплой).
Каждый этап — отдельный коммит; перед коммитом полный прогон проверок.
