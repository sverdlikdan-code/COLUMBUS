# MMD ORDERS App — Topic File

Приложение заказов MMD (`MMD ORDERS/index.html`) — PWA для просмотра заказов из Power BI через `server/index.js`.

## Архитектура

- **Endpoint:** `GET /pbi/mmd-orders?month=YYYY-MM`
- **Источник данных:** PBI KARTIS PARIT — та же таблица что и в MAHSAN
- **Server pipeline:** raw PBI → `fixBiDi()` → `fixGimel()` → response

## Критический баг и фикс — BiDi числа (2026-06-16) ✅

**Проблема:** PBI хранит `KARTIS PARIT[תאור]` в визуальном BiDi порядке. Функция `fixBiDi` переворачивала ивритские слова посимвольно — но цифры в составе слова тоже переворачивались: `'ג1200` → `0021ג'` (1200г → 0021).

**Симптом в UI:** продукты показывали `'ג0021` вместо `1200 ג`.

**Фикс в `server/index.js` fixBiDi:**
```javascript
// Было (баг):
.map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('') : w)

// Стало (фикс):
.map(w => /[א-ת]/.test(w) 
  ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join(''))
  : w)
```

**Фикс `fixGimel` — паттерн 2 (добавлен):**
```javascript
// digits before gimel+apostrophe: 1200ג' → 1200 ג
s = s.replace(/(\d+)ג['‘’׳ʼ´`]/g, '$1 ג ');
```

## Фиксы фильтра компаний (2026-06-16) ✅

- **Проблема:** чипы компаний переносились на 2 строку (INTER и ICE bdd)
- **Фикс CSS:** `#fbar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }`
- **Проблема:** INTER (35 продуктов) не видно — уходил за левый край в RTL
- **Фикс JS:** сортировка чипов по убыванию количества (FORMULA 479 > ICE MISH 42 > INTER 35 > ICE bdd 25)

## Архитектура v2 — GitHub Pages (без зависимости от PC) ✅ 2026-06-17

**Проблема:** Cloudflare Error 1033 при выключенном PC — tunnel + Node.js завязаны на локальную машину.

**Решение:** Повторить паттерн MAHSAN/Formula Road — статический JSON + GitHub Actions.

### Новые файлы
- `server/build-mmd-orders.js` — standalone build script: вызывает PBI REST API, сохраняет `docs/mmd-orders.json`
- `.github/workflows/mmd-orders-build.yml` — CI: запуск 3×/день (07:00/13:00/19:00 IST = 04/10/16 UTC)
- `docs/mmd-orders.html` — статичная копия приложения, читает `./mmd-orders.json`
- `docs/mmd-orders.json` — первичные данные 424 продукта (май-июнь 2026)

### Деплой
- **URL:** `https://sverdlikdan-code.github.io/COLUMBUS/mmd-orders.html`
- **Workflow ID:** 297430969, state: active
- **Secret:** `PBI_MMD_DATASET` — добавлен пользователем в GitHub Settings → Secrets

### Отличия docs/mmd-orders.html от оригинала
1. `fetch('./mmd-orders.json')` вместо `/pbi/mmd-orders?y1=...`
2. Фон: `linear-gradient` вместо фото (FOTO CITY/ не в docs/)
3. Пути логотипов: `./logo-diler-bmd.png` вместо `/logo-diler-bmd.png`

## Файлы

- `MMD ORDERS/index.html` — frontend PWA (аутентифицированный локальный сервер `/mmd`)
- `server/index.js` — endpoint `/pbi/mmd-orders`, функции `fixBiDi`, `fixGimel`
- `server/build-mmd-orders.js` — CI build script
- `docs/mmd-orders.html` — публичная статика GitHub Pages

## Prophet MMD — пилот прогнозирования (2026-06-30) #done

**Цель:** заменить статичную `[המלצה להזמנה קרטון]` прогнозом Prophet на 4–8 недель.

### Что создано
- `server/probe-prophet.js` — probe DIMCALENDAR колонок + top-10 SKUs по объёму
- `server/fetch-prophet-history.js` — DAX pull 78 недель `[מכר קרטון]` для top-10 SKUs → `prophet/weekly_sales.csv`
- `prophet/run_prophet.py` — Prophet fit + Excel output
- `prophet/requirements.txt` — prophet, pandas, openpyxl
- `prophet/forecast_pilot.xlsx` — **результат пилота** (10 SKU, P4/P8 прогноз vs hamlatza)

### DIMCALENDAR структура
- `DIMCALENDAR[Date]`, `[Year]`, `[Month]`, `[Week Number]`, `[Sort Column]` (YYYYMM), `[Quarter]`
- WeekStart/WeekNum — нет. Используем `Year` + `Week Number`

### Результаты пилота (краткие)
| mkt | avg 26w | P4 | hamlatza | delta |
|-----|---------|----|----------|-------|
| 403001 | 38.7 | 51.7 | 27.9 | +23.8 |
| 403002 | 21.0 | 106.7 | 7.2 | +99.5 (аномалия — проверить) |
| 502210 | 16.9 | 28.3 | 8.6 | +19.7 |
| 818 | 17.4 | 15.2 | 6.7 | +8.5 |
| 631 | 14.6 | 13.9 | 14.7 | -0.8 |

### Запуск пайплайна
```powershell
cd server; node probe-prophet.js   # обновить top10 SKUs
node fetch-prophet-history.js      # обновить CSV
cd ..; set PYTHONIOENCODING=utf-8; python prophet/run_prophet.py  # fit + Excel
```

### Security
Пилот чисто локальный — нет новых HTTP-маршрутов. При добавлении API endpoint нужен `requireAuth`.
- `docs/mmd-orders.json` — pre-built данные (обновляется CI 3×/день)

---

## Сессии

### 2026-06-16 #resolved
- Исправлен BiDi баг с числами в именах продуктов (1200 ג вместо 0021ג')
- Добавлен fixGimel паттерн 2 для формата `{digits}ג'`
- Починены чипы компаний: nowrap + сортировка по count descending

### 2026-06-17 #resolved
- **MMD ORDERS переведён на GitHub Pages** — больше не зависит от включённого PC
- Создан `server/build-mmd-orders.js` — DAX → JSON build script
- Создан `.github/workflows/mmd-orders-build.yml` — CI 3×/день, Workflow ID 297430969
- Создан `docs/mmd-orders.html` — статичная версия приложения
- Загружены первичные данные: 424 продукта, период май-июнь 2026
- Секрет `PBI_MMD_DATASET` добавлен пользователем, первый автозапуск CI: 16:00 UTC = 19:00 IST 2026-06-17

### 2026-06-23 #resolved ✅ Excel-экспорт ломался при открытии

**Симптом:** пользователь получил `MMD-Order-23.6.2026.xlsx`, при открытии в Excel — диалог "We found a problem with some content... Do you want us to try to recover?", repair-log: `Removed Feature: AutoFilter from /xl/tables/table1.xml part (Table)` + `Removed Feature: Table from /xl/tables/table1.xml part (Table)`.

**Root cause (подтверждён живой репродукцией через Puppeteer):** баг в библиотеке `exceljs@4.4.0` (CDN, `node_modules/exceljs/lib/xlsx/xform/table/table-xform.js`):
```js
totalsRowCount: model.totalsRow ? '1' : undefined,
totalsRowShown: model.totalsRow ? undefined : '1',   // ← инвертировано
```
При `ws.addTable({ totalsRow: false, ... })` (как в `window.exportXL()`) высота таблицы (`ref`) правильно НЕ включает доп. строку (`table.js:126`), но рендер всё равно пишет `totalsRowShown="1"` в `xl/tables/table1.xml`. Несоответствие `ref` ↔ `totalsRowShown` — ровно то, что триггерит Excel's "file level validation and repair" и вырезает Table/AutoFilter.

Менять `totalsRow: true` нельзя — это раздвинуло бы `ref` Table ровно на следующую строку, которая уже занята вручную написанной строкой "סה"כ" (summary row), и затёрло бы её.

**Фикс (применён в обоих файлах — `docs/mmd-orders.html` и `MMD ORDERS/index.html`, это НЕ синхронные копии, разошлись по фетчу данных/фону/путям):** убрали `ws.addTable()` целиком. Вместо Table-объекта — обычный header row (вручную стилизованный: bold, fill `4472C4`, border) + `ws.autoFilter = { from:{row:5,column:1}, to:{row:5+tableData.length,column:8} }` (plain autoFilter, без Table XML) + ручная запись значений строк + ручное чередование цвета строк (`F2F5FB`) для имитации banded rows темы `TableStyleMedium2`.

**Верификация:** Puppeteer-репродукция (перехват Blob через monkey-patch `URL.createObjectURL`) на патченном файле → `unzip -t` без ошибок, в архиве больше нет `xl/tables/` вообще, `[Content_Types].xml` не содержит ссылок на table — корректный OOXML.

**Коммит:** `cc51f1c` — `fix(docs): убрать ws.addTable из экспорта MMD Order — баг exceljs totalsRowShown`, запушено в `master` (`dfc20bd..cc51f1c`).

**Не затронуто (отдельная, более низкоприоритетная находка):** в `docs/mmd-orders.json` поле `taur` показывает зеркальные скобки (`)20(` вместо `(20)`) — похоже на ещё один BiDi-косметический баг, не связан с порчей файла, пользователю не поднимался, фикс не делался.

### 2026-06-24 #resolved ✅ CI не обновлял JSON + 1004 не виден + имена продуктов обрезались

**CI Fix:** `dotenv` в build-script искал `.env` от CWD (корень репо на CI = папка выше). Фикс: `require('dotenv').config({ path: path.join(__dirname, '../.env') })`. Потом полностью убрали зависимость от .env на CI — переключились на `env:` блок в workflow YAML с GitHub Secrets.

**Секрет PBI_MMD_DATASET** был неверным (UUID отличался). Пользователь исправил вручную в GitHub Settings.

**SKU 1004 (только maavar=384):** добавлен в DAX-фильтр: `OR(OR(ashdod>0, mmd>0), maavar>0)`. Добавлена кнопка 📦 מחסן מעבר הזמנה — показывает только maavar-продукты. Ограничение заказа: в обычном режиме кап = ashdod_k, в maavar-режиме кап = maavar.

**Фильтр семейств:** переведён с модели исключения на модель включения (fams.size>0 = показывать только выбранные).

**Сплэш:** случайно перезаписан при копировании docs/ → MMD ORDERS/. Восстановлен фото-фон `FOTO CITY/hf_20260616_070536...png`. Логотипы исправлены на абсолютный путь `/logo-diler-bmd.png`.

**Имена продуктов обрезались до "200 ג":** `fixBiDi` в build-mmd-orders.js не переворачивал порядок слов (в отличие от server/index.js). Фикс: добавлен `.reverse()` после split + исправление скобок, как в server-версии. Результат: "חמאה 82.5% חדש 200 ג" вместо "200 ג".

**Роут JSON:** добавлен `app.get('/mmd/mmd-orders.json', mmdGuard, ...)` в server/index.js — сервер отдаёт docs/mmd-orders.json через /mmd/ маршрут.

**ПРАВИЛО:** никогда не копировать `docs/mmd-orders.html` → `MMD ORDERS/index.html`. Это разные файлы с разными путями, разным сплэшем, разными фетчами.

### 2026-06-25 #resolved ✅ Excel export — фото, умная таблица, фильтры

**תוקף נדרש в Excel:** красная заливка + 🚩 только когда `tOpts.length > 1 && !sessionP[mk]`. Никакого автозаполнения единственного срока.

**Фото в Excel:** добавлен прокси-роут `GET /mmd/img/:mkt` в server/index.js → качает с `priority.dilerbmd.com/priimages/:mkt.jpg`. Client-side canvas resize 40×40 JPEG q0.55. Колонка תמונה (col 5) между שם מוצר и מלאי MMD. Размер файла пригоден для email.

**Умная таблица:** `ws.addTable({ totalsRow:true, style:'TableStyleLight2', ... })` — настоящий Excel ListObject с autoFilter, banding, totals row (SUM на הזמנה קרטון). Обходит баг exceljs@4.4.0 (только `totalsRow:false` давал кривой XML).

**Цвета:** заголовок `455A64` (серо-синий), строки `F5F5F5` (нейтральный серый), титул `37474F`.

**חסר/יש фильтры в maavarMode:** в `filtered()` строка `return true` скипала все фильтры. Фикс: ashFilter и mmdFilter применяются и в maavar-режиме.

**Экспорт = то что видишь:** `orderedRows = filtered().filter(eff > 0)` — все активные фильтры (маавар, семейство, компания, חסר/יש) применяются к экспорту.

### 2026-06-28 #resolved ✅ Security audit + auth hardening

**Аудит:** 23 роута проверены. Найдено 3 открытых без auth + SSRF в isSafePhotoUrl.

**Фиксы:**
- `requireAuth` добавлен на `/pbi/formula-refresh`, `/api/export-order-xlsx`, `/api/export-position-xlsx`
- `isSafePhotoUrl`: заменён IP-блок на строгий domain whitelist `priority.dilerbmd.com`
- Проверено: `/mmd/` без ключа → 403, с ключом → 200 ✅

**Итог:** все 23 роута защищены.

### 2026-06-29 #resolved ✅ Динамические данные по месяцам — три критических бага

**Баги:**
1. `selectedPeriod()` → функция не существовала, нужно `getPeriodParams()` — ReferenceError до try/catch, loadPeriod падал молча
2. `HE_MON_FULL[m-1]` → off-by-one, Jun показывал May в label
3. `window.loadPeriod` определён снаружи IIFE → `baseAll`, `all`, `getPeriodParams` недоступны (разные скоупы)

**Фикс:** перенесли `HE_MON_FULL`, `periodLabel`, `_setPeriodLabel`, `window.loadPeriod` внутрь IIFE (до `})();`).

**Коммиты:** `32396d32`, `e4a114fd`, `45cbc53b`

**Верификация DAX:** `[מכר ממוצע בשבוע]` для May=13.5, Jun=12.8, May+Jun=15.6 — математически корректно (5 distinct недель вместо 6 из-за граничной недели). `[מכר קרטון]` всегда точен.

### 2026-06-28 (вечер) #resolved ✅ Кнопка ручного обновления данных + архитектура data refresh

**Проблема:** JSON обновляется 3×/день (07/13/19 IST). F5 не даёт свежие данные — только перезагружает страницу с тем же JSON. PBI dataset обновляется чаще.

**Решение:**
- `POST /mmd/rebuild` (mmdGuard) — запускает `build-mmd-orders.js` через `execFile`, busy-guard предотвращает двойной запуск. Возвращает `{ ok, products }`.
- Кнопка `🔄 רענן נתונים` на сплэше — под датой PBI, стиль subtle (золотая рамка, прозрачный фон). При нажатии: spinner → POST → авторелоад страницы через 1.2с.
- Состояния: `⏳ מעדכן...` → `✅ עודכן!` → reload / `❌ error` / `⏳ כבר רץ...` (если занято)

**Коммит:** `f6a67c3e` — feat(mmd): кнопка רענן נתונים

**Архитектура refresh (итог):**
```
PBI Dataset (авто по своему расписанию)
  ↓ CI 3×/день  ИЛИ  кнопка "🔄 רענן" вручную
mmd-orders.json
  ↓ F5 / reload
приложение
```

### 2026-07-01 #done ✅ Prophet панель — тренд, спарклайн, санкейп, DAX fix

**Реализовано:**

1. **Редизайн панели** `#prophet-panel` под layout из демо (`demo_prophet_page.html`):
   - Sparkline (div-бары) — 12 недель факта (синие) + 4 недели прогноза (зелёные dashed)
   - 4-tile metrics grid: `ממוצע שבועי` | `Prophet P4` | `המלצה נוכחית` | `דלתא`
   - Dual progress bar, CI note, Formula block (скрыт — внутренняя логика)
   - Trend badge: last4 vs prev4 actual weeks (реальный тренд продаж, не прогноз)

2. **Аномалии Prophet** — multiplicative seasonality + sparse data → P4=1176 для SKU с avg=2.0/нед:
   - Санкейп: если P4 > 4× avg_weekly → null (77 SKU занулены)
   - Emoji в print() → UnicodeEncodeError cp1255 → заменены на ASCII

3. **Тренд бейдж** (last4 vs prev4 actual weeks):
   - `> +30%` → `📈 +X% ביקוש עולה`
   - `< −30%` → `📉 −X% ירידה`
   - ±30% → `➡ יציב`

4. **Тренд в таблице** — колонка Prophet показывает `▲X%` / `▼X%` под значением

5. **Trend override** — если `< −30%`: Prophet показывает `—` в таблице + `מבוטל` в панели (не рекомендует заказывать при падении продаж)

6. **Спарклайн 2× выше** (56→110px) + динамическая ось `DD/MM 'YY` под каждым 4-м баром (ISO week → отказались, показываем дату начала недели)

7. **Неполная неделя** — Prophet не должен обучаться на незаконченных данных:
   - DAX: `DIMCALENDAR[Date] < TODAY() - MOD(WEEKDAY(TODAY(),1)-1, 7)` (фильтр до начала текущей недели)
   - Python `load_data()`: удаляет строки текущей ISO year+week перед fit

8. **DAX мера `מכר קרטון average per Week Number`** исправлена:
   - Баг: зерно по `Week Number` без года → Week 27 суммировал 5 лет → x5 инфляция (854 вместо 4.0)
   - Фикс: `AVERAGEX(FILTER(SUMMARIZE(Year, Week Number), MAX(Date) < TODAY()), CALCULATE([מכר קרטון]))`
   - Результат: SKU 800: 854→4.0, SKU 604: 3260→12.8

9. **`docs/mmd-orders.json` пересобран** — 422 продукта с правильными `mkr_shvua`

**Коммиты:** `8677a8a9` (prophet panel+series), `d83f662a` (trend in table), `6b23c047` (trend override), `c3b2e938` (sparkline 2x + axis), `52b25320` (incomplete week fix), `0675b475` (mmd-orders rebuild)

**Файлы изменены:**
- `MMD ORDERS/index.html` — prophet panel, trend badge, table column, sparkline
- `prophet/run_prophet.py` — series output, sanity cap, incomplete week filter
- `server/fetch-prophet-history.js` — DAX incomplete week filter
- `docs/prophet.json` — 596 SKU с series данными, 77 занулены санкейпом
- `docs/mmd-orders.json` — пересобран с правильными mkr_shvua
