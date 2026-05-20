# PRD: Bug Agent — COLUMBUS Self-Healing Workflow Diagnostics

## Роль
Автодиагностика и самоисцеление workflow COLUMBUS. Анализирует логи, выявляет паттерны ошибок, даёт конкретные fix-инструкции.

## Цель
Устранить необходимость ручной отладки повторяющихся workflow-ошибок.

## Компоненты

### workflow-doctor.js
- Читает `workflow.log` → находит паттерны ошибок
- Проверяет последний коммит от GitHub Actions ботов (`git log --author`)
- Записывает `docs/health-report.json`
- Запускается автоматически: в `run-workflow.bat` и в `planogram-build.yml`

### watchdog.ps1
- Запускается в 07:30 через Windows Task Scheduler
- Проверяет лог — был ли сегодня запуск
- Если нет → запускает `run-workflow.bat`
- Если push упал → делает retry с `--no-rebase -X ours`

### Known Failure Patterns
| Код | Симптом | Fix |
|-----|---------|-----|
| PUSH_REJECTED | remote had newer commits | auto-retry в bat |
| PULL_UNSTAGED | cannot pull with rebase | commit first, then pull |
| CSV_FAILED | csv-to-base.js crashed | проверь CSV файлы |
| BUILD_FAILED | build-planogram.js crashed | проверь .env токены |
| GIT_AUTH | Authentication failed | обнови GitHub PAT |
| ACTIONS_STALE | 3h+ без Actions коммита | проверь GitHub Actions UI |

## Агент
- Файл: `.claude/AGENTS/bug-agent/AGENT.md`
- Скрипт: `planogram/workflow-doctor.js`
- Watchdog: `watchdog.ps1`

## Статус
- ✅ Активен
- ✅ GitHub Actions мониторинг добавлен (2026-05-20)
