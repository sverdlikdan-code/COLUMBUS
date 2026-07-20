---
date: 2026-07-20
tags: [territory, filters, dropdowns, agent, manager, city, popup, GPS]
status: done
---

# Сессия 2026-07-20 — Territory: Agent/Manager Dropdowns + City Popup

## Что сделано

### Popup карты — добавлен עיר
- В `bindPopup()` добавлено поле city (синий текст под адресом)
- Источник: `c.city` (уже есть в клиентских объектах с сервера)

### Agent dropdown (סוכן) + Manager dropdown (מנהל)
- Два новых multi-select dropdown в filter-row рядом с city dropdown
- Загружаются при init: `/all-agents` и `/managers`
- Поиск внутри dropdown (חפש סוכן / חפש מנהל)
- Sets: `dropAgentFilter`, `dropManagerFilter`
- Применяются в `displayClients()`, `displayClientsAll()`, `renderDayBtns()` (baseCl)
- Кнопка "✓ כולם" в agent legend chips тоже учитывает фильтры

### Agent legend chips — cross-filter
- `getLegendAgents()` — новая хелпер-функция
- Фильтрует `st.agents` по `dropAgentFilter` + `dropManagerFilter` (через agent→manager map)
- `renderAgentLegend()` и `selectAllAgents()` используют только видимые агенты

### Auto-reload: выбор агента → авто-обновление городов
- Новый endpoint `/agent-cities?agents=X&managers=Y` на сервере
- `onDropFilterChanged()` → фетч `/agent-cities` → auto-selects cities → `loadClients()`
- При снятии фильтра: восстанавливает полный список городов

### Дизайн кнопок
- Все три кнопки (ערים / סוכן / מנהל) — единый стиль: `background: var(--sky-light)`, `border: 2px solid #90CAF9`, `color: var(--blue-dark)`
- flt-label: цвет `var(--mid)` вместо `var(--light)` — заметнее

## GPS проблема (не решена — требует ручного фикса)
- Клиент 1162625 (מ.נ.מאיר שוק ומסחר-אשדוד): координаты из PBI неверные
- НЕ в gps-corrections.json, НЕ в AI GPS, НЕ в formula-road-data.json
- formula-road-data.json = 2KB (пустой) — CI build упал из-за `PBI_TENANT=undefined`
- Фикс: клиент должен нажать "📍 תיקון מיקום" в popup карты

## Файлы изменены
- `docs/territory.html` — все изменения выше
- `server/index.js` — новый endpoint `/agent-cities`
