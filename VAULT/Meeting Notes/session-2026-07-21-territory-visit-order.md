---
date: 2026-07-21
tags: [territory, visit-order, second-visit, ice, day-cards, route-lines, polyline]
status: done
---

# Сессия 2026-07-21 — Territory: Visit Order + Second Visit + Route Lines + Day Cards

## Что сделано

### 1. Фикс спиннера formula-road день ג (из прошлой сессии, задеплоен)
- `renderFrIceBtn()` крашил на `st.sadranList.length` (undefined) → клиент-лист не рендерился
- Фикс: `const sadranCount=(st.clients||[]).filter(c=>c.sadran).length`

### 2. "להוסיף יום" — не добавлял клиента на второй день
- Баг: итерация по `result` (уже отфильтрованный список) — если основной день не в activeDays, клиент не попадает в result → клон не создаётся
- Фикс: итерация по `st.allClients` с применением фильтров агента/менеджера/lasso к клону

### 3. Значок ❄️ ICE — только для iceOnly клиентов
- `isIce = c.hevra==='ICE'` → заменено на `isIce = c.iceOnly===true`
- Formula клиенты с HEVRA='ICE' — НЕ получают значок ICE
- Только клиенты из MISHPAHTI ICE MISHTAH (`iceOnly:true`) — получают
- Изменено в 5 местах: filter, stats counter, card badge, card class, map marker

### 4. Два режима סדר ביקור: Google + גרסה
- Новое состояние: `st.visitSource: 'computed'|'version'`, `st.loadedVersionOrder: []`
- Кнопка "🗺 Google" — пересчитывает nearest-neighbor маршрут
- Кнопка "📋 גרסה" (фиолетовая) — восстанавливает порядок из загруженной версии
- Кнопка "📋 גרסה" скрыта пока версия не загружена
- `_updateVisitBtns()` — обновляет состояние обеих кнопок
- Fallback: если версия сохранена без visitOrder (старый формат) → автоматически Google

### 5. Линии маршрута на карте
- Рисуются только когда: `activeDays.size === 1` (один день) И `agentSet.size === 1` (один агент)
- Синие (`#1565C0`) = Google порядок; фиолетовые (`#7B1FA2`) = порядок גרסה
- Пунктирная линия: `dashArray:'6,7'`, weight 2.5, opacity 0.75
- `renderRoutePolyline()` вызывается из `renderMap()` после добавления кластера

### 6. Дубликат в списке клиентов (ביקור שני)
- Защита: если `ov.secondDay === primaryDay` → не создавать клон (одинаковый день)
- Клиент с α+ב (два визита в неделю) — корректно появляется дважды

### 7. Карточки дней — редизайн CSS
- Убрана синяя заливка (`.day-btn.active{background:var(--blue)}`)
- Активная карточка: светлый тинт `#EEF3FF` + кольцо через `box-shadow: 0 0 0 2px`
- Весь текст остаётся тёмным (не белый на синем)
- Пустые карточки (нет клиентов) — компактные, не растягиваются на 104px
- `.has-card-data` — класс только для карточек с данными

### 8. Карточка дня ב — второй визит в статистике
- `renderDayBtns()` не считал `secondDay` клиентов
- Добавлен второй цикл: клиенты с `ov.secondDay` попадают в `byDay[secondDay]`
- В итог (כל) клиент считается один раз (без дублирования)

### 9. Кнопка כל — нейтральный вид в режиме "все дни"
- В режиме all (size===6): כל получает `.day-all-mode` (голубая рамка, без кольца)
- Конкретный день активен → только ТА кнопка получает `.active` (кольцо)
- `selectDay(null)` теперь всегда сбрасывает в "все" (не toggle)
- Нажать тот же день дважды → возврат в "все" (restore если size→0)

## Файлы изменены
- `docs/territory.html` — все изменения выше
- `server/index.js` — `save-version`/`restore-version` endpoints с visitOrder

## Коммиты
- `feat(formula-road): два режима סדר ביקור`
- `fix(formula-road): карточка дня показывает second-visit клиентов`
- `fix(formula-road): не создавать клон ביקור שני если secondDay совпадает с основным днём`
- `feat(formula-road): линии маршрута на карте`
- `style(formula-road): редизайн карточек дней`
- `fix(formula-road): пустые дни-карточки компактные; כל без кольца`
