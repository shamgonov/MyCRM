# CRM2 — сводный план остатка (Этап 21)

Документ-ориентир. Актуален вместо `SPEC.md` (тот — застывший мастер-промпт, расходится с кодом).
Готовое: Этапы 0–20, 19 модулей `app/`, `SMOKE: pass=1303 fail=0`, `GATE OK`.

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
| 20 | Органайзер (`app/ui-tasks.js`), калькулятор без eval (`app/ui-calc.js`), профиль (`app/ui-profile.js`): PIN, график, уведомления, выход | (этот коммит) |

---

## 0. Правила для всех этапов

- Vanilla JS ES2017+, без сборщика, без `?.` и `??`, без внешних библиотек.
- Глобальные `function` / `var` / `const`; для `const` обязателен `window.*`-экспорт.
- Экраны — в `S` (`app/core.js`) через ленивые `typeof fn === 'function'` обёртки.
- События — делегирование `document.addEventListener` + `data-*`; смена `<select>` — на `change`.
- Кнопки внутри кликабельной карточки (`[data-order]`) обрабатывать ДО обработчика карточки.
- Модалки — `showModal()` / `closeModal()` + контекст в `window.__*`.
- Таблицы — на CSS-grid (`arow` / `rrow` / `mrow`), не `<td>` вне `<table>`.
- Инлайн-скриптов (`onclick`) — нет. `styles/theme.css` не трогать. Firebase/PDF/деплой — нет.
- Сохранение — глобальный `save()` из `db.js`; заявка — `saveOrderLocal(o)`.
- Каждый этап: модуль/правка + `<script>` в `index.html` + смоук + `node tools/check-modules.js`.
- Проверка: `node tools/check-modules.js && node tools/smoke/run.js && node --check app/<новый>.js`.
- Если якорь для правки не найден — СТОП, спросить, не выдумывать.

### Текущая модель данных (итог Этапов 12–20)
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
  `currentUserRecord/pinStatusText/notifyStatusText` (ui-profile.js).

### Осталось пустовать
- Пустых коллекций в модели нет: `DB.suppliers` ведётся в админке (Этап 18),
  `DB.tasks` — в органайзере (Этап 20).

---

## Этап 21 — Синхронизация (отложен намеренно)

Только резерв: `app/sync.js` поверх `save()` (хук `window.__onSave` уже есть), политика конфликтов last-write + история, офлайн-очередь, `firestore.rules` по ролям. Firebase не подключать и деплой не выполнять, пока пользователь не скажет.

---

## Порядок работ

Остался Этап 21 — только по отдельному решению пользователя.
Каждый этап — отдельный коммит; перед коммитом полный прогон проверок.
