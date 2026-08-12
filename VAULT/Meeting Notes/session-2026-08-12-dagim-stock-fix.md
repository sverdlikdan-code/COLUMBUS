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
