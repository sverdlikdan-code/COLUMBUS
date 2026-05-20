# PRD Status — Покрытие агентов

## Overview

Живой документ — CEO проверяет при каждом старте сессии. Показывает какие агенты системы COLUMBUS имеют PRD, какие нет. Когда CEO обнаруживает пробел — сообщает пользователю и предлагает создать. PRD хранятся в `PRD/<agent-name>-prd.md`.

## Текущий статус (2026-05-20)

| Агент | AGENT.md | PRD | Vault | Статус |
|-------|----------|-----|-------|--------|
| ceo-agent | ✅ | ✅ `PRD/ceo-agent-prd.md` | ✅ | Покрыт |
| geograf | ✅ | ✅ `PRD/geograf-agent-prd.md` | ✅ | Покрыт |
| designer | ✅ | ✅ `PRD/designer-agent-prd.md` | ✅ | Покрыт |
| analytics | ✅ (THE 5 AGENTS) | ✅ `PRD/analytics-agent-prd.md` | ❌ | Нужен Vault |
| fin-agent | ✅ (THE 5 AGENTS) | ✅ `PRD/fin-agent-prd.md` | ✅ | Покрыт |
| mahsan | ✅ | ✅ `PRD/mahsan-agent-prd.md` | ✅ | Покрыт |
| skill-creator | ✅ | ✅ `PRD/skill-creator-agent-prd.md` | ✅ | Покрыт |
| bug-agent | ✅ | ✅ `PRD/bug-agent-prd.md` | ✅ | Покрыт |
| biz-analyst | ✅ | ✅ `PRD/biz-analyst-agent-prd.md` | ✅ | Покрыт |
| reuven | ✅ | ❌ | ✅ | Резерв — PRD не нужен |
| yael | ✅ | ❌ | ✅ | Резерв — PRD не нужен |
| chen | ✅ | ❌ | ✅ | Резерв — PRD не нужен |
| guy | ✅ | ❌ | ✅ | Резерв — PRD не нужен |
| yuval | ✅ | ❌ | ✅ | Резерв — PRD не нужен |

**Активные агенты покрыты: 9 из 9** | Резервные (отключены): не требуют PRD

## Open Questions

- Приоритет создания PRD: начинать с активных (analytics, fin-agent) или по алфавиту?
- analytics и fin-agent: создать сначала AGENT.md или сразу PRD?
- Нужен ли шаблон PRD в `PRD/_template.md`?

## Session Log

### 2026-05-20 — Закрытие пробелов PRD + Vault [done]
- **What was done:** Созданы PRD для mahsan, skill-creator, bug-agent, biz-analyst. Vault-заметки для bug-agent и biz-analyst. Обновлена таблица статусов. Активные агенты покрыты полностью (9/9). Резервные агенты (yael, chen, guy, yuval, reuven) не требуют PRD — они отключены в CLAUDE.md.
- **Rule adopted:** При создании нового агента — сразу создавать AGENT.md + PRD + Vault note (три базовые вещи).
- **Related:** [[agent-bug-agent]], [[agent-biz-analyst]], [[mahsan-planogram]]

### 2026-05-04 — Инициализация PRD Audit [wip]
- **What was done:** Обнаружено что 7 из 10 агентов не имеют PRD. CEO AGENT.md обновлён — добавлена Фаза 0 (PRD Audit при старте сессии). CLAUDE.md обновлён с инструкцией запускать аудит. Создан этот tracking файл.
- **Decisions:** CEO проверяет PRD покрытие при каждом старте сессии автоматически; сообщает только при наличии пробелов (не спамит когда всё OK).
- **Notes / Caveats:** analytics и fin-agent упомянуты в CLAUDE.md но не имеют папки в `.claude/AGENTS/` — нужно создать полноценные AGENT.md перед PRD.
- **Related:** [[ceo-agent-prd]], [[agent-designer]], [[agent-geograf]]
