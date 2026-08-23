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

## Архив

Сессии 2026-05-12 – 2026-07-07 (STOP SALE фикс, Excel מיקום правки, photo-proxy CORS, CI/данные, auth/сессии, версионный ресет printOrder и др.) → [[mahsan-planogram-archive]]

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

