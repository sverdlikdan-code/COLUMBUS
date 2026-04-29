# Agent Designer

## Overview
Документирует нового специализированного агента `Designer`, отвечающего за мониторинг конкурентов и визуальный стиль продукта. Агент фокусируется на UI/UX: кнопки, интеракции, поведение состояний, и конкурентно-обоснованные паттерны для приложения.

## Open Questions
- Нужна ли недельная периодичность отчетов по конкурентам как обязательный ритуал
- Какие экраны приложения должны быть первыми в редизайне под новый стиль
- Нужен ли отдельный skill под только button-system и motion rules

## Session Log

### 2026-04-29 — Создан агент Designer и PRD [wip]
- **What was done:** Созданы `PRD/designer-agent-prd.md` и `.claude/AGENTS/designer/AGENT.md`; обновлены `CLAUDE.md` и `.claude/AGENTS/ceo-agent/AGENT.md`.
- **Decisions:** Временный активный набор агентов расширен до `CEO + Geograf + Designer`; Designer закреплен за задачами UI/UX, кнопок, интеракций и мониторинга конкурентов.
- **Notes / Caveats:** Остальные агенты по-прежнему отключены до отдельной команды.
- **Related:** [[agents-folder]], [[ceo-agent-prd]], [[agent-geograf]], [[claude-md]]
