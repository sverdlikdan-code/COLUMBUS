# Сессия 2026-07-19: MAHSAN — двоение позиций + stock=0 для דג יבש

#status/done #agent/mahsan #scope/planogram

**Claude Code:** `5a658fe2` · Sonnet 4.6 · ~11:30–14:00 IST

## Баги закрыты

### 1. Двоение позиций на странице תוקף (aa970d56)

**Симптом:** один и тот же мак"т показывается дважды в картах תוקף/הזמנה.

**Причина:** Step 4 в build-скриптах проверял только номер бая (`if (!(k in picks))`), не мак"т. Если breira-default назначила мак"т X в бай 9, а пользователь переставил его в бай 5 — оба бая попадали в state → двойной рендер.

**Fix — 4 build-скрипта** (`build-dagim-yavesh-new.js`, `build-dagim-fab.js`, `build-halavi-new.js`, `build-kapua-new.js`):
```js
// Step 4: skip working pick if makat already in breira-default
if (v && bdMakatSet.has(String(v.makat))) { skippedDup++; continue; }
```

**Fix — браузер** (`planogram-editor.html`, `_getPrintOrder`):
```js
// Defensive dedup by makat — clears existing localStorage state with duplicates
const seenMakatim = new Set();
const deduped = filtered.filter(p => {
  const mk = state[sec][p]?.makat;
  if (!mk) return true;
  const s = String(mk);
  if (seenMakatim.has(s)) return false;
  seenMakatim.add(s); return true;
});
```

---

### 2. stock=0 для всех продуктов דג יבש (d1e6a7af)

**Симптом:** מלאי = 0 для всех 25 мак"тов בדג יבש, хотя физически товар есть.

**Когда сломалось:** 18 июля 2026 в 08:29 +0300 (первый CI build после Fabric refresh).

**Причина:** `pbi-dagim-yavesh.js` использовал MLAY + 4 anchor-маки (717, 237, 1098, 1147) для поиска семейств. После Fabric refresh MLAY изменился → `famMakatim` вернул пустую таблицу → все запросы stock/sales/pakuot = 0. БЕЗ ОШИБКИ — просто тихо 0.

**Доказательство:** `pakuotAll=[]` (запрос без фильтра склада) при наличии реальных партий в PBI.

**Fix:**
```js
// pbi-dagim-yavesh.js — заменить MLAY-подход на KARTIS PARIT
const famMakatim = `
  SELECTCOLUMNS(
    FILTER('KARTIS PARIT',
      'KARTIS PARIT'[סטטוס] = "פעיל" &&
      'KARTIS PARIT'[שם מחסן אשדוד] = "דג יבש 🐠"
    ),
    "mk", 'KARTIS PARIT'[מק"ט]
  )`;
```

KARTIS PARIT управляется вручную, не зависит от Fabric refresh.

---

## Timeline бага stock=0

| Время (IST) | Событие | stock 1112 |
|-------------|---------|------------|
| 06:00 18.07 | Dan запустил build-planogram.js локально | 2 ✓ |
| ~07:xx 18.07 | Fabric dataset refresh | MLAY изменился |
| 08:29 18.07 | COLUMBUS Bot CI | 0 ✗ |
| 19.07 (сегодня) | Fix d1e6a7af | следующий CI восстановит |

## Коммиты

- `aa970d56` — prevent makat doubling in expiry/order pages
- `d1e6a7af` — dagim-yavesh stock always 0 — fix DAX famMakatim query

## Файлы

- `docs/planogram-editor.html`
- `planogram/pbi-dagim-yavesh.js`
- `planogram/build-dagim-yavesh-new.js`
- `planogram/build-dagim-fab.js`
- `planogram/build-halavi-new.js`
- `planogram/build-kapua-new.js`
