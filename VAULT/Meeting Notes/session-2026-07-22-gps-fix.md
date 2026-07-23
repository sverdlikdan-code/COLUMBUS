---
date: 2026-07-22
tags: [formula-road, territory, gps, geocoding, gps-corrections, google-gps, pbi, chains]
status: done
---

# Сессия 2026-07-22 — GPS: PBI над Google, ручные правки, синхронизация VPS

## Диагноз — корень проблемы

### גרסה кнопка (из предыдущей сессии)
- Версии сохранялись без `visitOrder` → кнопка "📋 גרסה" не появлялась
- Фикс: `loadedVersionOrder=null` (null=нет версии; []=версия без порядка; [...]=версия с порядком)
- Версии теперь всегда сохраняют текущий порядок отображения

### Цепочка GPS до 6 июля (старая)
- `gps-lookup.json` из "EXEL COORDINATES.xlsx" (4063 клиентов, ручная верификация)
- Для рשתות: Overpass OSM → находил каждый сниф отдельно
- PBI координаты (`קו רוחב` / `קו אורך` из таблицы `משטח`) использовались напрямую

### Цепочка GPS с 6 июля (новая — сломана)
- `geocode-compare.js` создан 6-7 июля: берёт всех клиентов из PBI, геокодирует Google → Excel
- Для рשתות: Google запрашивался по `name + city` (без адреса) — все снифы одной сети в одном городе получали **одинаковые** координаты
- `excel-to-ai-gps.js` брал Google без проверки разницы с PBI
- Результат: 3 מגה בעיר חיפה ветки все на `32.817777, 35.054641`

### bbox всегда пустой после рестарта
- `cityBBoxCache` in-memory, сбрасывается при PM2 restart (397 рестартов)
- `city-bbox-cache.json` с 151 городом существовал, но НЕ загружался при старте сервера
- Фикс: добавлен preload при старте `server/index.js`

## Что исправлено

### 1. PBI приоритет в excel-to-ai-gps.js
- Добавлено чтение колонок `PBI Lat` / `PBI Lng` из Excel (раньше игнорировались)
- Добавлен `haversine()` для расчёта расстояния
- Логика: если PBI валиден И разница с Google >2000м → `src:pbi` (0 новых API запросов)
- Результат: PBI=360, Google=1731, Rejected=16

### 2. google-gps.json перебилдан
- 3 מגה בעיר חיפה теперь уникальны: src=pbi, разные координаты для каждого сниф
- 360 клиентов переключены на PBI координаты

### 3. /territory-clients — добавлен geocodeBatch
- Раньше был raw PBI passthrough без bbox-проверки
- Теперь: corrections → geocodeBatch (как /customers)

### 4. gps-corrections.json — синхронизация
- VPS имел 20 записей, локально 41 (23 — מעיין 2000, добавленные скриптом)
- מעיין 2000 клиенты уже в PBI → удалены из corrections
- 2 VPS-уникальные правки (1112017, 1126079) добавлены в локальный файл
- Финал: 20 записей, синхронизировано на VPS

### 5. VPS деплой
- `server/index.js` с requireAuth на `/api/territory/jerusalem` и `/api/territory/geocode` — уже был в git master
- `git pull` на VPS + pm2 restart

## Масштаб проблемы (для понимания)
- 966 из 2056 клиентов имели конфликт PBI↔Google >threshold
- 360 из них теперь используют PBI (исправлены)
- `geocode-compare.js` намеренно искал рשתות по имени+город → одна точка на все ветки

## Файлы изменены
- `server/excel-to-ai-gps.js` — PBI приоритет + haversine
- `docs/google-gps.json` — перебилдан (360 pbi, 1731 google)
- `server/index.js` — bbox preload при старте, geocodeBatch в /territory-clients
- `docs/gps-corrections.json` — очищен от מעיין 2000, добавлены VPS-уникальные записи

## Коммиты
- `fix(formula-road): PBI GPS wins over Google when diff >2000m — 360 clients fixed`
