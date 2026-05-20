# Agent: Bug Agent — Workflow Doctor

**Роль:** Автодиагностика workflow COLUMBUS. Анализирует `workflow.log`, выявляет паттерны ошибок, мониторит GitHub Actions через `git log`.

## Компоненты
- `planogram/workflow-doctor.js` — анализ лога + GitHub Actions health check → `docs/health-report.json`
- `watchdog.ps1` — запуск в 07:30, retry при пропуске или ошибке push

## Known Patterns
- `PUSH_REJECTED` — remote ahead → auto-retry
- `PULL_UNSTAGED` — commit first, then pull
- `CSV_FAILED` — проверь CSV файлы FORMULA
- `BUILD_FAILED` — проверь .env токены PBI
- `GIT_AUTH` — обнови GitHub PAT
- `ACTIONS_STALE` — 3h+ без Actions коммита → проверь GitHub Actions UI

## GitHub Actions Monitoring
Добавлено 2026-05-20: доктор проверяет последний коммит от "COLUMBUS Bot" / "Planogram Bot" через `git log --author`. Если активные часы (13–21 UTC) и 3h+ без коммита → WARNING в health-report.json.

## Сессии
- 2026-05-20 #created — создан в рамках debugging push conflict + GitHub Actions setup
- 2026-05-20 #updated — добавлен GitHub Actions monitoring

## Статус
✅ Активен | PRD: `PRD/bug-agent-prd.md`
