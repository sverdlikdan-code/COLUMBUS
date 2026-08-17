---
title: Formula Road App — сессия сборки и настройки
date: 2026-05-01
status: in-progress
---

## Что сделано в этой сессии

### APK / EAS Build
- Установлен EAS CLI глобально
- Создан `app/eas.json` с профилями `preview` (APK) и `production` (AAB)
- Добавлен `android.package: "com.formularoad.app"` в `app.json`
- Проект привязан к Expo: ID `5a329f0b-5cc6-495f-bacb-1ff4d7ff25aa`, org `dansverdliks-organization`
- EXPO_TOKEN: `DVM_Ak4bBvaulEQM9MClYGszIBm04UKjFm5TDEOr`
- Собраны APK:
  - v1: `https://expo.dev/artifacts/eas/9c4gbKqVA9nZSv9JrFFdCs.apk` — базовая
  - v2: `https://expo.dev/artifacts/eas/9cXYiJCK8Q4xoZ1x9tb6A7.apk` — с UI правками (без Cloudflare URL)
  - v3: `b8a3654a` — in progress, с Cloudflare URL + все правки

### UI исправления
- **ClientCard** — имя магазина на отдельную строку (было обрезано)
- **RouteScreen** — адаптивный layout: на широком экране список (420px) + карта рядом
- **Toggle סדר ביקור / AI** — перенесён над списком на всю ширину
- **KmPanel** — иконка Excel заменена на SVG (убран emoji 📊)
- **ExportExcel** — добавлен web fallback (скачивание через браузер)
- **App.tsx** — модалка при первом запуске "создал ли shortcut на рабочий стол"

### Баг-фиксы
- **teams.js** — исправлена маппировка колонок Excel (row[0]=manager, row[1]=agentCode, row[3]=agentName). Раньше все строки пропускались → демо-режим всегда

### Cloudflare Tunnel
- Установлен `cloudflared.exe` на Desktop
- Временный туннель: `https://calculators-nextel-locator-james.trycloudflare.com`
- `client.ts` обновлён на этот URL
- `start-tunnel.bat` на Desktop — запускает сервер + туннель
- Ярлык добавлен в автозагрузку Windows
- **Минус:** URL меняется при перезагрузке компьютера → нужна новая сборка APK
- **Решение:** купить домен и создать Named Tunnel (постоянный URL)

## PBI Guard — 2026-06-16 ✅

**Задача:** спрятать Formula Road за Power BI кнопкой — нельзя открыть без прохождения через BI.

**Реализация** (идентична MMD ORDERS guard):
- Middleware `formulaRoadGuard` в `server/index.js`
- URL `https://api.sverdlik-apps.site/formula-road?k=FORMULA_PBI_KEY`
- При первом доступе с ключом → cookie `fr_ok=1; Path=/formula-road; HttpOnly; Max-Age=2592000` (30 дней)
- Без ключа и без cookie → 403 страница "גישה דרך Power BI בלבד"
- Данные: `/gps-corrections.json` и `/formula-road-data.json` — отдельные маршруты (без guard, публичны как GitHub Pages)

**Ключ:** `LN80v9eK7hEng5LagaHs2Feh` (в `.env` как `FORMULA_PBI_KEY`)

**URL для PBI кнопки:**
```
https://api.sverdlik-apps.site/formula-road?k=LN80v9eK7hEng5LagaHs2Feh
```

**Проверено:** без ключа → 403, с ключом → 200

---

## Геокодинг — 2026-06-17 ✅

**Задача:** исправить кривую карту из-за неправильного pipeline геокодинга.

**Проблема:** PBI Fabric хранит иврит-адреса в визуальном порядке с LRO-маркерами (U+202D). "הציונות 41" приходило как "‭41 תונויצה" → Google угадывал неправильное место.

**Реализация:**
- `fixBiDiAddress()` — детектирует LRO-маркер, стрипает все BiDi chars, реверсирует Hebrew-сегменты обратно в логический порядок
- Кеш: при загрузке сервера удалены 343 BiDi-испорченных записи; сохранено 1079 чистых
- Порядок геокодеров изменён: Azure → Nominatim → Google (Google угадывает агрессивно — теперь последний)
- `SETTLEMENT_RE`: מושב/קיבוץ/כפר/ישוב без номера дома → пропустить геокодинг, поставить в центр города (`gpsSource='city-center'`)
- **PBI Sibling Lookup**: если другой клиент в PBI с таким же адресом или той же улице ±10 домов имеет GPS → брать его координаты (`gpsSource='pbi-sibling'` / `'pbi-sibling-near'`)
- "⚠ GPS לא מדוייק" — предупреждение в попапе карты для geocoded/pbi-sibling-near клиентов
- `/customers` DAX перестроен: база `'משטח'` (не `'משטח עם כפולות'`), из второй таблицы тянем только `[יום]` и `[סדר ביקור]`; фейковые "קופת מזומן" клиенты исчезли

**Коммит:** `634fc35`

---

---

## SQL Migration — 2026-06-25 ✅

**Задача:** мигрировать Formula Road с DAX/Power BI → прямой SQL на form.dbo (192.168.100.246)

**Выполнено:**

### server/db.js — пул подключений к SQL Server
- База `form` (не `icecrea`) — подтверждено через TMDL
- Credentials из `.env`: DB_USER=ReadOnlyUser, DB_PASSWORD=aA123456b!B

### Миграция эндпоинтов
- `/managers` → SQL: `form.dbo.CUSTOMERS` + `system.dbo.USERSB.SNAME` (вместо TEAMS.xlsx)
- `/manager-agents` → SQL: тот же JOIN, фильтр по SNAME
- `/customers` → SQL: `CUSTCALLFREQUENCY` JOIN `CUSTOMERS` + `AGENTS` + `USERSB`, фильтр `cs.STATDES = N'פעיל'`
- `loadPBISiblingData` → SQL: `form.dbo.CUSTOMERS` GPSX/GPSY
- `loadFormIIntGPS` → SQL: `form.dbo.CUSTOMERS` где GPS не null/0

### Баг-фиксы
- **Числа в Priority хранятся перевёрнуто**: `fixPriNumbers()` — реверсит digit-runs в строках (91→19, 672→276). Применяется к custName, address, agentName, schedulerName, param7
- **Пустая карта при смене дня**: static-data использовалась даже с нулевым GPS → теперь ВСЕГДА API первым, static только fallback при недоступности сервера
- **bbox fail → null в кэше**: если Google нашёл адрес вне города — явно пишем null в geocode-cache, чтобы не повторять неверный результат

### Геокодинг
- Порядок изменён: **Google Maps первый** (лучше знает Израиль) → Azure Maps → Nominatim
- То же для getCityBBox
- Geocode cache (1777 записей) скопирован с dev на прод
- **Важно:** кэш только для адресов прошедших bbox; неверные пишутся как null

### Архитектура
- `AGENTCODE` в AGENTS — строка ("126", "47"), не число
- `ub.SNAME` из `system.dbo.USERSB` = имя менеджера/сдарана (не реверсируется PBI-ем → не трогаем)
- Priority хранит Hebrew в VISUAL ORDER → числа реверсированы, Hebrew сам правильно рендерится через BiDi

**Прод:** PM2 `columbus-api` на 31.154.67.58, автодеплой через git pull

---

## Zikuy Order UI — Designer polish — 2026-08-13 ✅

**Задача:** визуальный ревью и полировка `docs/zikuy-order.html` (бланк заявки на זיכוי/возврат товара, открывается из карточки клиента в formula-road.html). Стиль сверен с `mekarer-order.html` (тот же паттерн `.section`/`.sec-head`/`.sec-body`, токены `--blue`/`--sky`/`--green`).

**Изменено** (только визуал/UX, сервер и formula-road.html не тронуты):
- `viewport`: убран `maximum-scale=1` — блокировал pinch-zoom (WCAG 1.4.4)
- Таблица заявки (`.ret-tbl`, `min-width:640px`, горизонтальный скролл) → карточный список `.ret-item` без горизонтального скролла; каждая карточка = фото+название+% зиכוי сверху, поля כמות/תוקף/אופציה снизу в flex-wrap
- Количество: добавлен степпер +/− (было только `<input type=number>` шириной 60px)
- Touch targets увеличены до ~36-40px (inputs, select, rm-btn, chips) — были ~28px
- Хлебные крошки `↩ מחלקות` были текстовой подчёркнутой ссылкой (крошечная зона тапа) → стали pill-кнопками
- Клик-элементы (chips, photo-card) переведены с `<div>/<span>` на `<button>` — клавиатурная доступность + фокус
- Добавлен `alt` на все фото товаров, `aria-label` на все icon-only кнопки (🗑, →, степпер)
- Карточка товара: шрифт названия 10px→11.5px, line-clamp вместо grubого обрезания
- Счётчик выбранных товаров теперь виден в самой кнопке OK (`✅ OK — הפק בלנק (3)`) — раньше нужно было скроллить к таблице
- Кнопка WhatsApp: раньше создавалась динамически и **накапливалась дублями** при повторном нажатии OK (баг) — теперь статичный элемент в submit-bar, переиспользуется
- Печатная форма: добавлена строка "סה"כ" (итог по количеству), zebra-striping, читаемее заголовок

**Не менялось:** структура данных, `/api/client-returns/:custId`, бизнес-логика % זיכויים, серверный код.

**Проверено:** `new Function()` на извлечённом `<script>` — синтаксис ОК; баланс `<button>` open/close — ОК.

---

## Zikuy WhatsApp-фото + Formula Road tablet UX — 2026-08-16 ✅

**Огромная многочасовая сессия**, много итераций по живому фидбеку с реального планшета. Итог по направлениям:

### zikuy-order.html — эволюция шаринга бланка
- Финальная схема: кнопка "OK — הפק בלנק" открывает стилизованный бланк (фото+таблица) **на весь экран** — агент может просто сфотографировать телефоном, без зависимости от Web Share API вообще (`#pv-overlay`, close-кнопка)
- Кнопка WhatsApp внутри этого экрана — пробует нативный шеринг ФОТО через `navigator.share({files:[...]})`; **никакого текстового wa.me-фолбэка больше нет** (после ревью решили — дублирует то же самое хуже)
- По пути чинили: `window.print()` убран совсем (никто не печатает); баг с пустыми фото в бланке — `waitForImages()` не успевал до вызова `share()`, out-of-gesture-window; исправлено прелоадом фото в `toggleProduct()` сразу при выборе товара (не в момент сборки бланка)
- מק"ט и כמות — жирным (`*text*`, нативная WhatsApp-разметка; цвет текста в WhatsApp невозможен)
- Дата — "16 באוגוסט" (день + месяц словом), не цифрами
- `/api/client-returns/:custId` — добавлены `lastShipDate`/`lastShipQty` (последняя реальная отгрузка, ASHMADOT="-מכר-")
- **INTER-фикс**: `INTER_CATS_RET` не хватало `'מדף'` (полочные товары) — утекал как FORMULA; добавлено (сверено с `DEPT_COMPANY` в `scripts/sadran-data.js`)

### formula-road.html — тулбар на таблете
- Пробовали редизайн тулбара/карточек клиента через designer-агента (сегментированный контрол, кластеры иконок) — **на реальном планшете выглядело мусорно, откатили полностью** обратно к плоской вёрстке
- Осталось из той попытки: кнопка "🗺❌ הסתר מפה" (сейчас видима в тулбаре, не в меню) — **карта теперь скрыта по умолчанию** (`localStorage fr_map_hidden`), список получает всю ширину
- Убрано насовсем: кнопка "📱 GPS Tablet" (не нужна), блок "חיסכון" (экономия км vs Priority)
- Строки city-chips + ICE/spящие/סדרן-chips объединены в одну прокручиваемую строку (было 2 отдельные)
- **Баг**: возврат карты после скрытия показывал серый/битый Leaflet — инициализация в `display:none`-контейнере ломает внутренний кэш размеров тайлов. Фикс: `renderMap()` теперь no-op пока `st.mapHidden`, `toggleMapHidden()` явно вызывает `renderMap()+map.invalidateSize()` через `requestAnimationFrame` при показе
- **Баг**: сохранённая GPS-коррекция (ручная или tablet-review) не применялась сразу в карте/маршруте — `saveGpsCorrection` не ставил `gpsSource:'correction'` на объект клиента, и `triggerOsrm()` тут же затирал её координатами AI Google. Починено (симметрично и для `deleteGpsCorrection`)
- Новый 👑 crown-бейдж на TOP 3-5 клиентов дня по продажам за 3 месяца — лёгкий `/api/day-top-sales` без вызова Gemini (не как `/api/day-briefing`, тот дорогой и по кнопке)

### /api/day-briefing — баг с "днями без заказа"
- Живой репорт от пользователя: клиент איתניס שדרות (1164513) показывался как "22 дня без заказа" в "📊 ניתוח", хотя реально заказывал **сегодня** (проверено DAX + live SQL ORDERS)
- Причина: `lastOrder` считался ВНУТРИ того же `CALCULATETABLE`, что и сумма продаж за "3 закрытых месяца" (текущий месяц сознательно исключён для честного сравнения) — заказ в текущем месяце просто не попадал в расчёт даты
- Фикс: отдельный DAX-запрос без ограничения по датам только для `lastOrder`/`daysSince`, сумма продаж осталась в старом окне

### Инфраструктура доступа агентов
- Короткие invite-ссылки `/i/:code` (7 символов, `server/data/short-invites.json`) вместо длинного base64+HMAC — та же безопасность, презентабельнее
- Разослано **41 агенту** персональное письмо через Resend с их invite-ссылкой (список из `FORMULA ROADS -PASSWORDS/EMAIL + PASSWORD.xlsx`)

### Прочее
- Обнаружено: GitHub Pages (`sverdlikdan-code.github.io/COLUMBUS/`) — реальный источник для агентов, отдельный от VPS/api.sverdlik-apps.site; у `loadTabletGps()` был баг с абсолютным путём `/priority-gps-cross.json`, ломавшимся под GH Pages subpath (`/COLUMBUS/`) — исправлено на относительный
- **Важное открытие, не решено**: на VPS `git pull` регулярно натыкается на "фантомные" локальные изменения в `docs/*.html`, идентичные тому, что только что запушено — похоже, есть неизвестный процесс, синкающий файлы в обход git. Требует расследования отдельной сессией

## Tablet UX + DESIGN.md — 2026-08-17 ✅

**Задача:** Formula Road выглядел любительски на планшете — весь контент в телефонном масштабе растянут на широкий экран.

### Диагноз
- `client-card`: `padding:3px 7px`, шрифт имени 12px, адрес 10px, visit-badge 21px — всё мобильное
- Не было ни одного `@media(min-width:768px)` блока для визуального скейлинга
- `days-grid: repeat(5,1fr)` — на планшете 5 колонок в одну строку, каждая 140px, выглядело растянутым

### Исправлено: добавлен `@media(min-width:768px)` в formula-road.html
- `client-card`: padding `3px 7px → 9px 14px`, border-radius `6px → 10px`
- `.c-name`: `12px → 15px`, `.c-sub`: `10px → 12px`, visit-badge: `21px → 30px`
- Кнопки действий (мекарер, зикуй, Waze, AI): `28px → 38px` min-height
- Sort-кнопки: `34px → 40px`, day-switch: `44px → 50px`, city-chips: крупнее
- Header: лого `38px → 46px`, padding увеличен
- `days-grid`: `repeat(5,1fr) → repeat(3,minmax(130px,210px)) + justify-content:center` — 2 ряда по 3
- Задеплоено на VPS: коммит `16732b35`

### Создан DESIGN.md (дизайн-система Formula Road)
- North Star: "The Field Navigator" — инструмент поля, не SaaS-дашборд
- Философия компонентов: "Уверенный и дышащий"
- Зафиксированы: 15 цветовых токенов с названиями, 5 типографических уровней, 5 shadow-вариантов, все компоненты с правилами
- Named Rules: The Single Voice Rule, The Canvas Tint Rule, The Flat-at-Rest Rule, The Weight-as-Hierarchy Rule
- Запрет side-stripe borders зафиксирован явно в Do's and Don'ts
- Создан `.impeccable/design.json` sidecar со 15 цветовыми ramps, 6 компонентными сниппетами (HTML+CSS), motion + breakpoints tokens
- Коммит `986a5631`

### Запланировано (не сделано)
- Playwright MCP для автотестов после деплоя
- Аудит `client-card.ice-only` — side-stripe `border-right:3px solid #00B894` нарушает DESIGN.md правило

## Что нужно сделать

- [x] Phase 2: продажи + יעד $ в карточке клиента — ГОТОВО (2026-06-29)
  - sales_cte: INVOICEITEMS + ORDERITEMS + OTYPE='C' + FINAL='Y', SUM(IVCOST * DEBIT_SIGN) = точно как PBI
  - target: из TAHSHIV Excel (\\dilerbmdsrv\yulia-dan\bi pilot\FORMULA\TAHSHIV FORMULA.xlsx), кэш при старте
  - join key: CATGORY 7 (Excel col4) ↔ CUSTSPEC.SPEC7 (SQL), BiDi нормализация normCat7()
  - /admin/reload-targets — обновить кэш без перезапуска (для ежемесячного обновления Excel)
  - только FORM (ICE/INTER — pending решение)
- [ ] Мигрировать `/manager/gps-report`, `/api/client-sales`, `/api/mekarer-parts` с DAX на SQL
- [ ] APK через Capacitor (обернуть formula-road.html)
