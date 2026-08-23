# formula-road-app — Archive (сессии 2026-05-01 – 2026-06-25)

Старые сессии Formula Road (APK/EAS сборка, PBI Guard, геокодинг, SQL-миграция), вынесены из [[formula-road-app]] для читаемости основного файла. Актуальная архитектура и последние сессии — в основном файле.

## Что сделано — 2026-05-01

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

