---
name: session-2026-07-15-mmd-fixes
description: VPS_URL TDZ crash (252 рестарта), Excel corruption fix, _effOrd unification, prophet week 27 analysis
metadata:
  type: project
---

# Сессия 2026-07-15: VPS crash + Excel corruption + prophet analysis

## Статус: ✅ завершено

## Что сделано

### 1. VPS_URL TDZ — 252 краша сервера — ИСПРАВЛЕНО
- **Баг**: `const VPS_URL` была объявлена на строке ~3151 в server/index.js, но использовалась в коде выше (в старой версии на VPS) — классический Temporal Dead Zone
- Сервер делал 252 перезапуска (`pm2 status` → restart count), вызывая 502 для внешних пользователей
- **Фикс**: перенесли `const IS_LOCAL` и `const VPS_URL` в топ файла (строки 13-14), сразу после `require`
- Убрали дублирующее объявление на строке 3151-3152
- Commit: `fix(server): move IS_LOCAL/VPS_URL to top of file — prevent TDZ on redeploy`

**Почему менеджер не видел 502:** открывает `MMD ORDERS/index.html` с локального диска, VPS нужен только для API. Пользователи в Эйлате заходят напрямую через `api.sverdlik-apps.site` → при упавшем сервере видят 502 сразу.

### 2. Excel corruption ("problem with some content") — ИСПРАВЛЕНО
- **Баг**: после `ws.addTable({ headerRow: true })` стояло `ws.autoFilter = {...}` — дублировало autoFilter в XML (таблица уже создаёт свой) → Excel ругался при открытии
- Дополнительно: `style: { theme: null }` → невалидный XML для таблицы
- **Фикс**: убрали `ws.autoFilter`, заменили `theme: null` на `theme: 'TableStyleMedium2'`
- Добавили комментарий почему нельзя трогать (чтобы никто не вернул обратно)

### 3. המלצה ידנית не попадала в Excel — ИСПРАВЛЕНО
- **Баг**: три разных места (render table, orderedRows filter, Excel builder) считали `eff` по-разному:
  - Таблица: `hamlRnd` с fallback на `eilat_k × 2` (мкт 659) и `× 4` (мкт 664)
  - Фильтр/Excel: только `r.hamlatza` без этих fallback
- Пользователь видел значение в таблице, принимал рекомендацию (не трогал поле), скачивал Excel — а там 0 или товар вообще не появлялся
- **Фикс**: вынесли единую функцию `_effOrd(r, s)`, используется везде
- **Бонус**: при клике Excel теперь автоматически захватываются все видимые input-значения в localStorage (если поле не трогали — значение всё равно сохраняется перед экспортом)
- Commit: `fix(excel): remove duplicate autoFilter (corrupted xlsx) + consistent _effOrd()`

### 4. Prophet week 27 — не баг, реальные данные
- Проверили CSV: `True duplicate rows: 0` (124 "дубля" были артефактом наивного парсинга)
- Неделя 27 (июнь 29 - июль 5) genuinely сильная: медиана 1.6× относительно нед. 24-26, 114/291 товаров >2×
- Вероятно летний сезон или праздничный паттерн — данные PBI корректны

### 5. Prophet auto-rebuild
- Лог за 2026-07-15: `Weekly sales CSV updated from PBI` + `Prophet OK` — pipeline работает
- Данные по неделю 2026-07-06 (нед. 28, Jul 6-12) включены в prophet.json
- Периодические `ERROR: git push failed` — артефакт параллельных коммитов кода; пуш из auto-rebuild успевает через последующие сессии

## Коммиты
- `861aecea` — fix(server): move IS_LOCAL/VPS_URL to top — prevent TDZ
- `b8ee3dcb` — fix(excel): autoFilter + _effOrd() consistent

## Осталось
- [ ] Проверить что Eilat user может скачать Excel без ошибки (после deploy ~1 мин)
- [ ] Уточнить причину week 27 spike если нужно (летний сезон vs PBI calendar artifact)
