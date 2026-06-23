# Аудит второго компьютера COLUMBUS

Чеклист для проверки, что на втором компьютере всё установлено и настроено так же, как на основном (этот файл синхронизируется через git pull — открывай актуальную версию).

Дай этот файл агенту на втором компе со словами: "пройди по этому чеклисту и отчитайся по каждому пункту ✅/❌".

---

## РЕЗУЛЬТАТЫ АУДИТА — 2026-06-23

> Проверено агентом на **втором компьютере** (d.sverdlik@dilerbmdsrv2 или аналог).

### 1. Базовые инструменты

| Пункт | Статус | Подробности |
|-------|--------|-------------|
| git | ✅ | 2.54.0.windows.1 |
| node | ✅ | v24.15.0 |
| npm | ✅ | 11.12.1 |
| cloudflared | ✅ | C:\Program Files (x86)\cloudflared\cloudflared.exe |
| Obsidian | ✅ | 1.12.7 |

### 2. npm install по подпроектам

| Подпроект | Статус |
|-----------|--------|
| `.` (корень) | ✅ |
| `server/` | ✅ |
| `app/` | ✅ |
| `planogram/` | ✅ |
| `BIZNES-AI/` | ✅ |
| `APP-MAHSAN/portfolio/` | ✅ |

### 3. Секреты / .env

| Пункт | Статус | Подробности |
|-------|--------|-------------|
| `.env` (корень) | ✅ | Присутствует |
| `planogram/.env` | ✅ | Присутствует |
| Все 21 ключ в `.env` | ✅ | GEMINI_API_KEY, DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, POWERBI_DATASET_ID, POWERBI_WORKSPACE_ID, POWERBI_MMD_DATASET_ID, TOKEN, AZURE_MAPS_KEY, GOOGLE_MAPS_KEY, GITHUB_TOKEN, MANAGER_PASS, ADMIN_LOG_KEY, MMD_PBI_KEY, FORMULA_PBI_KEY, LOCATIONIQ_KEY |

### 4. Cloudflared tunnel

| Пункт | Статус | Подробности |
|-------|--------|-------------|
| `config.yml` | ✅ | Создан 2026-06-23, содержит ingress → localhost:3000 |
| `cert.pem` | ✅ | Присутствует |
| `579497d4...json` (credentials) | ❌ | Отсутствует — не критично, тоннель работает через --token |
| cloudflared запущен | ✅ | PID 17640, 4 соединения (2xtlv02, 1xlhr13, 1xmrs06) |
| node :3000 | ✅ | LISTENING |

> **Примечание:** credentials JSON отсутствует, но это не проблема — тоннель поднят через `--token` в config.yml и работает стабильно.

### 5. Память Claude — бридж через U:\

| Пункт | Статус | Подробности |
|-------|--------|-------------|
| `U:\` смонтирован | ✅ | \\dilerbmdsrv\homes$\d.sverdlik |
| `U:\columbus-claude-memory` | ✅ | Доступен |
| Local memory | ✅ | 27 файлов в ~/.claude/projects/.../memory/ |

### 6. Git / push

| Пункт | Статус | Подробности |
|-------|--------|-------------|
| remote origin | ✅ | https://github.com/sverdlikdan-code/COLUMBUS.git |
| git pull/push | ✅ | Несколько пушей выполнено сегодня без ошибок |
| `gh auth` (CLI) | ❌ | Не залогинен — не критично, git push работает через credential manager |

### 7. Task Scheduler (НЕ переносить)

| Пункт | Статус |
|-------|--------|
| COLUMBUS-Daily-06 | ✅ Намеренно отсутствует (только на основном компе) |
| COLUMBUS-Watchdog-0730 | ✅ Намеренно отсутствует (только на основном компе) |

### 8. Живой функциональный тест

| Тест | Статус | Подробности |
|------|--------|-------------|
| `health` (404 быстро) | ✅ | 404 за 0.44s |
| `order-history` | ✅ | 200 |
| Formula Road HTML | ✅ | 403 (Power BI guard — норма) |
| Mahsan Editor (GitHub Pages) | ✅ | 200 |
| Formula Road логин агент 110 | ✅ | אולג גלדקיך — токен получен |

---

## Итог

**Второй комп готов к работе.**

Найдено **2 несущественных ❌:**
1. `579497d4...json` — credentials JSON cloudflared отсутствует. Тоннель работает через token, переносить необязательно.
2. `gh auth` — GitHub CLI не залогинен. `git push` работает, `gh` CLI не используется в рабочем процессе.

**Всё функциональное:** сервер, тоннель, API, Formula Road, Mahsan Editor, память Claude, .env секреты — на месте.

---

## Исходный чеклист (для будущих проверок)

### 1. Базовые инструменты

```powershell
git --version        # ожидаем: git version 2.44.0 (или новее)
node --version        # ожидаем: v24.x
npm --version          # ожидаем: 11.x
where cloudflared       # должен найтись
where obsidian          # опционально, для VAULT
```

### 2. npm install по подпроектам

```powershell
cd COLUMBUS
npm install
cd server; npm install; cd ..
cd app; npm install; cd ..
cd planogram; npm install; cd ..
cd BIZNES-AI; npm install; cd ..
cd "APP-MAHSAN/portfolio"; npm install; cd ../..
```

### 3. Секреты / .env (НЕ в git — нужно перенести руками, например через U:\)

```powershell
Test-Path .\.env
Test-Path .\planogram\.env
```

### 4. Cloudflared tunnel

```powershell
Test-Path ~\.cloudflared\config.yml
Test-Path ~\.cloudflared\579497d4-7250-41b5-a3d1-0e04b3094afa.json
Test-Path ~\.cloudflared\cert.pem
```

### 5. Память Claude

```powershell
Test-Path U:\columbus-claude-memory
Get-ChildItem U:\columbus-claude-memory -File | Measure-Object
```

### 6. Git / push

```powershell
git remote -v
git status
```

### 7. НЕ переносить

- Windows Task Scheduler: `COLUMBUS-Daily-06`, `COLUMBUS-Watchdog-0730` — только на основном компе.

### 8. Живой функциональный тест

```powershell
curl https://api.sverdlik-apps.site/health
curl https://api.sverdlik-apps.site/api/order-history
```
