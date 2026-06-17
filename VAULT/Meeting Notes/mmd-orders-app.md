# MMD ORDERS App — Topic File

Приложение заказов MMD (`MMD ORDERS/index.html`) — PWA для просмотра заказов из Power BI через `server/index.js`.

## Архитектура

- **Endpoint:** `GET /pbi/mmd-orders?month=YYYY-MM`
- **Источник данных:** PBI KARTIS PARIT — та же таблица что и в MAHSAN
- **Server pipeline:** raw PBI → `fixBiDi()` → `fixGimel()` → response

## Критический баг и фикс — BiDi числа (2026-06-16) ✅

**Проблема:** PBI хранит `KARTIS PARIT[תאור]` в визуальном BiDi порядке. Функция `fixBiDi` переворачивала ивритские слова посимвольно — но цифры в составе слова тоже переворачивались: `'ג1200` → `0021ג'` (1200г → 0021).

**Симптом в UI:** продукты показывали `'ג0021` вместо `1200 ג`.

**Фикс в `server/index.js` fixBiDi:**
```javascript
// Было (баг):
.map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('') : w)

// Стало (фикс):
.map(w => /[א-ת]/.test(w) 
  ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join(''))
  : w)
```

**Фикс `fixGimel` — паттерн 2 (добавлен):**
```javascript
// digits before gimel+apostrophe: 1200ג' → 1200 ג
s = s.replace(/(\d+)ג['‘’׳ʼ´`]/g, '$1 ג ');
```

## Фиксы фильтра компаний (2026-06-16) ✅

- **Проблема:** чипы компаний переносились на 2 строку (INTER и ICE bdd)
- **Фикс CSS:** `#fbar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }`
- **Проблема:** INTER (35 продуктов) не видно — уходил за левый край в RTL
- **Фикс JS:** сортировка чипов по убыванию количества (FORMULA 479 > ICE MISH 42 > INTER 35 > ICE bdd 25)

## Архитектура v2 — GitHub Pages (без зависимости от PC) ✅ 2026-06-17

**Проблема:** Cloudflare Error 1033 при выключенном PC — tunnel + Node.js завязаны на локальную машину.

**Решение:** Повторить паттерн MAHSAN/Formula Road — статический JSON + GitHub Actions.

### Новые файлы
- `server/build-mmd-orders.js` — standalone build script: вызывает PBI REST API, сохраняет `docs/mmd-orders.json`
- `.github/workflows/mmd-orders-build.yml` — CI: запуск 3×/день (07:00/13:00/19:00 IST = 04/10/16 UTC)
- `docs/mmd-orders.html` — статичная копия приложения, читает `./mmd-orders.json`
- `docs/mmd-orders.json` — первичные данные 424 продукта (май-июнь 2026)

### Деплой
- **URL:** `https://sverdlikdan-code.github.io/COLUMBUS/mmd-orders.html`
- **Workflow ID:** 297430969, state: active
- **Secret:** `PBI_MMD_DATASET` — добавлен пользователем в GitHub Settings → Secrets

### Отличия docs/mmd-orders.html от оригинала
1. `fetch('./mmd-orders.json')` вместо `/pbi/mmd-orders?y1=...`
2. Фон: `linear-gradient` вместо фото (FOTO CITY/ не в docs/)
3. Пути логотипов: `./logo-diler-bmd.png` вместо `/logo-diler-bmd.png`

## Файлы

- `MMD ORDERS/index.html` — frontend PWA (аутентифицированный локальный сервер `/mmd`)
- `server/index.js` — endpoint `/pbi/mmd-orders`, функции `fixBiDi`, `fixGimel`
- `server/build-mmd-orders.js` — CI build script
- `docs/mmd-orders.html` — публичная статика GitHub Pages
- `docs/mmd-orders.json` — pre-built данные (обновляется CI 3×/день)

---

## Сессии

### 2026-06-16 #resolved
- Исправлен BiDi баг с числами в именах продуктов (1200 ג вместо 0021ג')
- Добавлен fixGimel паттерн 2 для формата `{digits}ג'`
- Починены чипы компаний: nowrap + сортировка по count descending

### 2026-06-17 #resolved
- **MMD ORDERS переведён на GitHub Pages** — больше не зависит от включённого PC
- Создан `server/build-mmd-orders.js` — DAX → JSON build script
- Создан `.github/workflows/mmd-orders-build.yml` — CI 3×/день, Workflow ID 297430969
- Создан `docs/mmd-orders.html` — статичная версия приложения
- Загружены первичные данные: 424 продукта, период май-июнь 2026
- Секрет `PBI_MMD_DATASET` добавлен пользователем, первый автозапуск CI: 16:00 UTC = 19:00 IST 2026-06-17
