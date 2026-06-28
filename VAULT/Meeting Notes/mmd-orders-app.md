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
