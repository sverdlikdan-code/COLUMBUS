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

### 2026-07-06 #resolved ✅ Prophet: стale eilat_k в панели И в колонке таблицы

**Проблема 1 — панель:** Prophet Panel показывал `hamilton=7` но `prophet_order=0`. Панель читала `eilat_k` из prophet.json (07:00 rebuild), но mmd-orders.json (13:16) уже содержал `mmd_k=4` (продали 8 картонов между ребилдами). `8.9 × 1 − 12 = −3.1 → 0` (неверно). Правильно: `8.9 × 1 − 4 = 4.9 → 5`.

**Фикс панели (`openProphetPanel`):**
- Добавлен аргумент `currentMmdK` — передаётся из onclick при рендере строки
- `const ek = currentMmdK != null ? currentMmdK : (p.eilat_k ?? 0)`
- `const po = (p4f != null && wn !== '—') ? Math.max(0, Math.round(p4f * wn - ek)) : Math.round(p.prophet_order ?? 0)`
- Аналогично для `tableHaml` — панель берёт המלצה из таблицы (актуальная), не из prophet.json (стale)

**Проблема 2 — колонка таблицы:** `const po = Math.round(p.prophet_order)` — та же стale проблема. Таблица показывала 0 вместо 5.

**Фикс колонки:**
```javascript
const p4f = p.p4;
const wn  = p.weeks_nf;
const ek  = (r.mmd_k != null && r.mmd_k >= 0) ? r.mmd_k : (p.eilat_k ?? 0);
const po  = (p4f != null && wn != null) ? Math.max(0, Math.round(p4f * wn - ek)) : Math.round(p.prophet_order ?? 0);
```

**Коммиты:** `30d8e6f5` (панель), `c2783cda` (колонка)

### 2026-07-21 #resolved ✅ Active row highlight + הזמנה אילת column + tukuf компактность

**Active row highlight:**
- При клике на 📊 (openInfoPanel) — строка подсвечивается синей рамкой (`.active-row`)
- `tr.dataset.mk = mk` добавлен в рендер строки
- `window.recalcTable = recalc` экспортирован из IIFE
- При закрытии панели — рамка снимается

**הזמנה אילת — колонка заказов Эйлата:**
- Новая зелёная колонка в таблице (read-only, `col-eilat`)
- `window._eilatDraft = {}` — загружается из `/mmd/draft/אילת` через `loadEilatDraft()`
- Обновляется каждые 2 минуты + при первом входе через 4с
- Пользователь Эйлат: при входе вводит имя "אילת" на сплэше → заказы авто-сохраняются
- Footer показывает сумму заказов Эйлата (зелёный)

**Eilat badge fix (⚠ inline):**
- Убран `<br>` перед `⚠ סכנה` / `⚠ תשומ'` в ячейке תוקף
- Badge идёт inline после дат, не расширяет строку
- Tooltip `title="סכנה — אילת"` добавлен

**tukuf.html — компактность:**
- `throwLine` в батч-строках: убран `<br>` + `<div>`, теперь `<span>` inline
- `⛔ STOP` и `~N🗑` идут в той же строке что и дата
- `ec-tbl td`: padding уменьшен `3px 7px` → `2px 6px` + `white-space:nowrap`
- Колонка "למכירה" переименована в "שב' למכירה סופית"
- flex-wrap попытка → сломала RTL → откатили обратно на `display:grid`

**Коммиты:** `689699ea`, `7f258a2d`, `6c12c592`, `d5c83b05`, `8df59662` (и серия между ними)

### 2026-07-20 #resolved ✅ tukuf grid + param2 + danger logic + архитектура JSON + eilat expiry

**tukuf.html grid:**
- `grid.style.display='flex'` (JS строка ~250) переопределял CSS grid → все карточки в одну строку. Фикс: `'flex'` → `'grid'`
- `#cards` не имел `align-content:start` → 2 строки растягивались на весь `min-height:100vh`. Фикс: добавлен в CSS
- tukuf.html не был в `server-deploy.yml` → VPS держал старый файл. Фикс: добавлен в paths + SCP step
- Добавлен `workflow_dispatch:` в server-deploy.yml

**param2 groupинг (ICE bdd / ICE MISH / INTER):**
- Компании ICE/INTER группируются по `param2` вместо `mishpacha`
- `build-mmd-orders.js`: добавлен `'KARTIS PARIT'[תאור פרמטר 2 למוצר]` в SUMMARIZECOLUMNS + маппинг `param2`
- ✅ param2 в JSON с 2026-07-21 (CI отработал) — группировка ICE/INTER работает

**Info panel danger badge — исправлена логика:**
- Было: `minDays < 30` → всегда danger для < 30 дней, независимо от скорости продаж
- Стало: `ws > we` где `ws = qty/mkr_shvua` (недель запаса), `we = (days-shelfLife)/7` (эффективных недель до истечения)
- Соответствует `eilatDangerLevel()` в tukuf

**Архитектурный фикс — git dirty на VPS:**
- Проблема: `rebuild` писал новый `docs/mmd-orders.json` прямо на VPS → `git status` dirty → `git pull` в других deploy CI блокировался
- Решение: `server/data/mmd-orders-live.json` (вне git tree) — живой файл
- `server/index.js` `/mmd/mmd-orders.json` → `sendFile(livePath || fallback)`
- Rebuild: пишет в livePath, потом `git checkout -- docs/mmd-orders.json` (restore git state)
- `mmd-orders-build.yml` CI: SCP JSON → `server/data/mmd-orders-live.json` на VPS (вместо `docs/`)
- `.gitignore`: добавлен `server/data/mmd-orders-live.json`; `server/data/.gitkeep` в git

**pp-tarif tile (было пустым — `tarif_mmd` не существует):**
- Теперь показывает `eilat_tukuf_dt` (ближайший срок тугуф Эйлата) в формате DD/MM
- Подзаголовок: `מדף מינ' N י'` (shelfLife из product-data.json)
- Label: `ת.תפוגה אילת`

**Коммиты этой сессии:** серия feat/fix(mmd) — tukuf grid, param2, danger, architecture, pp-tarif

### 2026-07-07 #resolved ✅ Заказ превышает млאי אשדוד при загрузке

**Проблема:** `ordV = s.k != null ? s.k : hamlRnd` — сохранённое из localStorage значение (напр. 6) ставилось в инпут без проверки cap. Cap-check `inp()` срабатывал только на `oninput`, не на initial render. Если מלאי אשדוד упал с 8 до 1 между сессиями — инпут всё равно показывал 6.

**Фикс (строка ~1490):**
```javascript
const _cap    = maavarMode ? mav : ash;
const _rawOrd = s.k != null ? s.k : hamlRnd;
const ordV    = (_rawOrd !== '' && _cap > 0 && Number(_rawOrd) > _cap) ? _cap : (_rawOrd || '');
```

**Коммит:** `c261a472`

### 2026-08-11 #resolved ✅ Prophet trend fix + пизур + cust_bought + фото Excel + фильтр клиентов + архив товаров

**Prophet trend `mkr_prev6` отсутствовал в `period-data`:**
- `/period-data` endpoint возвращал данные за выбранный период, но не вычислял `mkr_prev6` (предыдущий эквивалентный период).
- Тренд сравнивал period-mkr_shvua с базовым mkr_prev6 из mmd-orders.json — разные периоды → бессмысленный тренд.
- Фикс: вычислить `df_prev` (тот же промежуток времени до d1) и добавить в DAX-запрос period-data endpoint.

**Замена колонок по просьбе пользователя:**
- `yamim_haya` (ימי מכר) → `cust_bought` (לקוחות שקנו) — `CALCULATE([כמות לקוחות], ...)`, уникальные покупатели за период
- `pct_mkr` (% ימי מכר) → `pizur` (פיזור %) — `DIVIDE([כמות לקוחות], [לקוחות פעילים])` из PBI

**Фото в Excel не загружались:**
- Прокси `/mmd/img/:mkt` был захардкожен на `priimages/MAKT.jpg`
- Большинство продуктов используют `primail/YYYYMM/HASH/` URL
- Фикс: прокси принимает `?u=` с hostname-валидацией (`priority.dilerbmd.com`)
- Клиент передаёт `r.img` (реальный URL из PBI) как `?u=encodeURIComponent(r.img)`

**Расхождение клиентов PBI 162 vs App 177:**
- PBI исключает "אסטרל", "--", "רשות הטבע" дополнительно к основным типам
- Добавлены в NOT IN фильтр в `build-mmd-orders.js` и `period-data` endpoint
- После следующего CI build `dist_active` станет ~162

**Архив товаров (новая фича):**
- Кнопка 🗃 на каждой строке — мгновенно убирает товар из основного списка в архив
- Кнопка "🗃 ארכיון" в btn-row — переключает режим просмотра архива (загорается оранжевым)
- В режиме архива: кнопка ↩ "שחזר" возвращает товар обратно
- Хранится в `localStorage('mmd_archive')` — не сбрасывается при перезагрузке
- Бизнес-кейс: вне сезона, трудности импорта, форс-мажор, война

**Коммиты:** `a1321f02`, `65a43c60`, `9badc27c`

### 2026-08-27 #resolved ✅ הזמנה בלבד фильтр смотрел на raw hamlatza вместо _effOrd

**Симптом:** кнопка "📋 הזמנה בלבד" фильтрует/считает по колонке hamlatza (амлаца), а не по тому что реально показано в поле заказа — воспроизводится только на FORMULA.

**Root cause:** `filtered()`'s ordOnly-блок и `recalc()` в `MMD ORDERS/index.html` использовали собственную упрощённую формулу (`s.k ?? hamlatza`), а не общую `_effOrd()`. `_effOrd()` (создана `b8ee3dcb`, 2026-07-15) содержит SKU-override формулы — 659 (`3×mkr_shvua − eilat_k`, `42d999f3` 2026-07-16) и 664 (`hamlatza×4`) — которые в фильтр так и не попали. Оба override-SKU принадлежат FORMULA, поэтому баг виден только там (у ICE/INTER такого override нет — raw hamlatza почти всегда совпадает с показанным).

**Уже "чинили" раньше и не туда:** `2026-08-06` — два коммита с разницей 2 минуты (`80a97eb9` → `6e276e88`) правили этот же блок ради другой цели (UX для ICE: непросмотренные товары должны попадать в фильтр по рекомендации) — трогали симптом, не заметили что дублирование логики вообще не устранено.

**Фикс (`209737a8`):** `filtered()` ordOnly и `recalc()` теперь вызывают `_effOrd(r, s)` — единственный источник истины. Задеплоено на VPS, `git pull` + `pm2 restart columbus-api`, health-check `404` подтверждён.

**Не тронуто:** `docs/mmd-orders.html` (GitHub Pages бэкап) — там `_effOrd()` не существует вообще, 5 независимых копий формулы без override для 659/664. Не продакшн (продакшн = `/mmd` на VPS отдаёт `MMD ORDERS/index.html` статикой, `server/index.js:3851`). Фикс туда не переносился — не запрошено.

**Инструмент против повтора:** добавлен `jscpd` в `.git/hooks/pre-commit` (`7f54ac55`) — **warn-only**, не блокирует коммит. Конфиг `.jscpd.json`: `minLines:2, minTokens:15` — низкий порог специально, т.к. на 5/50 (без шума) тул НЕ ловил этот баг (дубль был всего 2-4 строки), а любой порог достаточно чувствительный чтобы поймать — шумит на больших monolithic HTML+JS файлах (40-90 "дублей" на файл, в основном совпадения синтаксиса). Протестировано на реальном pre-fix файле — реальный дубль (`1488:26-1491:35` ↔ `1774:23-1777:33`) находится. Хук печатает предупреждение при коммите застейдженных `.js`/`.html`, решение по каждому найденному "дублю" — за агентом/человеком в моменте, не автоматика. **Ограничение:** `.git/hooks/` не версионируется — только на этой машине, не разъедется на другие клоны или VPS.

### 2026-08-17 #resolved ✅ Блокировка заказа при מלאי אשדוד ≤ 0

**Симптом:** SKU 631 (SVALIA, FORMULA) с `ashdod_k=-4` показывал הזמנה קרטון=3 в Excel и в таблице.

**Root cause:** коммит `f8db5336` (02.08.2026) изменил в `inp()` условие `if (Number(v) > cap)` → `if (cap > 0 && Number(v) > cap)`. Когда ash=-4, `cap > 0` = false → гамлаца 3 проходила без ограничений. `_effOrd` и рендер также не проверяли знак ash.

**Фикс в трёх местах (`328fb9cc`):**
1. `_effOrd`: `if (!maavarMode && (r.ashdod_k ?? 0) <= 0) return 0;` — snapshot и orderedRows автоматически синхронизированы
2. Рендер: `(!maavarMode && ash <= 0 && s.k == null) ? 0 : _ordVRaw` — не авто-заполнять гамлацу
3. `inp()`: `if (capRaw <= 0) { el.value = 0; }` — блокировать ручной ввод

**Правило:** единственный способ заказать при ash≤0 — режим מחסן מעבר (maavarMode=true), где cap=maavar.

### 2026-08-31 #resolved ✅ Неразличимые даты тукуф в списке — жалоба makat 1167

**Симптом (со слов пользователя, через склад):** 20.08.2026 при оформлении заказа app по makat 1167 показал ближайшую партию/тукуф как 24/10/2026. Пользователь выгрузил остатки по партиям Ашдод за 19.08 и 20.08 напрямую — партия 11/09/2026 реально была в остатках оба дня, но в app как ближайшая не отобразилась.

**Расследование (bug-agent, git-история CI-снапшотов `docs/mmd-orders.json` за 19-20.08):**
- Партия 11/09/2026 была **во всех** снапшотах 19-20.08 без единого пропуска — данные/DAX/pipeline не теряли партию.
- До 16:50 IST 20.08: список тукуф = `[28/08, 11/09]` (28/08 ближе, ещё не распродана).
- После 16:50 IST 20.08 (партия 28/08 распродана): список стал `[11/09, 24/10]` — 11/09 стала первой/ближайшей, одновременно зарегистрирована новая партия 24/10.
- Ложная версия (отброшена пользователем): совпадение дат Ашдод/Эйлат — НЕ баг, Эйлат физически снабжается из Ашдод-склада, совпадающие даты — норма.
- Точное UI-место, где сотрудник визуально перепутал даты, не подтверждено на 100% (репорт с чужих слов, не скриншот момента заказа) — но подтверждён объективный пробел: список из 2+ дат тукуф в столбце таблицы рендерился одним стилем, без иерархии/подписи.

**Фикс (`da1993cd`, оба файла — `docs/mmd-orders.html` и `MMD ORDERS/index.html`, НЕ синхронные копии, правка внесена в каждый отдельно):**
- `formatTukuf()`: первая (ближайшая) дата получает класс `tk-near` — жирный зелёный (`#1b5e20`, вес 800); последующие — `tk-next` — приглушённый серый (`#90a4ae`, вес 400).
- Верифицировано визуально через Puppeteer (реальный рендер страницы, замоканный fetch, клик по `enterApp()`, desktop 1400px + mobile 390px viewport) — computed styles подтверждены на обоих файлах.

**Деплой:** commit `da1993cd` → merge с CI data-коммитом → push `cb663cc7` → auto-deploy на VPS через `server-deploy.yml` (путь `MMD ORDERS/index.html` в триггере) — подтверждено `pm2 list` (columbus-api online, restart с uptime ~2м после пуша).

**Побочная находка (SSH):** во время деплоя 2-3 подряд SSH-подключения к VPS обрывались (`Connection closed by ... port 22`) сразу после успешного порта-теста, следующая попытка после паузы ~20с прошла чисто. Не расследовано — разово, не мешало задаче. Если повторится систематически — стоит проверить sshd MaxStartups/нагрузку на VPS.

**Открыто, не сделано:** пользователь запросил alert-механизм на "тихую порчу" данных (mlai/tukuf — если CI/rebuild перестал обновлять или потерял часть данных, сейчас никто не узнает). Не начато, отложено на следующую сессию.

### 2026-09-03 #resolved ✅ "הזמנה בלבד" рецидив (3-й раз) + נקה הזמנות explicit-zero + колонка תוקף אשדוד

**Жалоба:** фильтр "הזמנה בלבד" (только заказ) снова фильтрует по гамлаце вместо реального ввода юзера — уже чинили ~3 раза (06.08 ×2, 27.08), всегда возвращается.

**Диагностика (bug-agent, 2 причины):**
1. `docs/mmd-orders.html` вообще не получил ни один из трёх прошлых прод-фиксов (`80a97eb9`, `6e276e88`, `90074dcf`) — все они правили только `MMD ORDERS/index.html`. В docs-версии очистка инпута делала `delete sv[mk][f]` вместо явного `sv[mk][f]=0`, и в файле вообще не было `_effOrd()` — 6 разных мест дублировали инлайн-расчёт `s.k != null ? ... : hamlatza fallback`.
2. Реальный корень рецидива, найден уже в диалоге с пользователем (не bug-agent'ом): кнопка **"✕ נקה הזמנות"** в ОБОИХ файлах делала `localStorage.removeItem(LS)` — строки становятся "нетронутыми", и по подтверждённому пользователем правилу (нетронутая строка с гамлацой>0 = заказ) фильтр СНОВА показывал гамлацу сразу после массовой очистки. Именно поэтому 3 прошлых фикса (все точечные, про один инпут) не держались — паттерн бага никогда не жил в bulk-clear кнопке.

**Решения, подтверждённые пользователем через AskUserQuestion:**
- Fallback на гамлацу для нетронутых строк — **оставить как есть** (осознанное поведение с 06.08, не трогать).
- "נקה הזמנות" — исправлено на **explicit-zero для каждой позиции** (`sv[mk]={k:0}` для всех `all`, затем `render()`), а не удаление стораджа.

**Фикс (`e2b07aa5`, оба файла):**
- `docs/mmd-orders.html`: добавлена `_effOrd(r,s)` идентичная прод-версии (hamlMult `{664:4}`, weeksNfOvr `{659:3}`), все 6 инлайн-расчётов (filtered, render, recalc, inp explicit-zero, exportXL ×2, `_saveOrderToHistory` ×2) переведены на неё.
- `clearAll()` в обоих файлах переписан: explicit-zero всем SKU + `render()` вместо `removeItem`+ручного DOM-клира.
- Новая колонка **תוקף אשדוד** (список дат тукуфа, `_fmtDate` по каждой) в Excel-экспорте — между "הזמנה קרטון" и "תוקף נדרש". Прод: 9→10 колонок в `ws.addTable`. Docs: 8→9 колонок в manual header/autoFilter (не addTable — сохранён паттерн без Table XML из-за бага exceljs@4.4.0 totalsRowShown).

**Верификация:** `node --check` синтаксис обоих файлов OK; реальная генерация `.xlsx` через exceljs с тестовыми данными (10-кол prod-стиль с `addTable`, 9-кол docs-стиль без Table) → `unzip -t` без ошибок, `table1.xml` показывает `tableColumns count="10"` с правильными именами, `autoFilter` покрывает новую колонку.

**Деплой:** commit `e2b07aa5` → push → auto-deploy `server-deploy.yml` (путь `MMD ORDERS/index.html`) → подтверждено `pm2 list` (columbus-api online, uptime 2м после пуша). GitHub Pages (`docs/mmd-orders.html`) публикуется отдельным авто-процессом, статус не проверен (`gh auth` невалиден — токен, см. reminder).

**Правило на будущее:** любой фикс `_effOrd`-related логики — грепать ОБА файла (`MMD ORDERS/index.html` И `docs/mmd-orders.html`), они не синхронные копии и фикс молча не переносится. Есть теперь единая `_effOrd()` в обоих — при следующем изменении логики "что считается заказом" менять её в обоих местах одинаково.
