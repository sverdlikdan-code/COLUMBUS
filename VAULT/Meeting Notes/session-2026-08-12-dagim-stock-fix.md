---
name: session-2026-08-12-dagim-stock-fix
description: Сессия 2026-08-12: mahsan IP whitelist, gate logging, dagim stock=0 диагноз и фикс
metadata:
  type: project
---

## Сессия 2026-08-12 #deployed

### IP whitelist для Mahsan Editor (из предыдущей сессии, задеплоено)
- `mahsanIpGuard` middleware в `server/index.js` — читает `MAHSAN_ALLOWED_IPS` из .env
- Применён к `/auth/pbi` и `/save-kapua`
- VPS `.env`: `MAHSAN_ALLOWED_IPS=147.235.181.158,85.130.240.2,213.146.169.210,213.146.170.221`
- Логирование gate-pbi / gate-cookie / gate-blocked добавлено в `formulaRoadGuard`

### Dagim stock=0 и daySales=null — диагноз

**Симптом:** В планограмм-эдиторе дагим секция показывала `stock: 0`, `daySales: null`.

**Root cause (stock=0):** DAX `SUMMARIZECOLUMNS` с группировкой только по `מק"ט` возвращает blank для дагим продуктов из-за поведения blank-row removal. Тот же `SUM` с группировкой мк+дата (pakuot query) возвращает правильные значения.

**Root cause (daySales=null):** Утренние CI-билды запускались до завершения PBI dataset refresh. `ALL_PARTS[מחסן]="Main"` возвращал пустоту пока данные не дошли. После полного обновления PBI — данные вернулись (в 12:xx UTC).

**Фикс в `planogram/pbi-kapua.js`:**
- `stock` = 0 и pakuot имеет карт → `stock = sum(pakuot.cartons)` — математически эквивалентно прямому SUM
- `stockZafn` аналогично из `pakuotZafn`
- Это fallback, не замена — когда PBI данные есть, прямой запрос берётся первым

**Верификация:** PBI показывает 403007: `מלאי קרטון=302` = 193 (Main) + 109 (Zafn). Наш pakuot=193 + pakuotZafn=109 = 302. Точное совпадение.

**Коммиты:**
- `ce6cdb46` — revert неправильного fallback с daySales=daySalesZafn
- `9a70ec23` — fix(dagim): stock/stockZafn from pakuot sum (verified vs PBI)
- `94c22003` — merge с CI rebuild (данные вернулись после PBI refresh)

### Важные уроки
- Неправильные данные ХУЖЕ чем нет данных (решения на миллионы на основе данных)
- Когда pakuot и stock расходятся — приоритет у pakuot (более гранулярный и верифицированный)
- daySales null утром = PBI refresh ещё не завершён, не баг кода
- Нельзя использовать Zafn продажи как proxy для Main продаж — разные склады, разные объёмы

---

## Сессия 2026-08-12 (продолжение) #deployed

### Проблема 2: KARTIS PARIT пустой во время PBI refresh → все дагим исчезают из product-data.json

**Симптом:** CI билд 11:46 UTC — product-data.json потерял 81 дагим продукт (было 288, стало 207).

**Root cause:** `fetchDagimFromBI()` запрашивает `שם מחסן אשדוד = "דגים 🐟"` из KARTIS PARIT. Во время PBI dataset refresh (~10:46 UTC) таблица временно пустая → `dagimProds=[]` → build-planogram.js записывает JSON без дагим. Одновременно `dagim-base.json` reserve слоты обнулились (dagimProdMap был пустой).

**Фиксы в `planogram/build-planogram.js`:**
1. `prevProdDataAll` — сохраняет полный предыдущий product-data.json в начале билда
2. Если `dagimProds.length === 0` после loop → восстанавливаем все мкат из `dagimMkSet` из предыдущего JSON
3. Guard: пропускаем sync dagim-base.json когда `dagimProds` пустой

**Фикс в `planogram/pbi-kapua.js` (Fallback 2):**
- После Fallback 1 (pakuot sum): если `stock=0` и `stockAllWh > 0` (MLAY, все склады) → `stock = stockAllWh`
- Если `pakuot` пустой и `pakuotAll` не пустой → `pakuot = pakuotAll`
- Источник `stockAllWh`: `MLAY[מלאי זמין] / packFactor` — не зависит от `מחסן="Main"` фильтра

**Почему `מלאי-תוקף[מחסן="Main"]` возвращает 0 для дагим в определённых CI-билдах:**
- DAX `SUMMARIZECOLUMNS` + blank-row removal (см. выше)
- Не "склад переехал" — данные в PBI есть, но агрегация без контекста визуала возвращает BLANK
- MLAY как fallback всегда надёжен (независимая таблица, нет warehouse-фильтра)

**Верификация CI (1abd535c):**
- 403001: stock=2555, pakuot=2
- 403007: stock=193 (от Fallback 1 — pakuot батч 193 крт.), spo=689, pakuotAll работает

**Коммиты этой части:**
- `ec7fa2f0` — fix(dagim): stockAllWh fallback + manual patch 403xxx stock from MLAY
- `55e9f729` — merge: resolve product-data.json conflict — keep CI build (dagim restored)

### CI расписание и окно refresh
- PBI dataset refresh начинается ~10:46 UTC
- CI запускается в 11:00 UTC → попадает в refresh-окно → KARTIS PARIT пустая
- Следующий CI (13:00+) уже после refresh → данные восстанавливаются
- Защита: prevProdDataAll fallback гарантирует что данные не потеряются даже при пустом ответе PBI
