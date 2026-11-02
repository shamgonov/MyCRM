# ЗАДАЧА: Создать CRM2 с нуля в E:\MyCRM
Ты — lead-разработчик. Строишь PWA для сервисной компании (ремонт окон).
Стек: Firebase Firestore + Auth (Phone) + PWA + GitHub Pages.
Язык: vanilla JS, ES2017+, без фреймворков, без сборщика.

## АРХИТЕКТУРА (МОДУЛЬНАЯ, НЕ МОНОЛИТ)

MyCRM/
├── index.html — только оболочка: <head>, <div id="app">, <nav id="nav">,
│ подключение модулей через <script src="app/...">.
│ НОЛЬ инлайн-скриптов.
├── app/
│ ├── core.js — state, go(), render(), роутер экранов
│ ├── db.js — локальный кэш (localStorage), defaultData()
│ ├── sync.js — Firestore: onSnapshot, queue, flushQueue, orderSave/orderPatch
│ ├── auth.js — вход по телефону+код, роли, can(), deviceId
│ ├── gates.js — ВСЕ гейты доступа в одном месте (isAssignedToMe, canEditOrder…)
│ ├── orders.js — домен заявок: модель, статусы, история, этапы
│ ├── notify.js — события, бейджи, напоминания (просрочка/выезд/завтра)
│ ├── ui-orders.js — список заявок, карточка, формы создания/редактирования
│ ├── ui-calendar.js — общий + мой календарь
│ ├── ui-shopping.js — закупки, брак, компенсации
│ ├── ui-clients.js — контрагенты с дедупликацией
│ ├── ui-reports.js — отчёты по прибыли, дележка
│ ├── ui-admin.js — сотрудники, роли, шаблоны, реквизиты
│ └── ui-profile.js — профиль, PIN, уведомления
├── styles/
│ └── theme.css — CSS-переменные (тёмная тема чёрный/жёлтый)
├── tools/
│ ├── check-modules.js — гейт: все модули парсятся
│ ├── deploy.js — bump версии + sw.js + version.json
│ └── smoke/ — тесты по модулям
├── sw.js — service worker (кэш, notificationclick)
├── version.json
├── manifest.webmanifest
├── firestore.rules
├── .gitignore
└── SPEC.md — этот документ

## МОДЕЛЬ ДАННЫХ
**orders/{id}**:
- id (number), client, phone, address, region, city, street
- date (YYYY-MM-DD локальная), t1, t2 (HH:MM)
- type: 'standard'|'manufacture'|'service'
- status: 'new'|'inspection'|'estimate'|'approved'|'inwork'|'paused'|'waiting'|'postponed'|'completed'|'paid'|'canceled'
- examiner (кто осматривал), worker (основной исполнитель), helpers[] (соисполнители, имена)
- confirm: {имя: 'pending'|'ok'|'no'} — подтверждение участия
- works[]: {title, qty, price, unit, done, skipped} — смета
- extras[]: {name, qty, price, unit, status:'pending_agree'|'agreed'|'rejected'} — доп. работы
- materials[]: {name, qty, price, munit, buyer, payer, where, deadline, unit, status, factPrice, spoiled:{reason,dt,by}, refund:'none'|'pending'|'paid'}
- payments[]: {id, sum, type, method, date, note}
- stages[]: {id, type, title, plan_start, plan_ready, done, by, ts_done, autoOnly}
- route[]: {id, type, title, address, status, ts_arrived, ts_done, geo}
- history[]: {ts, by, action, details}
- reward: {type:'percent'|'fixed', value}
- matsInTotal: boolean (включать материалы в сумму клиента)
- enroute: ISO|null (метка "я поехал")
- startedTs: ISO|null
- diagnostician: имя (кто составил смету)
- backfill: boolean (внесение задним числом)
- test: boolean
- photoReport: boolean
- viewedBy: {deviceId: ISO}
- cancelReason, cancelBy, cancelTs
- createdBy, createdAt

**users/{deviceId}**: id, name, phone, role, roles[], share, status:'approved'|'pending'|'fired'|'quit', active, profile:{specs, schedule, notify, pinHash, avatar}

**clients/{id}**: name, phones[], addresses[], notes, complaints[], orders[] (ссылки)

**events/{id}**: type, title, body, orderId, to:[имена], by, ts, read:[deviceId], mine:boolean

**sched/{deviceId}**: days:{'YYYY-MM-DD':{from,to,off,blocks:[{t1,t2}]}}

**settings/{org}**: name, inn, phone, signer, shareBase:'profit'|'revenue'

## СТАТУСЫ И ПЕРЕХОДЫ

new → inspection (назначен examiner)
inspection → estimate (осмотрщик составил смету)
estimate → approved (клиент согласовал) | postponed | canceled
approved → inwork (назначен worker, тот принял)
inwork → paused → inwork (возобновить)
inwork → completed (чек-лист закрыт)
completed → paid
любой → canceled (с причиной)

Ветка C (без осмотра): new → approved (если цена и аванс согласованы по телефону).

## РОЛИ И ПРАВА
- owner (владелец) — всё
- admin — всё кроме удаления владельца
- manager — заявки, календарь, закупки, назначение
- operator — приём заявок, календарь, закупки, отчёты
- worker — свои заявки, календарь, закупки

Матрица через `can('key')`. Все гейты в `gates.js`.

## КЛЮЧЕВЫЕ ПРАВИЛА (уроки старой CRM — НЕ НАРУШАТЬ)
1. **Никаких инлайн-скриптов** в index.html. Всё в модулях app/.
2. **localToday()** вместо `fmt(new Date())` — локальная дата, не UTC.
3. **sanitize перед set()** — удалять undefined из объекта перед записью в Firestore.
4. **set({merge:true})** при обновлении заявки, никогда не затирать поля.
5. **orderPatch(id, fields)** для точечных полей (viewedBy, status) — не весь документ.
6. **flushQueue** снимает голову ДО отправки, при сетевой ошибке возвращает в начало, при permission-denied — пропускает с баннером.
7. **hiddenTakeFromMe** учитывает helpers, не только worker.
8. **isAssignedToMe(o)** = worker===me ИЛИ helpers.includes(me) — единый источник «моё».
9. **markEventsRead** — ОДНА версия, не дублировать.
10. **События от себя** — silent=true, не растут в свой бейдж.
11. **Тестовые заявки** — вне отчётов/CSV/уведомлений всегда.
12. **Деплой** — только через tools/deploy.js (bump версии + sw.js + version.json + баннер).
13. **Правила Firestore** — отдельный деплой `firebase deploy --only firestore:rules`.
14. **Каждая правка** — гейт + смоук + коммит. Никаких «сделаю всё сразу».

## ПОРЯДОК РЕАЛИЗАЦИИ (этапы, каждый = отдельный промпт)
**Этап 0:** Каркас проекта — index.html, структура папок, theme.css, .gitignore, version.json, sw.js, manifest, firestore.rules (базовые), tools/check-modules.js, tools/deploy.js. Коммит "chore: каркас CRM2".

**Этап 1:** Модули core.js, db.js, auth.js — состояние, роутер, локальный кэш, вход по телефону (заглушка без Firebase, мок-данные), матрица прав can(), роли. Смоук на auth. Коммит.

**Этап 2:** sync.js — Firestore подключение, onSnapshot orders/users, очередь операций, flushQueue, orderSave/orderPatch, sanitize, merge:true. Смоук на очередь. Коммит.

**Этап 3:** gates.js — все гейты доступа (isAssignedToMe, canEditOrder, showTakeBtn, hiddenTakeFromMe, canViewAllOrders…). Смоук на каждый гейт. Коммит.

**Этап 4:** orders.js — модель заявки, статусы, переходы, история, этапы, normalizeOrder. Смоук. Коммит.

**Этап 5:** ui-orders.js — список заявок с фильтрами (Все/Сегодня/Мои/Просрочка), подсветка «моих», карточка с табами (Основное/Схема/Смета/Деньги/Журнал), форма создания с дедупликацией клиента, назначение исполнителя. Смоук. Коммит.

**Этап 6:** notify.js — события, бейджи, напоминания (просрочка/скоро выезд/завтра), модалка «принять/отказаться» при входе. Смоук. Коммит.

**Этап 7:** ui-calendar.js — общий календарь + мой календарь (sched), конфиг дня, просмотр чужого. Смоук. Коммит.

**Этап 8:** ui-shopping.js — закупки, брак, компенсации, свои средства. Смоук. Коммит.

**Этап 9:** ui-clients.js — контрагенты, дедупликация, период в истории, облачная синхронизация. Смоук. Коммит.

**Этап 10:** ui-reports.js — отчёты по прибыли, дележка, срез по диагностам, CSV. Смоук. Коммит.

**Этап 11:** ui-admin.js — сотрудники, роли, шаблоны работ/этапов, реквизиты организации. Смоук. Коммит.

**Этап 12:** ui-profile.js — PIN, график, уведомления, тест уведомления. Смоук. Коммит.

**Этап 13:** Документы — смета и акт выполненных работ, печать/PDF, шаринг. Смоук. Коммит.

**Этап 14:** Навигатор секций — липкие чипы + scrollspy + свайп для длинных экранов.

**Этап 15:** Досье заявки — модалка при клике в списке/календаре.

**Этап 16:** Финальный смоук + деплой №1.

## ПРАВИЛА РАБОТЫ
- Каждый этап = ОДИН промпт от меня. Не начинай следующий, пока я не скажу «далее».
- После каждого этапа: гейт + смоук + коммит + короткий отчёт (5 строк).
- Если якорь не найден — СТОП и сообщение, не гадать.
- Если контекст на пределе — закоммить и остановись, жди следующего промпта.
- Никаких sed по index.html. Только Node с utf8.
- Никаких правок без гейта.

## ПЕРВЫЙ ШАГ
Создай структуру папок, index.html (пустая оболочка), theme.css, .gitignore, version.json, sw.js, manifest.webmanifest, firestore.rules (базовые), tools/check-modules.js, tools/deploy.js, SPEC.md (этот текст).
Запусти `git init`, сделай первый коммит "chore: каркас CRM2".
Выведи `git log --oneline -1` и `git status --short`.
Жди следующего промпта (Этап 1).
