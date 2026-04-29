# Agent Geograf

## Overview
Документирует нового специализированного агента `Geograf` для маршрутизации визитов клиентов. Агент читает данные клиентов из SQL Server, запрашивает город старта агента и рассчитывает порядок визитов `סדר ביקור` на день с учетом координат и дорожных ограничений. В текущей сессии создан PRD уровня Draft в `PRD/geograf-agent-prd.md`.

## Open Questions
- Какой источник дорожных перекрытий использовать в проде (формат/API)
- Какие точные названия таблиц/колонок в SQL Server

## Session Log

### 2026-04-29 — PRD нового агента Geograf [planned]
- **What was done:** Создан PRD `PRD/geograf-agent-prd.md` с целями, scope, архитектурой, workflow, SQL Server требованиями, качественными критериями и roadmap.
- **Decisions:** Зафиксировано обязательное правило: сначала спросить `start_city`, только потом строить маршрут и проставлять `visit_order / סדר ביקור`.
- **Notes / Caveats:** Это продуктовая спецификация (Draft), без реализации кода и без AGENT.md на текущем шаге.
- **Related:** [[agents-folder]], [[ceo-agent-prd]], [[claude-md]]

### 2026-04-29 — Подключение skill и создание AGENT.md [wip]
- **What was done:** Добавлен обязательный блок в `CLAUDE.md` для `.claude/SKILLS/geograf-israel-routing/SKILL.md`; создан `.claude/AGENTS/geograf/AGENT.md`; обновлен реестр в `.claude/AGENTS/ceo-agent/AGENT.md`.
- **Decisions:** Географ готов к маршрутизации CEO после снятия режима `CEO-only`; до снятия ограничения остается в статусе временно отключен.
- **Notes / Caveats:** Маршрутизация к Географу неактивна, пока действует глобальный режим `CEO-only`.
- **Related:** [[skill-geograf-israel-routing]], [[ceo-agent-prd]], [[claude-md]]

### 2026-04-29 — Geograf активирован [wip]
- **What was done:** Изменены `CLAUDE.md` и `.claude/AGENTS/ceo-agent/AGENT.md`: включен режим `CEO + Geograf`, где Geograf активен для делегирования.
- **Decisions:** CEO может маршрутизировать геозадачи (SQL/координаты/`visit_order`/`סדר ביקור`) напрямую к Geograf.
- **Notes / Caveats:** Остальные агенты остаются отключенными до отдельной команды.
- **Related:** [[ceo-agent-prd]], [[skill-geograf-israel-routing]], [[claude-md]]
