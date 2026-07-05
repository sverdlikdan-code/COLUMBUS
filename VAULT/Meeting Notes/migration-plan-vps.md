# ПЛАН МИГРАЦИИ APPS НА VPS — с анализом ошибок Formula Road

#status/ready #scope/infra #scope/migration

---

## АНАЛИЗ ОШИБОК Formula Road — что пошло не так

### Ошибка 1: CLAUDE.md запускал локальный сервер
**Что было:** CLAUDE.md инструктировал `cd server && node index.js` в фоне при каждой сессии.
**Результат:** рогатый локальный сервер перехватывал запросы. Заказы мекарер сохранялись на Windows-компе.
**Вывод:** перед миграцией — убедиться что CLAUDE.md НЕ стартует локальный сервер для мигрируемых apps.

### Ошибка 2: туннель api.sverdlik-apps.site был на локальной машине
**Что было:** думали что VPS cloudflared обслуживает `api.sverdlik-apps.site`. Нет — там был `api-corp.sverdlik-apps.site`. Реальный туннель (id `579497d4`) запустился на Windows 23 июня и там и оставался.
**Результат:** убийство локального cloudflared → сайт упал.
**Вывод:** перед миграцией app — проверить КАКОЙ туннель его обслуживает: `curl -sI https://<domain>/health` и смотреть заголовки.

### Ошибка 3: session mismatch
**Что было:** браузер заходил на `localhost:3000/formula-road`, логинился там. Но API шёл на VPS → VPS не знал этот токен → 401 → демо-режим.
**Результат:** пользователи видели демо-данные, думали что система работает.
**Вывод:** после миграции — локальный сервер должен блокировать доступ к мигрированным app (не redirect, а HTML-страница с ссылкой).

### Ошибка 4: redirect loop
**Что было:** добавили IS_LOCAL redirect (302 на VPS URL). Но локальный cloudflared был активен → loop.
**Результат:** ERR_TOO_MANY_REDIRECTS.
**Вывод:** НИКОГДА не делать redirect с локального сервера на VPS. Только HTML страница-заглушка.

### Ошибка 5: .sessions.json очищался при рестартах
**Что было:** файл оставался но 3 байта (`{}`). Причина — crash во время записи.
**Вывод:** не критично (сессии 30 дней), но нужно следить.

### Ошибка 6: два cloudflared одновременно
**Что было:** сессия 2026-06-23 — два cloudflared на двух компах для одного туннеля. Cloudflare рандомно посылал запросы на разные машины.
**Вывод:** ONE tunnel = ONE cloudflared process. При переезде — сначала остановить на старом месте.

---

## ТЕКУЩЕЕ СОСТОЯНИЕ — что где живёт

| App | HTML-файл | Served from | API calls | Данные | Статус |
|---|---|---|---|---|---|
| Formula Road | `docs/formula-road.html` | VPS `/formula-road` | `api.sverdlik-apps.site` | SQL LAN + PBI | ✅ МИГРИРОВАН |
| Mekarer Order | `docs/mekarer-order.html` | VPS `/mekarer-order.html` | `api.sverdlik-apps.site` | `mekarer-orders.json` на VPS | ✅ МИГРИРОВАН |
| Planogram Editor | `docs/planogram-editor.html` | VPS? локал? | `api.sverdlik-apps.site` | PBI + TAHSHIV | ⚠️ API уже VPS, но где serve? |
| MMD Orders | `MMD ORDERS/index.html` | Локал `/mmd` | Относительные URL `/mmd/...` | PBI `POWERBI_MMD_DATASET_ID` | ❌ НЕ МИГРИРОВАН |
| Mahsan Editor | Где-то | Локал? | ? | planogram JSON файлы | ❌ НЕ МИГРИРОВАН |

---

## MMD ORDERS — что нужно для миграции

### Зависимости (проверено по коду):
- `fetch('/mmd/draft', ...)` → POST `/mmd/draft` (локальный сервер)
- `fetch('./mmd-orders.json')` → GET `/mmd/mmd-orders.json`
- `fetch('/mmd/period-data?d1=...&d2=...')` → PBI DAX запросы (через `POWERBI_MMD_DATASET_ID`)
- `fetch('/mmd/draft-list')`, `fetch('/mmd/draft/'+userId)` → draft управление
- `fetch('/mmd/rebuild', { method: 'POST' })` → пересборка данных
- Все вызовы относительные → привязаны к origin

### Что нужно:
1. VPS может делать PBI запросы (уже есть `executeDax` + `POWERBI_MMD_DATASET_ID` в .env VPS) ✅
2. `mmd-orders.json` — нужно скопировать с локала на VPS и настроить запись туда
3. `docs/mmd-orders.json` — этот файл пишет локальный `build-mmd-orders.js` (GitHub Actions CI)
4. Draft система: `mmd_draft_*` ключи — хранятся в памяти? или файлы? **→ проверить**

### Критический вопрос: SQL или PBI?
`/mmd/period-data` — нужно проверить, это PBI или SQL запрос. **VPS не имеет доступа к LAN 192.168.100.246**.

---

## MAHSAN EDITOR — что нужно для миграции

### Зависимости (из planogram-editor.html):
- API уже на `api.sverdlik-apps.site` (жёстко прописан)
- Читает данные через `frToken` (Formula Road сессия)
- Вызовы: `/api/export-position-xlsx`, `/api/order-history`, `/api/export-order-xlsx`

### Где сейчас serve?
Нужно найти — возможно через локальный сервер или GitHub Pages.
VPS не имеет `/planogram-editor` роута (проверено: VPS HTML = только formula-road.html, mekarer-order.html).

### Что нужно:
1. Добавить роут `/planogram-editor` на VPS (уже есть `/docs/planogram-editor.html`)
2. Добавить guard (как formulaRoadGuard)
3. Данные: уже идут на VPS API ✅
4. Файлы планограммы (`kapua-base.json`, `dagim-base.json` etc) — копировать на VPS в `/docs/`

---

## ЧЕКЛИСТ МИГРАЦИИ (для каждого app)

### ШАГ 0 — Разведка (ДО начала)
```bash
# Проверить какой туннель обслуживает домен
curl -sI https://api.sverdlik-apps.site/any-path | grep -E 'cf-ray|server|x-powered'

# Проверить что на VPS
ssh root@31.154.67.58 "ls /root/COLUMBUS/docs/"

# Проверить мм VPS cloudflared туннели
ssh root@31.154.67.58 "systemctl status cloudflared cloudflared-api"
```

### ШАГ 1 — Остановить мешающие процессы
```powershell
# На Windows — убедиться что cloudflared для нужного туннеля НЕ запущен локально
Get-Process cloudflared -ErrorAction SilentlyContinue
# НЕ убивать если это единственный cloudflared для api.sverdlik-apps.site!
# Сначала перенести туннель на VPS, потом убивать
```

### ШАГ 2 — Перенести файлы на VPS
```bash
# HTML файл
scp docs/app.html root@31.154.67.58:/root/COLUMBUS/docs/

# JSON данные (если нужны)
scp docs/data.json root@31.154.67.58:/root/COLUMBUS/docs/
```

### ШАГ 3 — Добавить роут на VPS (server/index.js)
```javascript
// Паттерн для нового app
function appGuard(req, res, next) {
  const key = process.env.APP_PBI_KEY;
  if (!key) return next();
  const cookies = req.headers.cookie || '';
  if (/(?:^|;\s*)app_ok=1/.test(cookies)) return next();
  if (req.query.k === key) {
    res.setHeader('Set-Cookie', 'app_ok=1; Path=/app; HttpOnly; SameSite=Lax; Max-Age=2592000');
    return next();
  }
  return res.status(403).send('403 — open via Power BI');
}
app.get('/app', appGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'app.html'));
});
```

### ШАГ 4 — Заблокировать на локальном сервере (НЕ REDIRECT!)
```javascript
// На локальном сервере — HTML заглушка, НЕ 302
app.get('/app', (req, res, next) => {
  if (process.platform === 'win32') {
    return res.status(200).send(`<html><body>
      <p>App работает на VPS</p>
      <a href="https://api.sverdlik-apps.site/app">Открыть →</a>
    </body></html>`);
  }
  next();
}, appGuard, ...);
```

### ШАГ 5 — Добавить переменные в VPS .env
```bash
ssh root@31.154.67.58 "echo 'APP_PBI_KEY=...' >> /root/COLUMBUS/.env"
# Перезапустить сервер
ssh root@31.154.67.58 "pm2 restart columbus-api"
```

### ШАГ 6 — Тест
```bash
# Без ключа → должно быть 403
curl -s -o /dev/null -w '%{http_code}' https://api.sverdlik-apps.site/app

# С ключом → 200
curl -s -o /dev/null -w '%{http_code}' 'https://api.sverdlik-apps.site/app?k=KEY'
```

### ШАГ 7 — Обновить PBI кнопку
Новый URL для кнопки в Power BI: `https://api.sverdlik-apps.site/app?k=KEY`

---

## ПОРЯДОК МИГРАЦИИ

### Приоритет 1: Planogram Editor (Mahsan)
**Почему первый:** API уже на VPS, только добавить роут. Самая быстрая миграция.
**Риск:** нужно найти где сейчас serve и какие JSON файлы нужны на VPS.

### Приоритет 2: MMD Orders
**Почему второй:** сложнее — относительные URL, draft система, CI build.
**Риск:** `/mmd/period-data` — нужно проверить что VPS может делать PBI запросы для MMD датасета.
**Предварительный шаг:** проверить что `POWERBI_MMD_DATASET_ID` в VPS .env и DAX работает через VPS.

---

## ВАЖНЫЕ НАПОМИНАНИЯ

1. **SQL LAN недоступен с VPS** (`192.168.100.246`) — если app требует SQL → нужен другой подход (PBI только)
2. **TAHSHIV.xlsx** — обновляется ежемесячно через SCP с Windows → VPS. Если app его читает → добавить в процедуру обновления
3. **mmd-orders.json** — сейчас пишется GitHub Actions CI + локальным сервером. После миграции — только VPS пишет
4. **Cloudflared** — туннель `579497d4` теперь на VPS (`cloudflared-api` service). НЕ запускать локально снова
5. **Проверить .env** на VPS перед каждой миграцией — все нужные ключи должны быть там
