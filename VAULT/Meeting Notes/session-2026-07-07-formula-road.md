# Сессия 2026-07-07: Formula Road — geocoding + territory planner

#status/done #agent/geograf #scope/formula-road #scope/migration

**Claude Code:** `a59b4dcb` · slug `parallel-tumbling-marble` · custom title «migration FORMULA ROADS ➡➡➡» · ~07:22–15:24

## Геокодинг — полный прогон клиентов

- 2107 уникальных клиентов из PBI → `geocode-compare-2026-07-07.xlsx`
- `docs/google-gps.json`: **2056 Google accepted**, 51 rejected (bbox)
- 166 city bbox через Google

## Изменения в скриптах

### `server/geocode-compare.js`
- `normCity()` — `תל אביב יפו` → `תל אביב`
- Цепочки (`רשתות`): Google query = `name + city` (адреса из Priority часто битые)

### `server/excel-to-ai-gps.js`
- Был hardcode `geocode-compare-2026-07-06.xlsx`
- Теперь автовыбор последнего `geocode-compare-*.xlsx` по дате в имени

## Коммиты

| Commit | Описание |
|--------|----------|
| `29e292c4` | feat(formula-road): google-gps.json — цепочки по имени+город, нормализация תא |
| `744bbcd0` | fix(formula-road): mekarer order — סלסלות, מספר לקוח, CC Наталья |

## Territory planner

- Рабочая копия: `Desktop/territory-planner.html` (автосохранение)
- В репо: `docs/territory-planner.html`
- `docs/formula-road.html` — обновлён
- `server/index.js` — задеплоен на VPS (pm2)

## Merge / CI

Merge с origin/master подтянул product-data, city-bbox-cache, mmd-orders.json и др.

## Финиш

«SAVE» — desktop-файл сохранён; server/index.js уже на VPS и в git.

## Связанные topic files

- [[formula-road-app]]
- [[migration-plan-vps]]
- [[skill-geograf-israel-routing]]
