# mahsan-planogram — MAHSAN PLANOGRAM (FORMULA cold storage)

## Open Questions
- `planogram-build.yml` не имеет guard на аномальную долю null-данных — если PBI снова вернёт пусто, `continue-on-error: true` на каждом шаге снова пропустит это, и бот закоммитит битые данные как обычный билд (см. сессия 2026-08-18). Нужен sanity-check перед commit-шагом (напр. % null не должен вырасти больше чем на X п.п. от прошлого билда).

## Сессия 2026-08-18 #deployed

### הזמנה דגים — тренд/YoY график в מודal, критичный баг данных, print page-break

**Фичи в модалке מגמה (клик по товару в таблице הזמנה):**
- Скобки-суммы 3v3 месяцев на графике (prev3 серая, recent3 цвет по направлению тренда)
- Значок стабильности `●` для трендов ≤10% в таблице (вместо цветного ▲▼%) — убирает визуальный шум
- Новая строка YoY: последние 3 закрытых месяца vs те же 3 календарных месяца год назад
- `/pbi/dagim-all-monthly` расширен с 13 до 16 месяцев (YoY нужны доп. 3 месяца, которых не было в окне)
- `_fillMonthGaps` (клиент) — защита от того, что DAX SUMMARIZECOLUMNS молча пропускает месяцы без продаж вместо строки с 0
- График теперь показывает все 16 месяцев + третью скобку (YoY-период, крайняя слева) — раньше урезался до 13, что как раз обрезало нужные для YoY месяцы
- Окно увеличено и стало квадратнее (было ~2.1:1 → стало ~1.25:1); все шрифты/фото пропорционально крупнее; проценты (142%▲) на треть крупнее описательного текста рядом
- Печать заказа: `page-break-inside:avoid` на `#print-split-tables > table` — категория (📦 IKRA и т.п.) больше не рвётся между страницами

**Критичный баг найден и исправлен**: автобилд `planogram-build.yml` (07:38 UTC 18.08) обнулил `daySales*`/`pakuotZafn` у 92 из 95 товаров דגים — источник PBI вернул пусто, а `continue-on-error: true` на каждом шаге пропустил это без остановки, бот закоммитил битые данные как обычный билд. Раздел סכנה ותוקף опустел на проде. Откачено к последнему рабочему билду (05:30 UTC). **Root cause в самом workflow не устранён** (нет guard на аномальную долю null) — риск повтора остаётся, см. Open Questions.

**INTER DAX-фикс** (`server/index.js`, `/api/client-analytics`): причина завышенных цифр — мера `[TOTAL SALES (ללא זיכויים מרכזים)]` содержит `NOT(...)` фильтр на том же столбце, по которому группирует SUMMARIZE → per-SKU ограничение из row-context молча терялось (DAX filter-argument semantics: explicit filter заменяет, а не пересекается). Заменено на прямой `SUM`. Фича осталась выключена флагом (не нужна сейчас), но root cause устранён для будущего включения.

**Tooling**: портативный poppler (`pdftoppm`) установлен в `~/.claude/tools/` без прав администратора — для реальной проверки print-CSS (`page-break-inside` и т.п.) через PDF→PNG вместо обычного скриншота, который пагинацию не показывает. Задокументировано в `.claude/AGENTS/designer/AGENT.md`.

**Инцидент (не баг, для информации)**: параллельная сессия Claude Code в этом же репозитории (правки map-toggle в `formula-road.html` + `/manifest.json` 404-фикс в `server/index.js`) синхронно запушила поверх коммита этой сессии. Обнаружено, содержимое проверено (byte-identical дублирование), смёржено через `git merge` — без `--hard`/force-push, без потерь.

Коммиты: `8132553e` → `fb2958cb`/`d3f42d70` (INTER DAX) → `6fbe8279` (откат данных) → `8f4c8342` (симметрия/размер модалки) → `74077f9d` (print page-break) → `6f88c915` (16 месяцев + YoY-скобка) → `810f209e` (шрифт %) → `82ea1d94`/`b82edc5c` (квадратнее + merge)

### הזמנה דגים — доводка скобок графика, deep-link "открыть заказ в один клик", PWA scope fix

**Скобки графика (продолжение)**: цифры над скобками (991/566/1371) увеличены (7.5px→12px), единый нейтральный цвет вместо серый/зелёный/красный — направление и так читается по цвету текста строк выше (142%▲/38%▲), дублировать в цифрах избыточно. Сама скобка (path) осталась цветной как ориентир. Добавлен едва заметный пунктирный вертикальный маркер вниз от каждой скобки + ⭐ на наибольшем из трёх значений.

**Deep-link `?open=dagim-order`**: одна ссылка → без клика по сплэшу и по вкладке דגים сразу открывает הזמנת דגים (для рассылки боссу по email/WhatsApp). Open Graph теги в `<head>` — красивое превью карточки со ссылкой вместо голого URL.

**Баг найден и исправлен (гонка данных)**: первая версия deep-link вызывала `splashEnter()` сразу при парсинге скрипта — до того как `loadMaps()` (fetch `dagim-base.json` и т.п.) вообще стартовал. Обычный клик пользователь делает через пару секунд, данные успевают подгрузиться в фоне; автопереход этой паузы лишён → таблица рендерилась по пустому `DAGIM_BASE` ("אין מוצרים"). Фикс: триггер перенесён в конец init-IIFE, после `await loadMaps()`. Проверено локальным static-server + puppeteer: `DAGIM_BASE` 88 ключей, 64 строки в таблице вместо 0.

**PWA scope баг**: `manifest.json` (name "FORMULA ROAD") без явного `"scope"` по умолчанию захватывал весь `docs/` — Edge открывал любую ссылку сайта (включая `planogram-editor.html`) внутри установленного PWA "Formula Road", с его именем в заголовке окна вместо страницы. Фикс: `"scope": "./formula-road.html"` — Formula Road на другие локальные страницы переходит только через `window.open` (новая вкладка), не задета. Уже установленным копиям PWA нужна переустановка — scope фиксируется на момент установки.

Коммиты: `fcefacac` (скобки доводка) → `9ea95f9b` (deep-link) → `1826a002` (OG теги) → `06607ab7` (фикс гонки) → `2069dba0` (PWA scope)

**Related:** [[session-2026-08-12-dagim-stock-fix]], [[formula-road-app]]

## Сессия 2026-08-12 #deployed

### Dagim секция — двойной баг, двойной фикс

**Баг 1:** `fetchStockMain()` (SUMMARIZECOLUMNS makat-only) выбрасывает строки дагим → stock=0.  
Фикс: Fallback 1 в `pbi-kapua.js` — `stock = sum(pakuot.cartons)`.

**Баг 2:** CI в 11:00 UTC попадает в PBI refresh → KARTIS PARIT пустой → dagimProds=[] → 81 продукт теряется из product-data.json.  
Фикс: `prevProdDataAll` в `build-planogram.js` — восстанавливает дагим из предыдущего JSON при пустом ответе PBI.

**Fallback 2 (pbi-kapua.js):** если stock=0 и stockAllWh > 0 (MLAY, все склады) → stock = stockAllWh. Защита от случая когда Main=0 но реальный товар есть.

**Верифицировано:** CI 1abd535c — 403001: stock=2555, 403007: stock=193, все 8 дагим с pakuot ✓

Детали: [[session-2026-08-12-dagim-stock-fix]]

## Сессия 2026-07-07 #done

### STOP SALE — исправление (combined view)

**Баг**: карточки STOP SALE не показывали фиолетовую рамку в combined (מאוחד) режиме.

**Причина**: в combined view была отдельная переменная `cBorder` (строка 3547), которая проверяла только `anySakana` (красный). Переменная `cardBorder` с `isStop` (фиолетовый) там не использовалась — вычислялась выше, но в combined path применялась только split view.

**Fix** (`docs/planogram-editor.html`, commit `de2afa8b`):
```js
const cBorder  = isStop ? '2.5px solid #6a1b9a' : anySakana ? '2px solid #c62828' : '1px solid #dde0e8';
const cThBg    = isStop ? '#6a1b9a' : anySakana ? '#c62828' : '#f5f5f5';
const cThTxt   = isStop ? '⛔ STOP SALE — כל המחסנים' : 'כל המחסנים — פק"ע';
```

**isBatchStop логика** (finalized):
- `cartons=0` → true (пустая партия = нечего продавать)
- `eff=0` (daysLeft ≤ shelfLife) → true (просрочено/в окне хранения → нельзя продать)
- `eff>0, sales=0` → false (данных нет, не можем судить)
- иначе: `throwAway = ceil(cartons - (eff/1.4)*sales) ≥ cartons`

**`/1.4` формула**: `1.4 = 7/5` — конвертирует рабочие дни → календарные. `daySales` — продажи за рабочий день, `daysLeft` — календарные дни.

**Пример 411001**: daysLeft=1, shelfLife=7 → eff=0 → STOP SALE (фиолетовый).

**Маркер**: `build:2026-07-07b` в консоли.

## Сессия 2026-07-06 #done

### Excel мיקום — финальные правки
- **mergeCells C2:J2**: заголовок теперь покрывает ровно ширину таблицы (C→J), без лишнего столбца K и без потери мастер-ячейки
- **halavi-base.json v2** (`2026-07-05-halavi-v2`): версия поднята → при первом открытии страницы localStorage сбрасывается и printOrder обновляется со 147-154 (было 247-254)
- **photo-proxy деплой**: VPS обновлён, фото через прокси загружаются в Excel

## Сессия 2026-07-05 (продолжение) #done

### Photo proxy — CORS fix
- **`/api/photo-proxy`**: GET endpoint на VPS — fetches `priority.dilerbmd.com` с SSRF-guard (`isSafePhotoUrl`), CORS `*`, Cache-Control 24h
- **planogram-editor.html fetchAndEmbed**: теперь качает через `https://api.sverdlik-apps.site/api/photo-proxy?url=...` — GitHub Pages больше не блокируется CORS
- **Деплой**: git push + pm2 restart columbus-api (online, ↺58)

## Сессия 2026-07-05 #done

### CI / данные
- **planogram-build.yml**: добавлены дневные запуски 08/10/12/14:00 Israel — теперь product-data.json обновляется каждые 2ч в рабочее время (раньше: только 06:00 + 16:00–23:00)
- **sync-breira-only.js**: новый скрипт — синхронизирует XLSX → *-base.json без PBI-запросов (быстрый однократный синк)

### Данные / planogram-editor
- **חלבי חלוקה 1 printOrder**: исправлено 247-254 → 147-154 (XLSX + halavi-base.json)
- **export-position-xlsx**: убран `requireAuth` — эндпоинт недоступен с GitHub Pages (разные localStorage домены); внутренний инструмент, авторизация не нужна
- **▲▼ move fix**: `movePrintOrder` теперь меняет числа `.printOrder` у двух соседних позиций — ре-сорт больше не сбрасывает ручное перемещение
- **drag-drop fix**: drop-handler в `_initTableDrag` перераспределяет `.printOrder` по диапазону затронутых строк — drag сохраняет позицию после sort
- **Excel מיקום — клиентская генерация**: убран серверный вызов, ExcelJS работает в браузере — фото качает сам браузер батчами по 8, нет зависания на 30+ мин; IMG_ROW_PT=22pt

### CLAUDE.md
- Добавлен раздел "Честность и верификация — ОБЯЗАТЕЛЬНО" (правило не выдавать предположения как факты)

## Сессия 2026-06-30 #done

### Исправления planogram-editor.html (продолжение)
- **Excel מיקום — фото при фильтре**: `editAs: twoCell` + `br` координаты — фото скрывается со строкой; размер −30% (row 24→17pt). Артефакт ниже таблицы остался (Excel limitation, принято)
- **Excel — кнопка загрузки**: кнопка "⬇ Excel 📷" блокируется и показывает "⏳ מכין..." пока генерируется файл
- **הזמנה בלבד кнопка**: текст пропадал при выключении (цвет был белый на белом). Исправлено: OFF-состояние bg=#fff, color=#0D47A1
- **dagim-sales — מכר בתקופה**: Query 2 возвращал `[סניפים2 שקנו]` (кол-во магазинов) вместо `[TOTAL מכר בקרטונים]` (реальные карт. продаж). Теперь правильно: 290 карт. вместо 1,417 для מקט 1154

### Данные / аналитика
- מקט 1154: продажи реально ~290 карт. за март-июнь 2026. В марте 251 магазин купил, с апреля стоит (7→3→0 магазинов)
- FORMULA TMDL: `[TOTAL מכר בקרטונים]` = SUMX(KARTIS PARIT[מקט], DIVIDE([TOTAL UNITS for _מכר_],[תכולה חישוב])) — правильная мера для итоговых карт. продаж

## Сессия 2026-06-29 #done

### Исправления planogram-editor.html (MAHSAN EDITOR)
- **Auth**: все fetch к API теперь передают `X-Session: frToken`; `/pbi/dagim-sales` и `/pbi/formula-refresh` стали публичными (no auth)
- **Сессии**: rolling 30 дней — каждый запрос продлевает токен, больше ежедневного логина нет
- **הזמנה данные по месяцам**: красный баннер "שגיאת שרת" устранён — dagim-sales теперь работает без токена
- **מיקום сортировка**: исправлено — теперь haluka→printOrder (bug: localStorage state не имел haluka из старых сессий, исправлен merge из base.json)
- **מיקום "כל המחלקות"**: все секции смешиваются и сортируются по חלוקה глобально
- **Excel из מיקום**: добавлена колонка חלוקה, фото уменьшено в 3 раза (90px→30px), сортировка по haluka→printOrder
- **תוקף print**: карточки растягиваются до высоты строки (height:100% в grid)

Topic file for planogram build system: ExcelJS builder, Power BI data, GitHub Actions CI/CD.

## Архитектура

- **Builder**: `C:\Users\d.sverdlik\Desktop\WORKSPACE\PLANOGRAM MAHSAN FORMULA\build-planogram.js`
- **Sync copy**: `COLUMBUS/planogram/build-planogram.js` (sync with Node fs.writeFileSync — PowerShell corrupts Hebrew)
- **CI/CD**: `.github/workflows/planogram.yml` — runs 08:00 Israel time Sun–Thu + workflow_dispatch
- **Web viewer**: `docs/index.html` → GitHub Pages at `https://sverdlikdan-code.github.io/COLUMBUS/`
- **Secrets**: PBI_TENANT, PBI_CLIENT, PBI_SECRET, PBI_DATASET, PBI_WORKSPACE, WORKFLOW_TRIGGER_TOKEN
- **Output**: `MAHSAN PLANOGRAM v41.xlsx` → 5 sheets (קפוא, חלבי, דגים, מחסן מעבר, צפון מלאי פחות מ3DAYS SALES)

## Cell structure (fillCell)

```
← START (pick #1 only, blue bold)
#pick_number
[🏅/⭐] [🏋️] product_name
────────────────────  (thin grey separator)
AVG/d: X.X קרט | Y.Y PAL  (if kratnost > 0)
KG: weight
╔══════════════╗
  מלאי: X PAL   (blue) or X קרט (red)
╚══════════════╝
────────────────────  (separator before dates)
פק"ע dd/mm/yy (Xd) Yקרט
```

## Compact fill rule (all 3 sheets)

Zero-stock products skip planogram slots. In-stock products fill sequentially. פנוי only at end after all products placed.

## Family legend bar (row 2)

- Colored family labels, height=30, shrinkToFit, medium top border
- No hyperlinks — pure visual legend
- Refresh timestamp in last cell

## Empty cells (פנוי)

- Added to colsToResize (width=32) + rowsToResize (height=160)
- Light grey border + near-white background, font size 10 bold grey

## Sessions

### 2026-05-12 #session-end ✅
Fixed legend row overflow (FERMA napolzaet): navRow.height 20→30, medium top border, shrinkToFit+wrapText:false.
Added PAL delimiter: thin separator line before פק"ע dates section.
Fixed empty cells: added to resize sets + border/fill.
Build output: ✅ v41.xlsx, all 3 sheets, 16 zero קפוא / 4 zero חלבי / 15 zero דגים.

### 2026-05-13 #session-end ✅
Planogram editor (docs/planogram-editor.html) — серия фиксов:
- **Вес коробки**: stockHTML показывает `weightCarton` (кг/коробка) вместо веса единицы.
  enrich-product-data.js добавляет `packFactor` (из паттерна "(N)" в desc) + `weightCarton = weight×packFactor` в product-data.json.
  197 продуктов обогащено, 157 с weightCarton.
- **Days label**: `ימ'` → `${days} days`.
- **DESC на карточках**: временно появился (desc из FORMULA PALLETS слишком длинный) — убрали.
- **SANTA BREMOR в חלבי**: localStorage загружал старый state. При Hard Refresh исчезло.
- **nameEn от KARTIS PARIT везде**: build-planogram.js теперь пишет `nameEn` в product-data.json для всех секций (kapua/halavi/dagim). pbi-kapua KARTIS PARIT query уже без фильтра семейства → содержит все продукты. planogram-editor.html: textModeHTML использует `p.name || productData[makat]?.nameEn`. Активируется после следующего scheduled build.
- **Reserve-start fix**: sectionReserveStart() helper — halavi/dagim используют свои переменные, не KAPUA_RESERVE_START.

Pending: scheduled build запишет nameEn → карточки получат имена из KARTIS PARIT.

### 2026-05-16 #session-end ✅

**Планограмма-редактор — страница תוקף (экспайри) + фиксы:**

- **fixVisualRTL** применён в `mkEntry` (build time) + `loadMaps` (client) — Hebrew имена больше не ломаются
- **Источник имён**: переключён с `KARTIS PARIT[תאור]` на `MLAY[תאור מוצר]` (полные имена с брендом/весом)
- **Фильтр склада**: убран fallback `stockZafn ?? stock` в stockHTML — кнопки מחסן теперь работают во всех секциях
- **סדר הדפסה**: новая колонка в таблице с ▲▼ стрелками, независимая от позиции bay, сохраняется в localStorage, CSV-экспорт следует порядку печати
- **Страница תוקף** (`📦 תוקף` кнопка в тулбаре):
  - 2-колоночная сетка: אשדוד | צפון
  - Фото товара + партии пак"э с датами, дансLeft, картонами
  - Фильтр: товары без מלאי не показываются
  - `⚠ סכנה` на партию (daysLeft < cartons/daySales)
  - Подвал (tfoot): `ממוצע מכירה: X קרט/יום` + `יספיק עוד: X ימים` отдельно для каждого склада
  - Цвет `יספיק`: красный < 7 дней, зелёный ≥ 7
  - Заголовки колонок красные только при наличии סכנה, иначе серые
  - Граница карточки красная только при סכנה
  - `batchCell` переписан: 2 строки — `תוקף: дд/мм/гг (N ימים)` + `כמות: N קרט`
  - Тотал мלаי сверху: один значок `סה"כ מלאי: N קרט` (аshd+zafn)
  - Auto-rebuild при смене секции через switchTab
- **Баг найден**: Query 2 (daySales) не имеет фильтра `מחסן = "Main"` — считает продажи всех складов. Исправление отложено (нужно уточнить DAX-меру у пользователя)
- **settings.local.json**: добавлен в `.gitignore` (содержал GitHub PAT)

Коммиты: `9fcf784` → `ba8cdb3` → `6898ef5` + `632f272` (gitignore)

### 2026-06-07 #session-end ✅

**Страница תוקף — временное скрытие карточек перед печатью:**

- **Фича**: кнопка **✕** на каждой карточке в странице תוקף — скрывает карточку перед печатью
- **Не навсегда**: состояние хранится только в `window._hiddenExpiryMakats = new Set()` (в памяти страницы, не в localStorage)
- **Кнопка ↩ איפוס (N)**: появляется в хедере страницы תוקף, когда есть скрытые карточки (N = количество); нажатие возвращает все
- **При печати**: кнопки ✕ и ↩ не печатаются (`class="no-print"`)
- **При закрытии/открытии** страницы תוקף — все скрытые карточки возвращаются автоматически
- **Функции**: `hideExpiryCard(mk)`, `resetHiddenExpiryCards()`, `_syncResetBtn()`
- Фильтр в `buildExpiryPage()`: `if (window._hiddenExpiryMakats.has(mk)) return null;`

**Объяснено**: кнопка מרענן делает `location.reload(true)` — тянет JSON из `docs/` (GitHub Pages). Данные PBI попадают туда только через GitHub Actions флоу. Дата в бейдже = дата последнего обновления PBI, не дата запуска флоу.

Коммит: `2d627ab` → push `4d11774`

### 2026-06-07 #session-end ✅ (продолжение)

**Страница הזמנה — открытые заказы и мלаי всех складов:**

- **Фикс фильтров** (HERRING/IKRA/KAPUSTA/OTHER): `const grpLabel` был в TDZ — перенесён до первого использования. Теперь кнопки работают.
- **Колонка הזמנות פתוחות**: добавлена в таблицу, header 📅 לכמה ימים
- **`fetchDagimFromBI()`**: добавлен запрос `[הזמנות רכש פתוחות PLUS מלאי זמין]` из KARTIS PARIT для dagim только. `openOrders = spo - (Main + Zafn + Trnz)` — вычитаем ВСЕ склады.
- **`fetchStockMain()`**: не тронут — планограмма не затронута
- **`build-planogram.js`**: одна строка в `mkEntry`: `openOrders: p.openOrders > 0 ? p.openOrders : null`. Строка из kapua merge section удалена.
- **`buildOrderPage()`**: `stockAll = stock + stockZafn + stockTrnz`; `daysStk = (stockAll + openOrders) / daySales * 1.4`; `need = safetyK - stockAll`
- **Логика**: `[הזמנות רכש פתוחות PLUS מלאי זמין]` = млаי всех складов + заказы поставщику. `openOrders` = чисто заказы (мера − все склады). `daysStk` = сколько дней хватит (все склады + заказы в пути).

Коммиты: `e71b63d` (planogram-editor), `b1d80ec` (pbi-kapua + build), + финальный фикс stockAll

### 2026-06-15 #session-end ✅

**MMD ORDERS — layout и BiDi финальные фиксы:**
- Sidebar убран полностью; фильтры мלаי אשדוד/MMD перенесены в горизонтальные строки `#skrow / .skline`
- `col-g` (#e8f0f8) — серая заливка на 5 колонках: מלאי MMD, מכר ממוצע, המלצה, הזמנה ידנית, תוקף הזמנה
- CSS: `tbody td.col-g { background: !important }` — переопределяет nth-child odd специфику
- `fixProductName(s)` — точечный фикс: `'ג004 → 400ג'` + зеркальные скобки `)text( → (text)`, применяется к строкам без BiDi-маркеров
- Порядок пайплайна рендера: `fixProductName → shortName → _ltrWrap`
- **Период-бар перенесён в заголовок**: `#period-bar` перемещён из отдельной строки внутрь `#hdr-top` (`flex:1` между h1 и кнопками); цвета чипов адаптированы под тёмный фон (rgba белые оттенки); освобождена одна строка для таблицы
- Коммит: `6077eb5`

### 2026-06-21 #session-end ✅

**MAHSAN EDITOR — страница הזמנה (דגים), серия фиксов real-time TOTAL + ручных правок:**

- **TOTAL не обновлялся (1-й репорт)**: добавлены `id` в ячейки нижней строки итогов + `_recalcOrdTotal()` → коммит `a9bd1d3`
- **מכר ממוצע не менялся по месяцам**: реальная причина — `toggleOrderPeriod()` делал multi-select toggle (Set add/remove) вместо single-select replace; при дефолтных 2 месяцах клик по 3-му только размывал среднее → коммит `6116653`
- **TOTAL "не в динамике" (2-й репорт, после a9bd1d3)**: настоящая причина — подытоговая строка каждой группы (📦 fOrder/fPal) рисуется один раз при `buildOrderPage()` и не имеет `id` → `_recalcOrdTotal()` её никогда не трогал, обновлялись только верхний KPI-бар и нижняя строка "סה"כ כולל". Юзер визуально следит за строкой группы прямо над/под правкой — она и оставалась статичной.
  - **Фикс**: `data-grp="${gIdx}"` на `.ord-k-input`/`.ord-pal-input`, `id="ord-grp-k-${gIdx}"`/`id="ord-grp-pal-${gIdx}"` на ячейках группы; `_recalcOrdTotal()` теперь считает per-group суммы и обновляет их тоже.
- **"הזמנה בלבד" сбрасывал ручные правки ידני PAL**: `buildOrderPage()` при каждом клике (фильтр семьи/период/zero/order-only) пересобирал `allRows` с нуля по авто-формуле `orderK = spo < safetyK ? safetyK : 0` — терялись все значения, вписанные руками.
  - **Фикс**: `window._orderManualEdits[mk] = {orderK, orderP}` пишется в `_recalcRowPal`/`_recalcRowK`; `buildOrderPage()` проверяет оверрайд перед авто-расчётом.
- **Добавлены 💾 שמור / 🕐 היסטוריה** в тулбар הזמנה (по аналогии с основной планограммой — localStorage `mahsan_order_versions`, последние 5 версий ручных правок, restore через dropdown).
- Коммит: `419776e`

### 2026-06-22 #session-end ✅ (MAHSAN EDITOR FORMULA)

**Найден и устранён разрыв пайплайна סדר הדפסה — данные из мастер-Excel молча отбрасывались:**

- **Причина**: пользователь правил `סדר הדפסה` в файле `בררת מחדל FOR ALL.xlsx` (корень COLUMBUS) — но этот файл гитигнорится (`*.xlsx`) и никогда не был подключён к пайплайну. Реальный файл автоматизации — `planogram/breira-default/FOR-ALL.xlsx`, хардкодом зашитый в `convert-breira.js`, не обновлялся с 3 июня.
- **Фикс файла**: корневой xlsx скопирован в `planogram/breira-default/FOR-ALL.xlsx` (старая версия — бэкап `FOR-ALL.xlsx.bak-20260603`).
- **Фикс пайплайна** (колонка `סדר הדפסה` читалась из CSV, но никуда не передавалась):
  - `planogram/breira-default/loader.js` — добавлен `idx.printOrder`, парсинг и возврат `printOrder` в результате `loadBreiraDefault()`
  - 4 build-скрипта (`build-kapua-new.js`, `build-halavi-new.js`, `build-dagim-fab.js`, `build-dagim-yavesh-new.js`) — `picks[bay]` теперь содержит `printOrder: bd.printOrder ?? null`
  - `docs/planogram-editor.html` — новый `_printOrderKey(sec, pick)` + `_getPrintOrder()` теперь сортирует по умолчанию по `printOrder` из Excel (а не по номеру bay-позиции), localStorage-оверрайд (ручная перетаска) остаётся приоритетным
- **Пересобраны все 4 base.json**, проверено: halavi 23/23 PRESIDENT гбинот с printOrder, kapua 53/71, dagim 59/59, dagim-yavesh 30/30
- Коммит: `5ca97f4`

Pending: визуальная проверка в браузере не выполнена; `build-planogram.js` + `workflow-doctor.js` (финальные шаги прод-workflow) не запускались локально — параллель с прод-сборкой не на 100%.

**Визуальная проверка + найден второй баг (тот же день, продолжение):**

- Puppeteer-проверка (headless, временный static-сервер) подтвердила: таблица מיקום и `exportCSV()`/`exportCSVAll()` действительно сортируют по одному и тому же `_getPrintOrder()` — 3 SKU "+300" (413001/413002/413000, printOrder 506-508) корректно уходят в конец списка, остальные 20 PRESIDENT-позиций (printOrder 235-254) — в середине. Подтверждено идентичным кодом обоих мест (`sectionReserveStart(sec)` + `.filter(pick => +pick < reserveStart)`).
- **Юзер показал скриншот живой страницы — порядок не совпадал ни с בי, ни с новым סדר הדפסה.** Причина: `_getPrintOrder()` сначала проверяет localStorage `mahsan_print_order_<sec>` (ручная drag/▲▼ перестановка) и, если она есть, **навсегда** перекрывает Excel-данные — даже после ребилда base.json с новым `printOrder`. Версионный ресет (`kapua_base_v`/`halavi_base_v`/`dagim_base_v`/`yavesh_base_v`) обновлял `state[sec]` из свежего JSON, но никогда не трогал этот отдельный localStorage-ключ — старая ручная сортировка переживала любой ребилд.
- **Фикс**: во всех 4 блоках версионного ресета в `docs/planogram-editor.html` добавлено `printOrder[sec] = null` + `localStorage.removeItem('mahsan_print_order_<sec>')` — при смене версии base.json ручной оверрайд теперь тоже сбрасывается, таблица возвращается к Excel-порядку `סדר הדפסה`.
- Проверено Puppeteer: искусственно выставили `halavi_base_v=STALE-OLD-VERSION` + фейковый `mahsan_print_order_halavi` → после reload оба ключа очистились, таблица отрисовалась по свежему printOrder.
- Коммит: `5a2b2dd` → push.

Pending: `build-planogram.js` + `workflow-doctor.js` всё ещё не прогнаны локально (прод-паритет).

**Прод-паритет + третий баг — отображение колонки (тот же день, продолжение):**

- Прогнаны `planogram/build-planogram.js` + `planogram/workflow-doctor.js` с живыми данными Power BI — фикс printOrder подтверждён на проде: все значения `printOrder` сохранились без регрессии после полного ребилда (`halavi-base.json` diff — только косметика семейств + 1 stale-pick очищен). Коммит ребилда: `9a86fc7`.
- `workflow-doctor.js` дал ⚠️ WARNING (GitHub Actions не коммитил 4ч, сегодня не запускался). Расследование через публичный GitHub REST API (без токена — репозиторий публичный, `.env GITHUB_TOKEN` оказался невалидным/просрочен, 401 на двух независимых проверках): `planogram.yml` — устаревший workflow (последний запуск 20 мая), реальный прод — `planogram-build.yml` (cron `0 3 * * *` + `0 13-20 * * *` UTC). Последний запуск — задержанный (09:13 UTC вместо 03:00), следующий слот (13:00 UTC) был просрочен на ~2ч без видимого запуска. Вывод: разовая задержка на стороне GitHub Actions (вчера весь день крон отрабатывал штатно по часам), не баг пайплайна — решено наблюдать, без дополнительных действий (локальный watchdog/`COLUMBUS-Daily-06` — подстраховка).
- **Третий баг, найден пользователем по скриншоту**: колонка `סדר הדפסה` в таблице מיקום показывала не реальное значение printOrder из Excel, а пересчитанный порядковый номер строки (`_SEC_BASE[sec] + i + 1`, например 201, 202, 203... подряд) — это маскировало реальные Excel-значения (включая разрывы для "+300" резервных позиций, например 501-508) и не позволяло пользователю визуально проверить, что сортировка реально идёт по Excel-данным.
  - **Фикс**: в `docs/planogram-editor.html` (обе точки рендера — секционная таблица и комбинированный вид "כולם") колонка теперь показывает `p.printOrder` напрямую (с fallback на старый пересчитанный номер только для picks без printOrder).
  - CSV-экспорты (`exportCSV`/`exportCSVAll`) не тронуты — там пересчитанный сквозной номер используется намеренно для печати этикеток (резервные "+300" позиции туда не попадают вовсе).
  - Проверено Puppeteer: колонка теперь показывает реальные значения (209→254, затем 501→508 для резерва) в правильном порядке.
  - Коммит: `8d1d3ab` → push.

Итог сессии: пайплайн `סדר הדפסה` (Excel → build → UI) полностью рабочий и визуально проверен на всех уровнях — сортировка, localStorage-версионирование, отображение реального значения, прод-ребилд.

### 2026-06-26 #session-end ✅ (הזמנה דגים + automation)

**הזמנה дגים — цвета, פיזור, Excel מיקום:**

- **Цветовая палитра MMD** — финально применена к странице הזמנה:
  - Thead: `#0D47A1` + белый текст (все заголовки, без цветных акцентов)
  - Чётные строки: `#E3F2FD`, нечётные: `#fff`, границы: `#BBDEFB`
  - Группы: `#1565C0` (было `#263238`), белый текст без цветных иконок
- **Разбивка запроса `/pbi/dagim-sales` на два**: Query 1 — `daySales` только (стабильный, всегда работает); Query 2 — `mkrTk` + `branchy` с `.catch(() => null)` (не роняет основной запрос)
- **Причина "שגיאת שרת"**: `[TOTAL מכר בקרטונים]` и `[סניפים2  שקנו]` ломают SUMMARIZECOLUMNS — изолированы в отдельный запрос с fallback

**Excel מיקום — новая колонка + сортировка:**
- Добавлена колонка `סדר הדפסה` в `/api/export-position-xlsx`
- Server-side сортировка по `printOrder` перед записью в Excel (`rows.sort(...)`)
- Фото: `ext: {width:90, height:90}` (не `tl/br`) — правильный размер изображения
- `printOrder` теперь передаётся из клиента в payload

**Automation — Hooks + CronCreate:**
- `SessionStart` hook → инжектирует напоминание в контекст (fin-agent + security)
- `PostToolUse` hook (Edit) → при изменении `server/index.js` — security-agent trigger
- CronCreate durable: fin-agent каждый понедельник 9:03, security-agent каждую пятницу 10:07

Коммиты: `7cc5f48` → `360692f` → `09f2e51` → `7e14ca6`
