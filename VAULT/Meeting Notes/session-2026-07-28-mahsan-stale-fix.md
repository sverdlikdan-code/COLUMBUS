# session-2026-07-28-mahsan-stale-fix

## #stale-localstorage-fix #mahsan-editor #priority-sql

Сессия 2026-07-28: исправление "призрачных" названий товаров в MAHSAN EDITOR תוקף, + оформление skill priority-sql (PRD + Vault + CLAUDE.md триггер), + два M кода с CURDATE фиксом.

---

## Проблема: "עוגת לימון" в תוקף — диагноз

В combined view תוקף страницы продукты на позициях #35-38 показывали названия "עוגת לימון / שוקולד / פאי / גזר". Эти названия НИКОГДА не существовали в реальной системе.

**Анализ:**
- product-data.json и kapua-base.json: имён "עוגת לימון" нет
- halavi/dagim-base.json: не найдено
- Источник: `localStorage['mahsan_editor']` — очень старое состояние, когда товары 420005-420008 были на позициях 35-38 с placeholder-именами

**Механизм бага:**
1. `state = deepClone(KAPUA_BASE)` — инициализация
2. `Object.assign(state, localStorage['mahsan_editor'])` — перезаписывает старым stale state
3. Merge kapua-base.json: pick 35 уже есть → обновляет только `haluka/printOrder`, НЕ `makat` и НЕ `name`
4. Результат: makat 420008 остаётся на pick 35 вместо makat 1045 (Santa Bremor)

## Фикс: makat-change detection (planogram-editor.html)

В merge-логике для kapua, halavi, dagim — при обнаружении что makat на позиции изменился в свежем base JSON:
- Force-replace весь pick из fresh base
- Сохранить только `printOrder` пользователя
- `_anyVersionReset = true` → принудительный save в localStorage

```js
const oldMk = String(state.kapua[k].makat || state.kapua[k].mk || '');
const newMk = String(p.makat || p.mk || '');
if (newMk && oldMk && oldMk !== newMk) {
  const savedPO = state.kapua[k].printOrder;
  state.kapua[k] = deepClone(p);
  if (savedPO != null) state.kapua[k].printOrder = savedPO;
  _anyVersionReset = true;
}
```

Применено: kapua + halavi + dagim (оба пути: version-change и same-version).

Коммиты: `63cc2941` (makat detection) → `3ac5c7e2` (+ _anyVersionReset)

## priority-sql skill — оформлен в этой сессии

- PRD: `PRD/priority-sql-skill-prd.md` ✅
- Vault: `VAULT/Meeting Notes/skill-priority-sql.md` ✅
- CLAUDE.md триггер: "Priority ERP SQL — обязательный skill" ✅
- CURDATE фиксы применены в M кодах: diller, icecrea (×2 версии), form (с PIT_FISHWEIGHT)

## Стандарт CURDATE фикса

В шапке M кода добавлять строку:
```
// CURDATE fix YYYY-MM-DD: дата из תעודת משלוח вместо IVDATE (фикс месячного спайка)
```

Применять в SELECT ×3 (`תאריך_דקות`, `תאריך`, `תאריך_נקי`) + GROUP BY ×1.

## Попутные изменения

- `buildExpiryPage()` line 4241: `d.nameEn || p.name` (d.nameEn = product-data.json, читаемый)
- `pbi-kapua.js` nameEnMap: MLAY[תאור מוצר] первый приоритет для nameEn (полное имя с брендом)
