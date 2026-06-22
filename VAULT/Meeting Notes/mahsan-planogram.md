# mahsan-planogram — MAHSAN PLANOGRAM (FORMULA cold storage)

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
