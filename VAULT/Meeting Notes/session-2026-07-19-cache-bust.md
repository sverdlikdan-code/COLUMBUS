---
name: session-2026-07-19-cache-bust
description: tukuf.html redesign, SKU 659/664 fixes, week numbering Sunday-based, cache-bust redirect
metadata:
  type: project
---

# Сессия 2026-07-19: tukuf redesign + cache-bust

## Статус: ✅ завершено

## Что сделано

### 1. tukuf.html — полный редизайн
- Переписан в стиль Mahsan Editor: белый фон `#f4f6fb`, красный хедер `#c62828`
- Горизонтальные карточки 320px: фото (64×64) слева + контент справа
- Кнопка ✕ (скрыть карточку), фильтры ⚠ סכנה / 🔶 תשומות לב, фильтр חברה
- Кнопка הדפסה (печать), ↩ בררת מחדל (сброс скрытых)
- Шапка таблицы: `'אילת — ' + mishpacha` (вместо "אילת — פק"ע")
- שם מוצר: 2 строки максимум (`-webkit-line-clamp:2`)
- `color-scheme: only light` + `!important` на все цвета против Chrome forced dark mode

### 2. Бейдж ×4 המלצה — только מק"ט 664
- Изначально был `krat===1`, пользователь исправил: только מק"ט 664
- Фиолетовый бейдж `×4 המלצה`, фиолетовый фон `#6a1b9a`

### 3. מק"ט 659 — формула `weeks_nf×3`
- Было: `eilat_k × 2` (хак)
- Стало: `Math.max(0, Math.round(3 * mkr_shvua - eilat_k))` — та же формула что у всех, но `weeks_nf` жёстко = 3
- Исправлено в `render()` и в `_effOrd()` (обе точки)

### 4. Нумерация недель по воскресенью (израильский календарь)
- Было: `getDay() || 7` — ISO-формат с понедельника → пропускал неделю 29
- Стало: `getDay()` (0=вс) → `setDate(d - dow)` — откат к воскресенью
- `isoWeekNum()` тоже переписан на Sunday-based
- `_sparkCutoff` теперь отсекает по воскресенью → нед. 29 отображается

### 5. Cache-bust через версионированный URL — КЛЮЧЕВОЕ РЕШЕНИЕ
- **Проблема**: no-cache заголовки на сервере не помогали — браузеры держали СТАРЫЕ кэши (загружены до появления заголовков)
- **Решение**: при каждом старте сервера вычисляется `MMD_BUILD_V = Math.floor(Date.now()/3600000)` (почасовой токен)
- Новый middleware в `server/index.js`: если запрос к HTML без `?v=BUILD_V` → 302 на URL с `v=`
- `URLSearchParams(req.query)` сохраняет все остальные параметры (`k=`, `r=`, etc.)
- Результат: при деплое все пользователи автоматически получают свежую страницу — никакого ручного Ctrl+Shift+R
- Проверено: `curl /mmd/?k=test` → `302 → /mmd/?k=test&v=495679` ✓

## Коммиты
- `44b63ba0` — fix(mmd): cache-bust HTML via versioned redirect
- `dbd2d5e7` — fix(mmd): preserve k= and r= params in cache-bust redirect

## VPS статус
- PM2 restart 307, status online, mem 77.5mb — нормально
