---
date: 2026-07-21
tags: [dagim, planogram-editor, security, season-slider, history, pakuot]
status: ✅ done
---

# Сессия 2026-07-21 — הזמנה דגים: slider + history + pakuot + security

## Что было сделано

### 1. מגמה onclick fix (продолжение предыдущей сессии)
- `JSON.stringify(r.name)` вставлял `"` в HTML-атрибут onclick → клик не работал
- Фикс: `data-name="${(r.name||'').replace(/"/g,'&quot;')}"` + `onclick="this.dataset.name"`
- Задеплоен в начале сессии

### 2. Season slider — теперь работает на ВСЕХ строках
- **Было:** слайдер только для строк с `_orderManualEdits[mk]` (ручной ввод)
- **Стало:** работает на все строки с `orderK > 0`; при первом движении сохраняет базу в `inp.dataset.baseK`
- Позиция: в заголовке колонки "המלצה KARTON" с `event.stopPropagation()`

### 3. היסטוריה дропдаун — не отображался (overflow:hidden)
- **Причина:** тулбар строки 1 имеет `overflow:hidden` из-за декоративного фона (radial gradient выходит за границы)
- **Фикс:** `_orderToggleHistory()` и `_interToggleHistory()` теперь ставят `position:fixed` + координаты через `getBoundingClientRect()`
- Применено к обоим страницам (дагим + интер)

### 4. mk 1166/1167 pakuot пустой — диагноз и фикс
- **Причина:** транзиентная ошибка PBI API в CI-билде 20.07 12:17 UTC → pakuot вернул `[]` при stock=4529
- **Диагноз:** DAX-запрос напрямую подтвердил что данные ЕСТЬ в PBI
- **Фикс:** пересборка билда 21.07 13:40 → 1166: 6 партий 4503 krt, 1167: 6 партий 3955 krt
- Задеплоен на VPS

### 5. Security audit (security-agent)
- **Найдено LOW:** `v.ts` вставлялся в `innerHTML` без экранирования (ветка без `T`) — строки 3000, 3009
- **Фикс:** заменено на `_orderFmtTs(v.ts)` везде — выводит только plain text
- Всё остальное чисто: auth, rate-limit, data-base-k (только parseInt), getBoundingClientRect (только геометрия)

### 6. Данные PBI — объяснение
- Бейдж показывает время последнего рефреша PBI Dataset (из `/pbi/formula-refresh`)
- product-data.json — единый снимок из PBI: все данные (מלאי, מכר, pakuot) одновременно
- Разница 4793 (CI 07:33 UTC) vs 4749 (билд 10:40 UTC) → PBI успел обновиться между двумя билдами

## Коммиты
- `aacfa3fa` fix: trend onclick + slider base + popup IIFE
- `619337cd` feat: slider in KARTON header
- `84f4900e` fix: history dropdown position:fixed + slider all rows
- `e2e5f65c` data: planogram build 21.07 13:40
- `30109ace` sec: sanitize history ts via _orderFmtTs

## Ссылки
- [[mahsan-planogram]] — общая архитектура планограммы
- [[session-2026-07-20-territory-filters]] — предыдущая сессия
