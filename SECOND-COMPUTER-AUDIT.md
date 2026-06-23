# Аудит второго компьютера COLUMBUS

Чеклист для проверки, что на втором компьютере всё установлено и настроено так же, как на основном (этот файл синхронизируется через git pull — открывай актуальную версию).

Дай этот файл агенту на втором компе со словами: "пройди по этому чеклисту и отчитайся по каждому пункту ✅/❌".

---

## 1. Базовые инструменты

```powershell
git --version        # ожидаем: git version 2.44.0 (или новее)
node --version        # ожидаем: v24.x
npm --version          # ожидаем: 11.x
where cloudflared       # должен найтись
where obsidian          # опционально, для VAULT
```

- [ ] git установлен
- [ ] node установлен (v24+)
- [ ] npm работает
- [ ] cloudflared установлен
- [ ] Obsidian установлен (для VAULT/) — опционально, но рекомендуется

## 2. npm install по подпроектам

```powershell
cd COLUMBUS
npm install
cd server; npm install; cd ..
cd app; npm install; cd ..
cd planogram; npm install; cd ..
cd BIZNES-AI; npm install; cd ..
cd "APP-MAHSAN/portfolio"; npm install; cd ../..
```

- [ ] `.` (корень) — node_modules есть
- [ ] `server/` — node_modules есть
- [ ] `app/` — node_modules есть
- [ ] `planogram/` — node_modules есть
- [ ] `BIZNES-AI/` — node_modules есть
- [ ] `APP-MAHSAN/portfolio/` — node_modules есть

## 3. Секреты / .env (НЕ в git — нужно перенести руками, например через U:\)

Проверить **наличие** файлов (не содержимое — секреты не публикуются):

```powershell
Test-Path .\.env                  # корневой — нужен server/index.js (грузит ../.env)
Test-Path .\planogram\.env        # для Power BI планограммы
```

Если `False` — взять актуальные файлы с основного компа (через `U:\` сетевой диск, не через git — `.env` в `.gitignore` намеренно).

Ключи, которые должны быть в корневом `.env` (только список переменных, без значений):
`GEMINI_API_KEY, DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, POWERBI_DATASET_ID, POWERBI_WORKSPACE_ID, POWERBI_MMD_DATASET_ID, TOKEN, AZURE_MAPS_KEY, GOOGLE_MAPS_KEY, GITHUB_TOKEN, MANAGER_PASS, ADMIN_LOG_KEY, MMD_PBI_KEY, FORMULA_PBI_KEY, LOCATIONIQ_KEY`

В `planogram/.env`: `PBI_TENANT, PBI_CLIENT, PBI_SECRET, PBI_DATASET, PBI_WORKSPACE`

- [ ] `.env` (корень) перенесён
- [ ] `planogram/.env` перенесён

⚠️ **Известное ограничение:** `DB_SERVER` (SQL Server) доступен только из офисной LAN. Если второй комп не в офисной сети — функции geograf/SQL-выгрузки работать не будут, это нормально, не баг.

## 4. Cloudflared tunnel (если планируешь гонять тоннель/сервер ОТСЮДА)

Tunnel ID: `579497d4-7250-41b5-a3d1-0e04b3094afa`, hostname: `api.sverdlik-apps.site` → `http://localhost:3000`

```powershell
Test-Path ~\.cloudflared\config.yml
Test-Path ~\.cloudflared\579497d4-7250-41b5-a3d1-0e04b3094afa.json
Test-Path ~\.cloudflared\cert.pem
```

Эти файлы НЕ в git (приватные ключи тоннеля) — переносить только через защищённый канал (U:\, не email/чаты).

- [ ] config.yml на месте
- [ ] credentials json на месте
- [ ] cert.pem на месте
- [ ] `cloudflared tunnel run` поднимается без ошибок
- [ ] node-сервер (`cd server; node index.js`) запущен и слушает :3000

## 5. Память Claude — бридж через сетевой диск U:\

```powershell
Test-Path U:\columbus-claude-memory
Get-ChildItem U:\columbus-claude-memory -File | Measure-Object
```

- [ ] `U:\` смонтирован (`\\dilerbmdsrv\homes$\d.sverdlik`)
- [ ] `columbus-claude-memory` доступен и виден
- [ ] Содержимое скопировано в локальную `~/.claude/projects/<hash>/memory/`

## 6. Git / push

```powershell
git remote -v
git status
gh auth status   # опционально, если используешь gh CLI
```

- [ ] `git pull` проходит без конфликтов
- [ ] `git push` работает (есть права/токен)

## 7. НЕ переносить (намеренно только на основном компе)

- ❌ Windows Task Scheduler задачи `COLUMBUS-Daily-06`, `COLUMBUS-Watchdog-0730` — локальные, не регистрируются `setup-new-computer.ps1`, второй комп работает только вручную (см. VAULT `session-2026-06-22`)

## 8. Живой функциональный тест

```powershell
curl https://api.sverdlik-apps.site/health             # ожидаем 404 быстро (сервер жив)
curl https://api.sverdlik-apps.site/api/order-history   # ожидаем 200
```

- [ ] API отвечает
- [ ] MMD Orders открывается (GitHub Pages)
- [ ] Mahsan Editor открывается, тянет данные (фото, kapua-base и т.д.)
- [ ] Formula Road открывается, логин работает

---

Итог: отчитаться по каждому пункту ✅/❌, для ❌ — указать что именно не получилось (текст ошибки).
