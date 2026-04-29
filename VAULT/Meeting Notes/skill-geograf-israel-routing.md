# Skill Geograf Israel Routing

## Overview
Навык `geograf-israel-routing` добавлен для построения корректного маршрутизатора визитов в Израиле: SQL-вход, обязательный вопрос о городе старта, обработка иврит-адресов, расчет детерминированного `סדר ביקור` и учет дорожных ограничений. Дополнительно добавлен benchmark по конкуренту ASCOMY.

## Open Questions
- Включать ли этот skill в обязательную загрузку через `CLAUDE.md`
- Какой конкретный источник road-closure событий использовать в production
- Нужен ли отдельный skill для только geocoding/normalization или достаточно текущего

## Session Log

### 2026-04-29 — Добавлен skill для израильской маршрутизации [wip]
- **What was done:** Созданы `.claude/SKILLS/geograf-israel-routing/SKILL.md` и `.claude/SKILLS/geograf-israel-routing/ascomy-benchmark.md`.
- **Decisions:** В skill закреплено правило `start_city` как обязательный блокер перед оптимизацией и parity checklist на основе публичных возможностей ASCOMY.
- **Notes / Caveats:** Benchmark основан на публичных страницах продукта/FAQ конкурента; без reverse engineering.
- **Related:** [[agent-geograf]], [[ceo-agent-prd]], [[skills-folder-architecture]]

### 2026-04-29 — Добавлены Obsidian артефакты для ops [wip]
- **What was done:** Созданы `VAULT/Meeting Notes/geograf-ops-obsidian.md` и `VAULT/Meeting Notes/geograf-daily-routing.base` для ежедневной работы по маршрутизации.
- **Decisions:** В Obsidian-шаблоне зафиксирован mandatory gate: сначала `start_city`, потом построение `סדר ביקור`.
- **Notes / Caveats:** `.base` настроен как минимальный table-view для операционного контроля заполненности ключевых полей.
- **Related:** [[geograf-ops-obsidian]], [[agent-geograf]], [[skill-geograf-israel-routing]]
