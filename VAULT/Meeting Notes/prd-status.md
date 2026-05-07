# PRD Status — Покрытие агентов

## Overview

Живой документ — CEO проверяет при каждом старте сессии. Показывает какие агенты системы COLUMBUS имеют PRD, какие нет. Когда CEO обнаруживает пробел — сообщает пользователю и предлагает создать. PRD хранятся в `PRD/<agent-name>-prd.md`.

## Текущий статус (2026-05-04)

| Агент | AGENT.md | PRD | Статус |
|-------|----------|-----|--------|
| ceo-agent | ✅ | ✅ `PRD/ceo-agent-prd.md` | Покрыт |
| geograf | ✅ | ✅ `PRD/geograf-agent-prd.md` | Покрыт |
| designer | ✅ | ✅ `PRD/designer-agent-prd.md` | Покрыт |
| reuven | ✅ | ❌ | Нужен PRD |
| yael | ✅ | ❌ | Нужен PRD |
| chen | ✅ | ❌ | Нужен PRD |
| guy | ✅ | ❌ | Нужен PRD |
| yuval | ✅ | ❌ | Нужен PRD |
| analytics | ✅ (в THE 5 AGENTS) | ✅ `PRD/analytics-agent-prd.md` | Покрыт |
| fin-agent | ✅ (в THE 5 AGENTS) | ✅ `PRD/fin-agent-prd.md` | Покрыт |

**Покрыто: 5 из 10 агентов**

## Open Questions

- Приоритет создания PRD: начинать с активных (analytics, fin-agent) или по алфавиту?
- analytics и fin-agent: создать сначала AGENT.md или сразу PRD?
- Нужен ли шаблон PRD в `PRD/_template.md`?

## Session Log

### 2026-05-04 — Инициализация PRD Audit [wip]
- **What was done:** Обнаружено что 7 из 10 агентов не имеют PRD. CEO AGENT.md обновлён — добавлена Фаза 0 (PRD Audit при старте сессии). CLAUDE.md обновлён с инструкцией запускать аудит. Создан этот tracking файл.
- **Decisions:** CEO проверяет PRD покрытие при каждом старте сессии автоматически; сообщает только при наличии пробелов (не спамит когда всё OK).
- **Notes / Caveats:** analytics и fin-agent упомянуты в CLAUDE.md но не имеют папки в `.claude/AGENTS/` — нужно создать полноценные AGENT.md перед PRD.
- **Related:** [[ceo-agent-prd]], [[agent-designer]], [[agent-geograf]]
