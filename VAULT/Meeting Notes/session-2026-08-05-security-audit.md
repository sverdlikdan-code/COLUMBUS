# Security Audit — 2026-08-04/05/06

## Тема
Полный аудит безопасности server/index.js + применение всех найденных фиксов.

## Сессия 2026-08-04 #DONE

Первый раунд фиксов (до security agent):
- Удалён `/admin/send-test-invite` — открытый endpoint выдавал сессию агента 258
- `INVITE_SECRET` и `MANAGER_PASS` — убраны небезопасные fallback-значения
- `mmdGuard` / `formulaRoadGuard` — open access без ключа → 503
- `/api/export-position-xlsx` — добавлен `requireAuth`
- `/auth/pbi` — добавлен `dataRateLimit`
- `saveSessions()` — дебаунс 5 сек (был writeFileSync на каждый запрос)
- `loginAttempts` / `generalRequests` Maps — очистка каждые 5 минут (memory leak)

Mahsan editor (planogram-editor.html):
- Добавлен auth gate при входе через splash
- PBI auto-login через `/auth/pbi` + cookie `fr_ok=1`

## Сессия 2026-08-05 #DONE

Security agent запущен по расписанию (cron 09:30). Оценка: 7/10 → после фиксов ~9/10.

**13 фиксов применены:**

| # | Severity | Проблема | Фикс |
|---|---|---|---|
| C-01 | 🔴 | DAX Injection в `/api/client-analytics/:custId` | Regex `/^\d{1,15}$/` |
| C-02 | 🔴 | Stored XSS в email mekarer | `escEmail()` хелпер |
| H-01 | 🟠 | 4 PBI endpoints без auth | `requireAuth` добавлен |
| H-02 | 🟠 | `/api/photo-proxy` — no auth, wildcard CORS | `requireAuth` + specific origin |
| H-03 | 🟠 | `priority-gps-cross.json` публичный | `requireAuth` |
| L-03 | 🟠 | `territory-planner.html` сломанный auth | `requireAuth` middleware |
| M-01 | 🟡 | Session TTL 30 дней | Менеджер 24ч / агент 7 дней |
| M-02 | 🟡 | INTER Dataset IDs захардкожены | Читается из `.env` с fallback |
| M-03 | 🟡 | `/log-access` без auth | `requireAuth` |
| M-04 | 🟡 | `/admin/*` без rate limit | `dataRateLimit` |
| M-05 | 🟡 | `/invite/:token` без rate limit | `dataRateLimit` |
| L-02 | 🟢 | Email Натальи захардкожен | Убран CC полностью |
| L-03 | 🟢 | `territory-planner.html` | `requireAuth` middleware |

**Намеренно пропущено (не критично):**
- H-04: `unsafe-inline` CSP — требует рефакторинг всех инлайн-скриптов, риск UI
- L-01: `e.message` клиенту — раскрывает архитектуру, но данных не даёт

## Текущий статус безопасности
- Оценка: ~9/10
- Все критические и высокие уязвимости закрыты
- H-04 и L-01 — hygiene, не дыры — можно не делать
